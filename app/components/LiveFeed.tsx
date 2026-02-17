"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const ESCROW_ABI = [
  "event JobPosted(uint256 indexed jobId, address indexed requester, uint256 reward, bytes32 detailsHash)",
  "event JobAccepted(uint256 indexed jobId, address indexed agent)",
  "event JobCompleted(uint256 indexed jobId, bytes32 resultHash)",
  "event JobPaid(uint256 indexed jobId, address indexed agent, uint256 reward)",
];

const REPUTATION_ABI = [
  "event Attested(uint256 indexed jobId, address indexed requester, address indexed agent, uint8 rating, bytes32 detailsHash, uint256 timestamp)",
];

interface FeedEvent {
  id: string;
  type: "posted" | "accepted" | "completed" | "paid" | "attested";
  jobId: number;
  agent?: string;
  requester?: string;
  reward?: string;
  rating?: number;
  timestamp: number;
  txHash: string;
}

interface Props {
  provider: ethers.Provider;
  escrowAddress: string;
  reputationAddress: string;
  onAgentClick: (address: string) => void;
}

export default function LiveFeed({ provider, escrowAddress, reputationAddress, onAgentClick }: Props) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);
    const reputation = new ethers.Contract(reputationAddress, REPUTATION_ABI, provider);

    const loadPastEvents = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks

        const allEvents: FeedEvent[] = [];

        // Job Posted
        const posted = await escrow.queryFilter(escrow.filters.JobPosted(), fromBlock, currentBlock);
        for (const log of posted) {
          if (!("args" in log)) continue;
          const block = await log.getBlock();
          allEvents.push({
            id: `${log.transactionHash}-${log.index}`,
            type: "posted",
            jobId: Number(log.args[0]),
            requester: log.args[1],
            reward: ethers.formatEther(log.args[2]),
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Job Accepted
        const accepted = await escrow.queryFilter(escrow.filters.JobAccepted(), fromBlock, currentBlock);
        for (const log of accepted) {
          if (!("args" in log)) continue;
          const block = await log.getBlock();
          allEvents.push({
            id: `${log.transactionHash}-${log.index}`,
            type: "accepted",
            jobId: Number(log.args[0]),
            agent: log.args[1],
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Job Completed
        const completed = await escrow.queryFilter(escrow.filters.JobCompleted(), fromBlock, currentBlock);
        for (const log of completed) {
          if (!("args" in log)) continue;
          const block = await log.getBlock();
          allEvents.push({
            id: `${log.transactionHash}-${log.index}`,
            type: "completed",
            jobId: Number(log.args[0]),
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Job Paid
        const paid = await escrow.queryFilter(escrow.filters.JobPaid(), fromBlock, currentBlock);
        for (const log of paid) {
          if (!("args" in log)) continue;
          const block = await log.getBlock();
          allEvents.push({
            id: `${log.transactionHash}-${log.index}`,
            type: "paid",
            jobId: Number(log.args[0]),
            agent: log.args[1],
            reward: ethers.formatEther(log.args[2]),
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Attested
        const attested = await reputation.queryFilter(reputation.filters.Attested(), fromBlock, currentBlock);
        for (const log of attested) {
          if (!("args" in log)) continue;
          const block = await log.getBlock();
          allEvents.push({
            id: `${log.transactionHash}-${log.index}`,
            type: "attested",
            jobId: Number(log.args[0]),
            requester: log.args[1],
            agent: log.args[2],
            rating: Number(log.args[3]),
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Sort by timestamp desc
        allEvents.sort((a, b) => b.timestamp - a.timestamp);
        setEvents(allEvents);
        setLoading(false);
      } catch (err) {
        console.error("Error loading events:", err);
        setLoading(false);
      }
    };

    loadPastEvents();

    // Listen for new events
    const handleJobPosted = async (jobId: bigint, requester: string, reward: bigint, detailsHash: string, event: any) => {
      const block = await event.getBlock();
      setEvents((prev) => [
        {
          id: `${event.log.transactionHash}-${event.log.index}`,
          type: "posted",
          jobId: Number(jobId),
          requester,
          reward: ethers.formatEther(reward),
          timestamp: block.timestamp,
          txHash: event.log.transactionHash,
        },
        ...prev,
      ]);
    };

    const handleJobAccepted = async (jobId: bigint, agent: string, event: any) => {
      const block = await event.getBlock();
      setEvents((prev) => [
        {
          id: `${event.log.transactionHash}-${event.log.index}`,
          type: "accepted",
          jobId: Number(jobId),
          agent,
          timestamp: block.timestamp,
          txHash: event.log.transactionHash,
        },
        ...prev,
      ]);
    };

    const handleJobCompleted = async (jobId: bigint, resultHash: string, event: any) => {
      const block = await event.getBlock();
      setEvents((prev) => [
        {
          id: `${event.log.transactionHash}-${event.log.index}`,
          type: "completed",
          jobId: Number(jobId),
          timestamp: block.timestamp,
          txHash: event.log.transactionHash,
        },
        ...prev,
      ]);
    };

    const handleJobPaid = async (jobId: bigint, agent: string, reward: bigint, event: any) => {
      const block = await event.getBlock();
      setEvents((prev) => [
        {
          id: `${event.log.transactionHash}-${event.log.index}`,
          type: "paid",
          jobId: Number(jobId),
          agent,
          reward: ethers.formatEther(reward),
          timestamp: block.timestamp,
          txHash: event.log.transactionHash,
        },
        ...prev,
      ]);
    };

    const handleAttested = async (jobId: bigint, requester: string, agent: string, rating: bigint, detailsHash: string, timestamp: bigint, event: any) => {
      const block = await event.getBlock();
      setEvents((prev) => [
        {
          id: `${event.log.transactionHash}-${event.log.index}`,
          type: "attested",
          jobId: Number(jobId),
          requester,
          agent,
          rating: Number(rating),
          timestamp: block.timestamp,
          txHash: event.log.transactionHash,
        },
        ...prev,
      ]);
    };

    escrow.on("JobPosted", handleJobPosted);
    escrow.on("JobAccepted", handleJobAccepted);
    escrow.on("JobCompleted", handleJobCompleted);
    escrow.on("JobPaid", handleJobPaid);
    reputation.on("Attested", handleAttested);

    return () => {
      escrow.off("JobPosted", handleJobPosted);
      escrow.off("JobAccepted", handleJobAccepted);
      escrow.off("JobCompleted", handleJobCompleted);
      escrow.off("JobPaid", handleJobPaid);
      reputation.off("Attested", handleAttested);
    };
  }, [provider, escrowAddress, reputationAddress]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "posted":
        return "[POST]";
      case "accepted":
        return "[ACCEPT]";
      case "completed":
        return "[DONE]";
      case "paid":
        return "[PAID]";
      case "attested":
        return "[RATE]";
      default:
        return "•";
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "posted":
        return "text-blue-400";
      case "accepted":
        return "text-purple-400";
      case "completed":
        return "text-emerald-400";
      case "paid":
        return "text-yellow-400";
      case "attested":
        return "text-pink-400";
      default:
        return "text-slate-400";
    }
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const renderEventMessage = (event: FeedEvent) => {
    switch (event.type) {
      case "posted":
        return (
          <>
            Agent{" "}
            <button
              onClick={() => onAgentClick(event.requester!)}
              className="font-mono text-emerald-400 hover:underline"
            >
              {formatAddress(event.requester!)}
            </button>{" "}
            posted job #{event.jobId} with reward {event.reward} ETH
          </>
        );
      case "accepted":
        return (
          <>
            Agent{" "}
            <button
              onClick={() => onAgentClick(event.agent!)}
              className="font-mono text-cyan-400 hover:underline"
            >
              {formatAddress(event.agent!)}
            </button>{" "}
            accepted job #{event.jobId}
          </>
        );
      case "completed":
        return <>Job #{event.jobId} marked completed</>;
      case "paid":
        return (
          <>
            Agent{" "}
            <button
              onClick={() => onAgentClick(event.agent!)}
              className="font-mono text-yellow-400 hover:underline"
            >
              {formatAddress(event.agent!)}
            </button>{" "}
            received {event.reward} ETH for job #{event.jobId}
          </>
        );
      case "attested":
        return (
          <>
            Agent{" "}
            <button
              onClick={() => onAgentClick(event.agent!)}
              className="font-mono text-pink-400 hover:underline"
            >
              {formatAddress(event.agent!)}
            </button>{" "}
            rated {event.rating}/10 for job #{event.jobId}
          </>
        );
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg p-8 border border-slate-700">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          <span className="ml-3 text-slate-400">Loading agent activity...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-xl font-semibold text-white">Live Agent Feed</h2>
        <p className="text-sm text-slate-400 mt-1">{events.length} autonomous actions recorded</p>
      </div>
      <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No agent activity yet. Run the simulation to see agents in action.
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id}
              className="bg-slate-900/50 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="text-xs font-mono text-slate-500">{getEventIcon(event.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${getEventColor(event.type)}`}>{renderEventMessage(event)}</div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    <span>{formatTimestamp(event.timestamp)}</span>
                    <a
                      href={`https://hashscan.io/testnet/transaction/${event.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:text-slate-400 transition-colors"
                    >
                      {event.txHash.slice(0, 10)}...
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
