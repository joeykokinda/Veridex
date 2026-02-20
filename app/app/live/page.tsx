"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

interface Activity {
  type: "reasoning" | "action" | "message" | "registered" | "unregistered";
  agent: string;
  to?: string;
  content?: string;
  action?: string;
  jobId?: string;
  description?: string;
  price?: string;
  txHash?: string;
  timestamp: number;
  success?: boolean;
  rating?: number;
}

interface AgentInfo {
  name: string;
  address: string;
  mode: string;
  reputation: number;
  jobsCompleted: number;
  jobsFailed: number;
  totalEarned: string;
  registered: boolean;
}

interface SimStatus {
  running: boolean;
  uptime?: string;
  lastTick?: string;
  agents?: number;
}

const ACTIVITY_API = process.env.NEXT_PUBLIC_ACTIVITY_API || "http://localhost:3001";

const AGENT_COLORS: Record<string, string> = {
  alice:   "#60a5fa",
  bob:     "#4ade80",
  charlie: "#c084fc",
  dave:    "#f87171",
  emma:    "#f472b6",
  frank:   "#fb923c",
  terry:   "#fbbf24",
};

const AGENT_ROLES: Record<string, string> = {
  alice:   "Professional Seller",
  bob:     "Reliable Buyer",
  charlie: "Seller",
  dave:    "Scammer",
  emma:    "Smart Buyer",
  frank:   "Bad Actor",
  terry:   "Trader",
};

function agentColor(name: string) {
  return AGENT_COLORS[name?.toLowerCase()] || "#94a3b8";
}

function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: agentColor(name),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: "700", color: "#000",
      flexShrink: 0, textTransform: "capitalize"
    }}>
      {name?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

export default function LiveDashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [personalities, setPersonalities] = useState<Record<string, string>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [simStatus, setSimStatus] = useState<SimStatus>({ running: false });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>({});
  const feedRef = useRef<HTMLDivElement>(null);

  const filteredActivities = selectedAgent
    ? activities.filter(a => a.agent === selectedAgent || a.to === selectedAgent)
    : activities;

  useEffect(() => {
    if (localStorage.getItem("auth") === "true") setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [actRes, agentRes, statusRes] = await Promise.all([
          fetch(`${ACTIVITY_API}/api/activity`),
          fetch(`${ACTIVITY_API}/api/agents`),
          fetch(`${ACTIVITY_API}/api/status`),
        ]);
        const actData = await actRes.json();
        const agentData = await agentRes.json();
        const statusData = await statusRes.json();

        setActivities(actData.activities || []);
        setAgents(agentData.agents || []);
        setSimStatus(statusData);

        // Count per agent
        const counts: Record<string, number> = {};
        for (const a of (actData.activities || [])) {
          counts[a.agent] = (counts[a.agent] || 0) + 1;
        }
        setActivityCounts(counts);
      } catch (e) {
        // orchestrator not reachable yet
      }
    };

    const fetchPersonalities = async () => {
      try {
        const res = await fetch(`${ACTIVITY_API}/api/personalities`);
        const data = await res.json();
        setPersonalities(data.personalities || {});
      } catch (e) {}
    };

    fetchAll();
    fetchPersonalities();
    const interval = setInterval(fetchAll, 4000);
    return () => clearInterval(interval);
  }, []);

  const startSim = async () => {
    setActionLoading(true);
    try {
      await fetch(`${ACTIVITY_API}/api/control/start`, { method: "POST" });
      setTimeout(() => setActionLoading(false), 2000);
    } catch { setActionLoading(false); }
  };

  const stopSim = async () => {
    setActionLoading(true);
    try {
      await fetch(`${ACTIVITY_API}/api/control/stop`, { method: "POST" });
      setTimeout(() => setActionLoading(false), 1000);
    } catch { setActionLoading(false); }
  };

  const restartSim = async () => {
    setActionLoading(true);
    try {
      await fetch(`${ACTIVITY_API}/api/control/stop`, { method: "POST" });
      await new Promise(r => setTimeout(r, 2000));
      await fetch(`${ACTIVITY_API}/api/control/start`, { method: "POST" });
      setTimeout(() => setActionLoading(false), 2000);
    } catch { setActionLoading(false); }
  };

  const selectedPersonality = selectedAgent ? personalities[selectedAgent] : null;

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">AgentTrust</Link>
          <nav className="nav">
            <Link href="/dashboard">Agents</Link>
            <Link href="/live" style={{ fontWeight: "600", textDecoration: "underline" }}>Live Feed</Link>
            <Link href="/skill.md">Docs</Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <Link href="/scanner" style={{ color: "var(--accent)" }}>Scanner</Link>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "32px 0" }}>
        <div className="container">

          {/* Page title */}
          <div className="flex items-center gap-3 mb-4">
            <h1 style={{ fontSize: "28px" }}>Live Agent Activity</h1>
            <span style={{
              padding: "3px 10px", background: simStatus.running ? "var(--success)" : "var(--border)",
              color: simStatus.running ? "#000" : "var(--text-dim)",
              fontSize: "11px", fontWeight: "700", borderRadius: "4px", textTransform: "uppercase"
            }}>
              {simStatus.running ? "Running" : "Stopped"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "16px", alignItems: "start" }}>

            {/* ── LEFT: Agent Roster ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="text-dim" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                Agents ({agents.length})
              </div>

              {/* All agents button */}
              <div
                onClick={() => setSelectedAgent(null)}
                style={{
                  padding: "10px 12px", borderRadius: "6px", cursor: "pointer",
                  background: selectedAgent === null ? "var(--accent)" : "var(--bg-secondary)",
                  color: selectedAgent === null ? "#000" : "inherit",
                  border: `1px solid ${selectedAgent === null ? "transparent" : "var(--border)"}`,
                  fontSize: "13px", fontWeight: selectedAgent === null ? "600" : "400"
                }}
              >
                All Agents
                <span style={{ float: "right", opacity: 0.7 }}>{activities.length}</span>
              </div>

              {agents.map(agent => (
                <div
                  key={agent.address}
                  onClick={() => setSelectedAgent(selectedAgent === agent.name ? null : agent.name)}
                  style={{
                    padding: "10px 12px", borderRadius: "6px", cursor: "pointer",
                    background: selectedAgent === agent.name ? `${agentColor(agent.name)}22` : "var(--bg-secondary)",
                    border: `1px solid ${selectedAgent === agent.name ? agentColor(agent.name) : "var(--border)"}`,
                    transition: "all 0.15s"
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AgentAvatar name={agent.name} size={20} />
                    <span style={{ fontWeight: "600", fontSize: "13px", textTransform: "capitalize" }}>{agent.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-dim)" }}>
                      {activityCounts[agent.name] || 0}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-dim)", paddingLeft: "28px" }}>
                    {AGENT_ROLES[agent.name] || agent.mode}
                  </div>
                  <div style={{ fontSize: "11px", paddingLeft: "28px", marginTop: "3px", display: "flex", gap: "8px" }}>
                    <span style={{ color: agentColor(agent.name), fontWeight: "600" }}>
                      REP {agent.reputation ?? 0}/1000
                    </span>
                    <span style={{ color: "var(--text-dim)" }}>
                      {agent.jobsCompleted ?? 0}W {agent.jobsFailed ?? 0}F
                    </span>
                  </div>
                </div>
              ))}

              {/* Personality panel */}
              {selectedAgent && selectedPersonality && (
                <div style={{
                  marginTop: "8px", padding: "16px", borderRadius: "8px",
                  background: "var(--bg-secondary)", border: `1px solid ${agentColor(selectedAgent)}`,
                  maxHeight: "400px", overflowY: "auto"
                }}>
                  <div className="flex items-center gap-2 mb-3">
                    <AgentAvatar name={selectedAgent} size={24} />
                    <span style={{ fontWeight: "600", fontSize: "13px", textTransform: "capitalize" }}>{selectedAgent}</span>
                  </div>
                  <pre style={{
                    fontSize: "10px", lineHeight: "1.6",
                    color: "var(--text-dim)", whiteSpace: "pre-wrap",
                    wordBreak: "break-word", margin: 0
                  }}>
                    {selectedPersonality}
                  </pre>
                </div>
              )}

              {/* Sim controls */}
              {isAuthenticated ? (
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="text-dim" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Controls</div>
                  <button
                    onClick={startSim}
                    disabled={actionLoading || simStatus.running}
                    style={{
                      padding: "8px", borderRadius: "6px", border: "none", cursor: simStatus.running ? "not-allowed" : "pointer",
                      background: simStatus.running ? "var(--bg-tertiary)" : "var(--success)",
                      color: simStatus.running ? "var(--text-dim)" : "#000",
                      fontWeight: "600", fontSize: "13px", opacity: simStatus.running ? 0.5 : 1
                    }}
                  >
                    {actionLoading ? "..." : "Start"}
                  </button>
                  <button
                    onClick={stopSim}
                    disabled={actionLoading || !simStatus.running}
                    style={{
                      padding: "8px", borderRadius: "6px", border: "none", cursor: !simStatus.running ? "not-allowed" : "pointer",
                      background: !simStatus.running ? "var(--bg-tertiary)" : "var(--error)",
                      color: !simStatus.running ? "var(--text-dim)" : "#fff",
                      fontWeight: "600", fontSize: "13px", opacity: !simStatus.running ? 0.5 : 1
                    }}
                  >
                    {actionLoading ? "..." : "Stop"}
                  </button>
                  <button
                    onClick={restartSim}
                    disabled={actionLoading}
                    style={{
                      padding: "8px", borderRadius: "6px", border: "1px solid var(--border)",
                      cursor: "pointer", background: "var(--bg-secondary)",
                      color: "var(--text)", fontWeight: "600", fontSize: "13px"
                    }}
                  >
                    Restart
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const pw = prompt("Admin password:");
                    if (pw === "ethdenver2026") {
                      setIsAuthenticated(true);
                      localStorage.setItem("auth", "true");
                    } else if (pw) alert("Wrong password");
                  }}
                  style={{
                    marginTop: "8px", padding: "8px", borderRadius: "6px",
                    border: "1px solid var(--border)", background: "var(--bg-secondary)",
                    color: "var(--text-dim)", cursor: "pointer", fontSize: "12px"
                  }}
                >
                  Unlock Controls
                </button>
              )}
            </div>

            {/* ── CENTER: Activity Feed ── */}
            <div className="card" style={{ padding: "0", overflow: "hidden" }}>
              {/* Feed header */}
              <div style={{
                padding: "16px 20px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <div className="flex items-center gap-2">
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: simStatus.running ? "var(--success)" : "var(--border)",
                    animation: simStatus.running ? "pulse 2s infinite" : "none"
                  }} />
                  <h2 style={{ fontSize: "16px" }}>
                    {selectedAgent
                      ? `${selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)}'s Activity`
                      : "Live Feed"}
                  </h2>
                </div>
                {selectedAgent && (
                  <button
                    onClick={() => setSelectedAgent(null)}
                    style={{
                      fontSize: "11px", padding: "4px 10px",
                      background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                      borderRadius: "4px", cursor: "pointer", color: "var(--text-dim)"
                    }}
                  >
                    Clear filter
                  </button>
                )}
              </div>

              {/* Feed body */}
              <div
                ref={feedRef}
                style={{
                  maxHeight: "calc(100vh - 220px)", overflowY: "auto",
                  display: "flex", flexDirection: "column", gap: "1px"
                }}
              >
                {filteredActivities.length === 0 ? (
                  <div style={{ padding: "64px 24px", textAlign: "center", color: "var(--text-dim)" }}>
                    {simStatus.running
                      ? "Agents are thinking... activity will appear here."
                      : "Hit Start to begin the simulation."}
                  </div>
                ) : (
                  filteredActivities.map((activity, idx) => (
                    <ActivityCard key={idx} activity={activity} />
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}

function ActivityCard({ activity }: { activity: Activity }) {
  const color = agentColor(activity.agent);

  if (activity.type === "reasoning") {
    return (
      <div style={{
        padding: "12px 20px",
        borderLeft: `3px solid ${color}22`,
        background: "var(--bg-secondary)"
      }}>
        <div className="flex items-center gap-2 mb-1">
          <AgentAvatar name={activity.agent} size={18} />
          <span style={{ fontSize: "12px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>thinking</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p style={{
          fontSize: "13px", lineHeight: "1.6",
          color: "var(--text-dim)", fontStyle: "italic",
          margin: 0, paddingLeft: "26px"
        }}>
          {activity.content}
        </p>
      </div>
    );
  }

  if (activity.type === "message") {
    const toLabel = activity.to === "marketplace" ? "marketplace" : activity.to;
    return (
      <div style={{
        padding: "12px 20px",
        background: "var(--bg-primary)"
      }}>
        <div className="flex items-center gap-2 mb-2">
          <AgentAvatar name={activity.agent} size={22} />
          <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
            {"->"} <span style={{ color: agentColor(activity.to || ""), textTransform: "capitalize" }}>
              {toLabel}
            </span>
          </span>
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div style={{
          marginLeft: "30px",
          padding: "10px 14px",
          background: `${color}11`,
          border: `1px solid ${color}33`,
          borderRadius: "0 8px 8px 8px",
          fontSize: "13px", lineHeight: "1.6", color: "var(--text-primary)"
        }}>
          {activity.content}
        </div>
        {activity.txHash && (
          <div style={{ marginLeft: "30px", marginTop: "4px" }}>
            <a
              href={`https://hashscan.io/testnet/transaction/${activity.txHash}`}
              target="_blank" rel="noopener"
              className="text-mono"
              style={{ fontSize: "10px", color: "var(--accent)" }}
            >
              on-chain: {activity.txHash.slice(0, 14)}... (HashScan)
            </a>
          </div>
        )}
      </div>
    );
  }

  if (activity.type === "action") {
    const actionColors: Record<string, string> = {
      bid: "#60a5fa",
      post_job: "#4ade80",
      accept_bid: "#a78bfa",
      submit_delivery: "#fbbf24",
      finalize_job: activity.success ? "#4ade80" : "#f87171",
      registered: "#4ade80",
      unregistered: "#f87171",
    };
    const actionColor = actionColors[activity.action || ""] || "var(--accent)";
    const actionLabels: Record<string, string> = {
      bid: "BID PLACED",
      post_job: "JOB POSTED",
      accept_bid: "BID ACCEPTED",
      submit_delivery: "DELIVERED",
      finalize_job: activity.success ? "JOB COMPLETE" : "JOB FAILED",
      registered: "REGISTERED",
      unregistered: "UNREGISTERED",
      already_registered: "ALREADY REGISTERED",
    };

    return (
      <div style={{
        padding: "12px 20px",
        borderLeft: `3px solid ${actionColor}`,
        background: `${actionColor}08`
      }}>
        <div className="flex items-center gap-2 mb-1">
          <AgentAvatar name={activity.agent} size={20} />
          <span style={{ fontSize: "12px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{
            fontSize: "10px", fontWeight: "700", padding: "2px 6px",
            background: `${actionColor}22`, color: actionColor,
            borderRadius: "3px", letterSpacing: "0.5px"
          }}>
            {actionLabels[activity.action || ""] || activity.action?.toUpperCase()}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>

        <div style={{ paddingLeft: "28px" }}>
          {activity.action === "post_job" && activity.description && (
            <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "4px" }}>
              "{activity.description}" — {activity.price} HBAR escrow
            </div>
          )}
          {activity.action === "bid" && (
            <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "4px" }}>
              Job #{activity.jobId} — {activity.price} HBAR
            </div>
          )}
          {activity.action === "finalize_job" && activity.rating !== undefined && (
            <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "4px" }}>
              Rating: {activity.rating}/100
            </div>
          )}
          {activity.content && (
            <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "4px" }}>
              {activity.content}
            </div>
          )}
          {activity.txHash && (
            <a
              href={`https://hashscan.io/testnet/transaction/${activity.txHash}`}
              target="_blank"
              rel="noopener"
              className="text-mono"
              style={{ fontSize: "10px", color: "var(--accent)" }}
            >
              {activity.txHash.slice(0, 16)}... (HashScan)
            </a>
          )}
        </div>
      </div>
    );
  }

  // registered / unregistered
  if (activity.type === "registered" || activity.type === "unregistered") {
    const isReg = activity.type === "registered";
    return (
      <div style={{
        padding: "10px 20px",
        background: isReg ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
        borderLeft: `3px solid ${isReg ? "var(--success)" : "var(--error)"}`,
        display: "flex", alignItems: "center", gap: "8px"
      }}>
        <AgentAvatar name={activity.agent} size={18} />
        <span style={{ fontSize: "12px", textTransform: "capitalize", fontWeight: "600", color }}>
          {activity.agent}
        </span>
        <span style={{ fontSize: "12px", color: isReg ? "var(--success)" : "var(--error)" }}>
          {isReg ? "joined the network" : "left the network"}
        </span>
        {activity.txHash && (
          <a href={`https://hashscan.io/testnet/transaction/${activity.txHash}`} target="_blank" rel="noopener"
            className="text-mono" style={{ fontSize: "10px", color: "var(--accent)", marginLeft: "auto" }}>
            {activity.txHash.slice(0, 10)}...
          </a>
        )}
      </div>
    );
  }

  return null;
}
