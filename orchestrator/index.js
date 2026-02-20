/**
 * Main entry point for the orchestrator
 * Loads config, starts agents, exposes activity feed API
 */

const express = require("express");
const cors = require("cors");
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

// Get agent list
app.get("/api/agents", (req, res) => {
  const agents = [];
  for (const [name, agent] of orchestrator.agents) {
    agents.push({
      name,
      address: agent.wallet.address,
      mode: agent.personality.mode,
      lastAction: agent.lastAction
    });
  }
  res.json({ agents });
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
  
  try {
    await orchestrator.start();
    res.json({ success: true, message: "Simulation started" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
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
  console.log(`\n📡 Activity feed API running on port ${PORT}`);
  console.log(`   GET /api/activity - Get live activity feed`);
  console.log(`   GET /api/agents - Get agent list`);
});

// Start orchestrator
orchestrator.start().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down gracefully...");
  orchestrator.stop();
  process.exit(0);
});
