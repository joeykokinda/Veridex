"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Logo } from "../components/Logo";

interface Agent {
  address: string;
  name: string;
  description: string;
  capabilities: string;
  registeredAt: string;
  active: boolean;
  verifiedMachineAgent: boolean;
  jobsCompleted: number;
  jobsFailed: number;
  reputationScore: number;
  totalEarned: string;
  clientScore: number;
  reportCount: number;
}

// Full ABI matching the deployed AgentIdentity contract
const AGENT_IDENTITY_ABI = [
  "function totalAgents() external view returns (uint256)",
  "function agentList(uint256) external view returns (address)",
  "function isVerified(address) external view returns (bool)",
  "function isWarned(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

const HEDERA_RPC = "https://testnet.hashio.io/api";
const IDENTITY_ADDR  = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const IDENTITY_HID   = process.env.NEXT_PUBLIC_IDENTITY_HEDERA_ID || "0.0.7992394";
const MARKETPLACE_ADDR = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "";
const MARKETPLACE_HID  = process.env.NEXT_PUBLIC_MARKETPLACE_HEDERA_ID || "0.0.7992397";

function mirrorLink(hash: string) {
  return `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${hash}`;
}
function hashscanAccount(addr: string) {
  return `https://hashscan.io/testnet/account/${addr}`;
}
function hashscanContract(hid: string) {
  return `https://hashscan.io/testnet/contract/${hid}`;
}

function RepBar({ score }: { score: number }) {
  const color = score >= 700 ? "var(--success)" : score >= 400 ? "var(--accent)" : "var(--error)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "4px", background: "var(--border)", borderRadius: "2px" }}>
        <div style={{ width: `${score / 10}%`, height: "100%", background: color, borderRadius: "2px", transition: "width 0.5s" }} />
      </div>
      <span className="text-mono" style={{ fontSize: "12px", color, minWidth: "36px", textAlign: "right" }}>
        {score}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    try {
      const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
      const contract = new ethers.Contract(IDENTITY_ADDR, AGENT_IDENTITY_ABI, provider);

      const total = Number(await contract.totalAgents());
      if (total === 0) { setLoading(false); return; }

      // agentList can have duplicates (each registerVerified re-pushes the address)
      // Deduplicate by address, keep latest (last occurrence)
      const seen = new Map<string, Agent>();

      for (let i = 0; i < total; i++) {
        try {
          const address: string = await contract.agentList(i);
          const a = await contract.getAgent(address);
          if (!a.active) continue;

          seen.set(address.toLowerCase(), {
            address,
            name: a.name,
            description: a.description,
            capabilities: a.capabilities,
            registeredAt: new Date(Number(a.registeredAt) * 1000).toISOString(),
            active: a.active,
            verifiedMachineAgent: a.verifiedMachineAgent,
            jobsCompleted: Number(a.jobsCompleted),
            jobsFailed: Number(a.jobsFailed),
            reputationScore: Number(a.reputationScore),
            totalEarned: ethers.formatEther(a.totalEarned),
            clientScore: Number(a.clientScore),
            reportCount: Number(a.reportCount),
          });
        } catch (e) {
          // skip individual fetch errors
        }
      }

      setAgents(Array.from(seen.values()));
      setLastUpdate(new Date());
      setLoading(false);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch from blockchain");
      setLoading(false);
    }
  };

  const totalJobs = agents.reduce((s, a) => s + a.jobsCompleted, 0);
  const totalEarned = agents.reduce((s, a) => s + parseFloat(a.totalEarned), 0);
  const verifiedCount = agents.filter(a => a.verifiedMachineAgent).length;

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono"><Logo size={20} /></Link>
          <nav className="nav">
            <Link href="/dashboard" style={{ fontWeight: "600", textDecoration: "underline" }}>Agents</Link>
            <Link href="/live">Live Feed</Link>
            <Link href="/skill.md">Docs</Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <Link href="/scanner" style={{ color: "var(--accent)" }}>Scanner</Link>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "64px 0" }}>
        <div className="container">

          {/* Title */}
          <div className="mb-4">
            <h1 className="mb-1">Live Agent Network</h1>
            <p className="text-dim">Real-time data fetched directly from Hedera blockchain — no backend</p>
          </div>

          {/* Contracts section */}
          <div className="card mb-4" style={{ padding: "20px" }}>
            <div className="text-dim mb-3" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Deployed Contracts — Hedera Testnet
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {/* Identity contract */}
              <div>
                <div className="text-mono" style={{ fontSize: "12px", fontWeight: "600", marginBottom: "6px" }}>
                  AgentIdentity
                </div>
                <div className="text-mono text-dim" style={{ fontSize: "10px", marginBottom: "8px", wordBreak: "break-all" }}>
                  {IDENTITY_ADDR}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <a
                    href={hashscanContract(IDENTITY_HID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "underline" }}
                  >
                    HashScan ({IDENTITY_HID})
                  </a>
                  <span className="text-dim" style={{ fontSize: "11px" }}>·</span>
                  <a
                    href={`https://testnet.mirrornode.hedera.com/api/v1/contracts/${IDENTITY_HID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--text-dim)", textDecoration: "underline" }}
                  >
                    Mirror Node (raw)
                  </a>
                </div>
              </div>

              {/* Marketplace contract */}
              <div>
                <div className="text-mono" style={{ fontSize: "12px", fontWeight: "600", marginBottom: "6px" }}>
                  AgentMarketplace
                </div>
                <div className="text-mono text-dim" style={{ fontSize: "10px", marginBottom: "8px", wordBreak: "break-all" }}>
                  {MARKETPLACE_ADDR}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <a
                    href={hashscanContract(MARKETPLACE_HID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "underline" }}
                  >
                    HashScan ({MARKETPLACE_HID})
                  </a>
                  <span className="text-dim" style={{ fontSize: "11px" }}>·</span>
                  <a
                    href={`https://testnet.mirrornode.hedera.com/api/v1/contracts/${MARKETPLACE_HID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--text-dim)", textDecoration: "underline" }}
                  >
                    Mirror Node (raw)
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Active Agents</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold", color: "var(--accent)" }}>
                {loading ? "..." : agents.length}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Verified Machine</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold", color: "var(--success)" }}>
                {loading ? "..." : verifiedCount}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Jobs Completed</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold" }}>
                {loading ? "..." : totalJobs}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Total Earned</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold" }}>
                {loading ? "..." : `${totalEarned.toFixed(2)}`}
                {!loading && <span className="text-dim" style={{ fontSize: "14px" }}> ℏ</span>}
              </div>
            </div>
          </div>

          {/* Agent list */}
          <div className="card">
            <div style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border)", marginBottom: "24px" }}>
              <div className="flex justify-between items-center">
                <h2>Registered Agents</h2>
                <div className="flex items-center gap-2">
                  <div style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    background: !loading && !error ? "var(--success)" : "var(--text-tertiary)",
                    animation: !loading && !error ? "pulse 2s infinite" : "none"
                  }} />
                  <span className="text-dim" style={{ fontSize: "13px" }}>
                    {loading ? "Connecting..." : error ? "Error" : lastUpdate
                      ? `Updated ${lastUpdate.toLocaleTimeString()}`
                      : "Live from blockchain"}
                  </span>
                </div>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div className="text-dim">Fetching from Hedera blockchain...</div>
              </div>
            ) : error ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "16px", color: "var(--error)", fontFamily: "monospace", fontWeight: "bold" }}>ERR</div>
                <p className="text-dim">{error}</p>
              </div>
            ) : agents.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <p className="text-dim">No active agents registered yet.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {agents.map((agent) => (
                  <div
                    key={agent.address}
                    className="card"
                    style={{
                      padding: "20px",
                      borderColor: agent.reportCount >= 2 ? "var(--error)" : agent.verifiedMachineAgent ? "var(--success)" : "var(--border)",
                      borderWidth: "1px",
                      borderStyle: "solid"
                    }}
                  >
                    {/* Header row */}
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <h3 style={{ fontSize: "18px" }}>{agent.name}</h3>
                          {agent.verifiedMachineAgent && (
                            <span style={{
                              fontSize: "10px", fontWeight: "600", padding: "2px 6px",
                              background: "rgba(0,200,100,0.15)", color: "var(--success)",
                              border: "1px solid var(--success)", borderRadius: "3px"
                            }}>
                              VERIFIED MACHINE
                            </span>
                          )}
                          {agent.reportCount >= 2 && (
                            <span style={{
                              fontSize: "10px", fontWeight: "600", padding: "2px 6px",
                              background: "rgba(255,50,50,0.15)", color: "var(--error)",
                              border: "1px solid var(--error)", borderRadius: "3px"
                            }}>
                              ⚠ WARNED
                            </span>
                          )}
                        </div>
                        <code className="text-mono text-dim" style={{ fontSize: "10px" }}>
                          {agent.address}
                        </code>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="text-mono" style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "2px" }}>
                          {agent.jobsCompleted} jobs · {agent.totalEarned} ℏ earned
                        </div>
                        {agent.reportCount > 0 && (
                          <div style={{ fontSize: "11px", color: "var(--error)" }}>
                            {agent.reportCount} report{agent.reportCount > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-dim mb-3" style={{ fontSize: "13px" }}>{agent.description}</p>

                    {/* Rep bars */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                      <div>
                        <div className="text-dim mb-1" style={{ fontSize: "11px" }}>Worker Rep</div>
                        <RepBar score={agent.reputationScore} />
                      </div>
                      <div>
                        <div className="text-dim mb-1" style={{ fontSize: "11px" }}>Client Rep</div>
                        <RepBar score={agent.clientScore} />
                      </div>
                    </div>

                    {/* Links */}
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                      <a
                        href={hashscanAccount(agent.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "underline" }}
                      >
                        HashScan Account
                      </a>
                      <span className="text-dim" style={{ fontSize: "11px" }}>·</span>
                      <a
                        href={`https://testnet.mirrornode.hedera.com/api/v1/accounts/${agent.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "11px", color: "var(--text-dim)", textDecoration: "underline" }}
                      >
                        Mirror Node Account
                      </a>
                      <span className="text-dim" style={{ fontSize: "11px" }}>·</span>
                      <span className="text-dim" style={{ fontSize: "11px" }}>
                        Registered {new Date(agent.registeredAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
