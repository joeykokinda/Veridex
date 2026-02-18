const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const AGENT_IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

/**
 * One-step agent registration
 * Auto-generates wallet if needed, registers on-chain
 * 
 * Usage:
 *   node scripts/agent/quick-register.js "AgentName" "Description" "Capabilities"
 */

async function quickRegister(name, description, capabilities) {
  console.log("\n=== AgentTrust Quick Registration ===\n");

  // Check if contract is deployed
  if (!process.env.AGENT_IDENTITY_CONTRACT) {
    console.error("ERROR: AGENT_IDENTITY_CONTRACT not set in .env");
    console.log("Deploy contract first: npm run deploy");
    process.exit(1);
  }

  const walletFile = path.join(__dirname, "..", "..", ".agent-wallet.json");
  let wallet;
  let isNewWallet = false;

  // Check if wallet exists
  if (fs.existsSync(walletFile)) {
    console.log("Loading existing wallet...");
    const walletData = JSON.parse(fs.readFileSync(walletFile, "utf8"));
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    wallet = new ethers.Wallet(walletData.privateKey, provider);
    console.log("Wallet loaded:", wallet.address);
  } else {
    console.log("No wallet found. Generating new wallet...");
    isNewWallet = true;
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    wallet = ethers.Wallet.createRandom().connect(provider);
    
    // Save wallet
    fs.writeFileSync(
      walletFile,
      JSON.stringify({
        address: wallet.address,
        privateKey: wallet.privateKey,
        createdAt: new Date().toISOString()
      }, null, 2)
    );
    
    console.log("New wallet created:", wallet.address);
    console.log("Wallet saved to:", walletFile);
    console.log("\nIMPORTANT: Fund this address with HBAR before registering!");
    console.log("Transfer 1-5 HBAR to:", wallet.address);
    console.log("Via: https://portal.hedera.com\n");
  }

  // Check balance
  const balance = await wallet.provider.getBalance(wallet.address);
  const hbarBalance = ethers.formatEther(balance);
  
  console.log("Balance:", hbarBalance, "HBAR");

  if (parseFloat(hbarBalance) < 0.1) {
    console.log("\nWARNING: Low balance. You need HBAR for gas fees.");
    if (isNewWallet) {
      console.log("Fund your wallet and run this command again.");
      process.exit(0);
    }
  }

  // Connect to contract
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AGENT_IDENTITY_ABI,
    wallet
  );

  // Check if already registered
  const isRegistered = await contract.isRegistered(wallet.address);
  
  if (isRegistered) {
    console.log("\nAgent already registered!");
    const agent = await contract.getAgent(wallet.address);
    console.log("\nProfile:");
    console.log("  Name:", agent.name);
    console.log("  Address:", wallet.address);
    console.log("  Registered:", new Date(Number(agent.registeredAt) * 1000).toLocaleString());
    return;
  }

  // Register agent
  console.log("\nRegistering on blockchain...");
  console.log("  Name:", name);
  console.log("  Description:", description);
  console.log("  Capabilities:", capabilities);

  try {
    const tx = await contract.register(name, description, capabilities);
    console.log("\nTransaction:", tx.hash);
    console.log("HashScan: https://hashscan.io/testnet/transaction/" + tx.hash);
    console.log("Waiting for confirmation...");
    
    await tx.wait();
    
    console.log("\nRegistration complete!");
    console.log("Agent Address:", wallet.address);
    console.log("\nYour agent is now on-chain and ready to work!");
    
  } catch (error) {
    if (error.message.includes("insufficient funds")) {
      console.error("\nERROR: Insufficient HBAR for gas fees");
      console.log("Fund your wallet:", wallet.address);
      console.log("Via: https://portal.hedera.com");
    } else {
      console.error("\nERROR:", error.message);
    }
    process.exit(1);
  }
}

// CLI
if (require.main === module) {
  const name = process.argv[2] || "Agent";
  const description = process.argv[3] || "Autonomous AI agent on Hedera";
  const capabilities = process.argv[4] || "General purpose AI agent";

  quickRegister(name, description, capabilities)
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { quickRegister };
