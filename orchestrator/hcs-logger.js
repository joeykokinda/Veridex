/**
 * Hedera HCS logging — one topic per agent, immutable audit trail
 * Uses @hashgraph/sdk directly for topic creation and message submission
 */

const {
  Client,
  PrivateKey,
  AccountId,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} = require("@hashgraph/sdk");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

function makeClient() {
  if (!process.env.DEPLOYER_ACCOUNT_ID || !process.env.DEPLOYER_PRIVATE_KEY) {
    return null;
  }
  try {
    const client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID),
      PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY)
    );
    return client;
  } catch (e) {
    console.error("[HCS] Failed to init client:", e.message);
    return null;
  }
}

/**
 * Create a new HCS topic for an agent.
 * @param {string} agentId
 * @param {string} agentName
 * @returns {{ topicId: string } | null}
 */
async function createAgentTopic(agentId, agentName) {
  const client = makeClient();
  if (!client) {
    console.warn("[HCS] No Hedera credentials — skipping topic creation");
    return null;
  }
  try {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(`Veridex Agent Log: ${agentName || agentId}`)
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId.toString();
    client.close();
    console.log(`[HCS] Created topic ${topicId} for agent ${agentId}`);
    return { topicId };
  } catch (e) {
    console.error("[HCS] Topic creation failed:", e.message);
    client.close();
    return null;
  }
}

/**
 * Write a log entry to an agent's HCS topic.
 * @param {string} topicId  - e.g. "0.0.1234567"
 * @param {object} logEntry - the full log object to serialize as JSON
 * @returns {{ sequenceNumber: string, timestamp: string } | null}
 */
async function writeToHCS(topicId, logEntry) {
  if (!topicId) return null;
  const client = makeClient();
  if (!client) return null;

  try {
    // Truncate params to keep message under HCS 4KB limit
    const safe = {
      ...logEntry,
      params: logEntry.params
        ? truncateParams(logEntry.params)
        : undefined
    };

    const message = JSON.stringify(safe);
    if (Buffer.byteLength(message, "utf8") > 4000) {
      console.warn("[HCS] Message too large, skipping params");
      safe.params = { _truncated: true };
    }

    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(safe))
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const seq = receipt.topicSequenceNumber?.toString() || "0";
    client.close();
    return { sequenceNumber: seq };
  } catch (e) {
    console.error("[HCS] Write failed:", e.message);
    try { client.close(); } catch {}
    return null;
  }
}

function truncateParams(params) {
  const result = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v.length > 200) {
      result[k] = v.slice(0, 200) + "…";
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Build a HashScan URL for a topic.
 */
function topicHashScanUrl(topicId) {
  return `https://hashscan.io/testnet/topic/${topicId}`;
}

module.exports = { createAgentTopic, writeToHCS, topicHashScanUrl };
