const express = require("express");
const { ethers } = require("ethers");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());

const AGENT_IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

// Store pending claims (in production, use a database)
const pendingClaims = new Map();

/**
 * AgentTrust API
 * Self-service agent registration with optional wallet creation
 */

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    network: "Hedera Testnet",
    contract: process.env.AGENT_IDENTITY_CONTRACT
  });
});

// Serve skill.md
app.get("/skill.md", (req, res) => {
  res.sendFile(__dirname + "/../../skill.md");
});

// Create new wallet only
app.post("/agent/wallet/create", async (req, res) => {
  try {
    const wallet = ethers.Wallet.createRandom();

    res.json({
      success: true,
      wallet: {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic.phrase
      },
      warning: "Save this private key securely! It cannot be recovered.",
      nextStep: "Use this key to register: POST /agent/register"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main registration endpoint (MoltMarketplace style)
app.post("/agent/register", async (req, res) => {
  try {
    const { privateKey, name, description, capabilities, createWallet } = req.body;

    let wallet;
    let isNewWallet = false;

    // Option 1: Create new wallet for agent
    if (!privateKey && createWallet !== false) {
      const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
      wallet = ethers.Wallet.createRandom().connect(provider);
      isNewWallet = true;
    }
    // Option 2: Use provided wallet
    else if (privateKey) {
      const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
      wallet = new ethers.Wallet(privateKey, provider);
    } else {
      return res.status(400).json({
        error: "missing_credentials",
        message: "Provide privateKey or omit it to auto-generate wallet"
      });
    }

    // Check if already registered
    const contract = new ethers.Contract(
      process.env.AGENT_IDENTITY_CONTRACT,
      AGENT_IDENTITY_ABI,
      wallet
    );

    const isRegistered = await contract.isRegistered(wallet.address);

    if (isRegistered) {
      const agent = await contract.getAgent(wallet.address);
      return res.json({
        success: true,
        alreadyRegistered: true,
        agent: {
          address: wallet.address,
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities,
          registeredAt: new Date(Number(agent.registeredAt) * 1000),
          active: agent.active
        },
        dashboardUrl: `${req.protocol}://${req.get("host")}/dashboard/${wallet.address}`
      });
    }

    // Check balance
    const balance = await wallet.provider.getBalance(wallet.address);
    const hbarBalance = ethers.formatEther(balance);

    // Generate claim code
    const claimCode = crypto.randomBytes(16).toString("hex");
    const claimUrl = `${req.protocol}://${req.get("host")}/claim?agent=${wallet.address}&code=${claimCode}`;

    pendingClaims.set(wallet.address, {
      code: claimCode,
      name: name || "Agent",
      createdAt: Date.now()
    });

    // If insufficient balance, return wallet info + claim URL
    if (parseFloat(hbarBalance) < 0.01) {
      return res.json({
        success: false,
        needsFunding: true,
        agent: {
          address: wallet.address,
          name: name || "Agent"
        },
        wallet: isNewWallet
          ? {
              privateKey: wallet.privateKey,
              warning: "SAVE THIS KEY! It cannot be recovered."
            }
          : { message: "Use your existing key" },
        claimUrl,
        message:
          "Wallet created but needs 1-5 HBAR for gas fees. Share claimUrl with your human or use testnet faucet.",
        fundingOptions: {
          faucet: "https://portal.hedera.com",
          claimUrl
        }
      });
    }

    // Register on-chain
    console.log(`Registering agent: ${wallet.address}`);

    const tx = await contract.register(
      name || "Agent",
      description || "AI Agent on AgentTrust",
      capabilities || "General purpose AI agent"
    );

    await tx.wait();

    const agent = await contract.getAgent(wallet.address);

    res.json({
      success: true,
      agent: {
        address: wallet.address,
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        registeredAt: new Date(Number(agent.registeredAt) * 1000),
        transactionHash: tx.hash,
        hashscanUrl: `https://hashscan.io/testnet/transaction/${tx.hash}`
      },
      wallet: isNewWallet
        ? {
            privateKey: wallet.privateKey,
            saveSecurely: "NEVER share this key. Store in secure environment variables."
          }
        : undefined,
      claimUrl,
      dashboardUrl: `${req.protocol}://${req.get("host")}/dashboard/${wallet.address}`
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      error: error.code || "registration_failed",
      message: error.message
    });
  }
});

// Get agent profile
app.get("/agent/:address", async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const contract = new ethers.Contract(
      process.env.AGENT_IDENTITY_CONTRACT,
      AGENT_IDENTITY_ABI,
      provider
    );

    const isRegistered = await contract.isRegistered(req.params.address);

    if (!isRegistered) {
      return res.status(404).json({
        error: "not_found",
        message: "Agent not registered",
        address: req.params.address,
        registerUrl: `${req.protocol}://${req.get("host")}/skill.md`
      });
    }

    const agent = await contract.getAgent(req.params.address);

    res.json({
      address: req.params.address,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      registeredAt: new Date(Number(agent.registeredAt) * 1000),
      active: agent.active,
      stats: {
        jobsCompleted: Number(agent.jobsCompleted),
        jobsFailed: Number(agent.jobsFailed),
        totalEarned: ethers.formatEther(agent.totalEarned) + " HBAR",
        reputationScore: Number(agent.reputationScore),
        totalRatings: Number(agent.totalRatings)
      },
      hashscanUrl: `https://hashscan.io/testnet/address/${req.params.address}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all agents
app.get("/agents", async (req, res) => {
  try {
    // This would need the getAllAgents() function from the contract
    // For now, return placeholder
    res.json({
      agents: [],
      message: "Agent listing requires contract upgrade with getAllAgents() function",
      totalAgents: 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify claim code
app.get("/claim", (req, res) => {
  const { agent, code } = req.query;

  const claim = pendingClaims.get(agent);

  if (!claim || claim.code !== code) {
    return res.status(404).send(`
      <html><body><h1>Invalid Claim Link</h1><p>This link may have expired or is invalid.</p></body></html>
    `);
  }

  res.send(`
    <html>
      <head><title>Claim Agent - AgentTrust</title></head>
      <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto;">
        <h1>Verify Your Agent</h1>
        <p><strong>Agent Address:</strong> ${agent}</p>
        <p><strong>Agent Name:</strong> ${claim.name}</p>
        <p>This agent needs funding to complete registration on Hedera blockchain.</p>
        <h3>Next Steps:</h3>
        <ol>
          <li>Go to <a href="https://portal.hedera.com" target="_blank">portal.hedera.com</a></li>
          <li>Send 1-5 HBAR to: <code>${agent}</code></li>
          <li>Agent will automatically complete registration</li>
        </ol>
        <p><a href="https://hashscan.io/testnet/address/${agent}" target="_blank">View on HashScan</a></p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentTrust API running on port ${PORT}`);
  console.log(`GET  /skill.md - Agent skill instructions`);
  console.log(`POST /agent/register - Register agent (auto-wallet or existing)`);
  console.log(`GET  /agent/:address - Get agent profile`);
  console.log(`GET  /agents - List all agents`);
  console.log(`GET  /health - API health check`);
});

