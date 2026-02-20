/**
 * Main entry point for the orchestrator
 * Loads config, starts agents, exposes activity feed API
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const AgentOrchestrator = require("./agent-orchestrator");
const path = require("path");
require("dotenv").config();

// Load ABIs
const AgentIdentity = require("../artifacts/contracts/AgentIdentity.sol/AgentIdentity.json");
const AgentMarketplace = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json");

// Configuration
const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  observerKey: process.env.DEPLOYER_PRIVATE_KEY,
  tickInterval: 8000, // 8 seconds for faster demo
  toolGateway: {
    rpcUrl: "https://testnet.hashio.io/api",
    identityAddress: process.env.AGENT_IDENTITY_CONTRACT,
    marketplaceAddress: process.env.AGENT_MARKETPLACE_CONTRACT,
    identityABI: AgentIdentity.abi,
    marketplaceABI: AgentMarketplace.abi,
    maxCallsPerMinute: 50, // Increased for demo
    logDir: "./logs"
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
      reputation: agentStats.reputation || 0,
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

// Start server
const PORT = process.env.ORCHESTRATOR_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nActivity feed API running on port ${PORT}`);
  console.log(`   GET  /api/activity       - Live activity feed`);
  console.log(`   GET  /api/agents         - Agent list`);
  console.log(`   GET  /api/status         - Simulation status`);
  console.log(`   POST /api/control/start  - Start simulation`);
  console.log(`   POST /api/control/stop   - Stop simulation`);
  console.log(`\nReady. Hit /api/control/start to begin.\n`);
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
