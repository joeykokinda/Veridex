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
  // Migrations — safe to run repeatedly
  try { db.exec("ALTER TABLE agents ADD COLUMN config TEXT"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN hcs_encryption_key TEXT"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN reputation_score INTEGER NOT NULL DEFAULT 500"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN safety_score INTEGER NOT NULL DEFAULT 1000"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN telegram_chat_id TEXT"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN claim_token TEXT"); } catch {}
  ensureJobsTable();
  try { db.exec(`CREATE TABLE IF NOT EXISTS agent_delegations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    delegate_address TEXT NOT NULL,
    delegator_address TEXT NOT NULL,
    allowed_actions TEXT NOT NULL,
    caveat_type TEXT NOT NULL DEFAULT 'action_scope',
    signature TEXT NOT NULL,
    delegation_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`); } catch {}
}

function ensureJobsTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id      TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      client      TEXT,
      agent       TEXT,
      budget      TEXT,
      amount      TEXT,
      description TEXT,
      block_number INTEGER,
      tx_hash     TEXT,
      posted_at   INTEGER,
      accepted_at INTEGER,
      completed_at INTEGER,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_agent  ON jobs(agent);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS vault_secrets (
      id             TEXT PRIMARY KEY,
      owner_agent_id TEXT NOT NULL,
      secret_type    TEXT NOT NULL,
      label          TEXT,
      ciphertext     TEXT NOT NULL,
      iv             TEXT NOT NULL,
      tag            TEXT NOT NULL,
      allowed_agents TEXT,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_owner ON vault_secrets(owner_agent_id);

    CREATE TABLE IF NOT EXISTS vault_grants (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      secret_type TEXT NOT NULL,
      endpoint    TEXT,
      granted     INTEGER NOT NULL DEFAULT 1,
      expires_at  INTEGER,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_grants_agent ON vault_grants(agent_id);

    CREATE TABLE IF NOT EXISTS agent_webhooks (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      url         TEXT NOT NULL,
      events      TEXT NOT NULL DEFAULT 'blocked,high_risk',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON agent_webhooks(agent_id);
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
  const agent   = d.prepare("SELECT reputation_score, safety_score FROM agents WHERE id = ?").get(agentId);
  return {
    totalActions: total.c,
    actionsToday: today.c,
    blockedActions: blocked.c,
    highRiskActions: high.c,
    totalEarned: earnings.total,
    reputationScore: agent?.reputation_score ?? 500,
    safetyScore: agent?.safety_score ?? 1000,
  };
}

// Reputation changes only from job outcomes (ERC-8183).
// delta: +10 on-time, +3 late, -15 abandoned, -5 disputed, +20 five-star, -20 one-star
function updateReputationFromJob(agentId, delta) {
  const d = getDb();
  if (delta >= 0) {
    d.prepare(
      "UPDATE agents SET reputation_score = MIN(1000, COALESCE(reputation_score, 500) + ?) WHERE id = ?"
    ).run(delta, agentId);
  } else {
    d.prepare(
      "UPDATE agents SET reputation_score = MAX(0, COALESCE(reputation_score, 500) + ?) WHERE id = ?"
    ).run(delta, agentId);
  }
}

// Safety score — tracks block behavior independently from reputation.
// Each blocked action decrements by 5 (floor 0). Positive delta can restore it.
function updateSafetyScore(agentId, delta) {
  const d = getDb();
  if (delta >= 0) {
    d.prepare(
      "UPDATE agents SET safety_score = MIN(1000, COALESCE(safety_score, 1000) + ?) WHERE id = ?"
    ).run(delta, agentId);
  } else {
    d.prepare(
      "UPDATE agents SET safety_score = MAX(0, COALESCE(safety_score, 1000) + ?) WHERE id = ?"
    ).run(delta, agentId);
  }
}

// Kept for internal compatibility; prefer updateSafetyScore for new call sites.
function decrementReputation(agentId, delta = 5) {
  updateSafetyScore(agentId, -delta);
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

// ── Split config ───────────────────────────────────────────────────────────────

const DEFAULT_SPLIT = { splitDev: 60, splitOps: 30, splitReinvest: 10 };

function getAgentSplitConfig(agentId) {
  const agent = getAgent(agentId);
  if (!agent?.config) return DEFAULT_SPLIT;
  try {
    const cfg = JSON.parse(agent.config);
    return { ...DEFAULT_SPLIT, ...cfg };
  } catch { return DEFAULT_SPLIT; }
}

function setAgentSplitConfig(agentId, { splitDev, splitOps, splitReinvest }) {
  const current = getAgent(agentId);
  let existing = {};
  try { existing = JSON.parse(current?.config || "{}"); } catch {}
  const next = JSON.stringify({ ...existing, splitDev, splitOps, splitReinvest });
  getDb().prepare("UPDATE agents SET config = ? WHERE id = ?").run(next, agentId);
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

function upsertJob({ jobId, status, client, agent, budget, amount, description, blockNumber, txHash, postedAt, acceptedAt, completedAt, updatedAt }) {
  const d = getDb();
  const existing = d.prepare("SELECT job_id FROM jobs WHERE job_id = ?").get(jobId);
  if (existing) {
    d.prepare(`
      UPDATE jobs SET
        status       = COALESCE(?, status),
        client       = COALESCE(?, client),
        agent        = COALESCE(?, agent),
        budget       = COALESCE(?, budget),
        amount       = COALESCE(?, amount),
        description  = COALESCE(?, description),
        block_number = COALESCE(?, block_number),
        tx_hash      = COALESCE(?, tx_hash),
        posted_at    = COALESCE(?, posted_at),
        accepted_at  = COALESCE(?, accepted_at),
        completed_at = COALESCE(?, completed_at),
        updated_at   = ?
      WHERE job_id = ?
    `).run(status||null, client||null, agent||null, budget||null, amount||null, description||null, blockNumber||null, txHash||null, postedAt||null, acceptedAt||null, completedAt||null, updatedAt||Date.now(), jobId);
  } else {
    d.prepare(`
      INSERT INTO jobs (job_id, status, client, agent, budget, amount, description, block_number, tx_hash, posted_at, accepted_at, completed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, status||"Open", client||null, agent||null, budget||null, amount||null, description||null, blockNumber||null, txHash||null, postedAt||null, acceptedAt||null, completedAt||null, updatedAt||Date.now());
  }
}

function getJob(jobId)             { return getDb().prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId); }
function getJobsByStatus(status)   { return getDb().prepare("SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC").all(status); }
function getJobsByAgent(agent)     { return getDb().prepare("SELECT * FROM jobs WHERE agent = ? ORDER BY updated_at DESC").all(agent); }
function getRecentJobs(limit = 50) { return getDb().prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?").all(limit); }

// ── Vault ─────────────────────────────────────────────────────────────────────

function insertVaultSecret({ ownerAgentId, secretType, label, ciphertext, iv, tag, allowedAgentIds }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO vault_secrets (id, owner_agent_id, secret_type, label, ciphertext, iv, tag, allowed_agents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerAgentId, secretType, label||null, ciphertext, iv, tag, JSON.stringify(allowedAgentIds||[]));
  return id;
}

function getVaultSecret(id)       { return getDb().prepare("SELECT * FROM vault_secrets WHERE id = ?").get(id); }
function deleteVaultSecret(id)    { return getDb().prepare("DELETE FROM vault_secrets WHERE id = ?").run(id); }

function getVaultSecrets(agentId) {
  const d = getDb();
  const own = d.prepare("SELECT * FROM vault_secrets WHERE owner_agent_id = ? ORDER BY created_at DESC").all(agentId);
  // Also return secrets where this agent is in allowed_agents
  const all = d.prepare("SELECT * FROM vault_secrets ORDER BY created_at DESC").all();
  const allowed = all.filter(s => {
    if (s.owner_agent_id === agentId) return false; // already in own
    try { return JSON.parse(s.allowed_agents || "[]").includes(agentId); } catch { return false; }
  });
  return [...own, ...allowed];
}

function findVaultSecret(agentId, secretType) {
  const d = getDb();
  // Check owned first
  const owned = d.prepare("SELECT * FROM vault_secrets WHERE owner_agent_id = ? AND secret_type = ? LIMIT 1").get(agentId, secretType);
  if (owned) return owned;
  // Check allowed
  const all = d.prepare("SELECT * FROM vault_secrets WHERE secret_type = ?").all(secretType);
  return all.find(s => {
    try { return JSON.parse(s.allowed_agents || "[]").includes(agentId); } catch { return false; }
  }) || null;
}

function insertVaultGrant({ agentId, secretType, endpoint, granted, expiresAt }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO vault_grants (id, agent_id, secret_type, endpoint, granted, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, agentId, secretType, endpoint||null, granted ? 1 : 0, expiresAt||null);
  return id;
}

function getVaultGrants(agentId) {
  return getDb().prepare("SELECT * FROM vault_grants WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 100").all(agentId);
}

// ── Agent Webhooks ─────────────────────────────────────────────────────────────

function insertWebhook({ agentId, url, events = "blocked,high_risk" }) {
  const { randomUUID } = require("crypto");
  const d = getDb();
  ensureJobsTable();
  const id = randomUUID();
  d.prepare("INSERT INTO agent_webhooks (id, agent_id, url, events) VALUES (?,?,?,?)").run(id, agentId, url, events);
  return id;
}

function getWebhooks(agentId) {
  const d = getDb();
  ensureJobsTable();
  return d.prepare("SELECT * FROM agent_webhooks WHERE agent_id = ?").all(agentId);
}

function deleteWebhook(id) {
  getDb().prepare("DELETE FROM agent_webhooks WHERE id = ?").run(id);
}

// ── Agent Delegations (ERC-7715) ───────────────────────────────────────────────

function insertDelegation({ agentId, delegateAddress, delegatorAddress, allowedActions, signature, delegationHash, caveatType }) {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO agent_delegations (id, agent_id, delegate_address, delegator_address, allowed_actions, caveat_type, signature, delegation_hash) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, agentId, delegateAddress, delegatorAddress, JSON.stringify(allowedActions), caveatType || "action_scope", signature, delegationHash);
  return id;
}

function getDelegations(agentId) {
  return getDb().prepare("SELECT * FROM agent_delegations WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC").all(agentId);
}

function revokeDelegation(id) {
  return getDb().prepare("UPDATE agent_delegations SET active = 0 WHERE id = ?").run(id);
}

// ── Agent lookup by wallet ─────────────────────────────────────────────────────

function findAgentByWallet(walletAddress) {
  if (!walletAddress) return null;
  return getDb().prepare("SELECT * FROM agents WHERE LOWER(owner_wallet) = LOWER(?) LIMIT 1").get(walletAddress);
}

module.exports = {
  getDb,
  // agents
  upsertAgent, getAgent, getAgentsByOwner, getAllAgents, findAgentByWallet,
  // logs
  insertLog, getAgentLogs, getRecentLogs, getAgentStats, decrementReputation, updateReputationFromJob, updateSafetyScore,
  // alerts
  insertAlert, getAgentAlerts, resolveAlert, getActiveAlertCount,
  // policies
  insertPolicy, getAgentPolicies, deletePolicy,
  // earnings
  insertEarning, getAgentEarnings,
  // split config
  getAgentSplitConfig, setAgentSplitConfig,
  // jobs
  ensureJobsTable, upsertJob, getJob, getJobsByStatus, getJobsByAgent, getRecentJobs,
  // vault
  insertVaultSecret, getVaultSecret, deleteVaultSecret, getVaultSecrets, findVaultSecret,
  insertVaultGrant, getVaultGrants,
  // webhooks
  insertWebhook, getWebhooks, deleteWebhook,
  // delegations (ERC-7715)
  insertDelegation, getDelegations, revokeDelegation,
};
