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
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");

  // Filter activities by selected agent
  const filteredActivities = selectedAgent
    ? activities.filter((a) => a.agent === selectedAgent)
    : activities;

  // Simple password check
  const checkPassword = () => {
    // Dev password - change this!
    if (password === "ethdenver2026") {
      setIsAuthenticated(true);
      localStorage.setItem("auth", "true");
    } else {
      alert("Wrong password!");
    }
  };

  useEffect(() => {
    // Check if already authenticated
    if (localStorage.getItem("auth") === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
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

  const openPersonalityFile = (agentName: string) => {
    const url = `https://github.com/joeykokinda/EthDenver2026/blob/main/agents/personalities/${agentName}.md`;
    window.open(url, '_blank');
  };

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
            <div className="flex items-center gap-3 mb-2">
              <h1>Live Agent Activity</h1>
              <span style={{
                padding: "4px 12px",
                background: "var(--accent)",
                color: "black",
                fontSize: "11px",
                fontWeight: "600",
                borderRadius: "4px",
                textTransform: "uppercase"
              }}>
                Controlled Simulation
              </span>
            </div>
            <p className="text-dim">
              Real-time reasoning and actions from autonomous AI agents. This is a controlled test environment demonstrating reputation dynamics.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "24px" }}>
            {/* Agent List Sidebar */}
            <div className="card" style={{ height: "fit-content", position: "sticky", top: "80px" }}>
              <h3 className="mb-3">Active Agents</h3>
              
              {/* All Agents Option */}
              <div 
                onClick={() => setSelectedAgent(null)}
                style={{ 
                  padding: "12px",
                  borderRadius: "6px",
                  marginBottom: "8px",
                  background: selectedAgent === null ? "var(--accent)" : "var(--bg-secondary)",
                  color: selectedAgent === null ? "black" : "inherit",
                  cursor: "pointer",
                  border: selectedAgent === null ? "none" : "1px solid var(--border)",
                  transition: "all 0.15s"
                }}
              >
                <div className="flex items-center justify-between">
                  <span style={{ fontWeight: selectedAgent === null ? "600" : "400" }}>
                    All Agents
                  </span>
                  <span style={{ 
                    fontSize: "11px", 
                    opacity: selectedAgent === null ? 1 : 0.6 
                  }}>
                    {activities.length}
                  </span>
                </div>
              </div>

              {/* Individual Agents */}
              {agents.map((agent) => {
                const agentActivityCount = activities.filter(a => a.agent === agent.name).length;
                return (
                  <div 
                    key={agent.address}
                    onClick={() => setSelectedAgent(agent.name)}
                    style={{ 
                      padding: "12px",
                      borderRadius: "6px",
                      marginBottom: "8px",
                      background: selectedAgent === agent.name ? "var(--accent)" : "var(--bg-secondary)",
                      color: selectedAgent === agent.name ? "black" : "inherit",
                      cursor: "pointer",
                      border: selectedAgent === agent.name ? "none" : "1px solid var(--border)",
                      transition: "all 0.15s"
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-mono" style={{ 
                        fontWeight: selectedAgent === agent.name ? "600" : "500",
                        fontSize: "14px",
                        color: selectedAgent === agent.name 
                          ? "black" 
                          : (agent.name.toLowerCase() === "frank" ? "var(--error)" : "inherit")
                      }}>
                        {agent.name}
                      </span>
                      <span style={{ 
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "3px",
                        background: selectedAgent === agent.name 
                          ? "rgba(0,0,0,0.2)" 
                          : (agent.mode === "scammer" ? "var(--error)" : "var(--success)"),
                        color: selectedAgent === agent.name ? "black" : "white",
                        fontWeight: "600"
                      }}>
                        {agent.mode.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <code className="text-dim" style={{ 
                        fontSize: "10px",
                        opacity: selectedAgent === agent.name ? 0.8 : 0.6 
                      }}>
                        {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                      </code>
                      <span style={{ 
                        fontSize: "11px",
                        fontWeight: "500",
                        opacity: selectedAgent === agent.name ? 1 : 0.6 
                      }}>
                        {agentActivityCount} actions
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* View Personality Files Button */}
              {!isAuthenticated && (
                <button 
                  onClick={() => {
                    const pw = prompt("Enter password to edit agents:");
                    if (pw && pw === "ethdenver2026") {
                      setIsAuthenticated(true);
                      localStorage.setItem("auth", "true");
                    } else if (pw) {
                      alert("Wrong password!");
                    }
                  }}
                  className="btn"
                  style={{ width: "100%", marginTop: "16px", fontSize: "12px" }}
                >
                  🔒 Unlock Controls
                </button>
              )}
            </div>

            {/* Activity Feed */}
            <div className="card">
              <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "16px", marginBottom: "24px" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div style={{ 
                      width: "8px", 
                      height: "8px", 
                      borderRadius: "50%", 
                      background: "var(--success)",
                      animation: "pulse 2s infinite"
                    }} />
                    <h2>
                      {selectedAgent ? `${selectedAgent}'s Activity` : "Live Activity Feed"}
                    </h2>
                  </div>
                  {selectedAgent && (
                    <button
                      onClick={() => setSelectedAgent(null)}
                      style={{
                        fontSize: "11px",
                        padding: "4px 12px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        color: "var(--text)"
                      }}
                    >
                      ← Back to All
                    </button>
                  )}
                </div>
                {selectedAgent && (
                  <p className="text-dim" style={{ marginTop: "8px", fontSize: "13px" }}>
                    Showing {filteredActivities.length} activities from {selectedAgent}
                  </p>
                )}
              </div>

              {loading ? (
                <div style={{ padding: "48px 0", textAlign: "center" }}>
                  <div className="text-dim">Connecting to orchestrator...</div>
                </div>
              ) : filteredActivities.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center" }}>
                  <div className="text-dim">
                    {selectedAgent 
                      ? `No activity from ${selectedAgent} yet.`
                      : "No activity yet. Agents are monitoring for jobs."
                    }
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "70vh", overflowY: "auto" }}>
                  {filteredActivities.map((activity, idx) => (
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
                          {!selectedAgent && (
                            <span className="text-mono" style={{ fontSize: "13px", fontWeight: "500" }}>
                              {activity.agent}
                            </span>
                          )}
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
                        <p className="text-dim" style={{ fontSize: "13px", margin: "8px 0 0 0", lineHeight: "1.5" }}>
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
          </div>

          {/* Experiment Controls - Only show when authenticated */}
          {isAuthenticated && (
            <div className="card" style={{ marginTop: "24px" }}>
              <h3 className="mb-2">Experiment Controls</h3>
              <div className="text-dim" style={{ fontSize: "13px", lineHeight: "1.6" }}>
                <p className="mb-2" style={{ color: "var(--success)" }}>
                  ✓ You can edit agent personality files in:
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
                <p style={{ fontSize: "12px" }}>
                  Edit modes, policies, and watch behavior change in real-time.
                </p>
                <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {agents.map((agent) => (
                    <button
                      key={agent.address}
                      onClick={() => openPersonalityFile(agent.name)}
                      className="btn"
                      style={{ fontSize: "11px", padding: "6px 12px" }}
                    >
                      Edit {agent.name} →
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
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
