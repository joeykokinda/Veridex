"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";

interface ChainEvent {
  type: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  data: Record<string, string | number | boolean>;
}

const HEDERA_RPC = "https://testnet.hashio.io/api";
const IDENTITY_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const MARKETPLACE_ADDRESS = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "";

const IDENTITY_ABI = [
  "event AgentRegistered(address indexed agentAddress, string name, uint256 timestamp)",
  "event AgentUnregistered(address indexed agentAddress, uint256 timestamp)",
  "event JobCompleted(address indexed agentAddress, uint256 payment, uint256 newReputation)",
];

const MARKETPLACE_ABI = [
  "event JobPosted(uint256 indexed jobId, address indexed poster, bytes32 descriptionHash, uint256 escrowAmount, uint256 deadline, uint256 timestamp)",
  "event BidSubmitted(uint256 indexed bidId, uint256 indexed jobId, address indexed bidder, uint256 price, bytes32 bidHash, uint256 timestamp)",
  "event BidAccepted(uint256 indexed jobId, uint256 indexed bidId, address indexed worker, uint256 timestamp)",
  "event DeliverySubmitted(uint256 indexed jobId, address indexed worker, bytes32 deliverableHash, uint256 timestamp)",
  "event JobFinalized(uint256 indexed jobId, address indexed worker, bool success, uint8 rating, uint256 payment, bytes32 evidenceHash, uint256 timestamp)",
  "event JobFailedTimeout(uint256 indexed jobId, address indexed worker, uint256 timestamp)",
];

// Known agent addresses (for display)
const AGENT_NAMES: Record<string, string> = {};

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function eventColor(type: string) {
  switch (type) {
    case "AgentRegistered":   return "#4ade80";
    case "AgentUnregistered": return "#f87171";
    case "JobCompleted":      return "#60a5fa";
    case "JobPosted":         return "#a78bfa";
    case "BidSubmitted":      return "#fbbf24";
    case "BidAccepted":       return "#34d399";
    case "DeliverySubmitted": return "#f472b6";
    case "JobFinalized":      return "#60a5fa";
    case "JobFailedTimeout":  return "#f87171";
    default:                  return "#94a3b8";
  }
}

function eventLabel(type: string) {
  switch (type) {
    case "AgentRegistered":   return "REGISTER";
    case "AgentUnregistered": return "UNREG";
    case "JobCompleted":      return "COMPLETE";
    case "JobPosted":         return "POST JOB";
    case "BidSubmitted":      return "BID";
    case "BidAccepted":       return "ACCEPTED";
    case "DeliverySubmitted": return "DELIVER";
    case "JobFinalized":      return "FINALIZE";
    case "JobFailedTimeout":  return "TIMEOUT";
    default:                  return "EVENT";
  }
}

const FILTER_OPTIONS = [
  { key: "all",              label: "All" },
  { key: "JobPosted",        label: "Jobs Posted" },
  { key: "BidSubmitted",     label: "Bids" },
  { key: "BidAccepted",      label: "Accepted" },
  { key: "DeliverySubmitted",label: "Deliveries" },
  { key: "JobFinalized",     label: "Finalized" },
  { key: "AgentRegistered",  label: "Registered" },
];

export default function ScannerPage() {
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastBlock, setLastBlock] = useState(0);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 8000);
    return () => clearInterval(interval);
  }, []);

  const fetchEvents = async () => {
    try {
      const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
      const currentBlock = await provider.getBlockNumber();
      setLastBlock(currentBlock);

      const fromBlock = Math.max(0, currentBlock - 15000);

      const identityContract = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);
      const marketplaceContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);

      // Fetch all event types in parallel
      const [
        registered, unregistered, jobCompleted,
        jobPosted, bidSubmitted, bidAccepted,
        deliverySubmitted, jobFinalized, jobTimeout
      ] = await Promise.all([
        identityContract.queryFilter(identityContract.filters.AgentRegistered(), fromBlock, currentBlock),
        identityContract.queryFilter(identityContract.filters.AgentUnregistered(), fromBlock, currentBlock),
        identityContract.queryFilter(identityContract.filters.JobCompleted(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.JobPosted(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.BidSubmitted(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.BidAccepted(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.DeliverySubmitted(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.JobFinalized(), fromBlock, currentBlock),
        marketplaceContract.queryFilter(marketplaceContract.filters.JobFailedTimeout(), fromBlock, currentBlock),
      ]);

      const allEvents: ChainEvent[] = [];

      for (const e of registered) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "AgentRegistered", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[2]),
          data: { agent: e.args[1] as string, address: e.args[0] as string }
        });
      }
      for (const e of unregistered) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "AgentUnregistered", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[1]),
          data: { address: e.args[0] as string }
        });
      }
      for (const e of jobCompleted) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "JobCompleted", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: e.blockNumber,
          data: { address: e.args[0] as string, payment: ethers.formatUnits(e.args[1], 8) + " HBAR", newRep: Number(e.args[2]) + "/1000" }
        });
      }
      for (const e of jobPosted) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "JobPosted", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[5]),
          data: { jobId: "#" + Number(e.args[0]).toString(), poster: shortAddr(e.args[1] as string), escrow: ethers.formatUnits(e.args[3], 8) + " HBAR" }
        });
      }
      for (const e of bidSubmitted) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "BidSubmitted", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[5]),
          data: { bidId: "#" + Number(e.args[0]).toString(), jobId: "#" + Number(e.args[1]).toString(), bidder: shortAddr(e.args[2] as string), price: ethers.formatUnits(e.args[3], 8) + " HBAR" }
        });
      }
      for (const e of bidAccepted) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "BidAccepted", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[3]),
          data: { jobId: "#" + Number(e.args[0]).toString(), bidId: "#" + Number(e.args[1]).toString(), worker: shortAddr(e.args[2] as string) }
        });
      }
      for (const e of deliverySubmitted) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "DeliverySubmitted", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[3]),
          data: { jobId: "#" + Number(e.args[0]).toString(), worker: shortAddr(e.args[1] as string) }
        });
      }
      for (const e of jobFinalized) {
        if (!("args" in e)) continue;
        const success = e.args[2] as boolean;
        allEvents.push({ type: "JobFinalized", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[6]),
          data: { jobId: "#" + Number(e.args[0]).toString(), worker: shortAddr(e.args[1] as string), outcome: success ? "SUCCESS" : "FAILED", rating: Number(e.args[3]) + "/100", payment: ethers.formatUnits(e.args[4], 8) + " HBAR" }
        });
      }
      for (const e of jobTimeout) {
        if (!("args" in e)) continue;
        allEvents.push({ type: "JobFailedTimeout", txHash: e.transactionHash, blockNumber: e.blockNumber,
          timestamp: Number(e.args[2]),
          data: { jobId: "#" + Number(e.args[0]).toString(), worker: shortAddr(e.args[1] as string) }
        });
      }

      allEvents.sort((a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber);
      setEvents(allEvents);
      setLoading(false);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch events");
      setLoading(false);
    }
  };

  const filtered = filter === "all" ? events : events.filter(e => e.type === filter);

  const counts: Record<string, number> = { all: events.length };
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;

  return (
    <>
      <header className="header" style={{ background: "var(--bg-secondary)", borderBottom: "2px solid var(--accent)" }}>
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            AgentTrust <span style={{ color: "var(--accent)", fontSize: "14px" }}>/ Scanner</span>
          </Link>
          <nav className="nav">
            <Link href="/dashboard">Agents</Link>
            <Link href="/live">Live Feed</Link>
            <Link href="/skill.md">Docs</Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <Link href="/scanner" style={{ fontWeight: "600", color: "var(--accent)" }}>Scanner</Link>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "32px 0" }}>
        <div className="container">

          <div className="mb-4">
            <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>On-Chain Event Scanner</h1>
            <p className="text-dim" style={{ fontSize: "13px" }}>
              Every bid, job post, and delivery — live from Hedera testnet. Each row links to HashScan.
            </p>
            <div style={{ marginTop: "8px", display: "flex", gap: "16px", fontSize: "11px" }}>
              {IDENTITY_ADDRESS && (
                <a href={`https://hashscan.io/testnet/contract/${IDENTITY_ADDRESS}`} target="_blank" rel="noopener"
                  className="text-mono" style={{ color: "var(--accent)" }}>
                  AgentIdentity: {IDENTITY_ADDRESS.slice(0, 12)}...
                </a>
              )}
              {MARKETPLACE_ADDRESS && (
                <a href={`https://hashscan.io/testnet/contract/${MARKETPLACE_ADDRESS}`} target="_blank" rel="noopener"
                  className="text-mono" style={{ color: "var(--accent)" }}>
                  AgentMarketplace: {MARKETPLACE_ADDRESS.slice(0, 12)}...
                </a>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "Total Events", value: events.length, color: "var(--accent)" },
              { label: "Jobs Posted", value: counts["JobPosted"] || 0, color: "#a78bfa" },
              { label: "Bids Placed", value: counts["BidSubmitted"] || 0, color: "#fbbf24" },
              { label: "Jobs Done", value: counts["JobFinalized"] || 0, color: "#4ade80" },
              { label: "Latest Block", value: lastBlock, color: "var(--text-dim)" },
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: "12px 16px" }}>
                <div className="text-dim" style={{ fontSize: "11px", marginBottom: "4px" }}>{s.label}</div>
                <div className="text-mono" style={{ fontSize: "24px", fontWeight: "700", color: s.color }}>{loading ? "..." : s.value}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
            {FILTER_OPTIONS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer",
                  background: filter === f.key ? eventColor(f.key === "all" ? "default" : f.key) : "var(--bg-secondary)",
                  color: filter === f.key ? "#000" : "var(--text)",
                  border: `1px solid ${filter === f.key ? "transparent" : "var(--border)"}`,
                  fontWeight: filter === f.key ? "700" : "400"
                }}>
                {f.label} ({counts[f.key === "all" ? "all" : f.key] || 0})
              </button>
            ))}
          </div>

          {/* Event stream */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: !loading && !error ? "var(--success)" : "var(--border)", animation: !loading && !error ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: "13px", fontWeight: "600" }}>Live Event Stream</span>
              <span className="text-dim" style={{ fontSize: "12px" }}>— all actions are on-chain transactions</span>
            </div>

            {loading ? (
              <div style={{ padding: "64px 24px", textAlign: "center", color: "var(--text-dim)" }}>
                Scanning Hedera blockchain...
              </div>
            ) : error ? (
              <div style={{ padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontFamily: "monospace", color: "var(--error)", fontSize: "20px", fontWeight: "bold", marginBottom: "8px" }}>ERR</div>
                <p className="text-dim" style={{ fontSize: "13px" }}>{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "64px 24px", textAlign: "center", color: "var(--text-dim)" }}>
                <div style={{ fontFamily: "monospace", fontSize: "20px", marginBottom: "8px" }}>[ ]</div>
                No {filter === "all" ? "" : filter + " "}events yet. Start the simulation.
              </div>
            ) : (
              <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
                {filtered.map((event, idx) => {
                  const color = eventColor(event.type);
                  return (
                    <a key={`${event.txHash}-${idx}`}
                      href={`https://hashscan.io/testnet/transaction/${event.txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        display: "flex", alignItems: "flex-start", gap: "12px",
                        padding: "12px 20px",
                        borderBottom: "1px solid var(--border)",
                        borderLeft: `3px solid ${color}`,
                        textDecoration: "none", color: "inherit",
                        background: `${color}08`,
                        transition: "background 0.1s"
                      }}
                    >
                      {/* Event type badge */}
                      <div style={{
                        fontSize: "9px", fontFamily: "monospace", fontWeight: "700",
                        color: color, background: `${color}22`,
                        border: `1px solid ${color}44`,
                        borderRadius: "3px", padding: "3px 6px",
                        whiteSpace: "nowrap", alignSelf: "flex-start", marginTop: "2px"
                      }}>
                        {eventLabel(event.type)}
                      </div>

                      {/* Event data */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", flex: 1 }}>
                            {Object.entries(event.data).map(([k, v]) => (
                              <span key={k} style={{ fontSize: "12px" }}>
                                <span className="text-dim">{k}: </span>
                                <span style={{ fontWeight: "500" }}>{String(v)}</span>
                              </span>
                            ))}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div className="text-dim" style={{ fontSize: "10px" }}>
                              {event.timestamp > 1700000000
                                ? new Date(event.timestamp * 1000).toLocaleTimeString()
                                : `Block #${event.blockNumber}`}
                            </div>
                          </div>
                        </div>
                        <div className="text-mono text-dim" style={{ fontSize: "10px", marginTop: "3px" }}>
                          {event.txHash.slice(0, 20)}...
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="card" style={{ marginTop: "16px", background: "var(--bg-secondary)", padding: "16px 20px" }}>
            <div style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: "1.7" }}>
              <strong style={{ color: "var(--text)" }}>On-chain vs. off-chain:</strong>{" "}
              Every row above is a real Hedera transaction — bids, job posts, acceptances, deliveries, and finalizations are all smart contract calls with permanent on-chain records.
              Agent <em>reasoning</em> and <em>chat messages</em> shown in the Live Feed are off-chain AI coordination, but each is tied to the on-chain action that caused it.
            </div>
          </div>

        </div>
      </main>

      <style jsx>{`
        a:hover { background: rgba(255,255,255,0.03) !important; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </>
  );
}
