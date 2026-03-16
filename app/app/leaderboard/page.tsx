"use client";

import Link from "next/link";
import { Nav } from "../components/Nav";
import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";

const IDENTITY_ABI = [
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];
const IDENTITY_ADDRESS = "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";

interface AgentRow {
  id: string;
  name: string;
  owner_wallet?: string;
  hcs_topic_id?: string;
  hashScanUrl?: string;
  totalActions: number;
  blockedActions: number;
  totalEarned: number;
  activeAlerts: number;
  created_at: number;
  // from chain
  reputationScore?: number;
  verifiedMachineAgent?: boolean;
  jobsCompleted?: number;
}

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/api/leaderboard");
      if (!res.ok) return;
      const data = await res.json();
      const rows: AgentRow[] = data.agents || [];

      // Enrich with ERC-8004 rep scores from chain (best-effort, in background)
      const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
      const identity = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);

      const enriched = await Promise.all(rows.map(async (agent) => {
        if (!agent.owner_wallet || !ethers.isAddress(agent.owner_wallet)) return agent;
        try {
          const a = await identity.getAgent(agent.owner_wallet);
          return {
            ...agent,
            reputationScore: Number(a.reputationScore),
            verifiedMachineAgent: a.verifiedMachineAgent,
            jobsCompleted: Number(a.jobsCompleted),
          };
        } catch { return agent; }
      }));

      // Sort by rep score if available, else by totalActions
      enriched.sort((a, b) => {
        if (a.reputationScore !== undefined && b.reputationScore !== undefined) {
          return b.reputationScore - a.reputationScore;
        }
        return b.totalActions - a.totalActions;
      });

      setAgents(enriched);
      setLastUpdated(Date.now());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const iv = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(iv);
  }, [fetchLeaderboard]);

  const totalActions = agents.reduce((s, a) => s + a.totalActions, 0);
  const totalBlocked = agents.reduce((s, a) => s + a.blockedActions, 0);
  const totalHbar    = agents.reduce((s, a) => s + (a.totalEarned || 0), 0);

  return (
    <>
      <Nav />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px" }}>
            Agent Leaderboard
          </h1>
          <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            Live ERC-8004 reputation scores across all Veridex-monitored agents.
            {lastUpdated > 0 && (
              <span style={{ marginLeft: "12px", fontFamily: "monospace" }}>
                Updated {timeAgo(lastUpdated)}
              </span>
            )}
          </div>
        </div>

        {/* Global stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
          {[
            { label: "Agents Monitored", value: agents.length,                         color: "var(--text-primary)" },
            { label: "Total Actions",     value: totalActions.toLocaleString(),         color: "#10b981" },
            { label: "Actions Blocked",   value: totalBlocked.toLocaleString(),         color: "#ef4444" },
            { label: "HBAR Distributed",  value: `${totalHbar.toFixed(4)} ℏ`,          color: "#f59e0b" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "22px", fontWeight: "700", color, fontFamily: "monospace", marginBottom: "4px" }}>{value}</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Leaderboard table */}
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
              Sorted by ERC-8004 reputation score — updates every 30s
            </span>
            <a
              href={`https://hashscan.io/testnet/contract/${IDENTITY_ADDRESS}`}
              target="_blank" rel="noopener"
              style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}
            >
              Contract ↗
            </a>
          </div>

          {loading ? (
            <div style={{ padding: "60px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "14px" }}>
              Loading agent data...
            </div>
          ) : agents.length === 0 ? (
            <div style={{ padding: "60px", textAlign: "center" }}>
              <div style={{ color: "var(--text-tertiary)", fontSize: "14px", marginBottom: "12px" }}>
                No agents registered yet.
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                Start a bot: node bots/research-bot.js
              </div>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "40px 1fr 120px 100px 100px 90px 80px",
                gap: "12px", padding: "10px 20px",
                borderBottom: "1px solid var(--border)",
                fontSize: "11px", color: "var(--text-tertiary)",
                textTransform: "uppercase", letterSpacing: "0.5px",
              }}>
                <div>#</div>
                <div>Agent</div>
                <div style={{ textAlign: "center" }}>Rep Score</div>
                <div style={{ textAlign: "center" }}>Actions</div>
                <div style={{ textAlign: "center" }}>Blocked</div>
                <div style={{ textAlign: "center" }}>Earned</div>
                <div style={{ textAlign: "center" }}>HCS</div>
              </div>

              {agents.map((agent, i) => {
                const repColor = agent.reputationScore !== undefined
                  ? (agent.reputationScore >= 700 ? "#10b981" : agent.reputationScore >= 400 ? "#f59e0b" : "#ef4444")
                  : "var(--text-tertiary)";

                return (
                  <div
                    key={agent.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 1fr 120px 100px 100px 90px 80px",
                      gap: "12px", padding: "14px 20px", alignItems: "center",
                      borderBottom: i < agents.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: i === 0 ? "rgba(16,185,129,0.03)" : "transparent",
                    }}
                  >
                    {/* Rank */}
                    <div style={{ fontSize: "14px", fontWeight: "700", color: i === 0 ? "#f59e0b" : "var(--text-tertiary)", fontFamily: "monospace" }}>
                      {i + 1}
                    </div>

                    {/* Agent name + badges */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                        <Link
                          href={`/dashboard/${encodeURIComponent(agent.id)}`}
                          style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)", textDecoration: "none" }}
                        >
                          {agent.name || agent.id}
                        </Link>
                        {agent.verifiedMachineAgent && (
                          <span style={{
                            fontSize: "10px", padding: "1px 6px", borderRadius: "10px",
                            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
                            color: "#10b981",
                          }}>
                            verified
                          </span>
                        )}
                        {agent.activeAlerts > 0 && (
                          <span style={{
                            fontSize: "10px", padding: "1px 6px", borderRadius: "10px",
                            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                            color: "#ef4444",
                          }}>
                            {agent.activeAlerts} alert{agent.activeAlerts !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                        {agent.id}
                        {agent.jobsCompleted !== undefined && ` · ${agent.jobsCompleted} jobs`}
                      </div>
                    </div>

                    {/* Rep score */}
                    <div style={{ textAlign: "center" }}>
                      {agent.reputationScore !== undefined ? (
                        <span style={{ fontSize: "20px", fontWeight: "700", fontFamily: "monospace", color: repColor }}>
                          {agent.reputationScore}
                        </span>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>—</span>
                      )}
                    </div>

                    {/* Total actions */}
                    <div style={{ textAlign: "center", fontSize: "14px", fontFamily: "monospace", color: "#10b981" }}>
                      {agent.totalActions.toLocaleString()}
                    </div>

                    {/* Blocked */}
                    <div style={{ textAlign: "center", fontSize: "14px", fontFamily: "monospace", color: agent.blockedActions > 0 ? "#ef4444" : "var(--text-tertiary)" }}>
                      {agent.blockedActions > 0 ? agent.blockedActions : "—"}
                    </div>

                    {/* Earned */}
                    <div style={{ textAlign: "center", fontSize: "13px", fontFamily: "monospace", color: "#f59e0b" }}>
                      {(agent.totalEarned || 0) > 0 ? `${agent.totalEarned.toFixed(4)} ℏ` : "—"}
                    </div>

                    {/* HCS link */}
                    <div style={{ textAlign: "center" }}>
                      {agent.hcs_topic_id ? (
                        <a
                          href={agent.hashScanUrl || "#"}
                          target="_blank" rel="noopener"
                          style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}
                        >
                          {agent.hcs_topic_id.split(".").pop()} ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--text-tertiary)", textAlign: "center" }}>
          Reputation scores read live from{" "}
          <a href={`https://hashscan.io/testnet/contract/${IDENTITY_ADDRESS}`} target="_blank" rel="noopener" style={{ color: "#10b981" }}>
            AgentIdentity ({IDENTITY_ADDRESS.slice(0, 10)}...)
          </a>{" "}
          on Hedera testnet via ERC-8004.
        </div>
      </div>
    </>
  );
}
