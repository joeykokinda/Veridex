const { ethers } = require("ethers");
require("dotenv").config();

async function checkBalance() {
  console.log("\n💰 Wallet Balance Check");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Checking balances on Hedera testnet...\n");

  // Check if .env is configured
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.log("❌ DEPLOYER_PRIVATE_KEY not found in .env");
    console.log("\n💡 Setup steps:");
    console.log("   1. Run: npm run setup:convert-key");
    console.log("   2. Add the output to .env as DEPLOYER_PRIVATE_KEY=0x...\n");
    process.exit(1);
  }

  if (!process.env.AGENT_ALPHA_PRIVATE_KEY) {
    console.log("❌ AGENT_ALPHA_PRIVATE_KEY not found in .env");
    console.log("\n💡 Setup steps:");
    console.log("   1. Run: npm run setup:generate-wallet");
    console.log("   2. Add the output to .env as AGENT_ALPHA_PRIVATE_KEY=0x...\n");
    process.exit(1);
  }

  try {
    // Connect to Hedera testnet
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");

    // Check deployer wallet
    const deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const deployerBalance = await provider.getBalance(deployerWallet.address);
    const deployerHBAR = ethers.formatEther(deployerBalance);

    console.log("👤 Deployer Wallet:");
    console.log("   Address:", deployerWallet.address);
    console.log("   Balance:", parseFloat(deployerHBAR).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }), "HBAR", deployerHBAR > 0 ? "✅" : "❌");

    // Check agent wallet
    const agentWallet = new ethers.Wallet(process.env.AGENT_ALPHA_PRIVATE_KEY, provider);
    const agentBalance = await provider.getBalance(agentWallet.address);
    const agentHBAR = ethers.formatEther(agentBalance);

    console.log("\n🤖 Agent Wallet:");
    console.log("   Address:", agentWallet.address);
    console.log("   Balance:", parseFloat(agentHBAR).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }), "HBAR", agentHBAR > 0 ? "✅" : "❌");

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Provide recommendations
    if (deployerHBAR == 0) {
      console.log("\n⚠️  Deployer wallet needs funding!");
      console.log("   1. Go to https://portal.hedera.com");
      console.log("   2. Navigate to your testnet account");
      console.log("   3. Click the faucet button to get free testnet HBAR");
      console.log("   4. Wait 10-30 seconds and run this script again\n");
    } else if (agentHBAR == 0) {
      console.log("\n⚠️  Agent wallet needs funding!");
      console.log("   Transfer 1-5 HBAR from deployer to agent:");
      console.log("   1. Go to https://portal.hedera.com");
      console.log("   2. Navigate to your testnet account");
      console.log("   3. Click 'Transfer' or 'Send'");
      console.log("   4. Send to:", agentWallet.address);
      console.log("   5. Amount: 5 HBAR");
      console.log("   6. Wait 10 seconds and run this script again\n");
      console.log("   OR deploy first (deployer pays gas), then fund agent for registration\n");
    } else {
      console.log("\n✅ Both wallets are funded!");
      console.log("\n💡 Next steps:");
      if (!process.env.AGENT_IDENTITY_CONTRACT) {
        console.log("   1. Deploy contract: npm run deploy");
        console.log("   2. Add contract address to .env");
        console.log("   3. Register agent: npm run register\n");
      } else {
        console.log("   1. Register agent: npm run register");
        console.log("   2. Check status: npm run status\n");
      }
    }

  } catch (error) {
    console.error("\n❌ Error checking balances:", error.message);
    console.log("\n💡 Troubleshooting:");
    console.log("   - Check your .env file has valid private keys");
    console.log("   - Make sure keys start with '0x'");
    console.log("   - Verify you're using Hedera testnet keys");
    console.log("   - Try running: npm run setup:convert-key\n");
    process.exit(1);
  }
}

checkBalance()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
