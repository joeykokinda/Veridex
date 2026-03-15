/**
 * Veridex SQLite database layer
 * Stores agent logs, alerts, policies, and earnings for the trust monitoring system
 */

const Database = require("better-sqlite3");
const path = require("path");
const { randomUUID } = require("crypto");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "veridex.db");

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      owner_wallet TEXT,
      hedera_account_id TEXT,
      hcs_topic_id TEXT,
      name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      action TEXT,
      tool TEXT,
      params TEXT,
      description TEXT,
      result TEXT,
      risk_level TEXT DEFAULT 'low',
      block_reason TEXT,
      phase TEXT,
      hcs_sequence_number TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      trigger_type TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS earnings (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      amount_hbar REAL,
      source TEXT,
      split_dev REAL,
      split_ops REAL,
      split_reinvest REAL,
      hcs_paystub_sequence TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_risk ON logs(risk_level);
    CREATE INDEX IF NOT EXISTS idx_alerts_agent_id ON alerts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_policies_agent_id ON policies(agent_id);
  `);
}

// ── Agents ────────────────────────────────────────────────────────────────────

function upsertAgent({ id, ownerWallet, hederaAccountId, hcsTopicId, name }) {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM agents WHERE id = ?").get(id);
  if (existing) {
    d.prepare(`
      UPDATE agents SET
        owner_wallet = COALESCE(?, owner_wallet),
        hedera_account_id = COALESCE(?, hedera_account_id),
        hcs_topic_id = COALESCE(?, hcs_topic_id),
        name = COALESCE(?, name)
      WHERE id = ?
    `).run(ownerWallet || null, hederaAccountId || null, hcsTopicId || null, name || null, id);
  } else {
    d.prepare(`
      INSERT INTO agents (id, owner_wallet, hedera_account_id, hcs_topic_id, name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, ownerWallet || null, hederaAccountId || null, hcsTopicId || null, name || null);
  }
  return getAgent(id);
}

function getAgent(id) {
  return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id);
}

function getAgentsByOwner(ownerWallet) {
  return getDb().prepare("SELECT * FROM agents WHERE owner_wallet = ? ORDER BY created_at DESC").all(ownerWallet);
}

function getAllAgents() {
  return getDb().prepare("SELECT * FROM agents ORDER BY created_at DESC").all();
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function insertLog({ agentId, sessionId, action, tool, params, description, result, riskLevel, blockReason, phase, hcsSequenceNumber, timestamp }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO logs (id, agent_id, session_id, action, tool, params, description, result, risk_level, block_reason, phase, hcs_sequence_number, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    agentId,
    sessionId || null,
    action || null,
    tool || null,
    params ? JSON.stringify(params) : null,
    description || null,
    result || null,
    riskLevel || "low",
    blockReason || null,
    phase || null,
    hcsSequenceNumber || null,
    timestamp || Date.now()
  );
  return id;
}

function getAgentLogs(agentId, { limit = 50, offset = 0, riskLevel, action } = {}) {
  let q = "SELECT * FROM logs WHERE agent_id = ?";
  const params = [agentId];
  if (riskLevel) { q += " AND risk_level = ?"; params.push(riskLevel); }
  if (action)    { q += " AND action = ?";     params.push(action); }
  q += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return getDb().prepare(q).all(...params).map(parseLog);
}

function getRecentLogs({ ownerWallet, agentId, limit = 20 } = {}) {
  const d = getDb();
  if (agentId) {
    return d.prepare("SELECT * FROM logs WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(agentId, limit).map(parseLog);
  }
  if (ownerWallet) {
    return d.prepare(`
      SELECT l.* FROM logs l
      JOIN agents a ON l.agent_id = a.id
      WHERE a.owner_wallet = ?
      ORDER BY l.timestamp DESC LIMIT ?
    `).all(ownerWallet, limit).map(parseLog);
  }
  return d.prepare("SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?").all(limit).map(parseLog);
}

function getAgentStats(agentId) {
  const d = getDb();
  const total   = d.prepare("SELECT COUNT(*) as c FROM logs WHERE agent_id = ?").get(agentId);
  const today   = d.prepare("SELECT COUNT(*) as c FROM logs WHERE agent_id = ? AND timestamp > ?").get(agentId, Date.now() - 86400000);
  const blocked = d.prepare("SELECT COUNT(*) as c FROM logs WHERE agent_id = ? AND risk_level = 'blocked'").get(agentId);
  const high    = d.prepare("SELECT COUNT(*) as c FROM logs WHERE agent_id = ? AND risk_level = 'high'").get(agentId);
  const earnings = d.prepare("SELECT COALESCE(SUM(amount_hbar),0) as total FROM earnings WHERE agent_id = ?").get(agentId);
  return {
    totalActions: total.c,
    actionsToday: today.c,
    blockedActions: blocked.c,
    highRiskActions: high.c,
    totalEarned: earnings.total
  };
}

function parseLog(row) {
  if (!row) return null;
  return {
    ...row,
    params: row.params ? JSON.parse(row.params) : null
  };
}

// ── Alerts ────────────────────────────────────────────────────────────────────

function insertAlert({ agentId, triggerType, description, timestamp }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO alerts (id, agent_id, trigger_type, description, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, agentId, triggerType || null, description || null, timestamp || Date.now());
  return id;
}

function getAgentAlerts(agentId, { limit = 50, status } = {}) {
  let q = "SELECT * FROM alerts WHERE agent_id = ?";
  const params = [agentId];
  if (status) { q += " AND status = ?"; params.push(status); }
  q += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);
  return getDb().prepare(q).all(...params);
}

function resolveAlert(alertId) {
  return getDb().prepare("UPDATE alerts SET status = 'resolved' WHERE id = ?").run(alertId);
}

function getActiveAlertCount(agentId) {
  return getDb().prepare("SELECT COUNT(*) as c FROM alerts WHERE agent_id = ? AND status = 'active'").get(agentId).c;
}

// ── Policies ──────────────────────────────────────────────────────────────────

function insertPolicy({ agentId, type, value, label }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO policies (id, agent_id, type, value, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, agentId, type, value, label || null);
  return id;
}

function getAgentPolicies(agentId) {
  return getDb().prepare("SELECT * FROM policies WHERE agent_id = ? ORDER BY created_at ASC").all(agentId);
}

function deletePolicy(policyId) {
  return getDb().prepare("DELETE FROM policies WHERE id = ?").run(policyId);
}

// ── Earnings ──────────────────────────────────────────────────────────────────

function insertEarning({ agentId, amountHbar, source, splitDev, splitOps, splitReinvest, hcsPaystubSequence }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO earnings (id, agent_id, amount_hbar, source, split_dev, split_ops, split_reinvest, hcs_paystub_sequence, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, amountHbar, source || null, splitDev || null, splitOps || null, splitReinvest || null, hcsPaystubSequence || null, Date.now());
  return id;
}

function getAgentEarnings(agentId) {
  return getDb().prepare("SELECT * FROM earnings WHERE agent_id = ? ORDER BY timestamp DESC").all(agentId);
}

module.exports = {
  getDb,
  // agents
  upsertAgent, getAgent, getAgentsByOwner, getAllAgents,
  // logs
  insertLog, getAgentLogs, getRecentLogs, getAgentStats,
  // alerts
  insertAlert, getAgentAlerts, resolveAlert, getActiveAlertCount,
  // policies
  insertPolicy, getAgentPolicies, deletePolicy,
  // earnings
  insertEarning, getAgentEarnings
};
