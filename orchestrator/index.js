/**
 * Main entry point for the Veridex orchestrator
 * Security control plane for OpenClaw agents
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Client, PrivateKey, Hbar, TransferTransaction, AccountId } = require("@hashgraph/sdk");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Veridex trust layer modules
const db = require("./veridex-db");
const { checkBlocking, assessRisk, decodeAction } = require("./blocking");
const { getAgentSplitConfig, setAgentSplitConfig } = db;
const { createAgentTopic, writeToHCS, topicHashScanUrl } = require("./hcs-logger");
const { sendAlert } = require("./telegram");
const telegramBot = require("./telegram-bot");
const vault = require("./vault");
const { startJobMonitor, getRecentJobs, getAgentJobs } = require("./job-monitor");

// SSE clients for live feed
const liveClients = new Set();

// Load ABIs
const AgentIdentity = require("../artifacts/contracts/AgentIdentity.sol/AgentIdentity.json");
const AgentMarketplace = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json");

// Create API server
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
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

  // Auto-record earnings NOW (before HCS write) so we have the earningId for the callback
  let earningId = null;
  if (action === "earnings_split" && phase === "after" && params?.amount) {
    const amountHbar = parseFloat(params.amount);
    if (amountHbar > 0) {
      const splitCfg = db.getAgentSplitConfig(agentId);
      earningId = db.insertEarning({
        agentId,
        amountHbar,
        source:        params.txId ? "hts_transfer" : (params.source || "agent_earnings"),
        splitDev:      parseFloat(params.splitDev)      || (amountHbar * splitCfg.splitDev / 100),
        splitOps:      parseFloat(params.splitOps)      || (amountHbar * splitCfg.splitOps / 100),
        splitReinvest: parseFloat(params.splitReinvest) || (amountHbar * splitCfg.splitReinvest / 100),
        hcsPaystubSequence: params.hcsPaystubSequence || null,
      });
    }
  }

  // HCS write async — write paystub for earnings_split, normal audit entry for everything else
  if (agentRecord.hcs_topic_id) {
    const hcsPayload = action === "earnings_split" && phase === "after"
      ? {
          event: "earnings_split",
          logId, agentId, action, tool,
          amountHbar: params?.amount,
          splitDev: params?.splitDev,
          splitOps: params?.splitOps,
          splitReinvest: params?.splitReinvest,
          txId: params?.txId || null,
          hashScanUrl: params?.hashScanUrl || null,
          totalEarned: params?.totalEarned || null,
          timestamp: timestamp || Date.now(),
        }
      : {
          logId, agentId, action, tool,
          params: params ? sanitizeParams(params) : null,
          result: "success", riskLevel: risk, phase,
          timestamp: timestamp || Date.now(),
        };

    writeToHCS(agentRecord.hcs_topic_id, hcsPayload).then(hcsResult => {
      if (hcsResult?.sequenceNumber) {
        try {
          db.getDb().prepare("UPDATE logs SET hcs_sequence_number = ? WHERE id = ?")
            .run(hcsResult.sequenceNumber, logId);
        } catch {}
        // For earnings_split: stamp the paystub sequence number onto the earnings record
        if (earningId) {
          try {
            db.getDb().prepare("UPDATE earnings SET hcs_paystub_sequence = ? WHERE id = ?")
              .run(hcsResult.sequenceNumber, earningId);
          } catch {}
        }
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
 * GET /api/monitor/agent/:agentId/split-config
 * GET current earnings split percentages for an agent.
 */
app.get("/api/monitor/agent/:agentId/split-config", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(db.getAgentSplitConfig(req.params.agentId));
});

/**
 * POST /api/monitor/agent/:agentId/split-config
 * Save earnings split percentages. Body: { splitDev, splitOps, splitReinvest }
 * Must add to 100.
 */
app.post("/api/monitor/agent/:agentId/split-config", (req, res) => {
  const { agentId } = req.params;
  const { splitDev, splitOps, splitReinvest } = req.body;
  const d = parseFloat(splitDev), o = parseFloat(splitOps), r = parseFloat(splitReinvest);
  if ([d, o, r].some(n => isNaN(n) || n < 0)) {
    return res.status(400).json({ error: "splitDev, splitOps, splitReinvest must be non-negative numbers" });
  }
  if (Math.round(d + o + r) !== 100) {
    return res.status(400).json({ error: `Splits must add to 100 (got ${d + o + r})` });
  }
  const agent = db.getAgent(agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  db.setAgentSplitConfig(agentId, { splitDev: d, splitOps: o, splitReinvest: r });
  res.json({ success: true, splitDev: d, splitOps: o, splitReinvest: r });
});

/**
 * GET /api/leaderboard
 * All agents sorted by total actions, with stats for leaderboard display.
 */
app.get("/api/leaderboard", (req, res) => {
  const agents = db.getAllAgents();
  const rows = agents.map(a => {
    const stats = db.getAgentStats(a.id);
    return {
      id: a.id,
      name: a.name || a.id,
      owner_wallet: a.owner_wallet,
      hcs_topic_id: a.hcs_topic_id,
      hashScanUrl: a.hcs_topic_id ? topicHashScanUrl(a.hcs_topic_id) : null,
      totalActions: stats.totalActions,
      blockedActions: stats.blockedActions,
      totalEarned: stats.totalEarned,
      activeAlerts: db.getActiveAlertCount(a.id),
      created_at: a.created_at,
    };
  }).sort((a, b) => b.totalActions - a.totalActions);
  res.json({ agents: rows });
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

// ── Layer 1: Secrets Vault ────────────────────────────────────────────────────

/**
 * POST /v2/vault/store
 * Body: { agentId, secretType, label, value, allowedAgentIds? }
 * Stores an encrypted secret. Raw value never persisted in plaintext.
 */
app.post("/v2/vault/store", (req, res) => {
  const { agentId, secretType, label, value, allowedAgentIds } = req.body;
  if (!agentId || !secretType || !value) {
    return res.status(400).json({ error: "agentId, secretType, and value required" });
  }
  try {
    const result = vault.storeSecret({ ownerAgentId: agentId, secretType, label, value, allowedAgentIds });
    res.json({ success: true, secretId: result.secretId, secretType, label: label || secretType });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /v2/vault/list/:agentId
 * Returns secret metadata for an agent (never values).
 */
app.get("/v2/vault/list/:agentId", (req, res) => {
  const secrets = vault.listSecrets(req.params.agentId);
  const grants  = vault.getGrants(req.params.agentId);
  res.json({ secrets, recentGrants: grants.slice(0, 20) });
});

/**
 * DELETE /v2/vault/secret/:secretId
 * Body: { agentId }
 */
app.delete("/v2/vault/secret/:secretId", (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const result = vault.deleteSecret(req.params.secretId, agentId);
  if (!result.ok) return res.status(403).json({ error: result.reason });
  res.json({ success: true });
});

/**
 * POST /v2/vault/request
 * Body: { agentId, secretType, endpoint? }
 * Issues a 60s scoped capability token. Logs grant/denial to HCS.
 */
app.post("/v2/vault/request", async (req, res) => {
  const { agentId, secretType, endpoint } = req.body;
  if (!agentId || !secretType) {
    return res.status(400).json({ error: "agentId and secretType required" });
  }

  const result = vault.requestCapability({ requestingAgentId: agentId, secretType, endpoint });

  // Log grant/denial to HCS
  const agentRecord = db.getAgent(agentId);
  if (agentRecord?.hcs_topic_id) {
    writeToHCS(agentRecord.hcs_topic_id, {
      event:      result.granted ? "capability_granted" : "capability_denied",
      agentId, secretType, endpoint: endpoint || "*",
      reason:     result.reason || null,
      expiresAt:  result.expiresAt || null,
      timestamp:  Date.now(),
    }).catch(() => {});
  }

  if (!result.granted) {
    // Alert on denial
    sendAlert({
      agentId, agentName: agentRecord?.name || agentId,
      triggerType: "capability_denied",
      description: `Capability denied: ${secretType} — ${result.reason}`,
      topicId: agentRecord?.hcs_topic_id,
    }).catch(() => {});
    return res.status(403).json({ granted: false, reason: result.reason });
  }

  res.json(result);
});

// ── Layer 4: ERC-8183 Job Monitor ─────────────────────────────────────────────

/**
 * GET /v2/jobs
 * All recent jobs across all agents.
 */
app.get("/v2/jobs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50"), 200);
  res.json({ jobs: getRecentJobs(limit) });
});

/**
 * GET /v2/jobs/agent/:agentAddress
 * Jobs for a specific agent wallet address.
 */
app.get("/v2/jobs/agent/:agentAddress", (req, res) => {
  res.json({ jobs: getAgentJobs(req.params.agentAddress) });
});

// ── Layer 8: Verifiable Operational History (Tamper-Proof Agent Memory) ───────

/**
 * GET /v2/agent/:agentId/memory
 * Reads last 50 HCS messages from Mirror Node + local DB state.
 * Returns structured context the agent should inject at startup.
 *
 * This is NOT generic "agent memory" (LangChain/Mem0 solved that).
 * This is VERIFIABLE OPERATIONAL HISTORY — cryptographically provable,
 * tamper-proof, independent of any server. Other agents can verify it too.
 */
app.get("/v2/agent/:agentId/memory", async (req, res) => {
  const { agentId } = req.params;
  const agentRecord = db.getAgent(agentId);

  if (!agentRecord) {
    return res.status(404).json({ error: "Agent not found. Register via POST /api/agent/register-monitor first." });
  }

  // ── Pull HCS history from Mirror Node ─────────────────────────────────────
  let hcsMessages = [];
  if (agentRecord.hcs_topic_id) {
    try {
      const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${agentRecord.hcs_topic_id}/messages?limit=50&order=desc`;
      const resp = await fetch(mirrorUrl, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json();
        hcsMessages = (data.messages || []).map(m => {
          try {
            const decoded = Buffer.from(m.message, "base64").toString("utf8");
            const parsed  = JSON.parse(decoded);
            return {
              sequenceNumber: m.sequence_number,
              consensusTimestamp: m.consensus_timestamp,
              hashScanUrl: `https://hashscan.io/testnet/topic/${agentRecord.hcs_topic_id}`,
              ...parsed,
            };
          } catch {
            return { sequenceNumber: m.sequence_number, raw: m.message };
          }
        });
      }
    } catch (e) {
      console.warn("[Memory] Mirror Node fetch failed:", e.message);
    }
  }

  // ── Structure HCS messages into categories ─────────────────────────────────
  const blockedActions = [];
  const recentCompletions = [];
  const earningEvents = [];
  const capabilityEvents = [];

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const msg of hcsMessages) {
    const ts = msg.timestamp || 0;
    if (ts < sevenDaysAgo && ts > 0) continue; // ignore entries older than 7 days

    if (msg.result === "blocked" || msg.riskLevel === "blocked") {
      blockedActions.push({
        tool:          msg.tool || msg.action,
        blockReason:   msg.blockReason,
        timestamp:     ts,
        sequenceNumber: msg.sequenceNumber,
        hashScanUrl:   msg.hashScanUrl,
      });
    } else if (msg.event === "job_completed") {
      recentCompletions.push({
        jobId:      msg.jobId,
        amountHbar: msg.amountHbar,
        timestamp:  ts,
        sequenceNumber: msg.sequenceNumber,
        hashScanUrl: msg.hashScanUrl,
      });
    } else if (msg.event === "capability_granted" || msg.event === "capability_denied") {
      capabilityEvents.push({
        event:      msg.event,
        secretType: msg.secretType,
        timestamp:  ts,
      });
    } else if (msg.action === "earnings_split" || msg.event === "earnings_split") {
      earningEvents.push({
        amount:    msg.params?.amount || msg.amountHbar,
        timestamp: ts,
      });
    }
  }

  // ── Pull current state from local DB ───────────────────────────────────────
  const stats         = db.getAgentStats(agentId);
  const openJobs      = db.getJobsByAgent(agentRecord.owner_wallet || "").filter(j => ["Open","Funded","Submitted","Bidding"].includes(j.status));
  const recentEarnings = db.getAgentEarnings(agentId).slice(0, 5);
  const activeAlerts  = db.getAgentAlerts(agentId, { status: "active", limit: 5 });

  const pendingEarnings = recentEarnings
    .filter(e => Date.now() - e.timestamp < 24 * 60 * 60 * 1000)
    .reduce((sum, e) => sum + (e.amount_hbar || 0), 0);

  // ── Build human-readable summary (inject into LLM context) ────────────────
  const lines = [`You are agent ${agentId}. Here is your verified operational history from Hedera HCS:`];

  if (openJobs.length > 0) {
    lines.push(`\nOPEN JOBS (${openJobs.length}):`);
    openJobs.forEach(j => lines.push(`  - Job #${j.job_id} [${j.status}] — ${j.budget || "?"} HBAR escrow`));
  }

  if (blockedActions.length > 0) {
    lines.push(`\nBLOCKED ACTIONS — do NOT retry these:`);
    blockedActions.slice(0, 5).forEach(b => lines.push(`  - ${b.tool || "unknown"}: ${b.blockReason || "policy violation"}`));
  }

  if (recentCompletions.length > 0) {
    lines.push(`\nRECENT COMPLETIONS (${recentCompletions.length}):`);
    recentCompletions.slice(0, 3).forEach(c => lines.push(`  - Job #${c.jobId}: ${c.amountHbar} HBAR earned`));
  }

  if (pendingEarnings > 0) {
    lines.push(`\nPENDING EARNINGS: ${pendingEarnings.toFixed(4)} HBAR (last 24h, not yet split)`);
  }

  lines.push(`\nLIFETIME STATS: ${stats.totalActions} actions · ${stats.blockedActions} blocked · ${stats.totalEarned?.toFixed(4) || 0} HBAR total earned`);

  if (activeAlerts.length > 0) {
    lines.push(`\nACTIVE ALERTS: ${activeAlerts.length} unresolved — check /monitor/${agentId}`);
  }

  if (agentRecord.hcs_topic_id) {
    lines.push(`\nAUDIT TRAIL: https://hashscan.io/testnet/topic/${agentRecord.hcs_topic_id}`);
    lines.push(`(Every entry above is cryptographically verifiable on Hedera — this history cannot be tampered with)`);
  }

  res.json({
    agentId,
    hcsTopicId:       agentRecord.hcs_topic_id || null,
    hashScanUrl:      agentRecord.hcs_topic_id ? topicHashScanUrl(agentRecord.hcs_topic_id) : null,
    open_jobs:        openJobs,
    blocked_actions:  blockedActions,
    recent_completions: recentCompletions,
    capability_events:  capabilityEvents,
    pending_earnings: parseFloat(pendingEarnings.toFixed(4)),
    lifetime_stats:   stats,
    active_alerts:    activeAlerts,
    hcs_message_count: hcsMessages.length,
    summary:          lines.join("\n"),
    note:             "Inject `summary` into your LLM context at startup. This history is immutable on Hedera HCS.",
  });
});

// Start server
const PORT = process.env.ORCHESTRATOR_PORT || 3001;
app.listen(PORT, () => {
  // Start ERC-8183 job monitor in background
  startJobMonitor(broadcastLiveEvent).catch(e => console.error("[JobMonitor] Start error:", e.message));
  // Start Telegram bot (polling)
  telegramBot.start();
  console.log(`\nVeridex Orchestrator running on port ${PORT}`);
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
  console.log(`\n── Secrets Vault (Layer 1) ───────────────────────`);
  console.log(`   POST /v2/vault/store             - Store encrypted secret`);
  console.log(`   GET  /v2/vault/list/:agentId     - List secrets (metadata only)`);
  console.log(`   POST /v2/vault/request           - Request 60s capability token`);
  console.log(`   DELETE /v2/vault/secret/:id      - Delete secret`);
  console.log(`\n── Job Monitor (Layer 4) ─────────────────────────`);
  console.log(`   GET  /v2/jobs                    - All recent ERC-8183 jobs`);
  console.log(`   GET  /v2/jobs/agent/:address     - Jobs for agent wallet`);
  console.log(`\n── Verifiable Memory (Layer 8) ───────────────────`);
  console.log(`   GET  /v2/agent/:id/memory        - Tamper-proof startup context from HCS`);
  console.log(`\nReady.\n`);
});

// Prevent uncaught promise rejections from crashing the process (e.g. Hedera 502s)
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (non-fatal):", reason?.message || reason);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down gracefully...");
  process.exit(0);
});
