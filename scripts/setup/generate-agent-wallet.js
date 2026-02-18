const { ethers } = require("ethers");

console.log("\n🤖 Agent Wallet Generator");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Generating a new random wallet for your AI agent...\n");

try {
  // Generate random wallet
  const wallet = ethers.Wallet.createRandom();

  console.log("✅ Generated new agent wallet!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  console.log("Private Key:");
  console.log(wallet.privateKey);
  
  console.log("\nPublic Address:");
  console.log(wallet.address);
  
  console.log("\n📝 Add this to your .env file as:");
  console.log(`AGENT_ALPHA_PRIVATE_KEY=${wallet.privateKey}`);
  
  console.log("\n⚠️  IMPORTANT: Fund this wallet before registering!");
  console.log("   The agent needs ~1-5 HBAR for gas fees.");
  console.log("   Transfer HBAR to:", wallet.address);
  console.log("   Via: https://portal.hedera.com\n");
  
  console.log("💡 Next steps:");
  console.log("   1. Add keys to .env file (see above)");
  console.log("   2. Check balances: npm run setup:check-balance");
  console.log("   3. If needed, transfer HBAR to agent address");
  console.log("   4. Deploy contract: npm run deploy\n");

} catch (error) {
  console.error("❌ Error generating wallet:", error.message);
  process.exit(1);
}
