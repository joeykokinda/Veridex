const { ethers } = require("ethers");
require("dotenv").config();

// ABI for the AgentIdentity contract (only functions we need)
const AGENT_IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active))"
];

async function main() {
  // Get agent name from command line or use default
  const agentName = process.argv[2] || "AgentAlpha";

  // Check required environment variables
  if (!process.env.AGENT_ALPHA_PRIVATE_KEY) {
    console.error("❌ Error: AGENT_ALPHA_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  if (!process.env.AGENT_IDENTITY_CONTRACT) {
    console.error("❌ Error: AGENT_IDENTITY_CONTRACT not found in .env");
    console.log("💡 Deploy the contract first: npm run deploy");
    process.exit(1);
  }

  // Connect to Hedera testnet
  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const wallet = new ethers.Wallet(process.env.AGENT_ALPHA_PRIVATE_KEY, provider);
  
  // Connect to the contract
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AGENT_IDENTITY_ABI,
    wallet
  );

  const agentAddress = wallet.address;

  console.log("🤖 Agent Address:", agentAddress);
  console.log("📝 Checking registration status...\n");

  try {
    // Check if already registered
    const isRegistered = await contract.isRegistered(agentAddress);

    if (isRegistered) {
      console.log("ℹ️  Agent is already registered!\n");
      
      // Fetch and display existing profile
      const agent = await contract.getAgent(agentAddress);
      const registeredDate = new Date(Number(agent.registeredAt) * 1000);
      
      console.log("✅ Registered Agent Profile:");
      console.log("   Name:", agent.name);
      console.log("   Description:", agent.description);
      console.log("   Capabilities:", agent.capabilities);
      console.log("   Registered:", registeredDate.toLocaleString());
      console.log("   Address:", agentAddress);
      
      return;
    }

    // Register the agent
    console.log("📝 Registering on blockchain...");
    
    const tx = await contract.register(
      agentName,
      "I am an autonomous AI agent built with OpenClaw, participating in the AgentTrust economy on Hedera.",
      "Smart contract interaction, autonomous decision making, blockchain transactions"
    );

    console.log("✅ Transaction:", tx.hash);
    console.log("🔗 HashScan:", `https://hashscan.io/testnet/transaction/${tx.hash}`);
    console.log("⏱️  Waiting for confirmation...");

    // Wait for transaction confirmation
    await tx.wait();

    console.log("✅ Registration complete!\n");

    // Fetch and display the new profile
    const agent = await contract.getAgent(agentAddress);
    const registeredDate = new Date(Number(agent.registeredAt) * 1000);

    console.log("📋 Your Agent Profile:");
    console.log("   Name:", agent.name);
    console.log("   Description:", agent.description);
    console.log("   Capabilities:", agent.capabilities);
    console.log("   Registered:", registeredDate.toLocaleString());
    console.log("   Address:", agentAddress);

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
