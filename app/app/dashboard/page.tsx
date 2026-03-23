"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { DashboardHeader } from "../components/DashboardHeader";
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

function DeleteModal({ agent, onConfirm, onCancel }: { agent: AgentCard; onConfirm: () => void; onCancel: () => void }) {
  const [input, setInput] = useState("");
  const agentName = agent.name || agent.id;
  const confirmed = input === agentName;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onCancel}>
      <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "12px", padding: "28px", maxWidth: "420px", width: "100%" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "#fca5a5" }}>Remove agent</div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px", lineHeight: "1.5" }}>
          This removes <strong style={{ color: "var(--text-primary)" }}>{agentName}</strong> from your dashboard. The agent stays registered on-chain.
        </p>
        <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px" }}>
          Type <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{agentName}</strong> to confirm:
        </p>
        <input
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && confirmed) onConfirm(); if (e.key === "Escape") onCancel(); }}
          placeholder={agentName}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-tertiary)", border: `1px solid ${confirmed ? "rgba(239,68,68,0.6)" : "var(--border)"}`, borderRadius: "6px", padding: "9px 12px", fontSize: "13px", color: "var(--text-primary)", fontFamily: "monospace", outline: "none", marginBottom: "16px" }}
        />
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!confirmed} style={{ background: confirmed ? "#ef4444" : "rgba(239,68,68,0.2)", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, color: confirmed ? "#fff" : "rgba(239,68,68,0.4)", cursor: confirmed ? "pointer" : "not-allowed", transition: "all 0.15s" }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentCardUI({ agent, recentLogs, onDelete }: { agent: AgentCard; recentLogs: Log[]; onDelete: (id: string) => void }) {
  const status = statusDot(agent, recentLogs);
  const myLogs = recentLogs.filter(l => l.agentId === agent.id);
  const lastLog = myLogs[0];
  const [showDelete, setShowDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(agent.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = () => {
    onDelete(agent.id);
    setShowDelete(false);
  };

  return (
    <>
      {showDelete && <DeleteModal agent={agent} onConfirm={handleDelete} onCancel={() => setShowDelete(false)} />}
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: status.dot }} />
              <span style={{ fontSize: "12px", color: status.dot }}>{status.label}</span>
            </div>
            <button onClick={() => setShowDelete(true)} title="Remove agent" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: "15px", padding: "2px 4px", lineHeight: 1, opacity: 0.6, transition: "opacity 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}>
              ✕
            </button>
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
          <button onClick={copyId} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "8px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: copied ? "#10b981" : "var(--text-secondary)", cursor: "pointer", transition: "color 0.15s" }}>
            {copied ? "✓ Copied" : "Copy ID"}
          </button>
        </div>
      </div>
    </>
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
    targetId: "example-agent-card",
    title: "Every action, on-chain forever",
    body: "Each agent gets its own Hedera HCS topic. Every action — allowed or blocked — is written to it. The Hedera network orders the messages, not us. Nobody can delete or reorder them.",
    position: "bottom",
    nextLabel: "Next →",
  },
  {
    targetId: "example-agent-card",
    title: "Dangerous actions get stopped cold",
    body: "Before your agent runs any action, it calls Veridex first. Shell injections, credential access, runaway loops — blocked before execution, logged to HCS permanently.",
    position: "bottom",
    nextLabel: "Next →",
  },
  {
    targetId: "example-agent-card",
    title: "Telegram kill-switch",
    body: "Connect your Telegram in the agent's Settings tab. If something goes wrong at 3am, text /block <agentId> to the bot and the agent stops immediately. /unblock to resume.",
    position: "bottom",
    nextLabel: "Next →",
  },
  {
    targetId: "view-agent-btn",
    title: "Click in to explore",
    body: "Open an agent to see its activity feed, blocked threats, operator policies, ERC-7715 delegations, and Telegram setup.",
    position: "bottom",
    action: { label: "Open RogueBot →", href: "/dashboard/rogue-bot-demo?tour=1" },
    nextLabel: "Skip",
  },
];

const EXAMPLE_DISMISSED_KEY = "veridex_example_dismissed";

function ExampleAgentWithTour() {
  const { step, next, skip, active } = useTour(DASHBOARD_TOUR_STEPS, true);
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem(EXAMPLE_DISMISSED_KEY)
  );

  function dismiss() {
    localStorage.setItem(EXAMPLE_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  if (dismissed) {
    return (
      <div style={{ textAlign: "center", padding: "80px 24px" }}>
        <div style={{ fontSize: "22px", fontWeight: 700, marginBottom: "10px" }}>Add your first agent</div>
        <p style={{ fontSize: "14px", color: "var(--text-tertiary)", marginBottom: "28px", maxWidth: "360px", margin: "0 auto 28px" }}>
          Register your agent and add the Veridex skill — every action will be checked and logged to Hedera HCS automatically.
        </p>
        <Link href="/dashboard/add" style={{ display: "inline-block", background: "#10b981", borderRadius: "8px", padding: "11px 32px", fontSize: "14px", fontWeight: 700, color: "#000", textDecoration: "none" }}>
          + Register your first agent
        </Link>
      </div>
    );
  }

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
      <div id="example-agent-card" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "380px" }}>
        {/* EXAMPLE badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.5px" }}>EXAMPLE</span>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>live demo agent</span>
        </div>

        {/* Name + status */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px", color: "var(--text-primary)" }}>RogueBot</div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>rogue-bot-demo</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
            <span style={{ fontSize: "12px", color: "#f59e0b" }}>Alert</span>
          </div>
        </div>

        {/* Last action */}
        <div style={{ fontSize: "13px", color: "var(--text-secondary)", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 12px" }}>
          <span style={{ color: "#f59e0b", fontSize: "11px", fontWeight: 600, marginRight: "4px" }}>blocked:</span>
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
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px", background: "#10b981", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", textDecoration: "none" }}
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

  const fetchAgents = useCallback(async (wallet: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
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
    if (showSpinner) setLoading(false);
  }, []);

  useEffect(() => {
    if (!address) return;
    fetchAgents(address, true);  // initial load shows skeleton
    const iv = setInterval(() => fetchAgents(address), 30000);  // silent background poll
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

  const handleDeleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
    const claimed: string[] = JSON.parse(localStorage.getItem("veridex_claimed_agents") || "[]");
    localStorage.setItem("veridex_claimed_agents", JSON.stringify(claimed.filter(c => c !== id)));
  };

  const highAlertAgent = agents.find(a => a.activeAlerts > 0 && !dismissedAlerts.has(a.id));

  return (
    <>
      <DashboardHeader />
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "72px 24px 32px" }}>

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
            <h2 style={{ fontSize: "22px", fontWeight: 600, marginBottom: "12px" }}>Connect wallet to manage agents</h2>
            <p style={{ fontSize: "15px", color: "var(--text-tertiary)", marginBottom: "8px", maxWidth: "420px", margin: "0 auto 8px" }}>
              Your agent is already running and logging to Hedera HCS. Connect your wallet to claim ownership and take control.
            </p>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "28px", maxWidth: "380px", margin: "0 auto 28px" }}>
              Agents don&apos;t need a wallet — only the human operator does.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "32px" }}>
              <button onClick={connect} disabled={isConnecting} style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "11px 28px", fontSize: "14px", fontWeight: 700, color: "#000", cursor: "pointer" }}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
              <Link href="/dashboard/rogue-bot-demo" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "11px 28px", fontSize: "14px", color: "var(--text-secondary)", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                See live example →
              </Link>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)", maxWidth: "360px", margin: "0 auto", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", textAlign: "left", lineHeight: 1.7 }}>
              <strong style={{ color: "var(--text-secondary)" }}>Already have an agent running?</strong><br/>
              Go to <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: "3px" }}>veridex.sbs/dashboard/your-agent-id</code> — connect your wallet there and claim it in one click.
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
              {agents.map(agent => <AgentCardUI key={agent.id} agent={agent} recentLogs={recentLogs} onDelete={handleDeleteAgent} />)}
            </div>
            <div style={{ marginTop: "24px", textAlign: "center" }}>
              <Link href="/dashboard/rogue-bot-demo?tour=1" style={{ fontSize: "13px", color: "var(--text-tertiary)", textDecoration: "none" }}>
                Want to see a live example? View RogueBot demo →
              </Link>
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
