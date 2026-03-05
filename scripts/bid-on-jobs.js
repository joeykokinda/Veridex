/**
 * bid-on-jobs.js — Browse open jobs and bid on one as an external agent
 *
 * Fetches live open jobs from the AgentMarketplace contract, picks the first
 * one this agent hasn't already bid on, and submits a competitive bid.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node bid-on-jobs.js
 *   AGENT_PRIVATE_KEY=0x... BID_HBAR=0.05 node bid-on-jobs.js
 *
 * Reads from .agent-wallet.json if AGENT_PRIVATE_KEY is not set.
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const API      = process.env.VERIDEX_API || "http://65.108.100.145:3001";
const RPC      = "https://testnet.hashio.io/api";

const IDENTITY_ADDRESS    = "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";
const MARKETPLACE_ADDRESS = "0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6";

const IDENTITY_ABI = [
  "function isRegistered(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

const MARKETPLACE_ABI = [
  "function getOpenJobs() external view returns (uint256[])",
  "function getJob(uint256 jobId) external view returns (tuple(uint256 id, address poster, bytes32 descriptionHash, uint256 escrowAmount, uint256 deadline, uint256 createdAt, uint8 state, uint256 acceptedBidId, address assignedWorker, bytes32 deliverableHash, uint8 rating, bytes32 evidenceHash, bool clientRated))",
  "function getJobBids(uint256 jobId) external view returns (uint256[])",
  "function getBid(uint256 bidId) external view returns (tuple(uint256 id, uint256 jobId, address bidder, uint256 price, bytes32 bidHash, uint256 createdAt, uint8 state))",
  "function bidOnJob(uint256 jobId, uint256 price, bytes32 bidHash) external",
  "event BidSubmitted(uint256 indexed bidId, uint256 indexed jobId, address indexed bidder, uint256 price, bytes32 bidHash, uint256 timestamp)"
];

function loadWallet(provider) {
  const key = process.env.AGENT_PRIVATE_KEY ||
    (fs.existsSync(".agent-wallet.json")
      ? JSON.parse(fs.readFileSync(".agent-wallet.json", "utf8")).privateKey
      : null);
  if (!key) {
    console.error("Error: No wallet found. Run `node faucet.js` first.");
    process.exit(1);
  }
  return new ethers.Wallet(key, provider);
}

async function getJobDescription(jobId) {
  // Try to get human-readable description from the jobs board API
  try {
    const res = await fetch(`${API}/api/jobs-board`);
    if (!res.ok) return null;
    const { jobs } = await res.json();
    const job = jobs.find(j => j.id === jobId.toString());
    return job?.description || null;
  } catch {
    return null;
  }
}

async function toHashScanUrl(txHash) {
  try {
    const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${txHash}`);
    if (!res.ok) return `https://hashscan.io/testnet/transaction/${txHash}`;
    const d = await res.json();
    return d.timestamp
      ? `https://hashscan.io/testnet/transaction/${d.timestamp}`
      : `https://hashscan.io/testnet/transaction/${txHash}`;
  } catch {
    return `https://hashscan.io/testnet/transaction/${txHash}`;
  }
}

async function main() {
  console.log("\n=== Veridex — Bid on Jobs ===\n");

  const provider    = new ethers.JsonRpcProvider(RPC);
  const wallet      = loadWallet(provider);
  const identity    = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);

  console.log("Agent address:", wallet.address);

  // Check registration
  const registered = await identity.isRegistered(wallet.address);
  if (!registered) {
    console.error("\n  Not registered. Run `node register.js` first.");
    process.exit(1);
  }
  const profile = await identity.getAgent(wallet.address);
  console.log("Agent name:   ", profile.name);
  console.log("Rep score:    ", profile.reputationScore.toString());
  console.log("Verified:     ", profile.verifiedMachineAgent ? "yes" : "no");

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceHbar = parseFloat(ethers.formatEther(balance));
  console.log("Balance:      ", balanceHbar.toFixed(4), "HBAR");

  if (balanceHbar < 0.01) {
    console.error("\n  Insufficient HBAR. Run `node faucet.js` to get 2 HBAR.");
    process.exit(1);
  }

  // Get open jobs
  console.log("\nFetching open jobs from chain...");
  const openIds = await marketplace.getOpenJobs();
  console.log("  Open jobs:", openIds.length);

  if (openIds.length === 0) {
    console.log("\n  No open jobs right now. The agents tick every ~90s — check back soon.");
    console.log("  Or post your own: node post-job.js \"Your job description\"");
    return;
  }

  // Find a job we haven't bid on yet
  let targetJob   = null;
  let alreadyBid  = false;

  for (const id of openIds) {
    const job = await marketplace.getJob(id);
    // State 0 = Open
    if (Number(job.state) !== 0) continue;
    // Don't bid on our own jobs
    if (job.poster.toLowerCase() === wallet.address.toLowerCase()) continue;

    // Check if we already have a bid
    const bidIds = await marketplace.getJobBids(id);
    let hasBid = false;
    for (const bidId of bidIds) {
      const bid = await marketplace.getBid(bidId);
      if (bid.bidder.toLowerCase() === wallet.address.toLowerCase()) {
        hasBid = true;
        break;
      }
    }
    if (hasBid) {
      console.log(`  Job #${id}: already bid — skipping`);
      alreadyBid = true;
      continue;
    }

    targetJob = { id, raw: job };
    break;
  }

  if (!targetJob) {
    if (alreadyBid) {
      console.log("\n  Already have bids on all open jobs.");
      console.log("  Check https://www.veridex.xyz/live to see if any bids were accepted.");
    } else {
      console.log("\n  No eligible jobs to bid on right now.");
    }
    return;
  }

  const { id, raw } = targetJob;
  const escrowHbar  = parseFloat(ethers.formatUnits(raw.escrowAmount, 8));
  const description = await getJobDescription(id);

  console.log(`\nFound job #${id}:`);
  if (description) {
    console.log("  Description:", description.slice(0, 120) + (description.length > 120 ? "..." : ""));
  } else {
    console.log("  Description hash:", raw.descriptionHash);
  }
  console.log("  Escrow:     ", escrowHbar.toFixed(4), "HBAR");
  console.log("  Poster:     ", raw.poster);
  console.log("  Deadline:   ", new Date(Number(raw.deadline) * 1000).toISOString());

  // Bid at ~80% of escrow (competitive but not the floor)
  const customBid = process.env.BID_HBAR ? parseFloat(process.env.BID_HBAR) : null;
  const bidHbar   = customBid || Math.max(0.001, escrowHbar * 0.8);
  const bidPrice  = ethers.parseUnits(bidHbar.toFixed(8), 8);

  // Bid hash: keccak256 of jobId + bidder + timestamp (identifies this bid uniquely)
  const bidHash = ethers.keccak256(
    ethers.solidityPacked(
      ["uint256", "address", "uint256"],
      [id, wallet.address, Math.floor(Date.now() / 1000)]
    )
  );

  console.log(`\nSubmitting bid...`);
  console.log("  Bid price:", bidHbar.toFixed(4), "HBAR");

  const tx = await marketplace.connect(wallet).bidOnJob(id, bidPrice, bidHash);
  console.log("  Tx submitted:", tx.hash);
  console.log("  Waiting for confirmation...");
  const receipt = await tx.wait();

  // Extract bid ID from event
  let bidId = "?";
  try {
    const iface = marketplace.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === "BidSubmitted") {
          bidId = parsed.args.bidId.toString();
          break;
        }
      } catch {}
    }
  } catch {}

  const hashScanUrl = await toHashScanUrl(receipt.hash);

  console.log("\n  Bid submitted!");
  console.log("  Bid ID:  ", bidId);
  console.log("  HashScan:", hashScanUrl);
  console.log(`\nNow watch https://www.veridex.xyz/live`);
  console.log(`The job poster evaluates bids every ~90s. Your rep score (${profile.reputationScore}) matters.`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
