"use client";

import Link from "next/link";
import { Logo } from "../components/Logo";
import { useEffect, useState, useCallback } from "react";

interface Log {
  id: string;
  agentId: string;
  agentName?: string;
  action: string;
  tool: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "blocked";
  blockReason?: string;
  phase?: string;
  hcsSequenceNumber?: string;
  timestamp: number;
}

interface MonitorAgent {
  id: string;
  name?: string;
  hcs_topic_id?: string;
  stats: {
    totalActions: number;
    actionsToday: number;
    blockedActions: number;
    highRiskActions: number;
    totalEarned: number;
  };
  activeAlerts: number;
  hashScanUrl?: string;
}

const RISK_COLOR: Record<string, string> = {
  low:     "#10b981",
  medium:  "#f59e0b",
  high:    "#ef4444",
  blocked: "#dc2626",
};

const RISK_BG: Record<string, string> = {
  low:     "rgba(16,185,129,0.1)",
  medium:  "rgba(245,158,11,0.1)",
  high:    "rgba(239,68,68,0.1)",
  blocked: "rgba(220,38,38,0.15)",
};

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLOR[level] || "#71717a";
  const bg    = RISK_BG[level]    || "transparent";
  return (
    <span style={{
      fontSize: "10px", fontWeight: "700", padding: "2px 7px",
      borderRadius: "4px", fontFamily: "monospace",
      background: bg, color, border: `1px solid ${color}44`,
      textTransform: "uppercase", flexShrink: 0,
    }}>
      {level}
    </span>
  );
}

export default function MonitorPage() {
  const [logs, setLogs]         = useState<Log[]>([]);
  const [agents, setAgents]     = useState<MonitorAgent[]>([]);
  const [overview, setOverview] = useState({ totalAgents: 0, logsToday: 0, blockedToday: 0, activeAlerts: 0 });
  const [filter, setFilter]     = useState<{ agentId: string; riskLevel: string }>({ agentId: "", riskLevel: "" });
  const [loading, setLoading]   = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [overviewRes, logsRes, agentsRes] = await Promise.all([
        fetch("/api/proxy/api/monitor/overview"),
        fetch("/api/proxy/feed/live"),
        fetch("/api/proxy/api/monitor/agents"),
      ]);
      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (logsRes.ok) {
        const d = await logsRes.json();
        if (d.logs) setLogs(d.logs);
      }
      if (agentsRes.ok) {
        const d = await agentsRes.json();
        if (d.agents) setAgents(d.agents);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 3000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const filteredLogs = logs.filter(l => {
    if (filter.agentId && l.agentId !== filter.agentId) return false;
    if (filter.riskLevel && l.riskLevel !== filter.riskLevel) return false;
    return true;
  });

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            <Logo size={20} />
          </Link>
          <nav className="nav">
            <Link href="/monitor" style={{ color: "var(--text-primary)" }}>Monitor</Link>
            <Link href="/dashboard">Agents</Link>
            <Link href="/live">Marketplace</Link>
            <a href="/skill.md" target="_blank" rel="noopener">skill.md</a>
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
            <h1 style={{ fontSize: "24px", fontWeight: "700" }}>Veridex Monitor</h1>
          </div>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
            Real-time agent action log · All actions written to Hedera HCS · Dangerous actions blocked before execution
          </p>
        </div>

        {/* Overview Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
          {[
            { label: "Agents Monitored",    value: overview.totalAgents,  color: "#10b981" },
            { label: "Actions Today",       value: overview.logsToday,    color: "var(--text-primary)" },
            { label: "Blocked Today",       value: overview.blockedToday, color: "#ef4444" },
            { label: "Active Alerts",       value: overview.activeAlerts, color: "#f59e0b" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "28px", fontWeight: "700", color, fontFamily: "monospace", marginBottom: "4px" }}>{value}</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px" }}>

          {/* Left: Agent List */}
          <div>
            <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-tertiary)", marginBottom: "12px" }}>
              Monitored Agents
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => setFilter(f => ({ ...f, agentId: "" }))}
                style={{
                  padding: "10px 14px", borderRadius: "6px", border: "1px solid",
                  borderColor: !filter.agentId ? "var(--accent)" : "var(--border)",
                  background: !filter.agentId ? "var(--accent-dim)" : "transparent",
                  color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <span>All agents</span>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                  {logs.length}
                </span>
              </button>

              {agents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => setFilter(f => ({ ...f, agentId: agent.id }))}
                  style={{
                    padding: "10px 14px", borderRadius: "6px", border: "1px solid",
                    borderColor: filter.agentId === agent.id ? "var(--accent)" : "var(--border)",
                    background: filter.agentId === agent.id ? "var(--accent-dim)" : "var(--bg-secondary)",
                    color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontWeight: "500" }}>{agent.name || agent.id.slice(0, 12)}</span>
                    {agent.activeAlerts > 0 && (
                      <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", padding: "2px 6px", borderRadius: "10px" }}>
                        {agent.activeAlerts} alert{agent.activeAlerts > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-tertiary)" }}>
                    <span>{agent.stats?.actionsToday || 0} today</span>
                    {agent.stats?.blockedActions > 0 && (
                      <span style={{ color: "#ef4444" }}>{agent.stats.blockedActions} blocked</span>
                    )}
                  </div>
                  {agent.hcs_topic_id && (
                    <div style={{ marginTop: "6px" }}>
                      <Link
                        href={`/monitor/${agent.id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: "11px", color: "#10b981" }}
                      >
                        View detail →
                      </Link>
                    </div>
                  )}
                </button>
              ))}

              {agents.length === 0 && !loading && (
                <div style={{ padding: "20px 14px", fontSize: "12px", color: "var(--text-tertiary)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  No agents registered yet. Start demo bots or install the skill.
                </div>
              )}
            </div>

            {/* Risk filter */}
            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-tertiary)", marginBottom: "12px" }}>
                Filter by Risk
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {["", "low", "medium", "high", "blocked"].map(level => (
                  <button
                    key={level}
                    onClick={() => setFilter(f => ({ ...f, riskLevel: level }))}
                    style={{
                      padding: "8px 14px", borderRadius: "6px", border: "1px solid",
                      borderColor: filter.riskLevel === level ? (RISK_COLOR[level] || "var(--accent)") : "var(--border)",
                      background: filter.riskLevel === level ? (RISK_BG[level] || "var(--accent-dim)") : "transparent",
                      color: level ? (RISK_COLOR[level] || "var(--text-primary)") : "var(--text-primary)",
                      fontSize: "12px", cursor: "pointer", textAlign: "left", fontFamily: "monospace",
                    }}
                  >
                    {level || "All risk levels"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Log Feed */}
          <div>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                  {filteredLogs.length} entries · updates every 3s
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
                  <span style={{ fontSize: "11px", color: "#10b981" }}>live</span>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: "60px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                  Loading...
                </div>
              ) : filteredLogs.length === 0 ? (
                <div style={{ padding: "60px", textAlign: "center" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "16px" }}>
                    No actions logged yet.
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                    Start demo bots: <code style={{ color: "#10b981" }}>node bots/research-bot.js</code>
                  </div>
                </div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div
                    key={log.id || i}
                    style={{
                      padding: "12px 20px",
                      borderBottom: i < filteredLogs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      background: log.riskLevel === "blocked" ? "rgba(220,38,38,0.04)" : "transparent",
                      transition: "background 0.2s",
                    }}
                  >
                    {/* Risk badge */}
                    <div style={{ flexShrink: 0, paddingTop: "2px" }}>
                      <RiskBadge level={log.riskLevel} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "500", color: log.riskLevel === "blocked" ? "#fca5a5" : "var(--text-primary)", marginBottom: "3px" }}>
                        {log.description || `${log.action}: ${log.tool}`}
                      </div>
                      {log.blockReason && (
                        <div style={{ fontSize: "11px", color: "#ef4444", marginBottom: "3px" }}>
                          {log.blockReason}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                        <span>{log.agentName || log.agentId?.slice(0, 16)}</span>
                        <span>{timeAgo(log.timestamp)}</span>
                        {log.phase && <span>{log.phase}</span>}
                        {log.hcsSequenceNumber && (
                          <span style={{ color: "#10b981" }}>HCS #{log.hcsSequenceNumber}</span>
                        )}
                      </div>
                    </div>

                    {/* HashScan link */}
                    {log.hcsSequenceNumber && (
                      <div style={{ flexShrink: 0 }}>
                        <a
                          href={`https://hashscan.io/testnet/topic/${
                            agents.find(a => a.id === log.agentId)?.hcs_topic_id || ""
                          }`}
                          target="_blank"
                          rel="noopener"
                          style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "monospace" }}
                        >
                          ↗ HCS
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
