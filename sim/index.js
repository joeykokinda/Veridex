/**
 * Agent Society Simulation Loop
 *
 * Entities:
 *   - 1 Requester (posts jobs, approves, attests)
 *   - 3 Workers (accept, complete jobs)
 *
 * Each cycle: post job → worker accepts → worker completes → requester pays → requester attests
 */
import { ethers } from "ethers";
import { readFileSync } from "fs";
import {
  RPC_URL,
  ESCROW_ADDRESS,
  REPUTATION_ADDRESS,
  HARDHAT_ACCOUNTS,
  NETWORK,
} from "./config.js";

const escrowABI = JSON.parse(
  readFileSync("../contracts/artifacts/contracts/JobBoardEscrow.sol/JobBoardEscrow.json", "utf8")
).abi;
const repABI = JSON.parse(
  readFileSync("../contracts/artifacts/contracts/Reputation.sol/Reputation.json", "utf8")
).abi;

// Job description templates
const JOB_TEMPLATES = [
  "Analyze market sentiment for ETH/USDC pair",
  "Generate summary report of DeFi yields",
  "Audit smart contract for reentrancy vulnerabilities",
  "Create data visualization of gas trends",
  "Translate documentation to Spanish",
  "Optimize database query performance",
  "Write integration tests for payment module",
  "Review pull request for security issues",
  "Monitor network health and alert on anomalies",
  "Generate compliance report for Q4",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomRating() {
  // Weighted toward higher ratings (realistic) - scale 1-10
  const weights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const probs = [0.02, 0.03, 0.05, 0.05, 0.1, 0.15, 0.2, 0.2, 0.15, 0.05];
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i];
    if (r <= cum) return weights[i];
  }
  return 10;
}

async function main() {
  if (!ESCROW_ADDRESS || !REPUTATION_ADDRESS) {
    console.error("Missing contract addresses. Run deploy-local.js first or set .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  console.log(`\n🌐 Network: ${NETWORK} (${RPC_URL})`);
  console.log(`📋 Escrow: ${ESCROW_ADDRESS}`);
  console.log(`⭐ Reputation: ${REPUTATION_ADDRESS}\n`);

  // Set up wallets with NonceManager to handle nonce tracking
  const requester = new ethers.NonceManager(new ethers.Wallet(HARDHAT_ACCOUNTS[0], provider));
  const workers = [
    new ethers.NonceManager(new ethers.Wallet(HARDHAT_ACCOUNTS[1], provider)),
    new ethers.NonceManager(new ethers.Wallet(HARDHAT_ACCOUNTS[2], provider)),
    new ethers.NonceManager(new ethers.Wallet(HARDHAT_ACCOUNTS[3], provider)),
  ];

  const requesterAddr = await requester.getAddress();
  const workerAddrs = await Promise.all(workers.map((w) => w.getAddress()));
  console.log("👤 Requester:", requesterAddr);
  workerAddrs.forEach((addr, i) => console.log(`🤖 Worker ${String.fromCharCode(65 + i)}:`, addr));
  console.log("");

  // Connect contracts
  const escrow = new ethers.Contract(ESCROW_ADDRESS, escrowABI, requester);
  const reputation = new ethers.Contract(REPUTATION_ADDRESS, repABI, requester);

  const NUM_CYCLES = parseInt(process.env.NUM_CYCLES || "10", 10);
  const DELAY_MS = parseInt(process.env.DELAY_MS || "3000", 10);

  console.log(`Running ${NUM_CYCLES} job cycles with ${DELAY_MS}ms delay...\n`);

  for (let cycle = 0; cycle < NUM_CYCLES; cycle++) {
    const template = JOB_TEMPLATES[cycle % JOB_TEMPLATES.length];
    const worker = workers[cycle % workers.length];
    const workerLabel = String.fromCharCode(65 + (cycle % workers.length));
    const reward = ethers.parseEther((0.1 + Math.random() * 0.9).toFixed(4));

    console.log(`--- Cycle ${cycle + 1}/${NUM_CYCLES} ---`);
    console.log(`📝 Job: "${template}"`);
    console.log(`💰 Reward: ${ethers.formatEther(reward)} ETH`);

    // 1. Post job
    const detailsHash = ethers.id(JSON.stringify({ task: template, cycle }));
    const postTx = await escrow.postJob(detailsHash, { value: reward });
    const postReceipt = await postTx.wait();
    const jobId = Number(await escrow.nextJobId()) - 1;
    console.log(`✅ Posted jobId=${jobId} (tx: ${postReceipt.hash.slice(0, 10)}...)`);

    await sleep(DELAY_MS / 4);

    // 2. Worker accepts
    const acceptTx = await escrow.connect(worker).acceptJob(jobId);
    await acceptTx.wait();
    console.log(`🤖 Worker ${workerLabel} accepted`);

    await sleep(DELAY_MS / 4);

    // 3. Worker completes
    const resultHash = ethers.id(JSON.stringify({ result: `completed by ${workerLabel}`, jobId }));
    const completeTx = await escrow.connect(worker).completeJob(jobId, resultHash);
    await completeTx.wait();
    console.log(`📦 Worker ${workerLabel} completed`);

    await sleep(DELAY_MS / 4);

    // 4. Requester approves and pays
    const payTx = await escrow.approveAndPay(jobId);
    await payTx.wait();
    console.log(`💸 Paid worker ${workerLabel}`);

    // 5. Requester attests
    const rating = randomRating();
    const attestHash = ethers.id(JSON.stringify({ quality: rating, feedback: "auto-rated" }));
    const workerAddr = workerAddrs[cycle % workers.length];
    const attestTx = await reputation.attest(jobId, workerAddr, rating, attestHash);
    await attestTx.wait();
    console.log(`⭐ Attested rating=${rating}/10 for Worker ${workerLabel}`);

    console.log("");
    await sleep(DELAY_MS / 4);
  }

  // Print final scores
  console.log("=== Final Trust Scores ===");
  for (let i = 0; i < workers.length; i++) {
    const [avg, count] = await reputation.getScore(workerAddrs[i]);
    console.log(
      `Worker ${String.fromCharCode(65 + i)} (${workerAddrs[i]}): avg=${avg}, jobs=${count}`
    );
  }
  console.log("\nSimulation complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
