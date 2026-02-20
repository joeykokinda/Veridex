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

// Get agent list with reputation stats
app.get("/api/agents", (req, res) => {
  const agents = [];
  const stats = orchestrator.getAgentStats();
  for (const [name, agent] of orchestrator.agents) {
    const agentStats = stats.find(s => s.name === name) || {};
    agents.push({
      name,
      address: agent.wallet.address,
      mode: agent.personality.mode,
      lastAction: agent.lastAction,
      reputation: agentStats.reputationScore || agentStats.reputation || 500,
      reputationScore: agentStats.reputationScore || 500,
      clientScore: agentStats.clientScore || 500,
      reportCount: agentStats.reportCount || 0,
      warned: agentStats.warned || false,
      jobsCompleted: agentStats.jobsCompleted || 0,
      jobsFailed: agentStats.jobsFailed || 0,
      totalEarned: agentStats.totalEarned || "0",
      registered: agentStats.registered || false
    });
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

// ── OpenClaw / external agent integration ─────────────────────────────────────
//
// Any OpenClaw bot can call these endpoints to register on AgentTrust.
//
// Flow:
//   1. POST /api/agent/sign    → get a registry signature for your address
//   2. Use that sig to call registerVerified() on-chain yourself
//
//   OR in one shot:
//   POST /api/agent/register   → we sign + submit the tx on your behalf (you pay nothing)
//
// Limitation (honest): we are the central signer right now.
// Production upgrade: replace with TEE attestation so any agent self-registers
// without needing us at all.
// ─────────────────────────────────────────────────────────────────────────────

const registryAuthority = process.env.DEPLOYER_PRIVATE_KEY
  ? new ethers.Wallet(
      process.env.DEPLOYER_PRIVATE_KEY,
      new ethers.JsonRpcProvider("https://testnet.hashio.io/api")
    )
  : null;

// POST /api/agent/sign
// Body: { address: "0x..." }
// Returns: { signature, address, contractAddress, registryAuthority }
// The OpenClaw bot then calls registerVerified(name, desc, caps, signature) itself.
app.post("/api/agent/sign", async (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }
  if (!registryAuthority) {
    return res.status(500).json({ error: "Registry authority not configured" });
  }
  try {
    const msgHash = ethers.solidityPackedKeccak256(["address"], [address]);
    const signature = await registryAuthority.signMessage(ethers.getBytes(msgHash));
    res.json({
      address,
      signature,
      contractAddress: process.env.AGENT_VERIFIED_IDENTITY_CONTRACT,
      registryAuthority: registryAuthority.address,
      instructions: "Call registerVerified(name, description, capabilities, signature) on the contract with this signature"
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
