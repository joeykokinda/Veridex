/**
 * Veridex Telegram Bot — Mobile Control Plane
 *
 * Commands (only accepted from TELEGRAM_CHAT_ID):
 *   /agents                — list all agents with status
 *   /logs <agentId>        — last 10 actions in plain English
 *   /block <agentId>       — quarantine agent (all actions denied)
 *   /unblock <agentId>     — remove quarantine
 *   /status <agentId>      — stats + last action + HBAR balance
 *   /memory <agentId>      — HCS recovery context (Mirror Node)
 *
 * Uses long-polling (no webhook needed). Safe for VPS + dev environments.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const db = require("./veridex-db");

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.TELE_KEY;
const ALLOWED_CHAT = String(process.env.TELEGRAM_CHAT_ID || "");

if (!BOT_TOKEN) {
  console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
  module.exports = { start: () => {} };
  return;
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;
let running = false;

// Dedup processed update_ids via SQLite — prevents double-response when Railway
// runs two instances simultaneously during rolling deploys (~30s overlap).
// Both processes share the same /data/veridex.db volume, so this is a real lock.
function claimUpdate(updateId) {
  try {
    const d = db.getDb();
    // Ensure table exists
    d.exec(`CREATE TABLE IF NOT EXISTS tg_processed_updates (
      update_id INTEGER PRIMARY KEY,
      processed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`);
    // Prune old entries (older than 1 hour) to keep the table small
    d.prepare("DELETE FROM tg_processed_updates WHERE processed_at < ?").run(Date.now() - 3600000);
    // Try to insert — fails silently if already exists (another instance got there first)
    const result = d.prepare("INSERT OR IGNORE INTO tg_processed_updates (update_id) VALUES (?)").run(updateId);
    return result.changes === 1; // true = we claimed it, false = already processed
  } catch {
    return true; // if DB unavailable, allow processing (better than silent failure)
  }
}

// ─── Telegram API helpers ────────────────────────────────────────────────────

async function tgPost(method, body, timeoutMs = 10000) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (e) {
    console.warn(`[TelegramBot] ${method} error:`, e.message);
    return null;
  }
}

async function send(chatId, text) {
  return tgPost("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

// ─── Command handlers ────────────────────────────────────────────────────────

async function cmdAgents(chatId) {
  const agents = db.getAllAgents();
  if (!agents.length) {
    return send(chatId, "No agents registered yet.");
  }

  const now = Date.now();
  const lines = ["*📡 Veridex Agents*\n"];

  for (const agent of agents) {
    const stats  = db.getAgentStats(agent.id);
    const recent = db.getRecentLogs({ agentId: agent.id, limit: 1 });
    const lastTs = recent[0]?.timestamp || agent.created_at;
    const age    = now - lastTs;

    let statusDot;
    const alerts = db.getAgentAlerts(agent.id, { status: "active", limit: 1 });
    if (alerts.length > 0) statusDot = "🔴";
    else if (age < 3 * 60 * 1000)  statusDot = "🟢";
    else if (age < 30 * 60 * 1000) statusDot = "🟡";
    else                            statusDot = "⚫";

    const lastAction = recent[0] ? timeAgo(lastTs) : "never";
    lines.push(`${statusDot} *${agent.name || agent.id}*`);
    lines.push(`   ID: \`${agent.id}\` · ${stats.actionsToday} actions today · ${stats.blockedActions} blocked`);
    lines.push(`   Last: ${lastAction}`);
    if (stats.totalEarned > 0) lines.push(`   Earned: ${stats.totalEarned.toFixed(4)} ℏ`);
    lines.push("");
  }

  lines.push(`🟢 active  🟡 idle  🔴 alert  ⚫ offline`);
  return send(chatId, lines.join("\n"));
}

async function cmdLogs(chatId, agentId) {
  if (!agentId) return send(chatId, "Usage: /logs <agentId>");

  const agent = db.getAgent(agentId);
  if (!agent) return send(chatId, `❌ Agent \`${agentId}\` not found.\n\nTry /agents to see all IDs.`);

  const logs = db.getAgentLogs(agentId, { limit: 10 });
  if (!logs.length) return send(chatId, `No logs yet for *${agent.name || agentId}*.`);

  const EMOJI = { low: "🟢", medium: "🟡", high: "🔴", blocked: "⬛" };
  const lines = [`*📋 ${agent.name || agentId} — last ${logs.length} actions*\n`];

  for (const log of logs) {
    const e = EMOJI[log.riskLevel] || "⚪";
    const desc = log.description || log.action || "unknown";
    lines.push(`${e} ${timeAgo(log.timestamp)} — ${desc}`);
    if (log.blockReason) lines.push(`   ↳ Blocked: ${log.blockReason}`);
    if (log.hcsSequenceNumber && agent.hcs_topic_id) {
      lines.push(`   ↳ [HCS #${log.hcsSequenceNumber}](https://hashscan.io/testnet/topic/${agent.hcs_topic_id})`);
    }
  }

  return send(chatId, lines.join("\n"));
}

async function cmdBlock(chatId, agentId) {
  if (!agentId) return send(chatId, "Usage: /block <agentId>");

  const agent = db.getAgent(agentId);
  if (!agent) {
    db.upsertAgent({ id: agentId });
  }

  // Remove any existing quarantine first, then insert fresh
  const existing = db.getAgentPolicies(agentId).filter(p => p.type === "quarantine");
  for (const p of existing) db.deletePolicy(p.id);

  db.insertPolicy({ agentId, type: "quarantine", value: "true", label: "Quarantined via Telegram" });

  const name = agent?.name || agentId;
  return send(chatId,
    `🚫 *${name} QUARANTINED*\n\nAll actions are now blocked. The agent is still running but every \`/api/log\` call will return \`allowed: false\`.\n\nUse /unblock ${agentId} to restore.`
  );
}

async function cmdUnblock(chatId, agentId) {
  if (!agentId) return send(chatId, "Usage: /unblock <agentId>");

  const agent = db.getAgent(agentId);
  if (!agent) return send(chatId, `❌ Agent \`${agentId}\` not found.`);

  const policies = db.getAgentPolicies(agentId).filter(p => p.type === "quarantine");
  if (!policies.length) return send(chatId, `✅ *${agent.name || agentId}* is not quarantined.`);

  for (const p of policies) db.deletePolicy(p.id);
  return send(chatId, `✅ *${agent.name || agentId}* UNBLOCKED — actions allowed again.`);
}

async function cmdStatus(chatId, agentId) {
  if (!agentId) return send(chatId, "Usage: /status <agentId>");

  const agent = db.getAgent(agentId);
  if (!agent) return send(chatId, `❌ Agent \`${agentId}\` not found.\n\nTry /agents to see all IDs.`);

  const stats   = db.getAgentStats(agentId);
  const recent  = db.getRecentLogs({ agentId, limit: 1 });
  const alerts  = db.getAgentAlerts(agentId, { status: "active", limit: 5 });
  const policies = db.getAgentPolicies(agentId);
  const quarantined = policies.some(p => p.type === "quarantine");

  const now = Date.now();
  const lastTs = recent[0]?.timestamp;
  const age = lastTs ? now - lastTs : null;

  let statusLine;
  if (quarantined)           statusLine = "🚫 QUARANTINED";
  else if (alerts.length)    statusLine = `🔴 ALERT (${alerts.length} active)`;
  else if (age && age < 3 * 60 * 1000)  statusLine = "🟢 Active";
  else if (age && age < 30 * 60 * 1000) statusLine = "🟡 Idle";
  else                       statusLine = "⚫ Offline";

  const lines = [
    `*📊 ${agent.name || agentId}*`,
    `Status: ${statusLine}`,
    ``,
    `*Activity*`,
    `  Actions today: ${stats.actionsToday}`,
    `  Blocked total: ${stats.blockedActions}`,
    `  High risk:     ${stats.highRiskActions}`,
    `  All time:      ${stats.totalActions}`,
    ``,
    `*Earnings*`,
    `  Total: ${(stats.totalEarned || 0).toFixed(4)} ℏ`,
    ``,
  ];

  if (recent[0]) {
    lines.push(`*Last Action* — ${timeAgo(lastTs)}`);
    lines.push(`  ${recent[0].description || recent[0].action}`);
    lines.push("");
  }

  if (alerts.length) {
    lines.push(`*⚠️ Active Alerts (${alerts.length})*`);
    for (const a of alerts.slice(0, 3)) lines.push(`  • ${a.description}`);
    lines.push("");
  }

  if (policies.filter(p => p.type !== "quarantine").length) {
    lines.push(`*Blocking Rules:* ${policies.filter(p => p.type !== "quarantine").length} active`);
  }

  if (agent.hcs_topic_id) {
    lines.push(`\n[HashScan Audit Trail](https://hashscan.io/testnet/topic/${agent.hcs_topic_id})`);
  }

  return send(chatId, lines.join("\n"));
}

async function cmdMemory(chatId, agentId) {
  if (!agentId) return send(chatId, "Usage: /memory <agentId>");

  const agent = db.getAgent(agentId);
  if (!agent) return send(chatId, `❌ Agent \`${agentId}\` not found.`);

  if (!agent.hcs_topic_id) {
    return send(chatId, `⚠️ *${agent.name || agentId}* has no HCS topic yet. Start the agent to generate history.`);
  }

  await send(chatId, `🔍 Reading Hedera HCS for *${agent.name || agentId}*...`);

  try {
    const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${agent.hcs_topic_id}/messages?limit=50&order=desc`;
    const resp = await fetch(mirrorUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Mirror Node ${resp.status}`);
    const data = await resp.json();

    const messages = (data.messages || []).map(m => {
      try { return { seq: m.sequence_number, ...JSON.parse(Buffer.from(m.message, "base64").toString()) }; }
      catch { return { seq: m.sequence_number }; }
    });

    const blocked = messages.filter(m => m.result === "blocked" || m.riskLevel === "blocked");
    const openJobs = db.getJobsByAgent(agent.owner_wallet || "").filter(j =>
      ["Open", "Funded", "Submitted", "Bidding"].includes(j.status)
    );
    const stats = db.getAgentStats(agentId);

    const lines = [
      `*🧠 ${agent.name || agentId} — Verified Memory*`,
      `${messages.length} HCS messages · [HashScan](https://hashscan.io/testnet/topic/${agent.hcs_topic_id})`,
      "",
    ];

    if (blocked.length) {
      lines.push(`*⛔ Blocked Actions (${blocked.length})*`);
      for (const b of blocked.slice(0, 5)) {
        lines.push(`  #${b.seq} ${b.tool || b.action || "?"} — ${b.blockReason || "policy"}`);
      }
      lines.push("");
    }

    if (openJobs.length) {
      lines.push(`*📋 Open Jobs (${openJobs.length})*`);
      for (const j of openJobs) lines.push(`  ${j.status}: Job #${j.job_id} · ${j.budget || "?"} ℏ`);
      lines.push("");
    }

    lines.push(`*📈 Lifetime Stats*`);
    lines.push(`  ${stats.totalActions} actions · ${stats.blockedActions} blocked · ${(stats.totalEarned || 0).toFixed(4)} ℏ`);

    return send(chatId, lines.join("\n"));
  } catch (e) {
    return send(chatId, `❌ Failed to read HCS: ${e.message}`);
  }
}

function cmdHelp(chatId) {
  return send(chatId, [
    "*🤖 Veridex Bot Commands*",
    "",
    "/agents — list all agents with status",
    "/logs <id> — last 10 actions (plain English)",
    "/block <id> — quarantine agent (kill switch)",
    "/unblock <id> — restore agent",
    "/status <id> — full stats + last action",
    "/memory <id> — read verified history from Hedera",
    "",
    "🟢 active  🟡 idle  🔴 alert  ⚫ offline  🚫 quarantined",
  ].join("\n"));
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = String(msg.chat?.id);
  const text   = (msg.text || "").trim();

  // Security: only respond to configured chat
  if (ALLOWED_CHAT && chatId !== ALLOWED_CHAT) {
    console.warn(`[TelegramBot] Ignored message from unauthorized chat ${chatId}`);
    return;
  }

  if (!text.startsWith("/")) return;

  const parts   = text.split(/\s+/);
  const command = parts[0].split("@")[0].toLowerCase(); // strip @botname suffix
  const arg     = parts[1] || "";

  console.log(`[TelegramBot] ${command} ${arg} (from chat ${chatId})`);

  try {
    switch (command) {
      case "/agents":                    await cmdAgents(chatId); break;
      case "/logs":                      await cmdLogs(chatId, arg); break;
      case "/block":                     await cmdBlock(chatId, arg); break;
      case "/unblock":                   await cmdUnblock(chatId, arg); break;
      case "/status":                    await cmdStatus(chatId, arg); break;
      case "/memory":                    await cmdMemory(chatId, arg); break;
      case "/start": case "/help":       await cmdHelp(chatId); break;
      default:
        await send(chatId, `Unknown command: ${command}\n\nType /help for available commands.`);
    }
  } catch (e) {
    console.error("[TelegramBot] Command error:", e);
    await send(chatId, `❌ Error: ${e.message}`);
  }
}

// ─── Long-polling loop ───────────────────────────────────────────────────────

async function poll() {
  try {
    const result = await tgPost("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    }, 40000); // 40s — must exceed the 30s long-poll timeout

    if (!result?.ok || !result.result?.length) return;

    for (const update of result.result) {
      offset = update.update_id + 1;
      if (update.message && claimUpdate(update.update_id)) {
        await handleMessage(update.message);
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") console.warn("[TelegramBot] Poll error:", e.message);
  }
}

function start() {
  if (!BOT_TOKEN) return;
  if (running) return;
  running = true;

  console.log(`[TelegramBot] Started — listening for commands (chat: ${ALLOWED_CHAT})`);

  // Send startup message
  if (ALLOWED_CHAT) {
    send(ALLOWED_CHAT, "🤖 *Veridex Bot online*\n\nType /help for commands.\nType /agents to see your agents.").catch(() => {});
  }

  // Poll loop
  (async function loop() {
    while (running) {
      await poll();
      await new Promise(r => setTimeout(r, 1000));
    }
  })().catch(e => console.error("[TelegramBot] Loop crashed:", e));
}

function stop() {
  running = false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)    return `${d}s ago`;
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

module.exports = { start, stop };
