"use client";

import Link from "next/link";
import { Logo } from "../../components/Logo";
import { useEffect, useState, useCallback } from "react";
import { use } from "react";
import { ethers } from "ethers";

const IDENTITY_ABI = [
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

interface ChainRep {
  reputationScore: number;
  clientScore: number;
  jobsCompleted: number;
  totalEarned: string;
  verifiedMachineAgent: boolean;
  active: boolean;
}

interface Log {
  id: string;
  agentId: string;
  action: string;
  tool: string;
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
  hashScanUrl?: string;
}

const RISK_COLOR: Record<string, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#ef4444", blocked: "#dc2626",
};
const RISK_BG: Record<string, string> = {
  low: "rgba(16,185,129,0.1)", medium: "rgba(245,158,11,0.1)",
  high: "rgba(239,68,68,0.1)", blocked: "rgba(220,38,38,0.15)",
};

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
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

const POLICY_TYPES = [
  { value: "blacklist_domain",  label: "Block Domain",   placeholder: "evil.com" },
  { value: "blacklist_command", label: "Block Command",  placeholder: "rm -rf" },
  { value: "block_file_path",   label: "Block File Path", placeholder: "/etc/" },
];

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const [tab,      setTab]      = useState<"activity" | "earnings" | "policies" | "alerts">("activity");
  const [stats,    setStats]    = useState<AgentStats | null>(null);
  const [logs,     setLogs]     = useState<Log[]>([]);
  const [alerts,   setAlerts]   = useState<Alert[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [chainRep, setChainRep] = useState<ChainRep | null>(null);

  // New policy form
  const [newPolicy, setNewPolicy] = useState({ type: "blacklist_domain", value: "", label: "" });
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, logsRes, alertsRes, policiesRes] = await Promise.all([
        fetch(`/api/proxy/api/monitor/agent/${agentId}/stats`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/feed?limit=50`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/alerts`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/policies`),
      ]);
      if (statsRes.ok)    setStats(await statsRes.json());
      if (logsRes.ok)     { const d = await logsRes.json(); setLogs(d.logs || []); }
      if (alertsRes.ok)   { const d = await alertsRes.json(); setAlerts(d.alerts || []); }
      if (policiesRes.ok) { const d = await policiesRes.json(); setPolicies(d.policies || []); }
    } catch {}
    setLoading(false);
  }, [agentId]);

  // Read ERC-8004 reputation from Hedera contract using agent's on-chain wallet address
  const fetchChainRep = useCallback(async () => {
    try {
      // The agent's ownerWallet is their on-chain address on Hedera
      const statsRes = await fetch(`/api/proxy/api/monitor/agent/${agentId}/stats`);
      if (!statsRes.ok) return;
      const data = await statsRes.json();
      const walletAddress = data.agent?.owner_wallet;
      if (!walletAddress || !ethers.isAddress(walletAddress)) return;

      const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
      const identity = new ethers.Contract(
        "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250",
        IDENTITY_ABI,
        provider
      );
      const a = await identity.getAgent(walletAddress);
      setChainRep({
        reputationScore:   Number(a.reputationScore),
        clientScore:       Number(a.clientScore),
        jobsCompleted:     Number(a.jobsCompleted),
        totalEarned:       ethers.formatUnits(a.totalEarned, 8),
        verifiedMachineAgent: a.verifiedMachineAgent,
        active:            a.active,
      });
    } catch {}
  }, [agentId]);

  useEffect(() => {
    fetchAll();
    fetchChainRep();
    const iv1 = setInterval(fetchAll, 5000);
    const iv2 = setInterval(fetchChainRep, 30000); // chain reads less frequently
    return () => { clearInterval(iv1); clearInterval(iv2); };
  }, [fetchAll, fetchChainRep]);

  async function addPolicy() {
    if (!newPolicy.value.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${agentId}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPolicy),
      });
      setNewPolicy(p => ({ ...p, value: "", label: "" }));
      await fetchAll();
    } catch {}
    setSaving(false);
  }

  async function deletePolicy(policyId: string) {
    try {
      await fetch(`/api/proxy/api/monitor/agent/${agentId}/policy/${policyId}`, { method: "DELETE" });
      await fetchAll();
    } catch {}
  }

  async function resolveAlert(alertId: string) {
    try {
      await fetch(`/api/proxy/api/monitor/alert/${alertId}/resolve`, { method: "POST" });
      await fetchAll();
    } catch {}
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <span style={{ color: "var(--text-tertiary)", fontSize: "14px" }}>Loading...</span>
      </div>
    );
  }

  const agent = stats?.agent;
  const s = stats?.stats;

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono"><Logo size={20} /></Link>
          <nav className="nav">
            <Link href="/monitor">← Monitor</Link>
            <Link href="/dashboard">Agents</Link>
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Agent Header */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "20px" }}>
            <div>
              <h1 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "6px" }}>
                {agent?.name || agentId}
              </h1>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace", marginBottom: "8px" }}>
                {agentId}
              </div>
              {agent?.hcs_topic_id && (
                <a
                  href={stats?.hashScanUrl}
                  target="_blank"
                  rel="noopener"
                  style={{ fontSize: "12px", color: "#10b981", fontFamily: "monospace" }}
                >
                  HCS: {agent.hcs_topic_id} ↗
                </a>
              )}
              {chainRep && (
                <div style={{ marginTop: "12px", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{
                      fontSize: "11px", fontWeight: "700", padding: "2px 8px",
                      borderRadius: "4px", background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.3)", color: "#10b981",
                    }}>
                      ERC-8004
                    </span>
                    <span style={{ fontSize: "20px", fontWeight: "700", fontFamily: "monospace",
                      color: chainRep.reputationScore >= 700 ? "#10b981" : chainRep.reputationScore >= 400 ? "#f59e0b" : "#ef4444"
                    }}>
                      {chainRep.reputationScore}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>/ 1000</span>
                  </div>
                  {chainRep.verifiedMachineAgent && (
                    <span style={{ fontSize: "11px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", padding: "2px 8px", borderRadius: "10px" }}>
                      ✓ verifiedMachineAgent
                    </span>
                  )}
                  <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                    {chainRep.jobsCompleted} jobs · {chainRep.totalEarned} ℏ earned on-chain
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              {s && [
                { label: "Total Actions",  value: s.totalActions,    color: "var(--text-primary)" },
                { label: "Blocked",        value: s.blockedActions,  color: "#ef4444" },
                { label: "Active Alerts",  value: stats?.recentAlerts.filter(a => a.status === "active").length || 0, color: "#f59e0b" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 20px", textAlign: "center", minWidth: "90px" }}>
                  <div style={{ fontSize: "24px", fontWeight: "700", color, fontFamily: "monospace" }}>{value}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0", borderBottom: "1px solid var(--border)", marginBottom: "24px" }}>
          {(["activity", "earnings", "policies", "alerts"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "10px 20px", border: "none", background: "transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: "14px", fontWeight: tab === t ? "600" : "400",
                cursor: "pointer", borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
                marginBottom: "-1px", transition: "all 0.15s", textTransform: "capitalize",
              }}
            >
              {t}
              {t === "alerts" && alerts.filter(a => a.status === "active").length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", padding: "2px 6px", borderRadius: "10px" }}>
                  {alerts.filter(a => a.status === "active").length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab: Activity */}
        {tab === "activity" && (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                {logs.length} actions · updates every 5s
              </span>
            </div>
            {logs.length === 0 ? (
              <div style={{ padding: "60px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                No actions logged yet for this agent.
              </div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={log.id || i}
                  style={{
                    padding: "12px 20px",
                    borderBottom: i < logs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    display: "flex", alignItems: "flex-start", gap: "12px",
                    background: log.riskLevel === "blocked" ? "rgba(220,38,38,0.04)" : "transparent",
                  }}
                >
                  <div style={{ paddingTop: "2px" }}><RiskBadge level={log.riskLevel} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: "500", color: log.riskLevel === "blocked" ? "#fca5a5" : "var(--text-primary)", marginBottom: "3px" }}>
                      {log.description || `${log.action}: ${log.tool}`}
                    </div>
                    {log.blockReason && (
                      <div style={{ fontSize: "11px", color: "#ef4444", marginBottom: "3px" }}>{log.blockReason}</div>
                    )}
                    <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                      <span>{timeAgo(log.timestamp)}</span>
                      {log.phase && <span>{log.phase}</span>}
                      {log.hcsSequenceNumber && <span style={{ color: "#10b981" }}>HCS #{log.hcsSequenceNumber}</span>}
                    </div>
                  </div>
                  {agent?.hcs_topic_id && log.hcsSequenceNumber && (
                    <a
                      href={`https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`}
                      target="_blank" rel="noopener"
                      style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "monospace", flexShrink: 0 }}
                    >
                      ↗ HCS
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Earnings */}
        {tab === "earnings" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                <div style={{ fontSize: "24px", fontWeight: "700", color: "#f59e0b", fontFamily: "monospace", marginBottom: "4px" }}>
                  {(s?.totalEarned || 0).toFixed(4)} ℏ
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Total Earned</div>
              </div>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                <div style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", fontFamily: "monospace", marginBottom: "4px" }}>
                  {stats?.earnings?.length || 0}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Earnings Events</div>
              </div>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                <div style={{ fontSize: "24px", fontWeight: "700", color: "#10b981", fontFamily: "monospace", marginBottom: "4px" }}>
                  {stats?.earnings?.[0] ? timeAgo(stats.earnings[0].timestamp) : "—"}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Last Payout</div>
              </div>
            </div>

            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>Earnings History</span>
              </div>
              {!stats?.earnings?.length ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                  No earnings recorded yet.
                </div>
              ) : (
                stats.earnings.map((e, i) => (
                  <div key={e.id} style={{ padding: "14px 20px", borderBottom: i < stats.earnings.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#f59e0b", fontFamily: "monospace" }}>
                          +{e.amount_hbar?.toFixed(4)} ℏ
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                          {e.source || "agent_earnings"} · {timeAgo(e.timestamp)}
                        </div>
                        {e.split_dev && (
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "6px", fontFamily: "monospace" }}>
                            Dev: {e.split_dev?.toFixed(4)}ℏ · Ops: {e.split_ops?.toFixed(4)}ℏ · Reinvest: {e.split_reinvest?.toFixed(4)}ℏ
                          </div>
                        )}
                      </div>
                      {e.hcs_paystub_sequence && agent?.hcs_topic_id && (
                        <a
                          href={`https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`}
                          target="_blank" rel="noopener"
                          style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}
                        >
                          Pay stub ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab: Policies */}
        {tab === "policies" && (
          <div>
            {/* Add new policy */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "16px" }}>Add Blocking Rule</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "12px", alignItems: "end" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</label>
                  <select
                    value={newPolicy.type}
                    onChange={e => setNewPolicy(p => ({ ...p, type: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }}
                  >
                    {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Value</label>
                  <input
                    value={newPolicy.value}
                    onChange={e => setNewPolicy(p => ({ ...p, value: e.target.value }))}
                    placeholder={POLICY_TYPES.find(t => t.value === newPolicy.type)?.placeholder}
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Label (optional)</label>
                  <input
                    value={newPolicy.label}
                    onChange={e => setNewPolicy(p => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Block sketchy API"
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }}
                  />
                </div>
                <button
                  onClick={addPolicy}
                  disabled={saving || !newPolicy.value.trim()}
                  className="btn btn-primary"
                  style={{ height: "36px", padding: "0 20px" }}
                >
                  {saving ? "..." : "Add Rule"}
                </button>
              </div>
            </div>

            {/* Policy list */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                  {policies.length} active {policies.length === 1 ? "rule" : "rules"}
                </span>
              </div>
              {policies.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                  No custom blocking rules. Default rules (rm -rf, /etc/passwd, etc.) are always active.
                </div>
              ) : (
                policies.map((p, i) => (
                  <div key={p.id} style={{
                    padding: "14px 20px",
                    borderBottom: i < policies.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ fontSize: "13px", fontFamily: "monospace", color: "#ef4444", marginBottom: "4px" }}>
                        ⛔ {p.value}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                        {POLICY_TYPES.find(t => t.value === p.type)?.label || p.type}
                        {p.label && ` · ${p.label}`}
                      </div>
                    </div>
                    <button
                      onClick={() => deletePolicy(p.id)}
                      style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 10px", color: "var(--text-tertiary)", fontSize: "12px", cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab: Alerts */}
        {tab === "alerts" && (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                {alerts.filter(a => a.status === "active").length} active · {alerts.length} total
              </span>
            </div>
            {alerts.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                No alerts. All clear.
              </div>
            ) : (
              alerts.map((alert, i) => (
                <div key={alert.id} style={{
                  padding: "14px 20px",
                  borderBottom: i < alerts.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px",
                  opacity: alert.status === "resolved" ? 0.5 : 1,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span style={{
                        fontSize: "10px", fontWeight: "700", padding: "2px 7px", borderRadius: "4px",
                        background: alert.triggerType === "blocked" ? "rgba(220,38,38,0.15)" : "rgba(245,158,11,0.1)",
                        color: alert.triggerType === "blocked" ? "#dc2626" : "#f59e0b",
                        fontFamily: "monospace", textTransform: "uppercase",
                      }}>
                        {alert.triggerType}
                      </span>
                      {alert.status === "resolved" && (
                        <span style={{ fontSize: "10px", color: "#10b981", fontFamily: "monospace" }}>resolved</span>
                      )}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: "4px" }}>
                      {alert.description}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                      {timeAgo(alert.timestamp)}
                    </div>
                  </div>
                  {alert.status === "active" && (
                    <button
                      onClick={() => resolveAlert(alert.id)}
                      style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 10px", color: "var(--text-tertiary)", fontSize: "12px", cursor: "pointer", flexShrink: 0 }}
                    >
                      Resolve
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
