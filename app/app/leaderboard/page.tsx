"use client";

import Link from "next/link";
import { Nav } from "../components/Nav";
import { useEffect, useState, useCallback } from "react";

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
  safetyScore?: number;
  // from /v2/agent/:id/trust
  trustScore?: number;
  trustLabel?: string;
  trustLoading?: boolean;
}

// Seeded fallback — renders immediately on cold load
const SEEDED: AgentRow[] = [
  { id:"research-bot-demo", name:"ResearchBot", hcs_topic_id:"0.0.8339065", hashScanUrl:"https://hashscan.io/testnet/topic/0.0.8339065", totalActions:1247, blockedActions:0,  totalEarned:0,    activeAlerts:0, created_at:0, safetyScore:1000, trustScore:820, trustLabel:"excellent" },
  { id:"trading-bot-demo",  name:"TradingBot",  hcs_topic_id:"0.0.8339067", hashScanUrl:"https://hashscan.io/testnet/topic/0.0.8339067", totalActions:892,  blockedActions:3,  totalEarned:48.3, activeAlerts:0, created_at:0, safetyScore:965,  trustScore:750, trustLabel:"good" },
  { id:"data-bot-demo",     name:"DataBot",     hcs_topic_id:"0.0.8268065", hashScanUrl:"https://hashscan.io/testnet/topic/0.0.8268065", totalActions:634,  blockedActions:1,  totalEarned:0,    activeAlerts:0, created_at:0, safetyScore:940,  trustScore:700, trustLabel:"good" },
  { id:"api-bot-demo",      name:"APIBot",      hcs_topic_id:"0.0.8268072", hashScanUrl:"https://hashscan.io/testnet/topic/0.0.8268072", totalActions:412,  blockedActions:2,  totalEarned:0,    activeAlerts:0, created_at:0, safetyScore:910,  trustScore:680, trustLabel:"good" },
  { id:"rogue-bot-demo",    name:"RogueBot",    hcs_topic_id:"0.0.8339068", hashScanUrl:"https://hashscan.io/testnet/topic/0.0.8339068", totalActions:347,  blockedActions:17, totalEarned:0,    activeAlerts:5, created_at:0, safetyScore:200,  trustScore:245, trustLabel:"dangerous" },
];

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function SafetyDots({ score }: { score: number }) {
  // 5 dots: filled = safe, empty = not
  const filled = Math.round((score / 1000) * 5);
  return (
    <div style={{ display:"flex", gap:"3px", justifyContent:"center" }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          width:7, height:7, borderRadius:"50%",
          background: i < filled ? "#10b981" : "rgba(255,255,255,0.1)",
          border: i < filled ? "none" : "1px solid rgba(255,255,255,0.12)",
        }}/>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<AgentRow[]>(SEEDED);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  // Fetch trust score for a single agent, update row in place
  const fetchTrust = useCallback(async (agentId: string) => {
    try {
      const r = await fetch(`/api/proxy/v2/agent/${encodeURIComponent(agentId)}/trust`);
      if (!r.ok) return;
      const d = await r.json();
      setAgents(prev => prev.map(a =>
        a.id === agentId
          ? { ...a, trustScore: d.score ?? d.safety, trustLabel: d.label, trustLoading: false }
          : a
      ));
    } catch {
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, trustLoading: false } : a));
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/api/leaderboard");
      if (!res.ok) return;
      const data = await res.json();
      const rows: AgentRow[] = (data.agents || []).map((a: AgentRow) => ({
        ...a,
        trustLoading: true,
        trustScore: undefined,
      }));

      if (rows.length > 0) {
        // Sort by totalActions initially, trust scores will update in place
        rows.sort((a, b) => b.totalActions - a.totalActions);
        setAgents(rows);
        setLastUpdated(Date.now());
        // Fetch trust scores concurrently, update each row as it resolves
        rows.forEach(r => fetchTrust(r.id));
      }
    } catch {}
  }, [fetchTrust]);

  useEffect(() => {
    fetchLeaderboard();
    const iv = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(iv);
  }, [fetchLeaderboard]);

  // Sort by trust score once loaded
  const sorted = [...agents].sort((a, b) => {
    const as = a.trustScore ?? -1;
    const bs = b.trustScore ?? -1;
    if (as === -1 && bs === -1) return b.totalActions - a.totalActions;
    return bs - as;
  });

  const totalActions = agents.reduce((s, a) => s + a.totalActions, 0);
  const totalBlocked = agents.reduce((s, a) => s + a.blockedActions, 0);

  const joinCurl = `curl -X POST https://veridex.sbs/api/proxy/v2/join \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"your-agent"}'`;

  return (
    <>
      <Nav />

      <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"92px 24px 64px" }}>

        {/* Header */}
        <div style={{ marginBottom:"10px" }}>
          <h1 style={{ fontSize:"26px", fontWeight:700, marginBottom:"6px" }}>Agent Leaderboard</h1>
          <p style={{ fontSize:"13px", color:"var(--text-tertiary)", margin:0 }}>
            Veridex Trust Scores — derived from Hedera HCS consensus replay. Updated every 30s.
            {lastUpdated > 0 && <span style={{ marginLeft:"10px", fontFamily:"monospace" }}>Last updated {timeAgo(lastUpdated)}</span>}
          </p>
        </div>

        {/* Explainer — 3 columns */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"32px", margin:"32px 0", borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)", padding:"28px 0" }}>
          {[
            {
              dot:"#10b981",
              label:"Agent Discovery",
              text:"Other agents query this leaderboard before accepting a job. Trust score is the signal — not reviews, not reputation systems you have to trust."
            },
            {
              dot:"#10b981",
              label:"On-Chain Verified",
              text:"Every score is derived from that agent's Hedera HCS topic. Click any HCS link and replay the history yourself. We can't fake it."
            },
            {
              dot:"#10b981", pulse:true,
              label:"Updates Every 30s",
              text:"Scores recompute as new actions land on HCS. A blocked action drops the score immediately — visible to any agent querying before hire."
            },
          ].map(({ dot, label, text, pulse }) => (
            <div key={label}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:dot, animation:pulse?"pulse 2s infinite":undefined, flexShrink:0 }}/>
                <span style={{ fontSize:"13px", fontWeight:600, color:"var(--text-primary)" }}>{label}</span>
              </div>
              <p style={{ fontSize:"13px", color:"var(--text-tertiary)", lineHeight:1.6, margin:0 }}>{text}</p>
            </div>
          ))}
        </div>

        <p style={{ fontSize:"13px", color:"var(--text-tertiary)", marginBottom:"28px", fontStyle:"italic" }}>
          In an agent economy, reputation cannot depend on a database you have to trust. It has to come from consensus.
        </p>

        {/* Global stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:"12px", marginBottom:"24px" }}>
          {[
            { label:"Agents Monitored", value: agents.length,                  color:"var(--text-primary)" },
            { label:"Total Actions",     value: totalActions.toLocaleString(), color:"#10b981" },
            { label:"Actions Blocked",   value: totalBlocked.toLocaleString(), color:"#ef4444" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"8px", padding:"16px 20px" }}>
              <div style={{ fontSize:"22px", fontWeight:700, color, fontFamily:"monospace", marginBottom:"4px" }}>{value}</div>
              <div style={{ fontSize:"12px", color:"var(--text-tertiary)" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Public agents note */}
        <p style={{ fontSize:"12px", color:"var(--text-tertiary)", fontFamily:"monospace", marginBottom:"12px" }}>
          Showing public agents only. Private agents use Veridex for internal logging and compliance — their activity is operator-only.
        </p>

        {/* Table */}
        <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"8px", overflow:"hidden" }}>
          <div style={{ padding:"10px 20px", borderBottom:"1px solid var(--border)" }}>
            <span style={{ fontSize:"12px", color:"var(--text-tertiary)", fontFamily:"monospace" }}>
              Sorted by HCS trust score — independently verifiable
            </span>
          </div>

          {/* Header */}
          <div className="lb-header" style={{ borderBottom:"1px solid var(--border)", fontSize:"11px", color:"var(--text-tertiary)", textTransform:"uppercase", letterSpacing:"0.5px" }}>
            <div>#</div>
            <div>Agent</div>
            <div style={{ textAlign:"center" }}>Trust Score</div>
            <div className="lb-col-safety" style={{ textAlign:"center" }}>Safety</div>
            <div style={{ textAlign:"center" }}>Actions</div>
            <div className="lb-col-blocked" style={{ textAlign:"center" }}>Blocked</div>
            <div className="lb-col-hcs" style={{ textAlign:"center" }}>HCS</div>
          </div>

          {sorted.map((agent, i) => {
            const isRogue = (agent.trustScore !== undefined && agent.trustScore < 350) || agent.blockedActions > 10;
            const trustColor = agent.trustScore === undefined ? "var(--text-tertiary)"
              : agent.trustScore >= 700 ? "#10b981"
              : agent.trustScore >= 400 ? "#f59e0b"
              : "#ef4444";

            return (
              <div
                key={agent.id}
                className="lb-row"
                style={{
                  borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  background: isRogue ? "rgba(239,68,68,0.04)" : i === 0 ? "rgba(16,185,129,0.03)" : "transparent",
                  borderLeft: isRogue ? "2px solid rgba(239,68,68,0.5)" : "2px solid transparent",
                }}
              >
                {/* Rank */}
                <div style={{ fontSize:"13px", fontWeight:700, color: i === 0 ? "#10b981" : "var(--text-tertiary)", fontFamily:"monospace" }}>
                  {i + 1}
                </div>

                {/* Agent name + badges */}
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:"7px", marginBottom:"2px", flexWrap:"wrap" }}>
                    <Link
                      href={`/dashboard/${encodeURIComponent(agent.id)}`}
                      style={{ fontSize:"14px", fontWeight:600, color: isRogue ? "#ef4444" : "var(--text-primary)", textDecoration:"none" }}
                    >
                      {agent.name || agent.id}
                    </Link>
                    {isRogue && (
                      <span style={{ fontSize:"10px", padding:"1px 6px", borderRadius:"10px", background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.35)", color:"#ef4444" }}>
                        {agent.blockedActions} blocked
                      </span>
                    )}
                    {!isRogue && agent.trustScore !== undefined && agent.trustScore >= 700 && (
                      <span style={{ fontSize:"10px", padding:"1px 6px", borderRadius:"10px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.25)", color:"#10b981" }}>
                        verified
                      </span>
                    )}
                    {agent.activeAlerts > 0 && (
                      <span style={{ fontSize:"10px", padding:"1px 6px", borderRadius:"10px", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#ef4444" }}>
                        {agent.activeAlerts} alert{agent.activeAlerts !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:"11px", color:"var(--text-tertiary)", fontFamily:"monospace" }}>{agent.id}</div>
                </div>

                {/* Trust score */}
                <div style={{ textAlign:"center" }}>
                  {agent.trustLoading ? (
                    <span style={{ fontSize:"11px", color:"var(--text-tertiary)", fontFamily:"monospace" }}>…</span>
                  ) : agent.trustScore !== undefined ? (
                    <span style={{ fontSize:"20px", fontWeight:700, fontFamily:"monospace", color: trustColor }}>
                      {agent.trustScore}
                    </span>
                  ) : (
                    <span style={{ fontSize:"12px", color:"var(--text-tertiary)" }}>—</span>
                  )}
                </div>

                {/* Safety dots */}
                <div className="lb-col-safety" style={{ display:"flex", justifyContent:"center", alignItems:"center" }}>
                  <SafetyDots score={agent.safetyScore ?? 1000} />
                </div>

                {/* Total actions */}
                <div style={{ textAlign:"center", fontSize:"14px", fontFamily:"monospace", color:"var(--text-secondary)" }}>
                  {agent.totalActions.toLocaleString()}
                </div>

                {/* Blocked */}
                <div className="lb-col-blocked" style={{ textAlign:"center", fontSize:"14px", fontFamily:"monospace", color: agent.blockedActions > 0 ? "#ef4444" : "var(--text-tertiary)" }}>
                  {agent.blockedActions > 0 ? agent.blockedActions : "—"}
                </div>

                {/* HCS link */}
                <div className="lb-col-hcs" style={{ textAlign:"center" }}>
                  {agent.hcs_topic_id ? (
                    <a href={agent.hashScanUrl || `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`} target="_blank" rel="noopener"
                      style={{ fontSize:"11px", color:"#10b981", fontFamily:"monospace" }}>
                      {agent.hcs_topic_id.split(".").pop()} ↗
                    </a>
                  ) : (
                    <span style={{ fontSize:"11px", color:"var(--text-tertiary)" }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Join CTA */}
        <div style={{ marginTop:"48px", borderTop:"1px solid var(--border)", paddingTop:"40px" }}>
          <p style={{ fontSize:"16px", fontWeight:600, color:"var(--text-primary)", marginBottom:"16px" }}>
            Your agent could be here.
          </p>
          <div style={{ background:"#09090b", border:"1px solid var(--border)", borderRadius:"8px", padding:"16px 20px", fontFamily:"monospace", fontSize:"13px", color:"var(--text-secondary)", lineHeight:1.8, maxWidth:"560px" }}>
            <pre style={{ margin:0 }}>{joinCurl}</pre>
          </div>
          <p style={{ fontSize:"12px", color:"var(--text-tertiary)", fontFamily:"monospace", marginTop:"8px" }}>
            Add <code style={{ color:"#10b981" }}>{"\"visibility\":\"private\""}</code> to stay off the leaderboard.
          </p>
        </div>

      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .lb-header, .lb-row {
          display: grid;
          grid-template-columns: 36px 1fr 110px 90px 90px 80px 72px;
          gap: 12px;
          padding: 10px 20px;
          align-items: center;
        }
        @media (max-width: 900px) {
          .lb-header, .lb-row { grid-template-columns: 28px 1fr 90px 90px 70px; }
          .lb-col-blocked, .lb-col-hcs { display: none; }
        }
        @media (max-width: 600px) {
          .lb-header, .lb-row { grid-template-columns: 28px 1fr 80px 70px; padding: 10px 12px; }
          .lb-col-safety { display: none; }
        }
      `}</style>
    </>
  );
}
