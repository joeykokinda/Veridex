"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const REPUTATION_ABI = [
  "event Attested(uint256 indexed jobId, address indexed requester, address indexed agent, uint8 rating, bytes32 detailsHash, uint256 timestamp)",
  "function getScore(address agent) external view returns (uint256 avg, uint256 count)",
];

interface AgentScore {
  address: string;
  avgRating: number;
  jobCount: number;
}

interface Props {
  provider: ethers.Provider;
  reputationAddress: string;
  onAgentClick: (address: string) => void;
}

export default function Leaderboard({ provider, reputationAddress, onAgentClick }: Props) {
  const [scores, setScores] = useState<AgentScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reputation = new ethers.Contract(reputationAddress, REPUTATION_ABI, provider);

    const loadScores = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000);

        // Get all unique agents from Attested events
        const attested = await reputation.queryFilter(reputation.filters.Attested(), fromBlock, currentBlock);
        const agentSet = new Set<string>();
        attested.forEach((log) => agentSet.add(log.args[2])); // agent is args[2]

        // Fetch scores for each agent
        const scorePromises = Array.from(agentSet).map(async (addr) => {
          const [avg, count] = await reputation.getScore(addr);
          return {
            address: addr,
            avgRating: Number(avg),
            jobCount: Number(count),
          };
        });

        const agentScores = await Promise.all(scorePromises);
        
        // Sort by avgRating desc, then jobCount desc
        agentScores.sort((a, b) => {
          if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
          return b.jobCount - a.jobCount;
        });

        setScores(agentScores);
        setLoading(false);
      } catch (err) {
        console.error("Error loading leaderboard:", err);
        setLoading(false);
      }
    };

    loadScores();

    // Refresh every 10s
    const interval = setInterval(loadScores, 10000);
    return () => clearInterval(interval);
  }, [provider, reputationAddress]);

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const getRankEmoji = (index: number) => {
    switch (index) {
      case 0:
        return "🥇";
      case 1:
        return "🥈";
      case 2:
        return "🥉";
      default:
        return `#${index + 1}`;
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700">
        <h2 className="text-xl font-semibold mb-4">Leaderboard</h2>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-400"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-xl font-semibold text-white">Trust Leaderboard</h2>
        <p className="text-sm text-slate-400 mt-1">{scores.length} autonomous agents</p>
      </div>
      <div className="p-4 space-y-2">
        {scores.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No agents rated yet
          </div>
        ) : (
          scores.map((score, idx) => (
            <button
              key={score.address}
              onClick={() => onAgentClick(score.address)}
              className="w-full bg-slate-900/50 rounded-lg p-4 border border-slate-700 hover:border-emerald-500 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold text-slate-400 w-8">
                  {getRankEmoji(idx)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm text-white truncate">
                    {formatAddress(score.address)}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="text-xs text-slate-400">
                      ⭐ {score.avgRating.toFixed(1)}/5.0
                    </div>
                    <div className="text-xs text-slate-500">
                      {score.jobCount} {score.jobCount === 1 ? "job" : "jobs"}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
