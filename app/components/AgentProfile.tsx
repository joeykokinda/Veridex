"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const REPUTATION_ABI = [
  "function getScore(address agent) external view returns (uint256 avg, uint256 count)",
];

const ESCROW_ABI = [
  "event JobPosted(uint256 indexed jobId, address indexed requester, uint256 reward, bytes32 detailsHash)",
  "event JobAccepted(uint256 indexed jobId, address indexed agent)",
  "event JobPaid(uint256 indexed jobId, address indexed agent, uint256 reward)",
];

interface JobHistory {
  jobId: number;
  role: "requester" | "worker";
  reward?: string;
  timestamp: number;
  txHash: string;
}

interface Props {
  provider: ethers.Provider;
  address: string;
  reputationAddress: string;
  escrowAddress: string;
  onClose: () => void;
}

export default function AgentProfile({ provider, address, reputationAddress, escrowAddress, onClose }: Props) {
  const [avgRating, setAvgRating] = useState(0);
  const [jobCount, setJobCount] = useState(0);
  const [jobHistory, setJobHistory] = useState<JobHistory[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      try {
        const reputation = new ethers.Contract(reputationAddress, REPUTATION_ABI, provider);
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);

        // Get reputation score
        const [avg, count] = await reputation.getScore(address);
        setAvgRating(Number(avg));
        setJobCount(Number(count));

        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000);

        const history: JobHistory[] = [];
        let earned = 0;

        // Jobs posted (as requester)
        const posted = await escrow.queryFilter(
          escrow.filters.JobPosted(null, address),
          fromBlock,
          currentBlock
        );
        for (const log of posted) {
          const block = await log.getBlock();
          history.push({
            jobId: Number(log.args[0]),
            role: "requester",
            reward: ethers.formatEther(log.args[2]),
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        // Jobs completed (as worker)
        const paid = await escrow.queryFilter(
          escrow.filters.JobPaid(null, address),
          fromBlock,
          currentBlock
        );
        for (const log of paid) {
          const block = await log.getBlock();
          const reward = ethers.formatEther(log.args[2]);
          earned += parseFloat(reward);
          history.push({
            jobId: Number(log.args[0]),
            role: "worker",
            reward,
            timestamp: block.timestamp,
            txHash: log.transactionHash,
          });
        }

        history.sort((a, b) => b.timestamp - a.timestamp);
        setJobHistory(history);
        setTotalEarned(earned);
        setLoading(false);
      } catch (err) {
        console.error("Error loading profile:", err);
        setLoading(false);
      }
    };

    loadProfile();
  }, [provider, address, reputationAddress, escrowAddress]);

  const formatAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString();
  };

  return (
    <div className="bg-slate-800/50 rounded-lg border border-emerald-500 shadow-lg shadow-emerald-500/20">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Agent Profile</h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-400"></div>
        </div>
      ) : (
        <div className="p-6 space-y-4">
          {/* Address */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Address</div>
            <div className="font-mono text-sm text-emerald-400 break-all">{address}</div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">Trust Score</div>
              <div className="text-lg font-semibold text-white">
                ⭐ {avgRating.toFixed(1)}/10.0
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">Jobs Rated</div>
              <div className="text-lg font-semibold text-white">{jobCount}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">Total Earned</div>
              <div className="text-lg font-semibold text-emerald-400">
                {totalEarned.toFixed(4)} ETH
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">Activity</div>
              <div className="text-lg font-semibold text-white">{jobHistory.length}</div>
            </div>
          </div>

          {/* Job History */}
          <div>
            <div className="text-sm font-semibold text-white mb-2">Recent Activity</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {jobHistory.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-4">No activity yet</div>
              ) : (
                jobHistory.map((job, idx) => (
                  <div
                    key={`${job.txHash}-${idx}`}
                    className="bg-slate-900/50 rounded-lg p-3 border border-slate-700 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-semibold">
                        {job.role === "requester" ? "Posted" : "Completed"} Job #{job.jobId}
                      </span>
                      {job.reward && (
                        <span className="text-yellow-400 font-mono">{job.reward} ETH</span>
                      )}
                    </div>
                    <div className="text-slate-500">{formatTimestamp(job.timestamp)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
