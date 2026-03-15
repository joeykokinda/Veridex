/**
 * Main entry point for the orchestrator
 * Loads config, starts agents, exposes activity feed API
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const AgentOrchestrator = require("./agent-orchestrator");
const path = require("path");
const { ethers } = require("ethers");
const { Client, PrivateKey, Hbar, TransferTransaction, AccountId } = require("@hashgraph/sdk");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Veridex trust layer modules
const db = require("./veridex-db");
const { checkBlocking, assessRisk, decodeAction } = require("./blocking");
const { createAgentTopic, writeToHCS, topicHashScanUrl } = require("./hcs-logger");
const { sendAlert } = require("./telegram");

// SSE clients for live feed
const liveClients = new Set();

// Load ABIs
const AgentIdentity = require("../artifacts/contracts/AgentIdentity.sol/AgentIdentity.json");
const AgentMarketplace = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json");

// Configuration
const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  observerKey: process.env.DEPLOYER_PRIVATE_KEY,
  activeAgents: ["albert", "eli", "gt", "joey"], // 4-agent demo: poet, artist, generalist, scammer
  tickInterval: 8000, // 8 seconds for faster demo
  toolGateway: {
    rpcUrl: "https://testnet.hashio.io/api",
    identityAddress: process.env.AGENT_IDENTITY_CONTRACT,
    marketplaceAddress: process.env.AGENT_MARKETPLACE_CONTRACT,
    contentRegistryAddress: process.env.CONTENT_REGISTRY_CONTRACT,
    maxCallsPerMinute: 50,
    logDir: "./logs",
    registryAuthorityKey: process.env.DEPLOYER_PRIVATE_KEY
  }
};

// Create orchestrator
const orchestrator = new AgentOrchestrator(config);

// Load agent personalities
const personalitiesDir = path.join(__dirname, "../agents/personalities");
orchestrator.loadPersonalities(personalitiesDir);

// Create API server for activity feed
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    agents: orchestrator.agents.size,
    running: orchestrator.running
  });
});

// Get activity feed
app.get("/api/activity", (req, res) => {
  res.json({
    activities: orchestrator.getActivityFeed()
  });
});

// Get jobs board — uses persistent jobEvents + jobDescriptions for reliable display
app.get("/api/jobs-board", (req, res) => {
  res.json({ jobs: orchestrator.getJobsBoard() });
});

// Get agent list — always queries chain live so rep + balance are never stale
app.get("/api/agents", async (req, res) => {
  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const identity = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AgentIdentity.abi,
    provider
  );

  const agents = [];
  for (const [name, agent] of orchestrator.agents) {
    try {
      const [agentData, rawBalance] = await Promise.all([
        identity.getAgent(agent.wallet.address),
        provider.getBalance(agent.wallet.address)
      ]);
      agents.push({
        name,
        address: agent.wallet.address,
        mode: agent.personality?.mode || "default",
        lastAction: agent.lastAction || null,
        reputation: Number(agentData.reputationScore),
        reputationScore: Number(agentData.reputationScore),
        clientScore: Number(agentData.clientScore),
        reportCount: Number(agentData.reportCount),
        warned: Number(agentData.reportCount) >= 2,
        jobsCompleted: Number(agentData.jobsCompleted),
        jobsFailed: Number(agentData.jobsFailed),
        totalEarned: ethers.formatUnits(agentData.totalEarned, 8),
        registered: agentData.active,
        balance: parseFloat(ethers.formatEther(rawBalance)).toFixed(2)
      });
    } catch (err) {
      // fallback to snapshot if chain query fails
      const stats = orchestrator.getAgentStats();
      const s = stats.find(s => s.name === name) || {};
      agents.push({
        name,
        address: agent.wallet.address,
        mode: agent.personality?.mode || "default",
        lastAction: agent.lastAction || null,
        reputation: s.reputationScore || s.reputation || 500,
        reputationScore: s.reputationScore || 500,
        clientScore: s.clientScore || 500,
        reportCount: s.reportCount || 0,
        warned: s.warned || false,
        jobsCompleted: s.jobsCompleted || 0,
        jobsFailed: s.jobsFailed || 0,
        totalEarned: s.totalEarned || "0",
        registered: s.registered || false,
        balance: "0.00"
      });
    }
  }
  res.json({ agents });
});

// Get personality files for all agents
app.get("/api/personalities", (req, res) => {
  const personalitiesDir = path.join(__dirname, "../agents/personalities");
  const personalities = {};
  try {
    const files = fs.readdirSync(personalitiesDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = path.basename(file, ".md");
      personalities[name] = fs.readFileSync(path.join(personalitiesDir, file), "utf-8");
    }
    res.json({ personalities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get simulation status
app.get("/api/status", (req, res) => {
  res.json({
    running: orchestrator.running,
    pendingAction: orchestrator.pendingAction || null,
    agents: orchestrator.agents.size,
    uptime: orchestrator.startTime
      ? Math.floor((Date.now() - orchestrator.startTime) / 1000) + "s"
      : "0s",
    lastTick: orchestrator.lastTickTime
      ? new Date(orchestrator.lastTickTime).toLocaleTimeString()
      : "N/A"
  });
});

// Control endpoints
app.post("/api/control/start", async (req, res) => {
  if (orchestrator.running) {
    return res.json({ success: false, message: "Simulation already running" });
  }

  // Respond immediately, start runs in background (registration + first tick can take ~30s)
  res.json({ success: true, message: "Simulation starting — agents registering on-chain..." });

  orchestrator.start().catch(error => {
    console.error("Start error:", error);
  });
});

app.post("/api/control/stop", (req, res) => {
  if (!orchestrator.running) {
    return res.json({ success: false, message: "Simulation not running" });
  }
  orchestrator.stop();
  res.json({ success: true, message: "Simulation stopped" });
});

// Unregister all agents on-chain and stop the simulation
app.post("/api/control/unregister-all", async (req, res) => {
  if (orchestrator.pendingAction) {
    return res.json({ success: false, message: `Busy: ${orchestrator.pendingAction}` });
  }
  res.json({ success: true, message: "Unregistering all agents from chain..." });
  orchestrator.unregisterAll().catch(err => {
    console.error("Unregister-all error:", err);
    orchestrator.pendingAction = null;
  });
});

// ── OpenClaw / external agent registration ────────────────────────────────────
//
// Two-step challenge-response flow. Proves the registrant is running automated
// code (an agent), not a human typing in a terminal.
//
// Step 1: POST /api/agent/challenge  →  get a random nonce, 5s timer starts
// Step 2: POST /api/agent/sign       →  submit signed nonce within 5s → get registry sig
//
// Why this proves agency: signing a 32-byte nonce with secp256k1 requires code.
// A human cannot compute it manually within the deadline. An agent does it in ~50ms.
//
// Limitation (honest): any developer could write a script to pass this. The
// full trustless solution is TEE attestation (Intel TDX / Phala Cloud) — the
// hardware proves an autonomous process is running, not a human or script.
// That is one contract swap away.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

const registryAuthority = process.env.DEPLOYER_PRIVATE_KEY
  ? new ethers.Wallet(
      process.env.DEPLOYER_PRIVATE_KEY,
      new ethers.JsonRpcProvider("https://testnet.hashio.io/api")
    )
  : null;

// address (lowercase) → { nonce, issuedAt, expiresAt }
const pendingChallenges = new Map();

const CHALLENGE_TTL_MS = 5000; // 5 seconds — impossible to sign manually, trivial for code

// POST /api/agent/challenge
// Body:    { address: "0x..." }
// Returns: { challenge, expiresAt, expiresIn, hint }
// Starts the 5-second clock. Agent must sign the challenge and call /api/agent/sign.
app.post("/api/agent/challenge", (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }

  const nonce     = crypto.randomBytes(32).toString("hex");
  const issuedAt  = Date.now();
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;

  pendingChallenges.set(address.toLowerCase(), { nonce, issuedAt, expiresAt });

  // Clean up expired challenges periodically
  for (const [addr, c] of pendingChallenges) {
    if (Date.now() > c.expiresAt + 60000) pendingChallenges.delete(addr);
  }

  res.json({
    challenge:  nonce,
    expiresAt,
    expiresIn:  `${CHALLENGE_TTL_MS / 1000} seconds`,
    hint:       "Sign this nonce with your agent's private key using ethers.signMessage() and POST to /api/agent/sign within the deadline."
  });
});

// POST /api/agent/sign
// Body:    { address: "0x...", challengeSignature: "0x..." }
// Returns: { registrySignature, address, contractAddress, registryAuthority, elapsed }
// Verifies the challenge was signed correctly and within the 5s window.
// On success, returns a registry signature the agent uses to call registerVerified() on-chain.
app.post("/api/agent/sign", async (req, res) => {
  const { address, challengeSignature } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }
  if (!challengeSignature) {
    return res.status(400).json({
      error: "Missing challengeSignature. Did you call /api/agent/challenge first?",
      hint:  "POST /api/agent/challenge to get your nonce, sign it within 5 seconds, then POST here."
    });
  }
  if (!registryAuthority) {
    return res.status(500).json({ error: "Registry authority not configured" });
  }

  const key       = address.toLowerCase();
  const challenge = pendingChallenges.get(key);

  if (!challenge) {
    return res.status(400).json({
      error: "No pending challenge for this address. Request one via POST /api/agent/challenge."
    });
  }

  const elapsed = Date.now() - challenge.issuedAt;

  // ── Timing check ──────────────────────────────────────────────────────────
  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(key);
    return res.status(400).json({
      error:   `Challenge expired. You took ${(elapsed / 1000).toFixed(2)}s — limit is ${CHALLENGE_TTL_MS / 1000}s.`,
      elapsed: `${elapsed}ms`,
      hint:    "Agents complete this in <500ms. If you are human, you cannot sign a secp256k1 nonce manually in time."
    });
  }

  // ── Signature check ───────────────────────────────────────────────────────
  let recovered;
  try {
    recovered = ethers.verifyMessage(challenge.nonce, challengeSignature);
  } catch {
    pendingChallenges.delete(key);
    return res.status(400).json({ error: "Invalid challenge signature format." });
  }

  if (recovered.toLowerCase() !== key) {
    pendingChallenges.delete(key);
    return res.status(400).json({
      error:    "Signature mismatch — wrong key signed the challenge.",
      expected: address,
      got:      recovered
    });
  }

  // ── Challenge passed — issue registry signature ───────────────────────────
  pendingChallenges.delete(key);

  try {
    const msgHash          = ethers.solidityPackedKeccak256(["address"], [address]);
    const registrySignature = await registryAuthority.signMessage(ethers.getBytes(msgHash));

    res.json({
      address,
      registrySignature,
      elapsed:           `${elapsed}ms`,
      contractAddress:   process.env.AGENT_IDENTITY_CONTRACT,
      registryAuthority: registryAuthority.address,
      instructions:      "Call registerVerified(name, description, capabilities, registrySignature) on the contract."
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Testnet Faucet ─────────────────────────────────────────────────────────
// For OpenClaw agents and demo participants to get HBAR to cover gas.
// Sends 2 HBAR per request, max once per address per hour, capped at 5 HBAR balance.
//
// POST /api/faucet
// Body:    { address: "0x..." }
// Returns: { txHash, amount, newBalance } | { error, alreadyFunded, balance }
// ─────────────────────────────────────────────────────────────────────────────

const faucetCooldowns = new Map(); // address → last funded timestamp
const FAUCET_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const FAUCET_AMOUNT_HBAR = 2;               // 2 HBAR per request
const FAUCET_MAX_BALANCE = 5;               // don't fund if already has 5+ HBAR

// Use ethers provider only for balance checks (read-only)
const faucetProvider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");

// Hedera SDK client for sending — handles new account auto-creation via TransferTransaction
// (raw ethers sendTransaction cannot create new Hedera accounts; Hedera SDK can)
function makeFaucetClient() {
  if (!process.env.DEPLOYER_ACCOUNT_ID || !process.env.DEPLOYER_PRIVATE_KEY) return null;
  try {
    const client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID),
      PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY)
    );
    return client;
  } catch (e) {
    console.error("Faucet: failed to init Hedera client:", e.message);
    return null;
  }
}

app.post("/api/faucet", async (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }

  const key            = address.toLowerCase();
  const lastFunded     = faucetCooldowns.get(key) || 0;
  const cooldownRemaining = FAUCET_COOLDOWN_MS - (Date.now() - lastFunded);

  if (cooldownRemaining > 0) {
    const mins = Math.ceil(cooldownRemaining / 60000);
    return res.status(429).json({
      error: `Already funded recently. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      retryAfterMs: cooldownRemaining
    });
  }

  // Check current balance (read-only via ethers, works for existing and new addresses)
  let currentBalance = 0;
  try {
    const raw = await faucetProvider.getBalance(address);
    currentBalance = parseFloat(ethers.formatEther(raw));
  } catch (_) {
    // New address with no account yet — balance is 0, proceed to fund
  }

  if (currentBalance >= FAUCET_MAX_BALANCE) {
    return res.status(200).json({
      alreadyFunded: true,
      balance: currentBalance.toFixed(4) + " HBAR",
      message: `Address already has ${currentBalance.toFixed(2)} HBAR — no funding needed.`
    });
  }

  // Send HBAR using Hedera SDK TransferTransaction.
  // This is the correct way to fund a brand-new EVM address on Hedera:
  // raw ethers sendTransaction fails for addresses with no existing Hedera account,
  // but TransferTransaction auto-creates a hollow account for the EVM alias.
  const client = makeFaucetClient();
  if (!client) {
    return res.status(503).json({ error: "Faucet not configured on this server (missing DEPLOYER_ACCOUNT_ID or DEPLOYER_PRIVATE_KEY)" });
  }

  try {
    const operatorId = AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID);
    const tx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-FAUCET_AMOUNT_HBAR))
      .addHbarTransfer(address, new Hbar(FAUCET_AMOUNT_HBAR))
      .execute(client);

    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") {
      throw new Error("Transfer status: " + receipt.status.toString());
    }

    faucetCooldowns.set(key, Date.now());
    client.close();

    // Wait briefly for Hedera finality then check new balance
    await new Promise(r => setTimeout(r, 4000));
    let newBalance = FAUCET_AMOUNT_HBAR;
    try {
      const newRaw = await faucetProvider.getBalance(address);
      newBalance = parseFloat(ethers.formatEther(newRaw));
    } catch (_) {}

    res.json({
      success:    true,
      txHash:     tx.transactionId.toString(),
      amount:     FAUCET_AMOUNT_HBAR + " HBAR",
      newBalance: newBalance.toFixed(4) + " HBAR",
      message:    `Sent ${FAUCET_AMOUNT_HBAR} HBAR to ${address}`
    });
  } catch (e) {
    client.close();
    res.status(500).json({ error: "Faucet transfer failed: " + e.message });
  }
});

// ── Veridex Trust Layer API ────────────────────────────────────────────────────

/**
 * POST /api/log
 * Core skill webhook — called by OpenClaw agents before/after every tool use.
 * Runs blocking checks, writes to HCS, stores in SQLite, fires alerts.
 */
app.post("/api/log", async (req, res) => {
  const { agentId, sessionId, action, tool, params, phase, timestamp, riskLevel: clientRisk } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: "agentId required" });
  }

  // Ensure agent exists in DB (auto-create if unknown, get policies)
  let agentRecord = db.getAgent(agentId);
  if (!agentRecord) {
    db.upsertAgent({ id: agentId, name: agentId });
    agentRecord = db.getAgent(agentId);
  }

  const policies = db.getAgentPolicies(agentId);
  const blockResult = checkBlocking(agentId, action, tool, params, policies);

  if (blockResult) {
    // Blocked — log it, alert, return denied
    const description = decodeAction({ action, tool, params, result: "blocked" });
    const logId = db.insertLog({
      agentId, sessionId, action, tool, params,
      description,
      result: "blocked",
      riskLevel: "blocked",
      blockReason: blockResult.reason,
      phase,
      timestamp: timestamp || Date.now()
    });

    // Write to HCS async (don't block response)
    if (agentRecord.hcs_topic_id) {
      writeToHCS(agentRecord.hcs_topic_id, {
        logId, agentId, action, tool, params: params ? sanitizeParams(params) : null,
        result: "blocked", riskLevel: "blocked",
        blockReason: blockResult.reason, phase,
        timestamp: timestamp || Date.now()
      }).then(hcsResult => {
        if (hcsResult?.sequenceNumber) {
          db.insertLog({ agentId, sessionId, action, tool, params, description, result: "blocked",
            riskLevel: "blocked", blockReason: blockResult.reason, phase,
            hcsSequenceNumber: hcsResult.sequenceNumber, timestamp: timestamp || Date.now() });
        }
      }).catch(() => {});
    }

    // Insert alert
    const alertId = db.insertAlert({
      agentId,
      triggerType: "blocked",
      description: `${blockResult.reason} | Tool: ${tool || action}`,
      timestamp: Date.now()
    });

    // Telegram alert
    sendAlert({
      agentId,
      agentName: agentRecord.name,
      triggerType: "blocked",
      description: `Action blocked: *${tool || action}*\nReason: ${blockResult.reason}`,
      topicId: agentRecord.hcs_topic_id
    }).catch(() => {});

    // Broadcast to SSE live clients
    broadcastLiveEvent({
      type: "log",
      log: {
        id: logId, agentId, agentName: agentRecord.name,
        action, tool, description,
        riskLevel: "blocked", blockReason: blockResult.reason,
        phase, timestamp: timestamp || Date.now()
      }
    });

    return res.json({ allowed: false, reason: blockResult.reason });
  }

  // Allowed — assess risk, log it
  const risk = clientRisk || assessRisk(action, tool, params);
  const description = decodeAction({ action, tool, params, result: "success" });

  const logId = db.insertLog({
    agentId, sessionId, action, tool, params, description,
    result: "success", riskLevel: risk, phase,
    timestamp: timestamp || Date.now()
  });

  // HCS write async
  if (agentRecord.hcs_topic_id) {
    writeToHCS(agentRecord.hcs_topic_id, {
      logId, agentId, action, tool,
      params: params ? sanitizeParams(params) : null,
      result: "success", riskLevel: risk, phase,
      timestamp: timestamp || Date.now()
    }).then(hcsResult => {
      if (hcsResult?.sequenceNumber) {
        // Update log with HCS sequence number
        try {
          db.getDb().prepare("UPDATE logs SET hcs_sequence_number = ? WHERE id = ?")
            .run(hcsResult.sequenceNumber, logId);
        } catch {}
      }
    }).catch(() => {});
  }

  // Alert on high risk
  if (risk === "high") {
    db.insertAlert({
      agentId,
      triggerType: "high_risk",
      description: `High-risk action: ${tool || action}`,
      timestamp: Date.now()
    });
    sendAlert({
      agentId,
      agentName: agentRecord.name,
      triggerType: "high_risk",
      description: `High-risk action detected: *${tool || action}*`,
      topicId: agentRecord.hcs_topic_id
    }).catch(() => {});
  }

  // Broadcast to SSE
  broadcastLiveEvent({
    type: "log",
    log: {
      id: logId, agentId, agentName: agentRecord.name,
      action, tool, description, riskLevel: risk, phase,
      timestamp: timestamp || Date.now()
    }
  });

  res.json({ allowed: true, logId, riskLevel: risk });
});

function sanitizeParams(params) {
  // Never persist secrets in logs
  const REDACT = ["password", "secret", "key", "token", "auth", "credential"];
  const result = {};
  for (const [k, v] of Object.entries(params)) {
    if (REDACT.some(r => k.toLowerCase().includes(r))) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      result[k] = v.slice(0, 500) + "…";
    } else {
      result[k] = v;
    }
  }
  return result;
}

function broadcastLiveEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of liveClients) {
    try { client.write(data); } catch {}
  }
}

/**
 * POST /api/agent/register-monitor
 * Register an agent with the Veridex monitoring system.
 * Creates an HCS topic and stores agent in DB.
 * Body: { agentId, ownerWallet, name, hederaAccountId }
 */
app.post("/api/agent/register-monitor", async (req, res) => {
  const { agentId, ownerWallet, name, hederaAccountId } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });

  let agentRecord = db.getAgent(agentId);

  // Create HCS topic if agent doesn't have one
  let hcsTopicId = agentRecord?.hcs_topic_id;
  if (!hcsTopicId) {
    const topicResult = await createAgentTopic(agentId, name || agentId);
    hcsTopicId = topicResult?.topicId || null;
  }

  db.upsertAgent({ id: agentId, ownerWallet, hederaAccountId, hcsTopicId, name });
  agentRecord = db.getAgent(agentId);

  res.json({
    agentId,
    hcsTopicId,
    hashScanUrl: hcsTopicId ? topicHashScanUrl(hcsTopicId) : null,
    logEndpoint: "/api/log",
    message: "Agent registered with Veridex monitoring. Send logs to POST /api/log"
  });
});

/**
 * GET /api/monitor/agents
 * List all monitored agents (optionally filter by ownerWallet).
 */
app.get("/api/monitor/agents", (req, res) => {
  const { wallet } = req.query;
  const agents = wallet ? db.getAgentsByOwner(wallet) : db.getAllAgents();
  const enriched = agents.map(a => ({
    ...a,
    stats: db.getAgentStats(a.id),
    activeAlerts: db.getActiveAlertCount(a.id),
    hashScanUrl: a.hcs_topic_id ? topicHashScanUrl(a.hcs_topic_id) : null
  }));
  res.json({ agents: enriched });
});

/**
 * GET /api/monitor/agent/:agentId/feed
 * Paginated log history for an agent.
 */
app.get("/api/monitor/agent/:agentId/feed", (req, res) => {
  const { agentId } = req.params;
  const limit  = Math.min(parseInt(req.query.limit  || "50"), 200);
  const offset = parseInt(req.query.offset || "0");
  const { riskLevel, action } = req.query;

  const agent = db.getAgent(agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const logs = db.getAgentLogs(agentId, { limit, offset, riskLevel, action });
  const decoded = logs.map(l => ({ ...l, description: l.description || decodeAction(l) }));
  res.json({ logs: decoded, agentId, total: logs.length });
});

/**
 * GET /api/monitor/agent/:agentId/stats
 */
app.get("/api/monitor/agent/:agentId/stats", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const stats    = db.getAgentStats(req.params.agentId);
  const earnings = db.getAgentEarnings(req.params.agentId);
  const alerts   = db.getAgentAlerts(req.params.agentId, { limit: 10 });
  res.json({
    agent,
    stats,
    earnings,
    recentAlerts: alerts,
    hashScanUrl: agent.hcs_topic_id ? topicHashScanUrl(agent.hcs_topic_id) : null
  });
});

/**
 * GET /api/monitor/agent/:agentId/alerts
 */
app.get("/api/monitor/agent/:agentId/alerts", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const alerts = db.getAgentAlerts(req.params.agentId, {
    limit: parseInt(req.query.limit || "50"),
    status: req.query.status
  });
  res.json({ alerts });
});

/**
 * POST /api/monitor/alert/:alertId/resolve
 */
app.post("/api/monitor/alert/:alertId/resolve", (req, res) => {
  db.resolveAlert(req.params.alertId);
  res.json({ success: true });
});

/**
 * GET /api/monitor/agent/:agentId/policies
 */
app.get("/api/monitor/agent/:agentId/policies", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({ policies: db.getAgentPolicies(req.params.agentId) });
});

/**
 * POST /api/monitor/agent/:agentId/policy
 * Body: { type: "blacklist_domain"|"blacklist_command"|"block_file_path", value, label }
 */
app.post("/api/monitor/agent/:agentId/policy", (req, res) => {
  const { agentId } = req.params;
  const { type, value, label } = req.body;
  if (!type || !value) return res.status(400).json({ error: "type and value required" });

  const agent = db.getAgent(agentId);
  if (!agent) {
    db.upsertAgent({ id: agentId });
  }

  const id = db.insertPolicy({ agentId, type, value, label });
  res.json({ success: true, id });
});

/**
 * DELETE /api/monitor/agent/:agentId/policy/:policyId
 */
app.delete("/api/monitor/agent/:agentId/policy/:policyId", (req, res) => {
  db.deletePolicy(req.params.policyId);
  res.json({ success: true });
});

/**
 * GET /feed/live   — SSE stream for real-time log updates
 * Query: ?wallet=0x...  (optional filter)
 */
app.get("/feed/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial burst of recent logs
  const recent = db.getRecentLogs({ ownerWallet: req.query.wallet, limit: 20 });
  const decoded = recent.map(l => ({ ...l, description: l.description || decodeAction(l) }));
  res.write(`data: ${JSON.stringify({ type: "init", logs: decoded })}\n\n`);

  // Keep-alive ping every 20s
  const ping = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 20000);

  liveClients.add(res);

  req.on("close", () => {
    liveClients.delete(res);
    clearInterval(ping);
  });
});

/**
 * GET /api/monitor/overview
 * Global stats across all agents.
 */
app.get("/api/monitor/overview", (req, res) => {
  const d = db.getDb();
  const totalAgents  = d.prepare("SELECT COUNT(*) as c FROM agents").get().c;
  const logsToday    = d.prepare("SELECT COUNT(*) as c FROM logs WHERE timestamp > ?").get(Date.now() - 86400000).c;
  const blockedToday = d.prepare("SELECT COUNT(*) as c FROM logs WHERE risk_level = 'blocked' AND timestamp > ?").get(Date.now() - 86400000).c;
  const activeAlerts = d.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'active'").get().c;
  const totalHbar    = d.prepare("SELECT COALESCE(SUM(amount_hbar),0) as t FROM earnings").get().t;
  res.json({ totalAgents, logsToday, blockedToday, activeAlerts, totalHbar });
});

/**
 * POST /api/monitor/telegram/test
 * Test Telegram alert integration.
 */
app.post("/api/monitor/telegram/test", async (req, res) => {
  const { sendMessage } = require("./telegram");
  const ok = await sendMessage("✅ Veridex Telegram integration working!", req.body.chatId);
  res.json({ success: ok, configured: !!process.env.TELEGRAM_BOT_TOKEN });
});

// Start server
const PORT = process.env.ORCHESTRATOR_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nVeridex Orchestrator running on port ${PORT}`);
  console.log(`\n── Simulation ────────────────────────────────────`);
  console.log(`   GET  /api/activity               - Live activity feed`);
  console.log(`   GET  /api/agents                 - Agent list`);
  console.log(`   GET  /api/status                 - Simulation status`);
  console.log(`   POST /api/control/start          - Start simulation`);
  console.log(`   POST /api/control/stop           - Stop simulation`);
  console.log(`\n── OpenClaw Registration ─────────────────────────`);
  console.log(`   POST /api/agent/challenge        - Get challenge nonce`);
  console.log(`   POST /api/agent/sign             - Get registry signature`);
  console.log(`   POST /api/faucet                 - Get 2 HBAR testnet gas`);
  console.log(`\n── Veridex Trust Layer ───────────────────────────`);
  console.log(`   POST /api/log                    - Skill webhook (core)`);
  console.log(`   POST /api/agent/register-monitor - Register agent for monitoring`);
  console.log(`   GET  /feed/live                  - SSE live log stream`);
  console.log(`   GET  /api/monitor/overview       - Global stats`);
  console.log(`   GET  /api/monitor/agents         - All monitored agents`);
  console.log(`   GET  /api/monitor/agent/:id/feed - Agent log history`);
  console.log(`   GET  /api/monitor/agent/:id/stats - Agent stats`);
  console.log(`   GET  /api/monitor/agent/:id/alerts - Agent alerts`);
  console.log(`   POST /api/monitor/agent/:id/policy - Add blocking rule`);
  console.log(`\nReady.\n`);
});

// Prevent uncaught promise rejections from crashing the process (e.g. Hedera 502s)
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (non-fatal):", reason?.message || reason);
});

// Graceful shutdown - unregister agents on exit
process.on("SIGINT", async () => {
  console.log("\n\nShutting down gracefully...");
  if (orchestrator.running) {
    orchestrator.stop();
    // Give unregister time to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  process.exit(0);
});
