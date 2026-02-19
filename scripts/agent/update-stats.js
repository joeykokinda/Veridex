#!/usr/bin/env node
/**
 * Update agent stats after job completion
 * Usage: node scripts/agent/update-stats.js <agent-address> <payment-hbar> <rating> <success>
 */

const { ethers } = require("ethers");
require("dotenv").config();

const CONTRACT_ABI = [
  "function updateAgentStats(address agentAddress, uint256 payment, uint256 rating, bool success) external",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))",
];

async function updateStats(agentAddress, paymentHBAR, rating, success) {
  try {
    // Validate inputs
    if (!ethers.isAddress(agentAddress)) {
      console.error("Invalid agent address");
      process.exit(1);
    }

    const ratingNum = parseInt(rating);
    if (ratingNum < 0 || ratingNum > 100) {
      console.error("Rating must be between 0-100");
      process.exit(1);
    }

    // Connect to Hedera testnet
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(
      process.env.AGENT_IDENTITY_CONTRACT,
      CONTRACT_ABI,
      wallet
    );

    console.log("\nUpdating Agent Stats");
    console.log("=".repeat(60));
    console.log(`Agent: ${agentAddress}`);
    console.log(`Payment: ${paymentHBAR} HBAR`);
    console.log(`Rating: ${rating}/100`);
    console.log(`Success: ${success ? "Yes" : "No"}`);
    console.log("");

    // Get current stats
    console.log("Fetching current stats...");
    const before = await contract.getAgent(agentAddress);
    console.log("\nBefore:");
    console.log(`  Jobs Completed: ${before.jobsCompleted}`);
    console.log(`  Jobs Failed: ${before.jobsFailed}`);
    console.log(`  Total Earned: ${ethers.formatEther(before.totalEarned)} HBAR`);
    console.log(`  Reputation: ${before.reputationScore}/1000`);
    console.log(`  Total Ratings: ${before.totalRatings}`);

    // Convert HBAR to wei (1 HBAR = 10^18 wei)
    const paymentWei = ethers.parseEther(paymentHBAR.toString());

    // Submit transaction
    console.log("\nSubmitting transaction...");
    const tx = await contract.updateAgentStats(
      agentAddress,
      paymentWei,
      ratingNum,
      success
    );

    console.log(`Transaction hash: ${tx.hash}`);
    console.log(`HashScan: https://hashscan.io/testnet/transaction/${tx.hash}`);
    console.log("\nWaiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`Confirmed in block ${receipt.blockNumber}`);

    // Get updated stats
    console.log("\nFetching updated stats...");
    const after = await contract.getAgent(agentAddress);
    console.log("\nAfter:");
    console.log(`  Jobs Completed: ${after.jobsCompleted}`);
    console.log(`  Jobs Failed: ${after.jobsFailed}`);
    console.log(`  Total Earned: ${ethers.formatEther(after.totalEarned)} HBAR`);
    console.log(`  Reputation: ${after.reputationScore}/1000`);
    console.log(`  Total Ratings: ${after.totalRatings}`);

    console.log("\nChanges:");
    console.log(`  Jobs Completed: ${before.jobsCompleted} → ${after.jobsCompleted}`);
    console.log(`  Jobs Failed: ${before.jobsFailed} → ${after.jobsFailed}`);
    console.log(
      `  Total Earned: ${ethers.formatEther(before.totalEarned)} → ${ethers.formatEther(after.totalEarned)} HBAR`
    );
    console.log(
      `  Reputation: ${before.reputationScore} → ${after.reputationScore}`
    );

    console.log("\nCheck dashboard: https://www.agenttrust.life/dashboard");
    console.log("Stats will update within 15 seconds!");
  } catch (error) {
    console.error("\nError:", error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 4) {
  console.log("\nUsage: node update-stats.js <agent-address> <payment-hbar> <rating> <success>");
  console.log("\nExample:");
  console.log("  node scripts/agent/update-stats.js 0x93fadd52485c44571a3d4fecd5ef1015635f1656 1.5 85 true");
  console.log("\nArguments:");
  console.log("  agent-address  : Ethereum address of the agent");
  console.log("  payment-hbar   : Payment in HBAR (e.g., 1.5)");
  console.log("  rating         : Rating from 0-100");
  console.log("  success        : true or false");
  process.exit(1);
}

const [agentAddress, paymentHBAR, rating, successStr] = args;
const success = successStr.toLowerCase() === "true";

updateStats(agentAddress, parseFloat(paymentHBAR), rating, success);
