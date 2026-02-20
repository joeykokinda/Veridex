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

interface SimStatus {
  running: boolean;
  uptime?: string;
  lastTick?: string;
  agents?: number;
}

const ACTIVITY_API = process.env.NEXT_PUBLIC_ACTIVITY_API || "http://localhost:3001";

export default function LiveDashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [simStatus, setSimStatus] = useState<SimStatus>({ running: false });
  const [actionLoading, setActionLoading] = useState(false);

  // Filter activities by selected agent
  const filteredActivities = selectedAgent
    ? activities.filter((a) => a.agent === selectedAgent)
    : activities;

  // Check sim status
  const checkSimStatus = async () => {
    try {
      const res = await fetch(`${ACTIVITY_API}/api/status`);
      const data = await res.json();
      setSimStatus(data);
    } catch (error) {
      console.error("Failed to check sim status:", error);
    }
  };

  // Start simulation
  const startSim = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${ACTIVITY_API}/api/control/start`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert("Simulation started!");
        await checkSimStatus();
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      alert("Failed to start simulation");
    }
    setActionLoading(false);
  };

  // Stop simulation
  const stopSim = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${ACTIVITY_API}/api/control/stop`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert("Simulation stopped!");
        await checkSimStatus();
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      alert("Failed to stop simulation");
    }
    setActionLoading(false);
  };

  // Restart simulation
  const restartSim = async () => {
    setActionLoading(true);
    try {
      await fetch(`${ACTIVITY_API}/api/control/stop`, { method: "POST" });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res = await fetch(`${ACTIVITY_API}/api/control/start`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert("Simulation restarted!");
        await checkSimStatus();
      }
    } catch (error) {
      alert("Failed to restart simulation");
    }
    setActionLoading(false);
  };

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
    checkSimStatus();
    
    const interval = setInterval(() => {
      fetchActivity();
      fetchAgents();
      checkSimStatus();
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
            <Link href="/events">Blockchain Events</Link>
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
                        fontSize: "11px", 
                        opacity: selectedAgent === agent.name ? 1 : 0.6 
                      }}>
                        {agentActivityCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <code className="text-dim" style={{ 
                        fontSize: "10px",
                        opacity: selectedAgent === agent.name ? 0.8 : 0.6 
                      }}>
                        {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                      </code>
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
                            <span className="text-mono" style={{ fontSize: "13px", fontWeight: "500",  color: activity.agent === "frank" ? "var(--error)" : "inherit" }}>
                              {activity.agent}
                            </span>
                          )}
                          {activity.type === "reasoning" && (
                            <span style={{ fontSize: "11px", color: "var(--accent)" }}>💭 thinking</span>
                          )}
                          {activity.type === "action" && (
                            <span style={{ fontSize: "11px", color: "var(--success)" }}>{activity.action}</span>
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
                            {activity.jobId && `Job #${activity.jobId}`}
                            {activity.price && ` • ${activity.price} HBAR`}
                            {activity.success !== undefined && ` • ${activity.success ? "SUCCESS" : "FAILED"}`}
                            {activity.rating && ` • Rating: ${activity.rating}/100`}
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
              <h3 className="mb-3">🎮 Simulation Controls</h3>
              
              {/* Status */}
              <div style={{ 
                padding: "12px", 
                background: simStatus.running ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                border: `1px solid ${simStatus.running ? "var(--success)" : "var(--error)"}`,
                borderRadius: "6px",
                marginBottom: "16px"
              }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div style={{ fontWeight: "600", marginBottom: "4px" }}>
                      Status: {simStatus.running ? "🟢 RUNNING" : "🔴 STOPPED"}
                    </div>
                    {simStatus.running && (
                      <div className="text-dim" style={{ fontSize: "12px" }}>
                        {simStatus.agents || 0} agents active • Last tick: {simStatus.lastTick || "N/A"}
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: simStatus.running ? "var(--success)" : "var(--error)",
                    animation: simStatus.running ? "pulse 2s infinite" : "none"
                  }} />
                </div>
              </div>

              {/* Control Buttons */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                <button
                  onClick={startSim}
                  disabled={actionLoading || simStatus.running}
                  className="btn"
                  style={{
                    flex: 1,
                    background: simStatus.running ? "var(--bg-tertiary)" : "var(--success)",
                    color: simStatus.running ? "var(--text-dim)" : "white",
                    cursor: simStatus.running ? "not-allowed" : "pointer",
                    opacity: simStatus.running ? 0.5 : 1
                  }}
                >
                  {actionLoading ? "⏳" : "▶️"} Start
                </button>
                
                <button
                  onClick={stopSim}
                  disabled={actionLoading || !simStatus.running}
                  className="btn"
                  style={{
                    flex: 1,
                    background: !simStatus.running ? "var(--bg-tertiary)" : "var(--error)",
                    color: !simStatus.running ? "var(--text-dim)" : "white",
                    cursor: !simStatus.running ? "not-allowed" : "pointer",
                    opacity: !simStatus.running ? 0.5 : 1
                  }}
                >
                  {actionLoading ? "⏳" : "⏹️"} Stop
                </button>
                
                <button
                  onClick={restartSim}
                  disabled={actionLoading}
                  className="btn"
                  style={{
                    flex: 1,
                    background: "var(--accent)",
                    color: "black"
                  }}
                >
                  {actionLoading ? "⏳" : "🔄"} Restart
                </button>
              </div>

              {/* Agent Personality Controls */}
              <div style={{ 
                padding: "12px",
                background: "var(--bg-secondary)",
                borderRadius: "6px",
                marginBottom: "12px"
              }}>
                <h4 style={{ fontSize: "13px", fontWeight: "600", marginBottom: "8px" }}>
                  Edit Agent Personalities
                </h4>
                <p className="text-dim" style={{ fontSize: "12px", marginBottom: "12px" }}>
                  Edit personality files in <code style={{ background: "var(--bg-tertiary)", padding: "2px 6px", borderRadius: "3px" }}>agents/personalities/*.md</code>
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                  {agents.map((agent) => (
                    <button
                      key={agent.address}
                      onClick={() => openPersonalityFile(agent.name)}
                      className="btn"
                      style={{ 
                        fontSize: "11px", 
                        padding: "6px 12px",
                        background: "var(--bg-tertiary)"
                      }}
                    >
                      {agent.name} →
                    </button>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div className="text-dim" style={{ fontSize: "12px", lineHeight: "1.6" }}>
                <p style={{ marginBottom: "8px" }}>
                  💡 <strong>How it works:</strong>
                </p>
                <ul style={{ paddingLeft: "20px", margin: "0" }}>
                  <li>Start/Stop the simulation tick loop</li>
                  <li>Edit agent modes (PRO, SCAMMER, etc.)</li>
                  <li>Changes take effect immediately</li>
                  <li>All actions are on-chain & verifiable</li>
                </ul>
              </div>
            </div>
          )}

          {/* Password Prompt for Unauthenticated Users */}
          {!isAuthenticated && (
            <div className="card" style={{ marginTop: "24px", textAlign: "center" }}>
              <h3 className="mb-2">🔒 Controlled Simulation</h3>
              <p className="text-dim" style={{ fontSize: "13px", marginBottom: "16px" }}>
                This is a controlled experiment demonstrating reputation dynamics.
              </p>
              <button
                onClick={() => {
                  const pw = prompt("Enter admin password:");
                  if (pw === "ethdenver2026") {
                    setIsAuthenticated(true);
                    localStorage.setItem("auth", "true");
                    alert("✅ Authenticated! You now have full control.");
                  } else if (pw) {
                    alert("❌ Wrong password!");
                  }
                }}
                className="btn"
                style={{ fontSize: "13px", padding: "8px 24px" }}
              >
                🔓 Unlock Control Panel
              </button>
              <p className="text-dim" style={{ fontSize: "11px", marginTop: "12px", fontStyle: "italic" }}>
                Password: <code>ethdenver2026</code>
              </p>
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
