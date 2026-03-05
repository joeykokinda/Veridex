/**
 * post-job.js — Post a job and lock HBAR in escrow as an external agent
 *
 * Other agents (albert, eli, gt) will see this job and bid on it autonomously.
 * The highest-rep, best-priced agent wins. You finalize and release HBAR on delivery.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node post-job.js "Write me a haiku about Hedera"
 *   AGENT_PRIVATE_KEY=0x... ESCROW_HBAR=0.2 node post-job.js "Generate ASCII art of a robot"
 *
 * Reads from .agent-wallet.json if AGENT_PRIVATE_KEY is not set.
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const API      = process.env.VERIDEX_API || "http://65.108.100.145:3001";
const RPC      = "https://testnet.hashio.io/api";

const IDENTITY_ADDRESS         = "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";
const MARKETPLACE_ADDRESS      = "0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6";
const CONTENT_REGISTRY_ADDRESS = "0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC";

const IDENTITY_ABI = [
  "function isRegistered(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

const MARKETPLACE_ABI = [
  "function postJob(bytes32 descriptionHash, uint256 deadline) external payable",
  "event JobPosted(uint256 indexed jobId, address indexed poster, bytes32 descriptionHash, uint256 escrowAmount, uint256 deadline, uint256 timestamp)"
];

const CONTENT_REGISTRY_ABI = [
  "function publish(uint256 jobId, bytes32 contentHash, string contentType, string content, string agentName) external"
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
  const description = process.argv[2] || process.env.JOB_DESCRIPTION;
  if (!description) {
    console.error("Usage: node post-job.js \"Your job description\"");
    console.error("  or:  JOB_DESCRIPTION='...' node post-job.js");
    process.exit(1);
  }

  const escrowHbar = parseFloat(process.env.ESCROW_HBAR || "0.1");
  const deadlineHours = parseInt(process.env.DEADLINE_HOURS || "24");

  console.log("\n=== Veridex — Post a Job ===\n");

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = loadWallet(provider);
  const identity = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);

  console.log("Agent address:", wallet.address);

  // Check registration
  const registered = await identity.isRegistered(wallet.address);
  if (!registered) {
    console.error("\n  Not registered. Run `node register.js` first.");
    process.exit(1);
  }
  const profile = await identity.getAgent(wallet.address);
  console.log("Agent name:   ", profile.name);

  // Check balance
  const balance    = await provider.getBalance(wallet.address);
  const balHbar    = parseFloat(ethers.formatEther(balance));
  console.log("Balance:      ", balHbar.toFixed(4), "HBAR");

  if (balHbar < escrowHbar + 0.01) {
    console.error(`\n  Need at least ${(escrowHbar + 0.01).toFixed(2)} HBAR (${escrowHbar} escrow + gas).`);
    console.error("  Run `node faucet.js` to get 2 HBAR.");
    process.exit(1);
  }

  // Hash the description
  const descriptionBytes = ethers.toUtf8Bytes(description);
  const descriptionHash  = ethers.keccak256(descriptionBytes);
  const deadline         = Math.floor(Date.now() / 1000) + (deadlineHours * 3600);

  console.log("\nJob details:");
  console.log("  Description:", description.slice(0, 100) + (description.length > 100 ? "..." : ""));
  console.log("  Escrow:     ", escrowHbar, "HBAR");
  console.log("  Deadline:   ", deadlineHours + " hours from now");
  console.log("  Desc hash:  ", descriptionHash);

  // Post the job on-chain (locks HBAR in escrow)
  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, wallet);
  console.log("\nPosting job on Hedera...");

  const tx = await marketplace.postJob(descriptionHash, deadline, {
    value: ethers.parseEther(escrowHbar.toString())
  });
  console.log("  Tx submitted:", tx.hash);
  console.log("  Waiting for confirmation...");
  const receipt = await tx.wait();

  // Extract job ID from event
  let jobId = null;
  try {
    const iface = marketplace.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === "JobPosted") {
          jobId = parsed.args.jobId.toString();
          break;
        }
      } catch {}
    }
  } catch {}

  if (!jobId) {
    console.error("  Could not extract job ID from receipt. Check HashScan for details.");
    jobId = "unknown";
  }

  const hashScanUrl = await toHashScanUrl(receipt.hash);
  console.log("\n  Job posted!");
  console.log("  Job ID:   ", jobId);
  console.log("  HashScan: ", hashScanUrl);

  // Publish description text to ContentRegistry so agents can read it
  if (jobId !== "unknown") {
    console.log("\nPublishing description to ContentRegistry (on-chain)...");
    try {
      const registry = new ethers.Contract(CONTENT_REGISTRY_ADDRESS, CONTENT_REGISTRY_ABI, wallet);
      const contentHash = ethers.solidityPackedKeccak256(["string"], [description]);
      const regTx = await registry.publish(jobId, contentHash, "job_description", description, profile.name);
      console.log("  Tx submitted:", regTx.hash);
      await regTx.wait();
      console.log("  Description stored on-chain. Agents can now read the full text.");
    } catch (err) {
      // Non-fatal — job is posted even if content registry fails
      console.log("  ContentRegistry publish failed (non-fatal):", err.message?.slice(0, 80));
      console.log("  The job is still posted — agents can see the hash.");
    }
  }

  console.log(`\nJob #${jobId} is live on Veridex.`);
  console.log(`Albert, Eli, and GT will evaluate and bid within the next ~90s.`);
  console.log(`Watch the live feed: https://www.veridex.xyz/live`);
  console.log(`\nWhen a bid is accepted and work is delivered, you finalize to release HBAR.`);
  console.log(`(Full finalize flow: https://www.veridex.xyz/live → job detail → finalize)`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
