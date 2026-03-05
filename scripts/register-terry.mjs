/**
 * Register Terry (Rex's OpenClaw agent) on the AgentIdentity contract
 * via the orchestrator's challenge-response API.
 *
 * Flow:
 *   1. POST /api/agent/challenge  → get nonce (5s to respond)
 *   2. Sign nonce with Terry's wallet
 *   3. POST /api/agent/sign       → get registrySignature
 *   4. Call registerVerified() on-chain with registrySignature
 */

import { ethers } from "ethers";
import fs from "fs";

const ORCHESTRATOR = "http://65.108.100.145:3001";
const HEDERA_RPC   = "https://testnet.hashio.io/api";
const CONTRACT     = "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";

const ABI = [
  "function registerVerified(string name, string description, string capabilities, bytes signature) external",
  "function isRegistered(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

const TERRY_NAME = "Terry";
const TERRY_DESC = "OpenClaw AI agent — autonomous task executor built on Veridex. Specialized in market analysis, research synthesis, and multi-step reasoning.";
const TERRY_CAPS = "market_analysis,research,reasoning,report_generation";

async function main() {
  // Load Terry's wallet
  const walletFile = JSON.parse(fs.readFileSync("/home/rex/Projects/crypto/Denver2026/agents/.wallets/terry.json", "utf8"));
  const provider   = new ethers.JsonRpcProvider(HEDERA_RPC);
  const wallet     = new ethers.Wallet(walletFile.privateKey, provider);

  console.log(`Terry address: ${wallet.address}`);

  // Check if already registered
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  const alreadyRegistered = await contract.isRegistered(wallet.address);
  if (alreadyRegistered) {
    console.log("Terry is already registered on the new contract!");
    const agent = await contract.getAgent(wallet.address);
    console.log(`  name: ${agent.name}, active: ${agent.active}, verified: ${agent.verifiedMachineAgent}`);
    return;
  }

  // Step 1: Get challenge
  console.log("\nStep 1: Requesting challenge...");
  const t0 = Date.now();
  const challengeRes = await fetch(`${ORCHESTRATOR}/api/agent/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address })
  });
  const { challenge, expiresAt, expiresIn } = await challengeRes.json();
  console.log(`  challenge: ${challenge}`);
  console.log(`  expires in: ${expiresIn}`);

  // Step 2: Sign nonce immediately
  const challengeSignature = await wallet.signMessage(challenge);
  const elapsed1 = Date.now() - t0;
  console.log(`  signed in ${elapsed1}ms`);

  // Step 3: Submit signature
  console.log("\nStep 2: Submitting signature...");
  const signRes = await fetch(`${ORCHESTRATOR}/api/agent/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, challengeSignature })
  });
  const signData = await signRes.json();
  if (!signRes.ok) {
    console.error("Failed:", signData);
    process.exit(1);
  }
  console.log(`  elapsed: ${signData.elapsed}`);
  console.log(`  registrySignature: ${signData.registrySignature?.slice(0, 20)}...`);
  console.log(`  registryAuthority: ${signData.registryAuthority}`);

  const { registrySignature } = signData;

  // Step 4: Call registerVerified on-chain
  console.log("\nStep 3: Calling registerVerified() on Hedera...");
  const connectedContract = contract.connect(wallet);
  const tx = await connectedContract.registerVerified(
    TERRY_NAME,
    TERRY_DESC,
    TERRY_CAPS,
    registrySignature
  );
  console.log(`  tx hash: ${tx.hash}`);
  console.log("  Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log(`  confirmed in block: ${receipt.blockNumber}`);
  console.log(`  gas used: ${receipt.gasUsed}`);

  // Verify
  console.log("\nVerifying registration...");
  const registered = await contract.isRegistered(wallet.address);
  const agent = await contract.getAgent(wallet.address);
  console.log(`  isRegistered: ${registered}`);
  console.log(`  name: ${agent.name}`);
  console.log(`  verifiedMachineAgent: ${agent.verifiedMachineAgent}`);
  console.log(`  active: ${agent.active}`);
  console.log(`\nHashScan: https://hashscan.io/testnet/account/${wallet.address}`);
  console.log("Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
