"use client";

import Link from "next/link";
import { Nav } from "../../components/Nav";
import { useEffect, useState, useCallback, useRef } from "react";
import { use } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentStats {
  agent: {
    id: string;
    name?: string;
    hcs_topic_id?: string;
    owner_wallet?: string;
    created_at: number;
  };
  stats: {
    totalActions: number;
    actionsToday: number;
    blockedActions: number;
    highRiskActions: number;
    totalEarned: number;
  };
  earnings: Earning[];
  recentAlerts: Alert[];
  policies: Policy[];
  recentLogs: Log[];
  activeAlerts: number;
  hashScanUrl?: string;
}

interface Log {
  id: string;
  agentId: string;
  action: string;
  tool?: string;
  description: string;
  riskLevel: string;
  blockReason?: string;
  phase?: string;
  hcsSequenceNumber?: string;
  timestamp: number;
}

interface Alert {
  id: string;
  agentId: string;
  triggerType: string;
  description: string;
  status: string;
  timestamp: number;
}

interface Policy {
  id: string;
  agentId: string;
  type: string;
  value: string;
  label?: string;
  created_at: number;
}

interface Earning {
  id: string;
  amount_hbar: number;
  source: string;
  split_dev: number;
  split_ops: number;
  split_reinvest: number;
  hcs_paystub_sequence?: string;
  timestamp: number;
}

interface Job {
  id: string;
  jobId: string;
  status: string;
  clientAddress?: string;
  agentAddress?: string;
  amount?: number;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
  txHash?: string;
}

interface AgentMemory {
  agentId: string;
  topicId: string;
  messageCount: number;
  blocked_actions: Array<{ seq: number; action: string; reason: string; timestamp?: string }>;
  open_jobs: Array<{ jobId: string; status: string; amount?: number }>;
  recent_completions: Array<{ jobId: string; amount?: number; timestamp?: string }>;
  pending_earnings: Array<{ amount?: number; source?: string }>;
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const RISK_COLORS: Record<string, string> = {
  blocked: "#ef4444",
  high:    "#f97316",
  medium:  "#f59e0b",
  low:     "#10b981",
  info:    "#3b82f6",
};

function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLORS[level] || "#71717a";
  return (
    <span style={{
      fontSize: "10px", padding: "2px 7px", borderRadius: "4px", fontWeight: 600,
      background: `${color}18`, border: `1px solid ${color}40`, color,
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>
      {level}
    </span>
  );
}

const JOB_STATUS_COLORS: Record<string, string> = {
  Posted: "#3b82f6", Funded: "#f59e0b", Submitted: "#14b8a6",
  Completed: "#10b981", Cancelled: "#6b7280", Failed: "#ef4444",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "activity" | "jobs" | "earnings" | "policies" | "recovery";

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const decodedId = decodeURIComponent(agentId);

  const [tab, setTab] = useState<Tab>("activity");
  const [data, setData] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLogs, setLiveLogs] = useState<Log[]>([]);
  const liveRef = useRef<EventSource | null>(null);

  // Activity filters
  const [riskFilter, setRiskFilter] = useState<string>("all");

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);

  // Policies
  const [policyType, setPolicyType] = useState("block_domain");
  const [policyValue, setPolicyValue] = useState("");
  const [policyLabel, setPolicyLabel] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);

  // Recovery / Memory
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  // ─── Fetch base data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}`);
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {}
    setLoading(false);
  }, [decodedId]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ─── SSE live feed (filter to this agent) ──────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/proxy/feed/live");
    liveRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.agentId === decodedId && ev.log) {
          setLiveLogs(prev => [ev.log as Log, ...prev].slice(0, 200));
        }
      } catch {}
    };
    return () => { es.close(); };
  }, [decodedId]);

  // ─── Fetch jobs ─────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    if (!data?.agent?.owner_wallet) return;
    try {
      const res = await fetch(`/api/proxy/v2/jobs/agent/${encodeURIComponent(data.agent.owner_wallet)}`);
      if (!res.ok) return;
      const json = await res.json();
      setJobs(json.jobs || []);
    } catch {}
  }, [data?.agent?.owner_wallet]);

  useEffect(() => {
    if (tab === "jobs") fetchJobs();
  }, [tab, fetchJobs]);

  // ─── Fetch memory ───────────────────────────────────────────────────────────

  const fetchMemory = useCallback(async () => {
    if (memory || memoryLoading) return;
    setMemoryLoading(true);
    try {
      const res = await fetch(`/api/proxy/v2/agent/${encodeURIComponent(decodedId)}/memory`);
      if (!res.ok) return;
      const json = await res.json();
      setMemory(json);
    } catch {}
    setMemoryLoading(false);
  }, [decodedId, memory, memoryLoading]);

  useEffect(() => {
    if (tab === "recovery") fetchMemory();
  }, [tab, fetchMemory]);

  // ─── Policy actions ─────────────────────────────────────────────────────────

  async function addPolicy() {
    if (!policyValue.trim()) return;
    setPolicyLoading(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: policyType, value: policyValue.trim(), label: policyLabel.trim() || undefined }),
      });
      setPolicyValue(""); setPolicyLabel("");
      fetchData();
    } catch {}
    setPolicyLoading(false);
  }

  async function deletePolicy(id: string) {
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/policy/${id}`, { method: "DELETE" });
      fetchData();
    } catch {}
  }

  async function resolveAlert(id: string) {
    try {
      await fetch(`/api/proxy/api/monitor/alert/${id}/resolve`, { method: "POST" });
      fetchData();
    } catch {}
  }

  // ─── Derived ────────────────────────────────────────────────────────────────

  const allLogs: Log[] = [...liveLogs, ...(data?.recentLogs || [])].reduce((acc: Log[], l) => {
    if (!acc.find(x => x.id === l.id)) acc.push(l);
    return acc;
  }, []).sort((a, b) => b.timestamp - a.timestamp);

  const filteredLogs = riskFilter === "all" ? allLogs : allLogs.filter(l =>
    riskFilter === "blocked" ? !!l.blockReason : l.riskLevel === riskFilter
  );

  if (loading) {
    return (
      <>
        <Nav />
        <div style={{ maxWidth: "1100px", margin: "60px auto", padding: "0 24px", textAlign: "center", color: "var(--text-tertiary)" }}>
          Loading agent...
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Nav />
        <div style={{ maxWidth: "1100px", margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ color: "var(--text-tertiary)", marginBottom: "16px" }}>Agent not found.</div>
          <Link href="/dashboard" style={{ color: "var(--accent)", fontSize: "14px" }}>← Back to Dashboard</Link>
        </div>
      </>
    );
  }

  const agent = data.agent;
  const stats = data.stats;
  const isLive = liveLogs.length > 0 || (allLogs[0] && Date.now() - allLogs[0].timestamp < 3 * 60 * 1000);

  return (
    <>
      <Nav />
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "20px" }}>
          <Link href="/dashboard" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>Dashboard</Link>
          <span style={{ margin: "0 8px" }}>›</span>
          <span style={{ color: "var(--text-primary)" }}>{agent.name || agent.id}</span>
        </div>

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <h1 style={{ fontSize: "26px", fontWeight: 700 }}>{agent.name || agent.id}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isLive ? "#10b981" : "#555" }} />
              <span style={{ fontSize: "12px", color: isLive ? "#10b981" : "var(--text-tertiary)" }}>
                {isLive ? "Live" : "Offline"}
              </span>
            </div>
            {data.activeAlerts > 0 && (
              <span style={{ fontSize: "12px", padding: "2px 10px", borderRadius: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
                {data.activeAlerts} alert{data.activeAlerts !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Stat pills */}
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {[
              { label: "Actions today", value: stats.actionsToday, color: "var(--accent)" },
              { label: "Blocked", value: stats.blockedActions, color: stats.blockedActions > 0 ? "#ef4444" : "var(--text-tertiary)" },
              { label: "High risk", value: stats.highRiskActions, color: stats.highRiskActions > 0 ? "#f97316" : "var(--text-tertiary)" },
              { label: "Total", value: stats.totalActions, color: "var(--text-secondary)" },
              { label: "HBAR earned", value: `${(stats.totalEarned || 0).toFixed(4)} ℏ`, color: "#f59e0b" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "6px 12px", display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, fontFamily: "monospace", color }}>{value}</span>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</span>
              </div>
            ))}
            {agent.hcs_topic_id && (
              <a
                href={data.hashScanUrl || `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`}
                target="_blank" rel="noopener"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", color: "var(--accent)", textDecoration: "none", fontFamily: "monospace" }}
              >
                HCS {agent.hcs_topic_id} ↗
              </a>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "28px" }}>
          {(["activity", "jobs", "earnings", "policies", "recovery"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 16px", fontSize: "14px", cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)",
                fontWeight: tab === t ? 600 : 400,
                textTransform: "capitalize",
                marginBottom: "-1px",
                transition: "color 0.15s",
              }}
            >
              {t}
              {t === "activity" && liveLogs.length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", background: "var(--accent)", color: "#000", borderRadius: "8px", padding: "1px 5px", fontWeight: 700 }}>
                  LIVE
                </span>
              )}
              {t === "policies" && (data?.policies?.length || 0) > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-tertiary)" }}>
                  {data.policies.length}
                </span>
              )}
              {t === "earnings" && (data?.earnings?.length || 0) > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-tertiary)" }}>
                  {data.earnings.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Activity Tab ──────────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              {["all", "blocked", "high", "medium", "low"].map(f => (
                <button
                  key={f}
                  onClick={() => setRiskFilter(f)}
                  style={{
                    padding: "4px 12px", fontSize: "12px", borderRadius: "20px", cursor: "pointer",
                    border: `1px solid ${riskFilter === f ? "var(--accent)" : "var(--border)"}`,
                    background: riskFilter === f ? "var(--accent-dim)" : "transparent",
                    color: riskFilter === f ? "var(--accent)" : "var(--text-tertiary)",
                  }}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-tertiary)", alignSelf: "center" }}>
                {filteredLogs.length} entries
              </span>
            </div>

            {filteredLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: "var(--text-tertiary)", fontSize: "14px" }}>
                {allLogs.length === 0 ? "No activity yet. Start your agent to see logs here." : "No entries match this filter."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                {filteredLogs.map((log, i) => (
                  <div
                    key={log.id || i}
                    style={{
                      display: "grid", gridTemplateColumns: "80px 1fr auto auto",
                      gap: "12px", padding: "11px 14px", alignItems: "start",
                      background: log.blockReason ? "rgba(239,68,68,0.03)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      borderRadius: "4px",
                      borderLeft: log.blockReason ? "2px solid rgba(239,68,68,0.4)" : "2px solid transparent",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", paddingTop: "1px" }}>
                      {timeAgo(log.timestamp)}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: log.blockReason ? "4px" : 0 }}>
                        {log.description || log.action}
                      </div>
                      {log.blockReason && (
                        <div style={{ fontSize: "12px", color: "#ef4444" }}>
                          Blocked: {log.blockReason}
                        </div>
                      )}
                    </div>
                    <RiskBadge level={log.blockReason ? "blocked" : log.riskLevel} />
                    {log.hcsSequenceNumber && (
                      <a
                        href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${log.hcsSequenceNumber}` : "#"}
                        target="_blank" rel="noopener"
                        style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)", whiteSpace: "nowrap" }}
                      >
                        #{log.hcsSequenceNumber}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Jobs Tab ──────────────────────────────────────────────────────── */}
        {tab === "jobs" && (
          <div>
            {jobs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: "var(--text-tertiary)", fontSize: "14px" }}>
                No jobs found for this agent.
              </div>
            ) : (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 120px auto", gap: "12px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <div>Job ID</div>
                  <div>Status</div>
                  <div>Amount</div>
                  <div>Updated</div>
                  <div>Tx</div>
                </div>
                {jobs.map((job, i) => {
                  const statusColor = JOB_STATUS_COLORS[job.status] || "#6b7280";
                  return (
                    <div
                      key={job.id}
                      style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 120px auto", gap: "12px", padding: "12px 16px", alignItems: "center", borderBottom: i < jobs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                    >
                      <div style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)" }}>
                        {job.jobId || job.id}
                        {job.description && <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "inherit", marginTop: "2px" }}>{job.description.slice(0, 60)}</div>}
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: `${statusColor}18`, border: `1px solid ${statusColor}40`, color: statusColor }}>
                          {job.status}
                        </span>
                      </div>
                      <div style={{ fontSize: "13px", fontFamily: "monospace", color: "#f59e0b" }}>
                        {job.amount ? `${job.amount} ℏ` : "—"}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                        {job.updatedAt ? timeAgo(job.updatedAt) : "—"}
                      </div>
                      <div>
                        {job.txHash ? (
                          <a href={`https://hashscan.io/testnet/transaction/${job.txHash}`} target="_blank" rel="noopener" style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                            View ↗
                          </a>
                        ) : <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Earnings Tab ─────────────────────────────────────────────────── */}
        {tab === "earnings" && (
          <div>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
              {[
                { label: "Total Earned", value: `${(stats.totalEarned || 0).toFixed(4)} ℏ`, color: "#f59e0b" },
                { label: "Payments", value: data.earnings.length, color: "var(--text-primary)" },
                { label: "Avg Payment", value: data.earnings.length > 0 ? `${(stats.totalEarned / data.earnings.length).toFixed(4)} ℏ` : "—", color: "var(--text-secondary)" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "monospace", color, marginBottom: "4px" }}>{value}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
                </div>
              ))}
            </div>

            {data.earnings.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                No earnings recorded yet.
              </div>
            ) : (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 200px 120px auto", gap: "12px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <div>Source</div>
                  <div>Amount</div>
                  <div>Split (dev / ops / reinvest)</div>
                  <div>When</div>
                  <div>HCS</div>
                </div>
                {data.earnings.map((e, i) => (
                  <div
                    key={e.id}
                    style={{ display: "grid", gridTemplateColumns: "1fr 120px 200px 120px auto", gap: "12px", padding: "12px 16px", alignItems: "center", borderBottom: i < data.earnings.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                  >
                    <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>{e.source || "unknown"}</div>
                    <div style={{ fontSize: "14px", fontFamily: "monospace", fontWeight: 700, color: "#f59e0b" }}>{e.amount_hbar.toFixed(4)} ℏ</div>
                    <div style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                      <span style={{ color: "#10b981" }}>{e.split_dev}%</span> / <span style={{ color: "#3b82f6" }}>{e.split_ops}%</span> / <span style={{ color: "#f59e0b" }}>{e.split_reinvest}%</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{timeAgo(e.timestamp)}</div>
                    <div>
                      {e.hcs_paystub_sequence ? (
                        <a href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${e.hcs_paystub_sequence}` : "#"} target="_blank" rel="noopener" style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                          #{e.hcs_paystub_sequence} ↗
                        </a>
                      ) : <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>—</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Policies Tab ─────────────────────────────────────────────────── */}
        {tab === "policies" && (
          <div>
            {/* Add policy form */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "24px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px" }}>Add Blocking Rule</div>
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr auto", gap: "10px", alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Type</div>
                  <select
                    value={policyType}
                    onChange={e => setPolicyType(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer" }}
                  >
                    <option value="block_domain">Block Domain</option>
                    <option value="block_path">Block Path</option>
                    <option value="require_approval">Require Approval</option>
                    <option value="rate_limit">Rate Limit</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Value</div>
                  <input
                    type="text"
                    placeholder="e.g. sketchy-api.com"
                    value={policyValue}
                    onChange={e => setPolicyValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addPolicy()}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "monospace", outline: "none" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Label (optional)</div>
                  <input
                    type="text"
                    placeholder="e.g. No sketchy APIs"
                    value={policyLabel}
                    onChange={e => setPolicyLabel(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "inherit", outline: "none" }}
                  />
                </div>
                <button
                  onClick={addPolicy}
                  disabled={policyLoading || !policyValue.trim()}
                  style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: policyLoading || !policyValue.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
                >
                  {policyLoading ? "..." : "Add Rule"}
                </button>
              </div>
            </div>

            {/* Policies list */}
            {(data.policies || []).length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                No custom policies. Add rules above to block specific domains or actions.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.policies.map(policy => (
                  <div
                    key={policy.id}
                    style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px" }}
                  >
                    <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", color: "#3b82f6", whiteSpace: "nowrap" }}>
                      {policy.type}
                    </span>
                    <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)", flex: 1 }}>
                      {policy.value}
                    </span>
                    {policy.label && (
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{policy.label}</span>
                    )}
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{timeAgo(policy.created_at)}</span>
                    <button
                      onClick={() => deletePolicy(policy.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: "18px", lineHeight: 1, padding: "0 4px" }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Active alerts */}
            {data.recentAlerts.filter(a => a.status !== "resolved").length > 0 && (
              <div style={{ marginTop: "32px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px", color: "#ef4444" }}>
                  Active Alerts
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {data.recentAlerts.filter(a => a.status !== "resolved").map(alert => (
                    <div
                      key={alert.id}
                      style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "12px 16px" }}
                    >
                      <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", whiteSpace: "nowrap" }}>
                        {alert.triggerType}
                      </span>
                      <span style={{ fontSize: "13px", color: "var(--text-primary)", flex: 1 }}>{alert.description}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{timeAgo(alert.timestamp)}</span>
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        style={{ background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", cursor: "pointer", color: "#ef4444", fontSize: "11px", padding: "3px 8px" }}
                      >
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Recovery Tab ─────────────────────────────────────────────────── */}
        {tab === "recovery" && (
          <div>
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>Verifiable Operational History</h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Every action is permanently written to Hedera HCS. After a crash or restart, your agent reads this topic to recover context — knowing what it tried, what was blocked, and which jobs are still open.
              </p>
            </div>

            {memoryLoading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px" }}>
                Reading Hedera HCS...
              </div>
            ) : !memory ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                {agent.hcs_topic_id ? "No HCS messages yet. Start your agent to build history." : "No HCS topic assigned to this agent."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                  {[
                    { label: "HCS Messages", value: memory.messageCount, color: "var(--accent)" },
                    { label: "Blocked Actions", value: memory.blocked_actions.length, color: "#ef4444" },
                    { label: "Open Jobs", value: memory.open_jobs.length, color: "#f59e0b" },
                    { label: "Completions", value: memory.recent_completions.length, color: "#10b981" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                      <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "monospace", color, marginBottom: "4px" }}>{value}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* LLM context summary */}
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
                    Recovery Context (sent to agent on restart)
                  </div>
                  <pre style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}>
                    {memory.summary || "No summary available."}
                  </pre>
                </div>

                {/* Blocked actions */}
                {memory.blocked_actions.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "20px" }}>
                    <div style={{ fontSize: "12px", color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
                      Blocked Actions — Permanently on HCS
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {memory.blocked_actions.map((ba, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", fontSize: "13px" }}>
                          <a
                            href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${ba.seq}` : "#"}
                            target="_blank" rel="noopener"
                            style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)", whiteSpace: "nowrap", paddingTop: "1px" }}
                          >
                            #{ba.seq}
                          </a>
                          <div>
                            <span style={{ color: "#ef4444" }}>{ba.action}</span>
                            <span style={{ color: "var(--text-tertiary)", marginLeft: "8px" }}>— {ba.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Open jobs */}
                {memory.open_jobs.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
                      Open Jobs
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {memory.open_jobs.map((job, i) => {
                        const sc = JOB_STATUS_COLORS[job.status] || "#6b7280";
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}>
                            <span style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "4px", background: `${sc}18`, border: `1px solid ${sc}40`, color: sc }}>{job.status}</span>
                            <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{job.jobId}</span>
                            {job.amount !== undefined && <span style={{ color: "#f59e0b" }}>{job.amount} ℏ</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* skill.md integration snippet */}
                <div style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
                    Add recovery to your agent (Step 0 in skill.md)
                  </div>
                  <pre style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", overflowX: "auto", margin: 0, whiteSpace: "pre-wrap" }}>
{`// On startup — before any action
const r = await fetch("https://veridex.sbs/v2/agent/${decodedId}/memory");
const memory = await r.json();
// memory.summary contains plain-English context for your LLM
// memory.blocked_actions tells the agent what not to try again`}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
