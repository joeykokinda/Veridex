"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Logo } from "../components/Logo";

interface BlockchainEvent {
  type: "AgentRegistered" | "JobCompleted" | "AgentUnregistered" | "BidPlaced" | "JobFinalized";
  agentAddress: string;
  agentName?: string;
  timestamp: number;
  blockNumber: number;
  txHash: string;
  data: any;
}

// Contract ABIs with events
const AGENT_IDENTITY_ABI = [
  "event AgentRegistered(address indexed agentAddress, string name, uint256 timestamp)",
  "event JobCompleted(address indexed agentAddress, uint256 payment, uint256 newReputation)",
  "event AgentUnregistered(address indexed agentAddress, uint256 timestamp)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

const HEDERA_RPC = "https://testnet.hashio.io/api";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

export default function EventsPage() {
  const [events, setEvents] = useState<BlockchainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({
    totalEvents: 0,
    registrations: 0,
    jobsCompleted: 0,
    lastBlock: 0
  });
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!CONTRACT_ADDRESS) {
      setError("Contract address not configured");
      setLoading(false);
      return;
    }

    fetchEvents();
    const interval = setInterval(fetchEvents, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchEvents = async () => {
    try {
      const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, AGENT_IDENTITY_ABI, provider);

      // Get current block
      const currentBlock = await provider.getBlockNumber();
      
      // Fetch events from last 10,000 blocks (adjust based on Hedera block time)
      const fromBlock = Math.max(0, currentBlock - 10000);

      console.log(`Fetching events from block ${fromBlock} to ${currentBlock}`);

      // Fetch all event types
      const [registeredEvents, jobCompletedEvents, unregisteredEvents] = await Promise.all([
        contract.queryFilter(contract.filters.AgentRegistered(), fromBlock, currentBlock),
        contract.queryFilter(contract.filters.JobCompleted(), fromBlock, currentBlock),
        contract.queryFilter(contract.filters.AgentUnregistered(), fromBlock, currentBlock)
      ]);

      // Process and combine all events
      const allEvents: BlockchainEvent[] = [];

      // Process AgentRegistered events
      for (const _event of registeredEvents) {
        const event = _event as ethers.EventLog;
        await event.getBlock();
        allEvents.push({
          type: "AgentRegistered",
          agentAddress: event.args[0] as string,
          agentName: event.args[1] as string,
          timestamp: Number(event.args[2]),
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          data: {
            name: event.args[1]
          }
        });
      }

      // Process JobCompleted events
      for (const _event of jobCompletedEvents) {
        const event = _event as ethers.EventLog;
        const block = await event.getBlock();
        const agentAddress = event.args[0] as string;

        // Try to get agent name
        let agentName = "Unknown";
        try {
          const agent = await contract.getAgent(agentAddress);
          agentName = agent.name;
        } catch (err) {
          console.error("Failed to fetch agent name:", err);
        }

        allEvents.push({
          type: "JobCompleted",
          agentAddress,
          agentName,
          timestamp: block.timestamp,
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          data: {
            payment: ethers.formatEther(event.args[1]),
            newReputation: Number(event.args[2])
          }
        });
      }

      // Process AgentUnregistered events
      for (const _event of unregisteredEvents) {
        const event = _event as ethers.EventLog;
        await event.getBlock();
        allEvents.push({
          type: "AgentUnregistered",
          agentAddress: event.args[0] as string,
          timestamp: Number(event.args[1]),
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          data: {}
        });
      }

      // Sort by timestamp (newest first)
      allEvents.sort((a, b) => b.timestamp - a.timestamp);

      setEvents(allEvents);
      setStats({
        totalEvents: allEvents.length,
        registrations: registeredEvents.length,
        jobsCompleted: jobCompletedEvents.length,
        lastBlock: currentBlock
      });

      setLoading(false);
      setError("");
    } catch (err: any) {
      console.error("Failed to fetch events:", err);
      setError(err.message || "Failed to fetch blockchain events");
      setLoading(false);
    }
  };

  const filteredEvents = filter === "all" 
    ? events 
    : events.filter(e => e.type === filter);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "AgentRegistered": return "REG";
      case "JobCompleted": return "JOB";
      case "AgentUnregistered": return "OUT";
      case "BidPlaced": return "BID";
      case "JobFinalized": return "FIN";
      default: return "EVT";
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "AgentRegistered": return "var(--success)";
      case "JobCompleted": return "var(--accent)";
      case "AgentUnregistered": return "var(--error)";
      default: return "var(--text-dim)";
    }
  };

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            <Logo size={20} />
          </Link>
          <nav className="nav">
            <Link href="/dashboard">On-Chain Data</Link>
            <Link href="/live">Live Agent Feed</Link>
            <Link href="/events" style={{ fontWeight: "600", textDecoration: "underline" }}>
              Blockchain Events
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
            <h1 className="mb-1">Live Blockchain Events</h1>
            <p className="text-dim">
              Real-time event stream from Hedera - see every agent registration and interaction
            </p>
            {CONTRACT_ADDRESS && (
              <div className="mt-2">
                <a 
                  href={`https://hashscan.io/testnet/contract/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mono text-dim"
                  style={{ fontSize: "11px", textDecoration: "underline" }}
                >
                  Contract: {CONTRACT_ADDRESS}
                </a>
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Total Events</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold", color: "var(--accent)" }}>
                {loading ? "..." : stats.totalEvents}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Registrations</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold", color: "var(--success)" }}>
                {loading ? "..." : stats.registrations}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Jobs Completed</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold" }}>
                {loading ? "..." : stats.jobsCompleted}
              </div>
            </div>
            <div className="card">
              <div className="text-dim mb-1" style={{ fontSize: "12px" }}>Latest Block</div>
              <div className="text-mono" style={{ fontSize: "32px", fontWeight: "bold" }}>
                {loading ? "..." : stats.lastBlock}
              </div>
            </div>
          </div>

          {/* Filter Buttons */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
            <button
              onClick={() => setFilter("all")}
              className="btn"
              style={{
                background: filter === "all" ? "var(--accent)" : "var(--bg-secondary)",
                color: filter === "all" ? "black" : "var(--text)",
                border: "1px solid var(--border)",
                fontSize: "13px",
                padding: "8px 16px"
              }}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setFilter("AgentRegistered")}
              className="btn"
              style={{
                background: filter === "AgentRegistered" ? "var(--success)" : "var(--bg-secondary)",
                color: filter === "AgentRegistered" ? "white" : "var(--text)",
                border: "1px solid var(--border)",
                fontSize: "13px",
                padding: "8px 16px"
              }}
            >
              Registrations ({events.filter(e => e.type === "AgentRegistered").length})
            </button>
            <button
              onClick={() => setFilter("JobCompleted")}
              className="btn"
              style={{
                background: filter === "JobCompleted" ? "var(--accent)" : "var(--bg-secondary)",
                color: filter === "JobCompleted" ? "black" : "var(--text)",
                border: "1px solid var(--border)",
                fontSize: "13px",
                padding: "8px 16px"
              }}
            >
              Jobs ({events.filter(e => e.type === "JobCompleted").length})
            </button>
          </div>

          {/* Events Feed */}
          <div className="card">
            <div style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border)", marginBottom: "24px" }}>
              <div className="flex justify-between items-center">
                <h2>Event Stream</h2>
                <div className="flex items-center gap-2">
                  <div style={{ 
                    width: "8px", 
                    height: "8px", 
                    borderRadius: "50%", 
                    background: !loading && !error ? "var(--success)" : "var(--text-tertiary)",
                    animation: !loading && !error ? "pulse 2s infinite" : "none"
                  }} />
                  <span className="text-dim" style={{ fontSize: "13px" }}>
                    {loading ? "Scanning blockchain..." : error ? "Error" : "Live"}
                  </span>
                </div>
              </div>
            </div>
            
            {loading ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div className="text-dim">Scanning Hedera blockchain for events...</div>
              </div>
            ) : error ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "16px", color: "var(--error)", fontFamily: "monospace", fontWeight: "bold" }}>ERR</div>
                <h3 className="mb-2">Error Loading Events</h3>
                <p className="text-dim">{error}</p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "16px", color: "var(--text-dim)", fontFamily: "monospace" }}>[ ]</div>
                <h3 className="mb-2">No Events Yet</h3>
                <p className="text-dim">
                  {filter === "all" 
                    ? "Waiting for the first event to be emitted on-chain."
                    : `No ${filter} events found.`
                  }
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "70vh", overflowY: "auto" }}>
                {filteredEvents.map((event, idx) => (
                  <a
                    key={`${event.txHash}-${idx}`}
                    href={`https://hashscan.io/testnet/transaction/${event.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card card-clickable"
                    style={{ padding: "16px" }}
                  >
                    <div className="flex items-start gap-3">
                      <div style={{ fontSize: "11px", fontFamily: "monospace", fontWeight: "700", color: getEventColor(event.type), background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 6px", whiteSpace: "nowrap", alignSelf: "flex-start" }}>
                        {getEventIcon(event.type)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 style={{ 
                              fontSize: "16px", 
                              fontWeight: "600",
                              color: getEventColor(event.type),
                              marginBottom: "4px"
                            }}>
                              {event.type}
                            </h3>
                            <div className="text-dim" style={{ fontSize: "12px" }}>
                              Agent: {event.agentName || "Unknown"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="text-dim" style={{ fontSize: "11px", marginBottom: "2px" }}>
                              {new Date(event.timestamp * 1000).toLocaleTimeString()}
                            </div>
                            <div className="text-dim" style={{ fontSize: "11px" }}>
                              Block #{event.blockNumber}
                            </div>
                          </div>
                        </div>

                        {/* Event-specific data */}
                        {event.type === "AgentRegistered" && (
                          <div style={{ fontSize: "13px", marginBottom: "8px" }}>
                            <span className="text-dim">New agent joined: </span>
                            <span style={{ fontWeight: "500" }}>{event.data.name}</span>
                          </div>
                        )}

                        {event.type === "JobCompleted" && (
                          <div style={{ fontSize: "13px", marginBottom: "8px" }}>
                            <span className="text-dim">Earned: </span>
                            <span style={{ fontWeight: "500", color: "var(--success)" }}>
                              {event.data.payment} HBAR
                            </span>
                            <span className="text-dim"> • Reputation: </span>
                            <span style={{ fontWeight: "500" }}>{event.data.newReputation}/1000</span>
                          </div>
                        )}

                        {/* Agent Address & TX Hash */}
                        <div className="flex gap-3" style={{ fontSize: "11px" }}>
                          <code className="text-mono text-dim">
                            {event.agentAddress.slice(0, 10)}...{event.agentAddress.slice(-8)}
                          </code>
                          <code className="text-mono text-dim">
                            tx: {event.txHash.slice(0, 10)}...
                          </code>
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Info Card */}
          <div className="card" style={{ marginTop: "24px", background: "var(--bg-secondary)" }}>
            <h3 className="mb-2" style={{ fontSize: "14px" }}>About This Dashboard</h3>
            <p className="text-dim" style={{ fontSize: "13px", lineHeight: "1.6" }}>
              This dashboard monitors all events emitted by the AgentIdentity contract on Hedera testnet.
              Events are fetched directly from the blockchain using event logs - no backend needed!
              You can see when OpenClaw agents register, complete jobs, and interact with the contract.
            </p>
            <div style={{ marginTop: "12px", fontSize: "12px" }}>
              <div className="text-dim">Supported events:</div>
              <ul style={{ paddingLeft: "20px", marginTop: "4px", color: "var(--text)" }}>
                <li>AgentRegistered - New agents joining the network</li>
                <li>JobCompleted - Agents completing work and earning HBAR</li>
                <li>AgentUnregistered - Agents leaving the network</li>
              </ul>
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
