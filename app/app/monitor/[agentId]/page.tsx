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

interface VaultSecret {
  secretId: string;
  secretType: string;
  label: string;
  ownerAgentId: string;
  createdAt: number;
}

interface VaultGrant {
  id: string;
  agent_id: string;
  secret_type: string;
  endpoint: string;
  granted: number;
  expires_at: number;
  timestamp: number;
}

interface AgentMemory {
  agentId: string;
  hcsTopicId?: string;
  hashScanUrl?: string;
  open_jobs: { job_id: string; status: string; budget?: string }[];
  blocked_actions: { tool: string; blockReason?: string; timestamp: number; sequenceNumber?: number; hashScanUrl?: string }[];
  recent_completions: { jobId: string; amountHbar: number; timestamp: number; sequenceNumber?: number }[];
  pending_earnings: number;
  lifetime_stats: { totalActions: number; blockedActions: number; totalEarned: number };
  active_alerts: Alert[];
  hcs_message_count: number;
  summary: string;
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
  { value: "blacklist_domain",  label: "Block Domain",        placeholder: "evil.com" },
  { value: "blacklist_command", label: "Block Command",        placeholder: "rm -rf" },
  { value: "block_file_path",   label: "Block File Path",      placeholder: "/etc/" },
  { value: "cap_hbar",          label: "Cap HBAR per tx",      placeholder: "5" },
  { value: "regex_output",      label: "Block Output Pattern", placeholder: "api_key|secret" },
];

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const [tab,      setTab]      = useState<"activity" | "earnings" | "policies" | "alerts" | "memory" | "vault">("activity");
  const [stats,    setStats]    = useState<AgentStats | null>(null);
  const [logs,     setLogs]     = useState<Log[]>([]);
  const [alerts,   setAlerts]   = useState<Alert[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [chainRep, setChainRep] = useState<ChainRep | null>(null);
  const [memory,   setMemory]   = useState<AgentMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [vaultSecrets, setVaultSecrets] = useState<VaultSecret[]>([]);
  const [vaultGrants,  setVaultGrants]  = useState<VaultGrant[]>([]);
  const [newSecret, setNewSecret] = useState({ secretType: "openai_key", label: "", value: "" });
  const [secretSaving, setSecretSaving] = useState(false);
  const [tokenResult, setTokenResult] = useState<{ token?: string; granted?: boolean; reason?: string; expiresAt?: number } | null>(null);

  // New policy form
  const [newPolicy, setNewPolicy] = useState({ type: "blacklist_domain", value: "", label: "" });
  const [saving, setSaving] = useState(false);

  // Earnings split config
  const [splitConfig, setSplitConfig] = useState({ splitDev: 60, splitOps: 30, splitReinvest: 10 });
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitSaved, setSplitSaved] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, logsRes, alertsRes, policiesRes, splitRes] = await Promise.all([
        fetch(`/api/proxy/api/monitor/agent/${agentId}/stats`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/feed?limit=50`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/alerts`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/policies`),
        fetch(`/api/proxy/api/monitor/agent/${agentId}/split-config`),
      ]);
      if (statsRes.ok)    setStats(await statsRes.json());
      if (logsRes.ok)     { const d = await logsRes.json(); setLogs(d.logs || []); }
      if (alertsRes.ok)   { const d = await alertsRes.json(); setAlerts(d.alerts || []); }
      if (policiesRes.ok) { const d = await policiesRes.json(); setPolicies(d.policies || []); }
      if (splitRes.ok)    { const d = await splitRes.json(); setSplitConfig(d); }
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

  const fetchVault = useCallback(async () => {
    try {
      const r = await fetch(`/api/proxy/v2/vault/list/${agentId}`);
      if (r.ok) { const d = await r.json(); setVaultSecrets(d.secrets || []); setVaultGrants(d.recentGrants || []); }
    } catch {}
  }, [agentId]);

  const fetchMemory = useCallback(async () => {
    setMemoryLoading(true);
    try {
      const r = await fetch(`/api/proxy/v2/agent/${agentId}/memory`);
      if (r.ok) setMemory(await r.json());
    } catch {}
    setMemoryLoading(false);
  }, [agentId]);

  useEffect(() => {
    fetchAll();
    fetchChainRep();
    const iv1 = setInterval(fetchAll, 5000);
    const iv2 = setInterval(fetchChainRep, 30000);
    return () => { clearInterval(iv1); clearInterval(iv2); };
  }, [fetchAll, fetchChainRep]);

  // Lazy-load memory + vault when those tabs are opened
  useEffect(() => {
    if (tab === "memory") fetchMemory();
    if (tab === "vault")  fetchVault();
  }, [tab, fetchMemory, fetchVault]);

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

  async function saveSplitConfig() {
    const total = splitConfig.splitDev + splitConfig.splitOps + splitConfig.splitReinvest;
    if (Math.round(total) !== 100) return;
    setSplitSaving(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${agentId}/split-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(splitConfig),
      });
      setSplitSaved(true);
      setTimeout(() => setSplitSaved(false), 2000);
    } catch {}
    setSplitSaving(false);
  }

  async function storeSecret() {
    if (!newSecret.value.trim() || !newSecret.secretType) return;
    setSecretSaving(true);
    try {
      await fetch(`/api/proxy/v2/vault/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, secretType: newSecret.secretType, label: newSecret.label || newSecret.secretType, value: newSecret.value }),
      });
      setNewSecret(s => ({ ...s, value: "", label: "" }));
      await fetchVault();
    } catch {}
    setSecretSaving(false);
  }

  async function deleteSecret(secretId: string) {
    try {
      await fetch(`/api/proxy/v2/vault/secret/${secretId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      await fetchVault();
    } catch {}
  }

  async function requestToken(secretType: string) {
    try {
      const r = await fetch(`/api/proxy/v2/vault/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, secretType }),
      });
      setTokenResult(await r.json());
      setTimeout(() => setTokenResult(null), 65000); // clear after 65s (token expired)
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
          {(["activity", "earnings", "policies", "alerts", "memory", "vault"] as const).map(t => (
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
            {/* Split config settings */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "4px" }}>Earnings Split</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "16px" }}>
                How HBAR earnings are automatically distributed via HTS. Must add to 100%.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "12px", alignItems: "end" }}>
                {([
                  { key: "splitDev",      label: "Developer (%)" },
                  { key: "splitOps",      label: "Operations (%)" },
                  { key: "splitReinvest", label: "Reinvest (%)" },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {label}
                    </label>
                    <input
                      type="number" min="0" max="100"
                      value={splitConfig[key]}
                      onChange={e => setSplitConfig(c => ({ ...c, [key]: parseFloat(e.target.value) || 0 }))}
                      style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }}
                    />
                  </div>
                ))}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ fontSize: "11px", color: Math.round(splitConfig.splitDev + splitConfig.splitOps + splitConfig.splitReinvest) === 100 ? "#10b981" : "#ef4444", fontFamily: "monospace", textAlign: "center" }}>
                    {Math.round(splitConfig.splitDev + splitConfig.splitOps + splitConfig.splitReinvest)}% total
                  </div>
                  <button
                    onClick={saveSplitConfig}
                    disabled={splitSaving || Math.round(splitConfig.splitDev + splitConfig.splitOps + splitConfig.splitReinvest) !== 100}
                    className="btn btn-primary"
                    style={{ height: "36px", padding: "0 20px" }}
                  >
                    {splitSaved ? "Saved!" : splitSaving ? "..." : "Save"}
                  </button>
                </div>
              </div>
            </div>

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
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>Earnings History — HTS transfers with on-chain pay stubs</span>
              </div>
              {!stats?.earnings?.length ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                  No earnings recorded yet. Start the trading bot to generate real HTS splits.
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
        {/* Tab: Memory */}
        {tab === "memory" && (
          <div>
            <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#10b981", marginBottom: "4px" }}>Verifiable Operational History</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                This data comes directly from Hedera HCS — it is cryptographically immutable. Even if this server is compromised, the history cannot be altered.
                Every entry is verifiable on HashScan independently.
              </div>
              {agent?.hcs_topic_id && (
                <a href={`https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`} target="_blank" rel="noopener"
                  style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace", marginTop: "8px", display: "inline-block" }}>
                  Verify on HashScan ↗
                </a>
              )}
            </div>

            {memoryLoading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>Reading from Hedera Mirror Node...</div>
            ) : !memory ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>No memory data. Agent must have an HCS topic.</div>
            ) : (
              <>
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
                  {[
                    { label: "HCS Messages", value: memory.hcs_message_count, color: "#10b981" },
                    { label: "Open Jobs",     value: memory.open_jobs.length,   color: "#f59e0b" },
                    { label: "Blocked (7d)",  value: memory.blocked_actions.length, color: "#ef4444" },
                    { label: "Pending HBAR",  value: `${memory.pending_earnings.toFixed(4)} ℏ`, color: "#f59e0b" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px", textAlign: "center" }}>
                      <div style={{ fontSize: "22px", fontWeight: "700", fontFamily: "monospace", color }}>{value}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* LLM Context panel */}
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "20px", overflow: "hidden" }}>
                  <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>Startup context injected into agent LLM</span>
                    <span style={{ fontSize: "10px", color: "#10b981", fontFamily: "monospace" }}>GET /v2/agent/{agentId}/memory → .summary</span>
                  </div>
                  <pre style={{ margin: 0, padding: "16px 20px", fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", lineHeight: "1.6" }}>
                    {memory.summary}
                  </pre>
                </div>

                {/* Blocked actions */}
                {memory.blocked_actions.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "16px", overflow: "hidden" }}>
                    <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "12px", color: "#ef4444", fontFamily: "monospace" }}>Blocked actions on HCS (agent will not retry)</span>
                    </div>
                    {memory.blocked_actions.map((b, i) => (
                      <div key={i} style={{ padding: "12px 20px", borderBottom: i < memory.blocked_actions.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", gap: "12px", alignItems: "center" }}>
                        <span style={{ fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", background: "rgba(220,38,38,0.15)", color: "#dc2626", fontFamily: "monospace" }}>BLOCKED</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "13px", color: "#fca5a5", fontFamily: "monospace" }}>{b.tool}</div>
                          {b.blockReason && <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>{b.blockReason}</div>}
                        </div>
                        {b.hashScanUrl && b.sequenceNumber && (
                          <a href={b.hashScanUrl} target="_blank" rel="noopener" style={{ fontSize: "10px", color: "#10b981", fontFamily: "monospace" }}>HCS #{b.sequenceNumber} ↗</a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Open jobs */}
                {memory.open_jobs.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                    <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "12px", color: "#f59e0b", fontFamily: "monospace" }}>Open jobs — agent was reminded at startup</span>
                    </div>
                    {memory.open_jobs.map((j, i) => (
                      <div key={i} style={{ padding: "12px 20px", borderBottom: i < memory.open_jobs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", gap: "12px", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontFamily: "monospace" }}>
                          {j.status}
                        </span>
                        <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)" }}>Job #{j.job_id}</span>
                        {j.budget && <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{j.budget} ℏ</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab: Vault */}
        {tab === "vault" && (
          <div>
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#ef4444", marginBottom: "4px" }}>Secrets Vault</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                Store API keys, wallet keys, and credentials here. Your agent never holds raw secrets — it requests a 60-second scoped token at runtime.
                Every grant and denial is logged to Hedera HCS.
              </div>
            </div>

            {/* Store new secret */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "16px" }}>Store New Secret</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr auto", gap: "12px", alignItems: "end" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</label>
                  <select value={newSecret.secretType} onChange={e => setNewSecret(s => ({ ...s, secretType: e.target.value }))}
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }}>
                    {["openai_key","wallet_key","stripe_key","db_token","api_key","other"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Label</label>
                  <input value={newSecret.label} onChange={e => setNewSecret(s => ({ ...s, label: e.target.value }))} placeholder="e.g. Production OpenAI Key"
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Value (encrypted at rest)</label>
                  <input type="password" value={newSecret.value} onChange={e => setNewSecret(s => ({ ...s, value: e.target.value }))} placeholder="sk-proj-... or 0xdeadbeef..."
                    style={{ width: "100%", padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px" }} />
                </div>
                <button onClick={storeSecret} disabled={secretSaving || !newSecret.value.trim()} className="btn btn-primary" style={{ height: "36px", padding: "0 20px" }}>
                  {secretSaving ? "..." : "Store"}
                </button>
              </div>
            </div>

            {/* Token result */}
            {tokenResult && (
              <div style={{ background: tokenResult.granted ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${tokenResult.granted ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
                {tokenResult.granted ? (
                  <>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#10b981", marginBottom: "8px" }}>Capability token issued — expires in 60s</div>
                    <code style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" }}>{tokenResult.token}</code>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "8px" }}>Single-use. Use as: Authorization: Bearer {"{token}"} — grant logged to HCS</div>
                  </>
                ) : (
                  <div style={{ fontSize: "13px", color: "#ef4444" }}>Denied: {tokenResult.reason}</div>
                )}
              </div>
            )}

            {/* Secrets list */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", marginBottom: "20px" }}>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>{vaultSecrets.length} stored secret{vaultSecrets.length !== 1 ? "s" : ""}</span>
              </div>
              {vaultSecrets.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>No secrets stored. Add credentials above — your agent will request them via scoped tokens.</div>
              ) : (
                vaultSecrets.map((s, i) => (
                  <div key={s.secretId} style={{ padding: "14px 20px", borderBottom: i < vaultSecrets.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", padding: "2px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontFamily: "monospace" }}>{s.secretType}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>{s.label}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>••••••••••••  ·  stored {timeAgo(s.createdAt)}</div>
                    </div>
                    <button onClick={() => requestToken(s.secretType)} style={{ background: "none", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "4px", padding: "4px 10px", color: "#10b981", fontSize: "12px", cursor: "pointer", marginRight: "8px" }}>
                      Get Token
                    </button>
                    <button onClick={() => deleteSecret(s.secretId)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 10px", color: "var(--text-tertiary)", fontSize: "12px", cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Grant history */}
            {vaultGrants.length > 0 && (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>Recent capability grants (logged to HCS)</span>
                </div>
                {vaultGrants.map((g, i) => (
                  <div key={g.id} style={{ padding: "10px 20px", borderBottom: i < vaultGrants.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", gap: "10px", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", background: g.granted ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: g.granted ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>
                      {g.granted ? "GRANTED" : "DENIED"}
                    </span>
                    <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)" }}>{g.secret_type}</span>
                    {g.endpoint && g.endpoint !== "*" && <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{g.endpoint}</span>}
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)", marginLeft: "auto" }}>{timeAgo(g.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
