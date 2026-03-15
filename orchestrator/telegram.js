/**
 * Veridex Telegram alert integration
 * Fires on blocked actions or high-risk events
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// In-memory rate limiting — at most 1 alert per agent per 60s for same trigger type
const alertCooldowns = new Map(); // `${agentId}:${triggerType}` → lastSent timestamp
const ALERT_COOLDOWN_MS = 60 * 1000;

/**
 * Send a Telegram alert.
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} opts.agentName
 * @param {string} opts.triggerType - "blocked" | "high_risk" | "alert"
 * @param {string} opts.description - plain-English description of what happened
 * @param {string} [opts.topicId] - HCS topic ID for HashScan link
 * @param {string} [opts.chatId] - override default chat ID
 */
async function sendAlert({ agentId, agentName, triggerType, description, topicId, chatId }) {
  if (!BOT_TOKEN) return; // Telegram not configured

  const cKey = `${agentId}:${triggerType}`;
  const lastSent = alertCooldowns.get(cKey) || 0;
  if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return; // rate limit
  alertCooldowns.set(cKey, Date.now());

  const target = chatId || DEFAULT_CHAT_ID;
  if (!target) return;

  const emoji = triggerType === "blocked" ? "🚨" : triggerType === "high_risk" ? "⚠️" : "ℹ️";
  const title = triggerType === "blocked" ? "ACTION BLOCKED" : triggerType === "high_risk" ? "HIGH RISK ACTION" : "ALERT";

  let text = `${emoji} *VERIDEX ${title}*\n`;
  text += `Agent: *${agentName || agentId}*\n`;
  text += `${description}\n`;
  text += `Time: ${new Date().toISOString()}\n`;
  if (topicId) {
    text += `Audit log: [HashScan](https://hashscan.io/testnet/topic/${topicId})`;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false
      })
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn("[Telegram] Send failed:", body);
    }
  } catch (e) {
    console.warn("[Telegram] Fetch error:", e.message);
  }
}

/**
 * Send a custom message (no rate limiting, for setup/test).
 */
async function sendMessage(text, chatId) {
  if (!BOT_TOKEN) return false;
  const target = chatId || DEFAULT_CHAT_ID;
  if (!target) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target, text, parse_mode: "Markdown" })
    });
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = { sendAlert, sendMessage };
