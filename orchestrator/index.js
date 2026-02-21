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
require("dotenv").config();

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
        totalEarned: ethers.formatEther(agentData.totalEarned),
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

// Start server
const PORT = process.env.ORCHESTRATOR_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nActivity feed API running on port ${PORT}`);
  console.log(`   GET  /api/activity          - Live activity feed`);
  console.log(`   GET  /api/agents            - Agent list`);
  console.log(`   GET  /api/status            - Simulation status`);
  console.log(`   POST /api/control/start     - Start simulation`);
  console.log(`   POST /api/control/stop      - Stop simulation`);
  console.log(`   POST /api/agent/sign        - OpenClaw: get registry signature for your agent address`);
  console.log(`\nReady. Hit /api/control/start to begin.\n`);
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
