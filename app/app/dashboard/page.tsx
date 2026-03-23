"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Nav } from "../components/Nav";
import { useWallet } from "../lib/wallet";
import { useTour, TourBubble, TourStep } from "../components/Tour";

interface AgentCard {
  id: string;
  name?: string;
  owner_wallet?: string;
  hcs_topic_id?: string;
  created_at: number;
  stats: { totalActions: number; actionsToday: number; blockedActions: number; totalEarned: number };
  activeAlerts: number;
  hashScanUrl?: string;
}

interface Log { id: string; agentId: string; description: string; riskLevel: string; action: string; timestamp: number; }

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function statusDot(agent: AgentCard, recentLogs: Log[]) {
  const myLogs = recentLogs.filter(l => l.agentId === agent.id);
  const lastLog = myLogs[0];
  if (agent.activeAlerts > 0) return { dot: "#ef4444", label: "Alert" };
  if (lastLog && Date.now() - lastLog.timestamp < 5 * 60 * 1000) return { dot: "#10b981", label: "Active" };
  if (lastLog && Date.now() - lastLog.timestamp < 30 * 60 * 1000) return { dot: "#f59e0b", label: "Idle" };
  if (lastLog && Date.now() - lastLog.timestamp < 24 * 60 * 60 * 1000) return { dot: "#f59e0b", label: "Warning", warning: true };
  return { dot: "#555", label: "Offline" };
}

function AgentCardUI({ agent, recentLogs }: { agent: AgentCard; recentLogs: Log[] }) {
  const status = statusDot(agent, recentLogs);
  const myLogs = recentLogs.filter(l => l.agentId === agent.id);
  const lastLog = myLogs[0];

  return (
    <div style={{ background: "var(--bg-secondary)", border: `1px solid ${agent.activeAlerts > 0 ? "rgba(239,68,68,0.4)" : "var(--border)"}`, borderRadius: "10px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {"warning" in status && status.warning && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#f59e0b" }}>
          No recent activity — agent may be offline or skill not installed
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>{agent.name || agent.id}</div>
          <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>
            {agent.id.length > 24 ? agent.id.slice(0, 24) + "..." : agent.id}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: status.dot }} />
          <span style={{ fontSize: "12px", color: status.dot }}>{status.label}</span>
        </div>
      </div>
      <div style={{ fontSize: "13px", color: lastLog?.riskLevel === "blocked" ? "#fca5a5" : "var(--text-secondary)", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 12px", minHeight: "40px" }}>
        {lastLog ? (
          <>
            {lastLog.riskLevel === "blocked" && <span style={{ color: "#c0392b", fontSize: "11px", fontWeight: 600, marginRight: "4px" }}>blocked:</span>}
            {lastLog.description || lastLog.action}
            <span style={{ color: "var(--text-tertiary)", fontSize: "11px", marginLeft: "8px" }}>{timeAgo(lastLog.timestamp)}</span>
          </>
        ) : (
          <span style={{ color: "var(--text-tertiary)" }}>No actions recorded yet</span>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {[
          { label: "actions today", value: agent.stats.actionsToday, color: "var(--text-secondary)" },
          { label: "blocked", value: agent.stats.blockedActions, color: agent.stats.blockedActions > 0 ? "#c0392b" : "var(--text-tertiary)" },
          { label: "alerts", value: agent.activeAlerts, color: agent.activeAlerts > 0 ? "#f59e0b" : "var(--text-tertiary)" },
          { label: "ℏ earned", value: agent.stats.totalEarned.toFixed(2), color: agent.stats.totalEarned > 0 ? "#f59e0b" : "var(--text-tertiary)" },
        ].map(s => (
          <div key={s.label} style={{ fontSize: "12px", padding: "3px 10px", background: "var(--bg-tertiary)", borderRadius: "20px", color: s.color, fontFamily: "monospace" }}>
            <strong>{s.value}</strong> <span style={{ color: "var(--text-tertiary)" }}>{s.label}</span>
          </div>
        ))}
      </div>
      {agent.hcs_topic_id && (
        <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>
          HCS: <a href={agent.hashScanUrl} target="_blank" rel="noopener" style={{ color: "#10b981", textDecoration: "none" }}>{agent.hcs_topic_id} ↗</a>
        </div>
      )}
      <div className="agent-card-btns" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
        <Link href={`/dashboard/${agent.id}`} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", background: "#10b981", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", textDecoration: "none" }}>
          View agent
        </Link>
        <Link href={`/dashboard/${agent.id}?tab=policies`} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-secondary)", textDecoration: "none" }}>
          Policies
        </Link>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "20px" }}>
      {[40, 20, 36, 16].map((h, i) => (
        <div key={i} style={{ height: h, background: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "12px", width: i === 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    targetId: "example-agent-card",
    title: "This is where your agents will be",
    body: "When you register an agent, it shows up here as a card. RogueBot below is a real registered agent — its blocked actions are live on Hedera HCS.",
    position: "bottom",
    nextLabel: "Next →",
  },
  {
    targetId: "view-agent-btn",
    title: "Click in to explore",
    body: "Open an agent to see its real-time activity feed, blocked threats, operator policies, and ERC-7715 delegations.",
    position: "top",
    action: { label: "Open RogueBot →", href: "/dashboard/rogue-bot-demo?tour=1" },
    nextLabel: "Skip",
  },
];

function ExampleAgentWithTour() {
  const { step, next, skip, active } = useTour(DASHBOARD_TOUR_STEPS, true);

  return (
    <>
      {/* Banner */}
      <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px", padding: "10px 14px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
          No agents registered yet — here&apos;s a live example of what monitoring looks like.
        </span>
        <Link href="/dashboard/add" style={{ background: "#10b981", border: "none", borderRadius: "6px", padding: "7px 16px", fontSize: "13px", fontWeight: 600, color: "#000", textDecoration: "none", flexShrink: 0 }}>
          + Register your agent
        </Link>
      </div>

      {/* Example agent card */}
      <div id="example-agent-card" style={{ background: "var(--bg-secondary)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "380px" }}>
        {/* EXAMPLE badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.5px" }}>EXAMPLE</span>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>live demo agent</span>
        </div>

        {/* Name + status */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px", color: "#c0392b" }}>RogueBot</div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>rogue-bot-demo</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
            <span style={{ fontSize: "12px", color: "#ef4444" }}>Alert</span>
          </div>
        </div>

        {/* Last action */}
        <div style={{ fontSize: "13px", color: "#fca5a5", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 12px" }}>
          <span style={{ color: "#c0392b", fontSize: "11px", fontWeight: 600, marginRight: "4px" }}>blocked:</span>
          Attempted to read /etc/passwd
          <span style={{ color: "var(--text-tertiary)", fontSize: "11px", marginLeft: "8px" }}>2m ago</span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[
            { label: "actions today", value: "14", color: "var(--text-secondary)" },
            { label: "blocked", value: "5", color: "#c0392b" },
            { label: "alerts", value: "3", color: "#f59e0b" },
            { label: "ℏ earned", value: "0.00", color: "var(--text-tertiary)" },
          ].map(s => (
            <div key={s.label} style={{ fontSize: "12px", padding: "3px 10px", background: "var(--bg-tertiary)", borderRadius: "20px", color: s.color, fontFamily: "monospace" }}>
              <strong>{s.value}</strong> <span style={{ color: "var(--text-tertiary)" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div className="agent-card-btns" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <Link
            id="view-agent-btn"
            href="/dashboard/rogue-bot-demo?tour=1"
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", background: "#ef4444", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#fff", textDecoration: "none" }}
          >
            View agent →
          </Link>
        </div>
      </div>

      {active && <TourBubble steps={DASHBOARD_TOUR_STEPS} step={step} next={next} skip={skip} />}
    </>
  );
}

export default function DashboardPage() {
  const { address, shortAddress, connect, isConnecting } = useWallet();
  const [agents, setAgents]   = useState<AgentCard[]>([]);
  const [recentLogs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissedAlerts, setDismissed] = useState<Set<string>>(new Set());

  const fetchAgents = useCallback(async (wallet: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/proxy/api/monitor/agents?wallet=${wallet}`);
      const walletAgents: AgentCard[] = r.ok ? (await r.json()).agents || [] : [];

      const claimedIds: string[] = JSON.parse(localStorage.getItem("veridex_claimed_agents") || "[]");
      const extra: AgentCard[] = [];
      for (const id of claimedIds) {
        if (walletAgents.find(a => a.id === id)) continue;
        try {
          const cr = await fetch(`/api/proxy/api/monitor/agent/${id}`);
          if (cr.ok) { const d = await cr.json(); if (d.agent) extra.push(d.agent); }
        } catch {}
      }
      setAgents([...walletAgents, ...extra]);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!address) return;
    fetchAgents(address);
    const iv = setInterval(() => fetchAgents(address), 8000);
    return () => clearInterval(iv);
  }, [address, fetchAgents]);

  useEffect(() => {
    if (agents.length === 0) return;
    async function fetchLogs() {
      const allLogs: Log[] = [];
      for (const a of agents.slice(0, 6)) {
        try {
          const r = await fetch(`/api/proxy/api/monitor/agent/${a.id}/feed?limit=3`);
          if (r.ok) { const d = await r.json(); allLogs.push(...(d.logs || [])); }
        } catch {}
      }
      allLogs.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(allLogs.slice(0, 30));
    }
    fetchLogs();
  }, [agents]);

  const highAlertAgent = agents.find(a => a.activeAlerts > 0 && !dismissedAlerts.has(a.id));

  return (
    <>
      <Nav />
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "92px 24px 32px" }}>

        {/* Global alert banner */}
        {highAlertAgent && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "8px", padding: "12px 16px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "14px", color: "#fca5a5" }}>
              <strong>{highAlertAgent.name || highAlertAgent.id}</strong> has {highAlertAgent.activeAlerts} active alert{highAlertAgent.activeAlerts > 1 ? "s" : ""} — blocked action detected
            </span>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <Link href={`/dashboard/${highAlertAgent.id}?tab=alerts`} style={{ fontSize: "13px", color: "#ef4444", textDecoration: "none" }}>View →</Link>
              <button onClick={() => setDismissed(s => new Set([...s, highAlertAgent.id]))} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: "16px" }}>×</button>
            </div>
          </div>
        )}

        {/* No wallet */}
        {!address && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--bg-secondary)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: "28px" }}>⬡</div>
            <h2 style={{ fontSize: "22px", fontWeight: 600, marginBottom: "12px" }}>Connect your wallet</h2>
            <p style={{ fontSize: "15px", color: "var(--text-tertiary)", marginBottom: "28px", maxWidth: "380px", margin: "0 auto 28px" }}>
              Your wallet address identifies your agents. Connect MetaMask to see agents registered to your address.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button onClick={connect} disabled={isConnecting} style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "11px 28px", fontSize: "14px", fontWeight: 700, color: "#000", cursor: "pointer" }}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
              <Link href="/dashboard/rogue-bot-demo" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "11px 28px", fontSize: "14px", color: "var(--text-secondary)", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                See live example →
              </Link>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
            {[1,2,3].map(i => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Connected, no agents — show onboarding */}
        {!loading && address && agents.length === 0 && (
          <>
            <div style={{ marginBottom: "28px" }}>
              <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Your Agents</h1>
              <p style={{ fontSize: "14px", color: "var(--text-tertiary)" }}>Showing agents for {shortAddress}</p>
            </div>
            <ExampleAgentWithTour />
          </>
        )}

        {/* Connected with agents */}
        {!loading && address && agents.length > 0 && (
          <>
            <div className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Your Agents</h1>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)" }}>Showing agents for {shortAddress}</p>
              </div>
              <Link href="/dashboard/add" style={{ background: "#10b981", border: "none", borderRadius: "6px", padding: "9px 18px", fontSize: "14px", fontWeight: 600, color: "#000", textDecoration: "none" }}>
                + Add Agent
              </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
              {agents.map(agent => <AgentCardUI key={agent.id} agent={agent} recentLogs={recentLogs} />)}
            </div>
          </>
        )}

      </div>
      <style>{`
  @media (max-width: 480px) {
    .dashboard-header { flex-direction: column; align-items: flex-start !important; }
    .agent-card-btns { flex-direction: column; }
  }
`}</style>
    </>
  );
}
