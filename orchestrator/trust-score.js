/**
 * Veridex Trust Score — HCS-derived, pure computation
 *
 * computeTrustScore(messages) is a pure function.
 * Input:  decoded HCS topic message array (sequence_number + parsed JSON fields)
 * Output: { score, breakdown, openJobs }
 *
 * Score is always computed from public Hedera data — never from DB columns.
 * Anyone can verify by fetching the agent's HCS topic on HashScan.
 */

"use strict";

const BASELINE = 500;

const WEIGHTS = {
  job_complete:            +20,
  on_time_bonus:           +10,
  earnings_settled:        +10,
  action_blocked_critical: -50,
  action_blocked_high:     -15,
  job_abandoned:           -30,
};

const ABANDONED_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Pure function — no I/O, no DB reads.
 *
 * @param {Array} messages  Decoded HCS messages. Each message must have fields
 *                          from the original writeToHCS payload plus
 *                          { sequenceNumber, consensusTimestamp }.
 * @returns {{ score: number, breakdown: object, openJobs: Array }}
 *   openJobs: job_start messages with no matching job_complete after timeout.
 *   Caller is responsible for writing job_abandoned to HCS for each entry.
 */
function computeTrustScore(messages) {
  const breakdown = {
    jobsCompleted:    0,
    onTimeBonuses:    0,
    earningsSettled:  0,
    blockedCritical:  0,
    blockedHigh:      0,
    jobsAbandoned:    0,
  };

  // Job pairing maps
  const jobStarts    = new Map(); // jobId → { timestamp, deadline }
  const jobCompletes = new Set(); // jobIds with a job_complete
  const jobAbandoned = new Set(); // jobIds already written as job_abandoned on HCS

  let delta = 0;
  const now = Date.now();

  for (const msg of messages) {
    const type = msg.type || msg.event || "";

    if (type === "job_start") {
      jobStarts.set(String(msg.jobId), { timestamp: msg.timestamp || 0, deadline: msg.deadline || 0 });

    } else if (type === "job_complete" || type === "job_completed") {
      const jid = String(msg.jobId);
      jobCompletes.add(jid);
      delta += WEIGHTS.job_complete;
      breakdown.jobsCompleted++;

      // On-time bonus: completed before deadline
      const start = jobStarts.get(jid);
      if (start?.deadline && msg.timestamp && msg.timestamp <= start.deadline) {
        delta += WEIGHTS.on_time_bonus;
        breakdown.onTimeBonuses++;
      }

    } else if (type === "job_abandoned") {
      jobAbandoned.add(String(msg.jobId));
      delta += WEIGHTS.job_abandoned;
      breakdown.jobsAbandoned++;

    } else if (type === "earnings_split" || msg.event === "earnings_split") {
      delta += WEIGHTS.earnings_settled;
      breakdown.earningsSettled++;

    } else if (msg.result === "blocked" || msg.riskLevel === "blocked") {
      if ((msg.severity || "high") === "critical") {
        delta += WEIGHTS.action_blocked_critical;
        breakdown.blockedCritical++;
      } else {
        delta += WEIGHTS.action_blocked_high;
        breakdown.blockedHigh++;
      }
    }
  }

  // Detect open jobs that exceeded the abandonment timeout
  const openJobs = [];
  for (const [jobId, start] of jobStarts) {
    if (jobCompletes.has(jobId) || jobAbandoned.has(jobId)) continue;
    const age = now - (start.timestamp || 0);
    if (age >= ABANDONED_TIMEOUT_MS) {
      openJobs.push({ jobId, startedAt: start.timestamp, ageMs: age });
      // Apply penalty now; caller writes job_abandoned to HCS to make it permanent
      delta += WEIGHTS.job_abandoned;
      breakdown.jobsAbandoned++;
    }
  }

  const score = Math.max(0, Math.min(1000, BASELINE + delta));
  return { score, breakdown, openJobs };
}

/**
 * Fetch all messages from a Hedera Mirror Node HCS topic, paginated.
 * Returns decoded message objects (decrypted if encryptionKey provided).
 *
 * @param {string} topicId       Hedera topic ID, e.g. "0.0.12345"
 * @param {string|null} encKey   Per-agent AES encryption key (hex), or null
 * @param {Function} decryptFn   decryptHcsMessage from hcs-logger
 * @returns {Promise<Array>}
 */
async function fetchHcsMessages(topicId, encKey, decryptFn) {
  const allMessages = [];
  let url = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  while (url) {
    let resp;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    } catch {
      break;
    }
    if (!resp.ok) break;

    const data = await resp.json();
    for (const m of data.messages || []) {
      try {
        const rawStr = Buffer.from(m.message, "base64").toString("utf8");
        let parsed;
        if (encKey && decryptFn) {
          try {
            parsed = JSON.parse(decryptFn(rawStr, encKey));
          } catch {
            parsed = JSON.parse(rawStr);
          }
        } else {
          parsed = JSON.parse(rawStr);
        }
        allMessages.push({
          sequenceNumber:     m.sequence_number,
          consensusTimestamp: m.consensus_timestamp,
          ...parsed,
        });
      } catch {
        // skip unparseable messages
      }
    }

    // Mirror node returns relative next link, e.g. "/api/v1/topics/.../messages?..."
    url = data.links?.next
      ? `https://testnet.mirrornode.hedera.com${data.links.next}`
      : null;
  }

  return allMessages;
}

const SCORE_LABELS = [
  [800, "Excellent"],
  [600, "Good"],
  [400, "Fair"],
  [200, "Poor"],
  [0,   "Critical"],
];

function scoreLabel(score) {
  for (const [thresh, label] of SCORE_LABELS) {
    if (score >= thresh) return label;
  }
  return "Critical";
}

module.exports = { computeTrustScore, fetchHcsMessages, scoreLabel, WEIGHTS, ABANDONED_TIMEOUT_MS };
