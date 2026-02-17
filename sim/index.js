/**
 * Multi-Agent Autonomous Society Simulation
 *
 * 12 agents that autonomously:
 * - Post jobs when they need work done
 * - Discover available jobs
 * - Rank jobs by reward + requester trust score
 * - Accept best jobs
 * - Complete work
 * - Pay and attest
 *
 * Each agent has a strategy: some post more, some work more
 */
import { ethers } from "ethers";
import { readFileSync } from "fs";
import {
  RPC_URL,
  ESCROW_ADDRESS,
  REPUTATION_ADDRESS,
  HEDERA_ACCOUNT_PRIVATE_KEY,
  HARDHAT_ACCOUNTS,
  NETWORK,
} from "./config.js";

const escrowABI = JSON.parse(
  readFileSync("../contracts/artifacts/contracts/JobBoardEscrow.sol/JobBoardEscrow.json", "utf8")
).abi;
const repABI = JSON.parse(
  readFileSync("../contracts/artifacts/contracts/Reputation.sol/Reputation.json", "utf8")
).abi;

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
  "Perform security assessment of smart contracts",
  "Create automated testing framework",
  "Build data pipeline for analytics",
  "Research and document best practices",
  "Design system architecture diagram",
  "Implement caching layer for API",
  "Conduct load testing on infrastructure",
  "Migrate database to new schema",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomRating() {
  // Weighted toward higher ratings - scale 1-10
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

class Agent {
  constructor(wallet, escrow, reputation, id) {
    this.wallet = wallet;
    this.escrow = escrow.connect(wallet);
    this.reputation = reputation.connect(wallet);
    this.id = id;
    this.address = wallet.address;
    
    // Agent strategy: bias toward posting or working
    // IDs 0-3: mostly posters, 4-11: mostly workers
    this.postProbability = id < 4 ? 0.7 : 0.3;
    
    this.jobsPosted = 0;
    this.jobsCompleted = 0;
    this.totalEarned = BigInt(0);
  }

  async getMyScore() {
    try {
      const [avg, count] = await this.reputation.getScore(this.address);
      return { avg: Number(avg), count: Number(count) };
    } catch {
      return { avg: 0, count: 0 };
    }
  }

  async decideBehavior() {
    return Math.random() < this.postProbability ? "post" : "work";
  }

  async postJob(template) {
    const reward = ethers.parseEther((0.05 + Math.random() * 0.45).toFixed(4)); // 0.05-0.5 ETH
    const detailsHash = ethers.id(JSON.stringify({ task: template, poster: this.id, ts: Date.now() }));
    
    try {
      const tx = await this.escrow.postJob(detailsHash, { value: reward });
      await tx.wait();
      this.jobsPosted++;
      
      const jobId = Number(await this.escrow.nextJobId()) - 1;
      console.log(`[Agent ${this.id}] Posted job ${jobId}: "${template.slice(0, 40)}..." (${ethers.formatEther(reward)} ETH)`);
      return jobId;
    } catch (err) {
      console.error(`Agent #${this.id} failed to post:`, err.message);
      return null;
    }
  }

  async findAndAcceptBestJob(openJobs, allAgents) {
    if (openJobs.length === 0) return null;

    // Rank jobs by: reward * (1 + requester_trust_score/10)
    // Higher reward + higher trust = better job
    const scored = await Promise.all(
      openJobs.map(async (job) => {
        const requesterAgent = allAgents.find((a) => a.address === job.requester);
        let trustBonus = 1;
        if (requesterAgent) {
          const score = await requesterAgent.getMyScore();
          trustBonus = 1 + (score.avg / 10);
        }
        const rewardEth = Number(ethers.formatEther(job.reward));
        const ranking = rewardEth * trustBonus;
        return { ...job, ranking };
      })
    );

    // Sort desc by ranking
    scored.sort((a, b) => b.ranking - a.ranking);
    const best = scored[0];

    // Don't accept own jobs
    if (best.requester === this.address) {
      return null;
    }

    try {
      const tx = await this.escrow.acceptJob(best.jobId);
      await tx.wait();
      console.log(`   [Agent ${this.id}] Accepted job ${best.jobId} (ranking: ${best.ranking.toFixed(3)})`);
      return best.jobId;
    } catch (err) {
      // Job might have been accepted by another agent
      return null;
    }
  }

  async completeJob(jobId) {
    const resultHash = ethers.id(JSON.stringify({ result: `completed by agent ${this.id}`, jobId, ts: Date.now() }));
    try {
      const tx = await this.escrow.completeJob(jobId, resultHash);
      await tx.wait();
      console.log(`   [Agent ${this.id}] Completed job ${jobId}`);
      return true;
    } catch (err) {
      return false;
    }
  }

  async payAndAttest(jobId, workerAddress) {
    try {
      // Pay
      const payTx = await this.escrow.approveAndPay(jobId);
      await payTx.wait();
      
      // Attest
      const rating = randomRating();
      const attestHash = ethers.id(JSON.stringify({ quality: rating, feedback: "auto-rated", ts: Date.now() }));
      const attestTx = await this.reputation.attest(jobId, workerAddress, rating, attestHash);
      await attestTx.wait();
      
      console.log(`   [Agent ${this.id}] Paid & rated ${rating}/10 for job ${jobId}`);
      return true;
    } catch (err) {
      console.error(`Agent #${this.id} failed to pay/attest job #${jobId}:`, err.message);
      return false;
    }
  }

  stats() {
    return `Agent #${this.id} (${this.address.slice(0, 8)}...): posted=${this.jobsPosted}, completed=${this.jobsCompleted}`;
  }
}

async function main() {
  if (!ESCROW_ADDRESS || !REPUTATION_ADDRESS) {
    console.error("Missing contract addresses. Run deploy-local.js first or set .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  console.log(`\nNetwork: ${NETWORK} (${RPC_URL})`);
  console.log(`Escrow: ${ESCROW_ADDRESS}`);
  console.log(`Reputation: ${REPUTATION_ADDRESS}\n`);

  // Create 12 agents
  const escrow = new ethers.Contract(ESCROW_ADDRESS, escrowABI, provider);
  const reputation = new ethers.Contract(REPUTATION_ADDRESS, repABI, provider);

  const agents = [];
  
  // Determine which accounts to use based on network
  const isHedera = NETWORK.includes("hedera");
  
  if (isHedera) {
    // For Hedera: use the main account + derived accounts
    // For simplicity, we'll create multiple agents from the same account
    // In production, you'd use different funded accounts
    console.log("Using Hedera testnet - creating agents from main account\n");
    for (let i = 0; i < 12; i++) {
      // Derive different wallets by adding index to private key (simple approach)
      // Note: In production, fund separate accounts
      const baseKey = BigInt(HEDERA_ACCOUNT_PRIVATE_KEY);
      const derivedKey = "0x" + (baseKey + BigInt(i)).toString(16).padStart(64, "0");
      const wallet = new ethers.NonceManager(new ethers.Wallet(derivedKey, provider));
      agents.push(new Agent(wallet, escrow, reputation, i));
    }
  } else {
    // For local Hardhat: use pre-funded accounts
    for (let i = 0; i < 12; i++) {
      const wallet = new ethers.NonceManager(new ethers.Wallet(HARDHAT_ACCOUNTS[i], provider));
      agents.push(new Agent(wallet, escrow, reputation, i));
    }
  }

  console.log(`Initialized ${agents.length} autonomous agents\n`);
  agents.forEach((a) => console.log(`   Agent ${a.id}: ${a.address} (${a.postProbability * 100}% post, ${(1 - a.postProbability) * 100}% work)`));
  console.log("");

  const NUM_ROUNDS = parseInt(process.env.NUM_ROUNDS || "15", 10);
  const DELAY_MS = parseInt(process.env.DELAY_MS || "2000", 10);

  console.log(`Running ${NUM_ROUNDS} rounds of autonomous behavior\n`);

  // Track jobs by state
  const jobStates = new Map(); // jobId -> { requester, agent, status, reward }

  for (let round = 0; round < NUM_ROUNDS; round++) {
    console.log(`\n━━━ ROUND ${round + 1}/${NUM_ROUNDS} ━━━`);

    // Phase 1: Agents decide to post or look for work
    for (const agent of agents) {
      const behavior = await agent.decideBehavior();
      
      if (behavior === "post") {
        const template = JOB_TEMPLATES[Math.floor(Math.random() * JOB_TEMPLATES.length)];
        const jobId = await agent.postJob(template);
        if (jobId !== null) {
          const job = await escrow.jobs(jobId);
          jobStates.set(jobId, {
            requester: agent.address,
            agent: null,
            status: "Open",
            reward: job.reward,
          });
        }
        await sleep(DELAY_MS / 4);
      }
    }

    // Phase 2: Workers look for open jobs and accept best
    const openJobs = [];
    for (const [jobId, state] of jobStates.entries()) {
      if (state.status === "Open") {
        openJobs.push({ jobId, requester: state.requester, reward: state.reward });
      }
    }

    if (openJobs.length > 0) {
      console.log(`\n${openJobs.length} open jobs available`);
      
      // Shuffle agents so not always same order
      const shuffled = [...agents].sort(() => Math.random() - 0.5);
      
      for (const agent of shuffled) {
        const behavior = await agent.decideBehavior();
        if (behavior === "work") {
          const currentOpen = [];
          for (const [jobId, state] of jobStates.entries()) {
            if (state.status === "Open") {
              currentOpen.push({ jobId, requester: state.requester, reward: state.reward });
            }
          }
          
          if (currentOpen.length > 0) {
            const acceptedJobId = await agent.findAndAcceptBestJob(currentOpen, agents);
            if (acceptedJobId !== null) {
              jobStates.get(acceptedJobId).status = "InProgress";
              jobStates.get(acceptedJobId).agent = agent.address;
              await sleep(DELAY_MS / 6);
            }
          }
        }
      }
    }

    // Phase 3: Workers complete jobs in progress
    const inProgress = [];
    for (const [jobId, state] of jobStates.entries()) {
      if (state.status === "InProgress") {
        inProgress.push({ jobId, agent: state.agent });
      }
    }

    for (const { jobId, agent: workerAddr } of inProgress) {
      const worker = agents.find((a) => a.address === workerAddr);
      if (worker) {
        const completed = await worker.completeJob(jobId);
        if (completed) {
          jobStates.get(jobId).status = "Completed";
          await sleep(DELAY_MS / 6);
        }
      }
    }

    // Phase 4: Requesters pay and attest completed jobs
    const completed = [];
    for (const [jobId, state] of jobStates.entries()) {
      if (state.status === "Completed") {
        completed.push({ jobId, requester: state.requester, agent: state.agent });
      }
    }

    for (const { jobId, requester: requesterAddr, agent: workerAddr } of completed) {
      const requester = agents.find((a) => a.address === requesterAddr);
      if (requester) {
        const paid = await requester.payAndAttest(jobId, workerAddr);
        if (paid) {
          jobStates.get(jobId).status = "Paid";
          const worker = agents.find((a) => a.address === workerAddr);
          if (worker) worker.jobsCompleted++;
          await sleep(DELAY_MS / 6);
        }
      }
    }

    await sleep(DELAY_MS / 2);
  }

  // Final stats
  console.log("\n\n========================================");
  console.log("FINAL AGENT SOCIETY STATS");
  console.log("========================================\n");

  for (const agent of agents) {
    const score = await agent.getMyScore();
    console.log(`Agent ${agent.id.toString().padStart(2)}: ${agent.address}`);
    console.log(`  Posted: ${agent.jobsPosted} | Completed: ${agent.jobsCompleted} | Trust: ${score.avg.toFixed(1)}/10 (${score.count} ratings)`);
  }

  const totalPaid = Array.from(jobStates.values()).filter((s) => s.status === "Paid").length;
  console.log(`\nTotal jobs completed & paid: ${totalPaid}`);
  console.log("Autonomous agent society simulation complete!\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
