/**
 * Veridex ERC-8183 Job Monitor — Layer 4
 * Polls AgentMarketplace for job state transitions.
 * Alerts on stuck jobs. Triggers earnings split on completion.
 */

const { ethers } = require("ethers");
const db = require("./veridex-db");
const { writeToHCS } = require("./hcs-logger");
const { sendAlert } = require("./telegram");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const MARKETPLACE_ABI = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json").abi;

// Job status — derived from event sequence
const STATUS_FROM_EVENT = {
  JobPosted:        "Open",
  BidSubmitted:     "Bidding",
  BidAccepted:      "Funded",
  DeliverySubmitted:"Submitted",
  JobFinalized:     null, // depends on success flag
  JobCancelled:     "Cancelled",
  JobFailedTimeout: "Expired",
};

let provider;
let marketplace;
let _pollInterval;
let _stuckInterval;
let lastCheckedBlock = 0;
let _broadcastFn = null;

async function startJobMonitor(broadcastFn) {
  if (!process.env.AGENT_MARKETPLACE_CONTRACT) {
    console.warn("[JobMonitor] No AGENT_MARKETPLACE_CONTRACT — skipping");
    return;
  }
  _broadcastFn = broadcastFn;

  provider  = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  marketplace = new ethers.Contract(process.env.AGENT_MARKETPLACE_CONTRACT, MARKETPLACE_ABI, provider);

  db.ensureJobsTable();
  console.log("[JobMonitor] Starting — polling every 30s");

  await _poll().catch(e => console.error("[JobMonitor] Initial poll error:", e.message));

  _pollInterval = setInterval(() => _poll().catch(e => console.error("[JobMonitor]", e.message)), 30000);
  _stuckInterval = setInterval(() => _checkStuck().catch(() => {}), 5 * 60 * 1000);
}

function stopJobMonitor() {
  if (_pollInterval)  clearInterval(_pollInterval);
  if (_stuckInterval) clearInterval(_stuckInterval);
}

// ── Core poll ─────────────────────────────────────────────────────────────────

async function _poll() {
  const currentBlock = await provider.getBlockNumber();
  const fromBlock    = lastCheckedBlock ? lastCheckedBlock + 1 : Math.max(0, currentBlock - 2000);

  if (fromBlock > currentBlock) return;

  const iface   = marketplace.interface;
  const address = process.env.AGENT_MARKETPLACE_CONTRACT;

  const eventNames = ["JobPosted","BidSubmitted","BidAccepted","DeliverySubmitted","JobFinalized","JobCancelled","JobFailedTimeout"];
  const topics = eventNames.map(n => {
    try { return iface.getEvent(n).topicHash; } catch { return null; }
  }).filter(Boolean);

  const rawLogs = await provider.getLogs({ address, fromBlock, toBlock: currentBlock, topics: [topics] });

  for (const log of rawLogs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      await _handleEvent(parsed, log);
    } catch { /* skip unparseable */ }
  }

  lastCheckedBlock = currentBlock;
}

async function _handleEvent(parsed, rawLog) {
  const name  = parsed.name;
  const args  = parsed.args;
  const jobId = args.jobId?.toString();
  if (!jobId) return;

  let newStatus = STATUS_FROM_EVENT[name];
  if (name === "JobFinalized") newStatus = args.success ? "Completed" : "Rejected";
  if (!newStatus) return;

  const existing   = db.getJob(jobId);
  const prevStatus = existing?.status;

  const update = {
    jobId,
    status:      newStatus,
    blockNumber: rawLog.blockNumber,
    txHash:      rawLog.transactionHash,
    updatedAt:   Date.now(),
  };

  if (name === "JobPosted") {
    update.client    = args.poster;
    update.budget    = ethers.formatEther(args.escrowAmount || 0n);
    update.postedAt  = Date.now();
  }
  if (name === "BidAccepted") {
    update.agent      = args.worker;
    update.acceptedAt = Date.now();

    // Write job_start to agent's HCS topic — this is one half of the reputation pair
    if (args.worker) {
      const agentRec = db.findAgentByWallet(args.worker);
      if (agentRec?.hcs_topic_id) {
        writeToHCS(agentRec.hcs_topic_id, {
          type:      "job_start",
          jobId,
          task:      `job_${jobId}`,
          deadline:  Date.now() + 24 * 60 * 60 * 1000, // 24h default
          timestamp: Date.now(),
        }, agentRec.hcs_encryption_key || null).catch(() => {});
      }
    }
  }
  if (name === "DeliverySubmitted") {
    update.agent = args.worker;
  }
  if (name === "JobFinalized") {
    update.agent       = args.worker;
    update.amount      = ethers.formatEther(args.payment || 0n);
    update.completedAt = Date.now();

    if (args.success && args.worker) {
      await _handleCompletion(jobId, args.worker, args.payment);
    }
  }

  db.upsertJob({ ...existing, ...update });

  if (prevStatus && prevStatus !== newStatus) {
    console.log(`[JobMonitor] Job #${jobId}: ${prevStatus} → ${newStatus}`);
    if (_broadcastFn) {
      _broadcastFn({
        type: "job_update",
        job:  { jobId, prevStatus, newStatus, agent: update.agent || existing?.agent, txHash: rawLog.transactionHash },
      });
    }
  }
}

// ── Stuck job detection ───────────────────────────────────────────────────────

async function _checkStuck() {
  const funded = db.getJobsByStatus("Funded");
  const STUCK_MS = 60 * 60 * 1000; // 1 hour

  for (const job of funded) {
    const age = Date.now() - (job.accepted_at || job.updated_at);
    if (age < STUCK_MS) continue;

    const hrs = Math.floor(age / 3600000);
    const agentRecord = job.agent ? db.findAgentByWallet(job.agent) : null;

    await sendAlert({
      agentId:     job.agent || "unknown",
      agentName:   agentRecord?.name || job.agent || "unknown",
      triggerType: "stuck_job",
      description: `Job #${job.job_id} has been Funded for ${hrs}h with no delivery submitted`,
      topicId:     agentRecord?.hcs_topic_id,
    }).catch(() => {});

    if (_broadcastFn) {
      _broadcastFn({
        type:  "alert",
        alert: { agentId: job.agent, triggerType: "stuck_job", description: `Job #${job.job_id} stuck ${hrs}h` },
      });
    }
  }
}

// ── Earnings on completion ────────────────────────────────────────────────────

async function _handleCompletion(jobId, agentAddress, paymentWei) {
  const agentRecord = db.findAgentByWallet(agentAddress);
  if (!agentRecord) return;

  const amountHbar = parseFloat(ethers.formatEther(paymentWei || 0n));
  if (amountHbar <= 0) return;

  const split   = db.getAgentSplitConfig(agentRecord.id);
  const devAmt  = parseFloat((amountHbar * split.splitDev      / 100).toFixed(6));
  const opsAmt  = parseFloat((amountHbar * split.splitOps      / 100).toFixed(6));
  const reinAmt = parseFloat((amountHbar * split.splitReinvest / 100).toFixed(6));

  db.insertEarning({
    agentId:       agentRecord.id,
    amountHbar,
    source:        `job_${jobId}`,
    splitDev:      devAmt,
    splitOps:      opsAmt,
    splitReinvest: reinAmt,
  });

  if (agentRecord.hcs_topic_id) {
    writeToHCS(agentRecord.hcs_topic_id, {
      event:     "job_completed",
      type:      "job_complete",   // trust-score key
      jobId,     amountHbar,
      result:    "success",
      split:     { dev: devAmt, ops: opsAmt, reinvest: reinAmt },
      timestamp: Date.now(),
    }, agentRecord.hcs_encryption_key || null).catch(() => {});
  }

  console.log(`[JobMonitor] Job #${jobId} completed → ${amountHbar} HBAR to ${agentRecord.id}`);
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function getRecentJobs(limit = 50) {
  return db.getRecentJobs(limit);
}

function getAgentJobs(agentAddress) {
  return db.getJobsByAgent(agentAddress);
}

module.exports = { startJobMonitor, stopJobMonitor, getRecentJobs, getAgentJobs };
