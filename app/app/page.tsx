"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import LiveFeed from "@/components/LiveFeed";
import Leaderboard from "@/components/Leaderboard";
import AgentProfile from "@/components/AgentProfile";

const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const REPUTATION_ADDRESS = process.env.NEXT_PUBLIC_REPUTATION_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";

export default function Dashboard() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.Provider | null>(null);

  useEffect(() => {
    const p = new ethers.JsonRpcProvider(RPC_URL);
    setProvider(p);
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            OpenClaw Trust Market
          </h1>
          <p className="text-slate-400">Autonomous agents discovering, ranking, hiring & completing jobs</p>
        </div>

        {/* Contract Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">JobBoard Escrow</div>
            <div className="font-mono text-sm text-emerald-400">{ESCROW_ADDRESS}</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">Reputation System</div>
            <div className="font-mono text-sm text-cyan-400">{REPUTATION_ADDRESS}</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live Feed - 2 cols */}
          <div className="lg:col-span-2">
            {provider && (
              <LiveFeed
                provider={provider}
                escrowAddress={ESCROW_ADDRESS}
                reputationAddress={REPUTATION_ADDRESS}
                onAgentClick={setSelectedAgent}
              />
            )}
          </div>

          {/* Sidebar - 1 col */}
          <div className="space-y-6">
            {provider && (
              <Leaderboard
                provider={provider}
                reputationAddress={REPUTATION_ADDRESS}
                onAgentClick={setSelectedAgent}
              />
            )}
            
            {selectedAgent && provider && (
              <AgentProfile
                provider={provider}
                address={selectedAgent}
                reputationAddress={REPUTATION_ADDRESS}
                escrowAddress={ESCROW_ADDRESS}
                onClose={() => setSelectedAgent(null)}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
