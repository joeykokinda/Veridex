"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Activity {
  type: "reasoning" | "action";
  agent: string;
  content?: string;
  action?: string;
  jobId?: string;
  price?: string;
  txHash?: string;
  timestamp: number;
}

interface AgentInfo {
  name: string;
  address: string;
  mode: string;
}

const ACTIVITY_API = process.env.NEXT_PUBLIC_ACTIVITY_API || "http://localhost:3001";

export default function LiveDashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch activity feed every 5 seconds
    const fetchActivity = async () => {
      try {
        const res = await fetch(`${ACTIVITY_API}/api/activity`);
        const data = await res.json();
        setActivities(data.activities);
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch activity:", error);
      }
    };

    const fetchAgents = async () => {
      try {
        const res = await fetch(`${ACTIVITY_API}/api/agents`);
        const data = await res.json();
        setAgents(data.agents);
      } catch (error) {
        console.error("Failed to fetch agents:", error);
      }
    };

    fetchActivity();
    fetchAgents();
    
    const interval = setInterval(() => {
      fetchActivity();
      fetchAgents();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            AgentTrust
          </Link>
          <nav className="nav">
            <Link href="/dashboard">On-Chain Data</Link>
            <Link href="/live" style={{ fontWeight: "600", textDecoration: "underline" }}>
              Live Agent Feed
            </Link>
            <Link href="/skill.md">For Agents</Link>
            <a href="https://hashscan.io/testnet" target="_blank" rel="noopener">
              HashScan
            </a>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "64px 0" }}>
        <div className="container">
          <div className="mb-4">
            <h1 className="mb-1">Live Agent Activity</h1>
            <p className="text-dim">
              Real-time reasoning and actions from autonomous agents
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
            {/* Activity Feed */}
            <div className="card">
              <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "16px", marginBottom: "24px" }}>
                <div className="flex items-center gap-2">
                  <div style={{ 
                    width: "8px", 
                    height: "8px", 
                    borderRadius: "50%", 
                    background: "var(--success)",
                    animation: "pulse 2s infinite"
                  }} />
                  <h2>Live Activity Feed</h2>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: "48px 0", textAlign: "center" }}>
                  <div className="text-dim">Connecting to orchestrator...</div>
                </div>
              ) : activities.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center" }}>
                  <div className="text-dim">No activity yet. Start the orchestrator to see agents in action.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "600px", overflowY: "auto" }}>
                  {activities.map((activity, idx) => (
                    <div 
                      key={idx}
                      className="card"
                      style={{ 
                        padding: "12px 16px",
                        background: activity.type === "reasoning" ? "var(--bg-secondary)" : "var(--bg-tertiary)"
                      }}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-mono" style={{ fontSize: "13px", fontWeight: "500" }}>
                            {activity.agent}
                          </span>
                          {activity.type === "reasoning" && (
                            <span style={{ fontSize: "11px", color: "var(--accent)" }}>💭 thinking</span>
                          )}
                          {activity.type === "action" && (
                            <span style={{ fontSize: "11px", color: "var(--success)" }}>⚡ {activity.action}</span>
                          )}
                        </div>
                        <span className="text-dim" style={{ fontSize: "11px" }}>
                          {new Date(activity.timestamp).toLocaleTimeString()}
                        </span>
                      </div>

                      {activity.content && (
                        <p className="text-dim" style={{ fontSize: "13px", margin: "8px 0 0 0" }}>
                          {activity.content}
                        </p>
                      )}

                      {activity.action && (
                        <div style={{ marginTop: "8px", fontSize: "12px" }}>
                          <div className="text-dim">
                            Job #{activity.jobId} • {activity.price} HBAR
                          </div>
                          {activity.txHash && (
                            <a 
                              href={`https://hashscan.io/testnet/transaction/${activity.txHash}`}
                              target="_blank"
                              rel="noopener"
                              className="text-accent text-mono"
                              style={{ fontSize: "11px" }}
                            >
                              {activity.txHash.slice(0, 10)}...{activity.txHash.slice(-8)}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agent Control Panel */}
            <div>
              <div className="card mb-3">
                <h3 className="mb-3">Active Agents</h3>
                {agents.map((agent) => (
                  <div 
                    key={agent.address}
                    style={{ 
                      padding: "12px",
                      borderBottom: "1px solid var(--border)",
                      marginBottom: "8px"
                    }}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-mono" style={{ fontWeight: "500" }}>
                        {agent.name}
                      </span>
                      <span 
                        style={{ 
                          fontSize: "10px",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: agent.mode === "scammer" ? "var(--error)" : "var(--success)",
                          color: "white"
                        }}
                      >
                        {agent.mode.toUpperCase()}
                      </span>
                    </div>
                    <code className="text-dim" style={{ fontSize: "10px" }}>
                      {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                    </code>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 className="mb-2">Instructions</h3>
                <div className="text-dim" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                  <p className="mb-2">
                    To modify agent behavior, edit personality MD files in:
                  </p>
                  <code style={{ 
                    display: "block",
                    padding: "8px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "4px",
                    fontSize: "11px",
                    marginBottom: "12px"
                  }}>
                    agents/personalities/*.md
                  </code>
                  <p>
                    Uncomment different modes (SCAMMER, GREEDY, etc.) and watch behavior change in real-time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}
