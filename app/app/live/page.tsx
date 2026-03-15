"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Logo } from "../components/Logo";

interface Activity {
  type: "reasoning" | "action" | "message" | "registered" | "unregistered" | "delivery" | "client_rating" | "report";
  agent: string;
  to?: string;
  content?: string;
  action?: string;
  jobId?: string;
  description?: string;
  price?: string;
  payment?: string;
  worker?: string;
  repBefore?: number;
  txHash?: string;
  txLink?: string;
  timestamp: number;
  success?: boolean;
  rating?: number;
  rawRating?: number;
  credibilityMultiplier?: string;
  jobType?: string;
  bidId?: string;
  clientName?: string;
  targetName?: string;
  reason?: string;
}

interface AgentInfo {
  name: string;
  address: string;
  mode: string;
  reputation: number;
  clientScore: number;
  jobsCompleted: number;
  jobsFailed: number;
  totalEarned: string;
  registered: boolean;
  balance?: string;
  warned?: boolean;
}

interface SimStatus {
  running: boolean;
  pendingAction?: string | null;
  uptime?: string;
  lastTick?: string;
  agents?: number;
}

interface JobBid {
  agent: string;
  price: string;
  txHash?: string;
  txLink?: string;
}

interface JobState {
  jobId: string;
  description: string;
  poster: string;
  escrow: string;
  status: "open" | "assigned" | "delivered" | "complete" | "failed";
  bids: JobBid[];
  winner?: string;
  deliverable?: string;
  rating?: number;
  payment?: string;
  postedAt: number;
  posterTxHash?: string;
  posterTxLink?: string;
  finalTxHash?: string;
  finalTxLink?: string;
}

const ACTIVITY_API = process.env.NEXT_PUBLIC_ACTIVITY_API || "http://localhost:3001";

const AGENT_COLORS: Record<string, string> = {
  albert: "#60a5fa",
  eli:    "#4ade80",
  gt:     "#f472b6",
  joey:   "#f87171",
};

const AGENT_ROLES: Record<string, string> = {
  albert: "Poet",
  eli:    "ASCII Artist",
  gt:     "Content Creator",
  joey:   "Scammer",
};

function agentColor(name: string) {
  return AGENT_COLORS[name?.toLowerCase()] || "#94a3b8";
}

function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: agentColor(name),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: "700", color: "#000",
      flexShrink: 0, textTransform: "capitalize"
    }}>
      {name?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

function deriveJobs(activities: Activity[]): JobState[] {
  const jobs: Record<string, JobState> = {};
  // Process oldest-first so state builds correctly
  const sorted = [...activities].reverse();

  for (const a of sorted) {
    if (a.type === "action") {
      // Create entry from post_job (ideal case)
      if (a.action === "post_job" && a.jobId && !jobs[a.jobId]) {
        jobs[a.jobId] = {
          jobId: a.jobId,
          description: a.description || "",
          poster: a.agent,
          escrow: a.price || "",
          status: "open",
          bids: [],
          postedAt: a.timestamp,
          posterTxHash: a.txHash,
          posterTxLink: a.txLink,
        };
      }

      // Create stub entry if we have job events but post_job was evicted from feed
      if (a.jobId && !jobs[a.jobId] && a.action !== "post_job") {
        // poster is whoever is accepting/finalizing; worker is the bidder/worker field
        const poster = (a.action === "accept_bid" || a.action === "finalize_job") ? a.agent : "unknown";
        jobs[a.jobId] = {
          jobId: a.jobId,
          description: a.description || "",
          poster,
          escrow: a.price || "",
          status: "open",
          bids: [],
          postedAt: a.timestamp,
        };
      }

      if (a.action === "bid" && a.jobId && jobs[a.jobId]) {
        const alreadyBid = jobs[a.jobId].bids.some(b => b.agent === a.agent);
        if (!alreadyBid) {
          jobs[a.jobId].bids.push({ agent: a.agent, price: a.price || "", txHash: a.txHash, txLink: a.txLink });
        }
      }
      if (a.action === "accept_bid" && a.jobId && jobs[a.jobId]) {
        jobs[a.jobId].status = "assigned";
        jobs[a.jobId].winner = a.worker;
      }
      if (a.action === "submit_delivery" && a.jobId && jobs[a.jobId]) {
        jobs[a.jobId].status = "delivered";
      }
      if (a.action === "finalize_job" && a.jobId && jobs[a.jobId]) {
        jobs[a.jobId].status = a.success ? "complete" : "failed";
        jobs[a.jobId].rating = a.rating;
        jobs[a.jobId].payment = a.payment;
        jobs[a.jobId].finalTxHash = a.txHash;
        jobs[a.jobId].finalTxLink = a.txLink;
        // Infer winner from worker field if not already set
        if (!jobs[a.jobId].winner && a.worker) {
          jobs[a.jobId].winner = a.worker;
        }
      }
    }
    if (a.type === "delivery" && a.jobId) {
      if (!jobs[a.jobId]) {
        jobs[a.jobId] = { jobId: a.jobId, description: "", poster: a.agent, escrow: "", status: "delivered", bids: [], postedAt: a.timestamp };
      }
      jobs[a.jobId].deliverable = a.content;
    }
  }

  // Active jobs first, then most-recently-posted among same status
  const statusOrder: Record<string, number> = { open: 0, assigned: 1, delivered: 2, complete: 3, failed: 3 };
  return Object.values(jobs).sort((a, b) => {
    const diff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    return diff !== 0 ? diff : b.postedAt - a.postedAt;
  });
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  open:      { label: "OPEN",     color: "#60a5fa" },
  assigned:  { label: "ASSIGNED", color: "#a78bfa" },
  delivered: { label: "REVIEW",   color: "#fbbf24" },
  complete:  { label: "COMPLETE", color: "#4ade80" },
  failed:    { label: "FAILED",   color: "#f87171" },
};

function normalizeNewlines(s?: string) {
  return s?.replace(/\\n/g, '\n') ?? '';
}

function JobCard({ job }: { job: JobState }) {
  const isDone = job.status === "complete" || job.status === "failed";
  const [expanded, setExpanded] = useState(!isDone);
  const st = STATUS_META[job.status] || { label: job.status.toUpperCase(), color: "#94a3b8" };
  const bids = job.bids.filter(b => b.price && parseFloat(b.price) > 0);

  return (
    <div style={{
      borderRadius: "8px",
      border: `1px solid ${isDone ? "var(--border)" : st.color + "44"}`,
      background: isDone ? "var(--bg-secondary)" : `${st.color}08`,
      overflow: "hidden",
      opacity: isDone ? 0.82 : 1,
    }}>
      {/* Header — click to expand/collapse */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: "10px 12px",
          display: "flex", alignItems: "flex-start", gap: "8px",
          cursor: "pointer",
          borderBottom: expanded ? "1px solid var(--border)" : "none",
        }}
      >
        <span style={{
          fontSize: "10px", fontWeight: "700", padding: "2px 6px",
          background: `${st.color}22`, color: st.color,
          borderRadius: "3px", letterSpacing: "0.5px",
          flexShrink: 0, marginTop: "1px"
        }}>
          {st.label}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: "600", lineHeight: "1.4", wordBreak: "break-word", color: job.description ? "var(--text-primary)" : "var(--text-dim)", fontStyle: job.description ? "normal" : "italic" }}>
            {job.description ? `"${job.description}"` : `Job #${job.jobId}`}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: agentColor(job.poster), textTransform: "capitalize" }}>{job.poster}</span>
            <span>·</span>
            <span>{job.escrow} HBAR</span>
            {job.rating !== undefined && (
              <>
                <span>·</span>
                <span style={{ color: job.status === "complete" ? "#4ade80" : "#f87171", fontWeight: "600" }}>
                  ★ {job.rating}/100
                </span>
              </>
            )}
          </div>
        </div>
        <span style={{ color: "var(--text-dim)", fontSize: "12px", flexShrink: 0, marginTop: "2px" }}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>

          {/* Winner / assignment line */}
          {job.winner && (
            <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
              Winner:{" "}
              <span style={{ color: agentColor(job.winner), fontWeight: "600", textTransform: "capitalize" }}>
                {job.winner}
              </span>
              {job.status === "complete" && job.payment && (
                <span style={{ color: "#4ade80", marginLeft: "6px" }}>· paid {job.payment} HBAR</span>
              )}
            </div>
          )}

          {/* Bids */}
          <div>
            <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
              Bids ({bids.length})
            </div>
            {bids.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {bids.map((bid, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "4px 6px", borderRadius: "4px",
                    background: job.winner === bid.agent ? `${agentColor(bid.agent)}15` : "transparent",
                    border: job.winner === bid.agent ? `1px solid ${agentColor(bid.agent)}33` : "1px solid transparent",
                  }}>
                    <AgentAvatar name={bid.agent} size={16} />
                    <span style={{ fontSize: "11px", textTransform: "capitalize", color: agentColor(bid.agent), fontWeight: "600" }}>
                      {bid.agent}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-primary)", marginLeft: "auto" }}>
                      {bid.price} HBAR
                    </span>
                    {job.winner === bid.agent && (
                      <span style={{ fontSize: "9px", color: "#4ade80", fontWeight: "700" }}>✓ WON</span>
                    )}
                    {(bid.txLink || bid.txHash) && (
                      <a
                        href={bid.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${bid.txHash}`}
                        target="_blank" rel="noopener"
                        style={{ fontSize: "9px", color: "var(--accent)" }}
                        onClick={e => e.stopPropagation()}
                      >
                        ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>No bids yet.</div>
            )}
          </div>

          {/* Deliverable */}
          {job.deliverable && (
            <div>
              <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                Deliverable
              </div>
              <div style={{
                padding: "8px 10px",
                background: "rgba(244,114,182,0.05)",
                border: "1px solid rgba(244,114,182,0.2)",
                borderRadius: "4px",
                fontSize: "11px", lineHeight: "1.6",
                fontFamily: "monospace", whiteSpace: "pre-wrap",
                color: "var(--text-primary)",
                maxHeight: "120px", overflowY: "auto",
                wordBreak: "break-word"
              }}>
                {normalizeNewlines(job.deliverable)}
              </div>
            </div>
          )}

          {/* Finalized tx link */}
          {(job.finalTxLink || job.finalTxHash) && (
            <a
              href={job.finalTxLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${job.finalTxHash}`}
              target="_blank" rel="noopener"
              style={{ fontSize: "9px", color: "var(--accent)", fontFamily: "monospace" }}
            >
              finalized on-chain — view on HashScan ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function LiveDashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [personalities, setPersonalities] = useState<Record<string, string>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [simStatus, setSimStatus] = useState<SimStatus>({ running: false });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>({});
  const [modalAgent, setModalAgent] = useState<string | null>(null);
  const [jobTab, setJobTab] = useState<"active" | "closed">("active");
  const [jobPage, setJobPage] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const JOBS_PER_PAGE = 8;

  const activeJobs = jobs.filter(j => j.status === "open" || j.status === "assigned" || j.status === "delivered");
  const closedJobs = jobs.filter(j => j.status === "complete" || j.status === "failed");

  const filteredActivities = selectedAgent
    ? activities.filter(a => a.agent === selectedAgent || a.to === selectedAgent)
    : activities;

  useEffect(() => {
    if (localStorage.getItem("auth") === "true") setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [actRes, agentRes, statusRes, jobsRes] = await Promise.all([
          fetch(`${ACTIVITY_API}/api/activity`),
          fetch(`${ACTIVITY_API}/api/agents`),
          fetch(`${ACTIVITY_API}/api/status`),
          fetch(`${ACTIVITY_API}/api/jobs-board`),
        ]);
        const actData = await actRes.json();
        const agentData = await agentRes.json();
        const statusData = await statusRes.json();
        const jobsData = await jobsRes.json();

        setActivities(actData.activities || []);
        setAgents(agentData.agents || []);
        setSimStatus(statusData);
        setJobs(jobsData.jobs || []);

        const counts: Record<string, number> = {};
        for (const a of (actData.activities || [])) {
          counts[a.agent] = (counts[a.agent] || 0) + 1;
        }
        setActivityCounts(counts);
      } catch (e) {
        // orchestrator not reachable yet
      }
    };

    const fetchPersonalities = async () => {
      try {
        const res = await fetch(`${ACTIVITY_API}/api/personalities`);
        const data = await res.json();
        setPersonalities(data.personalities || {});
      } catch (e) {}
    };

    fetchAll();
    fetchPersonalities();
    const interval = setInterval(fetchAll, 4000);
    return () => clearInterval(interval);
  }, []);

  // True global lock: server says something is in progress, OR we just clicked and are waiting for the server to reflect it
  const serverBusy = !!simStatus.pendingAction;
  const globalLock = actionLoading || serverBusy;

  const ctrlFetch = async (path: string) => {
    setActionLoading(true);
    try {
      const r = await fetch(`${ACTIVITY_API}${path}`, { method: "POST" });
      const d = await r.json();
      if (!d.success) console.warn("Control error:", d.message);
    } catch (e) {
      console.error("Control fetch failed:", e);
    } finally {
      // Don't clear immediately — wait for next status poll to confirm state
      setTimeout(() => setActionLoading(false), 3000);
    }
  };

  const startSim  = () => ctrlFetch("/api/control/start");
  const stopSim   = () => ctrlFetch("/api/control/stop");
  const restartSim = async () => {
    setActionLoading(true);
    try {
      await fetch(`${ACTIVITY_API}/api/control/stop`, { method: "POST" });
      await new Promise(r => setTimeout(r, 1500));
      await fetch(`${ACTIVITY_API}/api/control/start`, { method: "POST" });
    } catch (e) { console.error(e); }
    setTimeout(() => setActionLoading(false), 3000);
  };
  const unregisterAll = () => {
    if (!confirm("Unregister all 4 agents from the blockchain?\nThis resets their active status (reputation is preserved).")) return;
    ctrlFetch("/api/control/unregister-all");
  };

  const selectedPersonality = selectedAgent ? personalities[selectedAgent] : null;

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono"><Logo size={20} /></Link>
          <nav className="nav">
            <Link href="/monitor">Monitor</Link>
            <Link href="/dashboard">Agents</Link>
            <Link href="/live" style={{ fontWeight: "600", textDecoration: "underline" }}>Marketplace</Link>
            <a href="/skill.md" target="_blank" rel="noopener">skill.md</a>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "24px 0" }}>
        <div className="container" style={{ maxWidth: "1400px" }}>

          {/* Page title */}
          <div className="flex items-center gap-3 mb-4">
            <h1 style={{ fontSize: "24px" }}>Live Agent Activity</h1>
            <span style={{
              padding: "3px 10px",
              background: simStatus.pendingAction ? "#fbbf24" : simStatus.running ? "var(--success)" : "var(--border)",
              color: simStatus.pendingAction ? "#000" : simStatus.running ? "#000" : "var(--text-dim)",
              fontSize: "11px", fontWeight: "700", borderRadius: "4px", textTransform: "uppercase"
            }}>
              {simStatus.pendingAction === "starting"
                ? "Starting..."
                : simStatus.pendingAction === "unregistering"
                ? "Unregistering..."
                : simStatus.running
                ? "Live"
                : "Stopped"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "240px 380px 1fr", gap: "14px", alignItems: "start" }}>

            {/* ── COL 1: Agent Roster ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                <div className="text-dim" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Agents ({agents.length})
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-dim)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: simStatus.running ? "var(--success)" : "var(--border)",
                    animation: simStatus.running ? "pulse 2s infinite" : "none"
                  }} />
                  {simStatus.running ? "live from chain" : "last snapshot"}
                </div>
              </div>

              <div
                onClick={() => setSelectedAgent(null)}
                style={{
                  padding: "8px 10px", borderRadius: "6px", cursor: "pointer",
                  background: selectedAgent === null ? "var(--accent)" : "var(--bg-secondary)",
                  color: selectedAgent === null ? "#000" : "inherit",
                  border: `1px solid ${selectedAgent === null ? "transparent" : "var(--border)"}`,
                  fontSize: "12px", fontWeight: selectedAgent === null ? "600" : "400"
                }}
              >
                All Agents
                <span style={{ float: "right", opacity: 0.7 }}>{activities.length}</span>
              </div>

              {agents.map(agent => {
                const col = agentColor(agent.name);
                const workerRep = agent.reputation ?? 500;
                const clientRep = agent.clientScore ?? 500;
                const isSelected = selectedAgent === agent.name;
                return (
                  <div
                    key={agent.address}
                    onClick={() => setSelectedAgent(isSelected ? null : agent.name)}
                    style={{
                      padding: "10px 12px", borderRadius: "8px", cursor: "pointer",
                      background: isSelected ? `${col}18` : "var(--bg-secondary)",
                      border: `1px solid ${isSelected ? col : "var(--border)"}`,
                      transition: "all 0.15s"
                    }}
                  >
                    {/* Header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <AgentAvatar name={agent.name} size={22} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontWeight: "700", fontSize: "13px", textTransform: "capitalize", color: col }}>
                            {agent.name}
                          </span>
                          {agent.warned && (
                            <span style={{ fontSize: "9px", fontWeight: "700", color: "#f87171", padding: "1px 4px", background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: "3px" }}>
                              ⚠ WARN
                            </span>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setModalAgent(agent.name); }}
                            style={{
                              marginLeft: "auto", padding: "1px 5px",
                              fontSize: "9px", fontWeight: "600",
                              background: `${col}18`, border: `1px solid ${col}44`,
                              borderRadius: "3px", color: col,
                              cursor: "pointer", lineHeight: "1.5"
                            }}
                          >
                            MD
                          </button>
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "1px" }}>
                          {AGENT_ROLES[agent.name] || agent.mode}
                        </div>
                      </div>
                    </div>

                    {/* Score rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      {/* Worker reputation */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                          <span style={{ fontSize: "9px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.4px" }}>Worker Rep</span>
                          <span style={{ fontSize: "12px", fontWeight: "700", color: workerRep >= 700 ? "#4ade80" : workerRep >= 500 ? "#fbbf24" : "#f87171", fontFamily: "monospace" }}>
                            {workerRep}
                          </span>
                        </div>
                        <div style={{ height: "3px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(workerRep / 1000) * 100}%`, background: workerRep >= 700 ? "#4ade80" : workerRep >= 500 ? "#fbbf24" : "#f87171", borderRadius: "2px", transition: "width 0.5s" }} />
                        </div>
                      </div>

                      {/* Client reputation */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                          <span style={{ fontSize: "9px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.4px" }}>Client Rep</span>
                          <span style={{ fontSize: "12px", fontWeight: "700", color: clientRep >= 700 ? "#a78bfa" : clientRep >= 500 ? "#fbbf24" : "#f87171", fontFamily: "monospace" }}>
                            {clientRep}
                          </span>
                        </div>
                        <div style={{ height: "3px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(clientRep / 1000) * 100}%`, background: clientRep >= 700 ? "#a78bfa" : clientRep >= 500 ? "#fbbf24" : "#f87171", borderRadius: "2px", transition: "width 0.5s" }} />
                        </div>
                      </div>
                    </div>

                    {/* Footer: W/F + balance */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "7px", borderTop: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "monospace" }}>
                        <span style={{ color: "#4ade80" }}>{agent.jobsCompleted ?? 0}W</span>
                        {" "}
                        <span style={{ color: "#f87171" }}>{agent.jobsFailed ?? 0}F</span>
                      </span>
                      {agent.balance !== undefined && (
                        <span style={{ fontSize: "11px", color: "#4ade80", fontFamily: "monospace", fontWeight: "600" }}>
                          ℏ{agent.balance}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Sim controls */}
              {isAuthenticated ? (
                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "5px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="text-dim" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Controls</div>
                    <button
                      onClick={() => { localStorage.removeItem("auth"); setIsAuthenticated(false); }}
                      style={{ fontSize: "9px", color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      lock
                    </button>
                  </div>

                  {/* Status message while busy */}
                  {globalLock && (
                    <div style={{
                      padding: "6px 8px", borderRadius: "4px",
                      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
                      fontSize: "10px", color: "#fbbf24", textAlign: "center"
                    }}>
                      {simStatus.pendingAction === "starting"      && "⏳ Registering agents on-chain..."}
                      {simStatus.pendingAction === "unregistering" && "⏳ Unregistering from chain..."}
                      {simStatus.pendingAction === "stopping"      && "⏳ Stopping..."}
                      {!simStatus.pendingAction                    && "⏳ Waiting..."}
                    </div>
                  )}

                  {/* START */}
                  <button
                    onClick={startSim}
                    disabled={globalLock || simStatus.running}
                    style={{
                      padding: "7px", borderRadius: "6px", border: "none",
                      cursor: globalLock || simStatus.running ? "not-allowed" : "pointer",
                      background: globalLock || simStatus.running ? "var(--bg-tertiary)" : "var(--success)",
                      color: globalLock || simStatus.running ? "var(--text-dim)" : "#000",
                      fontWeight: "600", fontSize: "12px",
                      opacity: globalLock || simStatus.running ? 0.5 : 1
                    }}
                  >
                    {simStatus.pendingAction === "starting" ? "Starting..." : "Start"}
                  </button>

                  {/* STOP */}
                  <button
                    onClick={stopSim}
                    disabled={globalLock || !simStatus.running}
                    style={{
                      padding: "7px", borderRadius: "6px", border: "none",
                      cursor: globalLock || !simStatus.running ? "not-allowed" : "pointer",
                      background: globalLock || !simStatus.running ? "var(--bg-tertiary)" : "var(--error)",
                      color: globalLock || !simStatus.running ? "var(--text-dim)" : "#fff",
                      fontWeight: "600", fontSize: "12px",
                      opacity: globalLock || !simStatus.running ? 0.5 : 1
                    }}
                  >
                    Stop
                  </button>

                  {/* RESTART */}
                  <button
                    onClick={restartSim}
                    disabled={globalLock}
                    style={{
                      padding: "7px", borderRadius: "6px", border: "1px solid var(--border)",
                      cursor: globalLock ? "not-allowed" : "pointer",
                      background: "var(--bg-secondary)", color: globalLock ? "var(--text-dim)" : "var(--text)",
                      fontWeight: "600", fontSize: "12px",
                      opacity: globalLock ? 0.5 : 1
                    }}
                  >
                    Restart
                  </button>

                  {/* UNREGISTER ALL — only when stopped */}
                  {!simStatus.running && (
                    <button
                      onClick={unregisterAll}
                      disabled={globalLock}
                      style={{
                        padding: "6px 7px", borderRadius: "6px",
                        border: "1px solid rgba(248,113,113,0.4)",
                        cursor: globalLock ? "not-allowed" : "pointer",
                        background: "rgba(248,113,113,0.08)",
                        color: globalLock ? "var(--text-dim)" : "#f87171",
                        fontWeight: "600", fontSize: "11px",
                        opacity: globalLock ? 0.5 : 1,
                        marginTop: "2px"
                      }}
                    >
                      {simStatus.pendingAction === "unregistering" ? "Unregistering..." : "Unregister All"}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    const pw = prompt("Admin password:");
                    if (pw === "ethdenver2026") {
                      setIsAuthenticated(true);
                      localStorage.setItem("auth", "true");
                    } else if (pw) alert("Wrong password");
                  }}
                  style={{
                    marginTop: "6px", padding: "7px", borderRadius: "6px",
                    border: "1px solid var(--border)", background: "var(--bg-secondary)",
                    color: "var(--text-dim)", cursor: "pointer", fontSize: "11px"
                  }}
                >
                  Unlock Controls
                </button>
              )}
            </div>

            {/* ── COL 2: Jobs Board ── */}
            {(() => {
              const tabJobs = jobTab === "active" ? activeJobs : closedJobs;
              const totalPages = Math.max(1, Math.ceil(tabJobs.length / JOBS_PER_PAGE));
              const safePage = Math.min(jobPage, totalPages - 1);
              const pageJobs = tabJobs.slice(safePage * JOBS_PER_PAGE, (safePage + 1) * JOBS_PER_PAGE);

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {/* Header row: tabs + count */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
                    {(["active", "closed"] as const).map(tab => (
                      <button key={tab} onClick={() => { setJobTab(tab); setJobPage(0); }} style={{
                        padding: "4px 12px", fontSize: "11px", fontWeight: "600",
                        background: "none", border: "none", cursor: "pointer",
                        color: jobTab === tab ? "var(--accent)" : "var(--text-dim)",
                        borderBottom: jobTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                        marginBottom: "-9px", textTransform: "capitalize",
                      }}>
                        {tab} ({tab === "active" ? activeJobs.length : closedJobs.length})
                      </button>
                    ))}
                    <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-dim)" }}>
                      p.{safePage + 1}/{totalPages}
                    </span>
                  </div>

                  {/* Job cards */}
                  {jobs.length === 0 ? (
                    <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-dim)", background: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12px" }}>
                      No jobs yet. Waiting for agents...
                    </div>
                  ) : pageJobs.length === 0 ? (
                    <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>
                      No {jobTab} jobs.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {pageJobs.map(job => <JobCard key={job.jobId} job={job} />)}
                    </div>
                  )}

                  {/* Pagination controls */}
                  {totalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", paddingTop: "4px" }}>
                      <button onClick={() => setJobPage(0)} disabled={safePage === 0} style={{
                        padding: "4px 8px", fontSize: "11px", borderRadius: "4px",
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        color: safePage === 0 ? "var(--text-dim)" : "var(--text-primary)",
                        cursor: safePage === 0 ? "not-allowed" : "pointer", opacity: safePage === 0 ? 0.4 : 1,
                      }}>«</button>
                      <button onClick={() => setJobPage(p => Math.max(0, p - 1))} disabled={safePage === 0} style={{
                        padding: "4px 8px", fontSize: "11px", borderRadius: "4px",
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        color: safePage === 0 ? "var(--text-dim)" : "var(--text-primary)",
                        cursor: safePage === 0 ? "not-allowed" : "pointer", opacity: safePage === 0 ? 0.4 : 1,
                      }}>‹ Prev</button>

                      {/* Page number pills */}
                      {Array.from({ length: totalPages }, (_, i) => i).filter(i => Math.abs(i - safePage) <= 2).map(i => (
                        <button key={i} onClick={() => setJobPage(i)} style={{
                          padding: "4px 8px", fontSize: "11px", borderRadius: "4px",
                          border: i === safePage ? "1px solid var(--accent)" : "1px solid var(--border)",
                          background: i === safePage ? "var(--accent)" : "var(--bg-secondary)",
                          color: i === safePage ? "#000" : "var(--text-primary)",
                          cursor: "pointer", fontWeight: i === safePage ? "700" : "400",
                        }}>{i + 1}</button>
                      ))}

                      <button onClick={() => setJobPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1} style={{
                        padding: "4px 8px", fontSize: "11px", borderRadius: "4px",
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        color: safePage === totalPages - 1 ? "var(--text-dim)" : "var(--text-primary)",
                        cursor: safePage === totalPages - 1 ? "not-allowed" : "pointer", opacity: safePage === totalPages - 1 ? 0.4 : 1,
                      }}>Next ›</button>
                      <button onClick={() => setJobPage(totalPages - 1)} disabled={safePage === totalPages - 1} style={{
                        padding: "4px 8px", fontSize: "11px", borderRadius: "4px",
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        color: safePage === totalPages - 1 ? "var(--text-dim)" : "var(--text-primary)",
                        cursor: safePage === totalPages - 1 ? "not-allowed" : "pointer", opacity: safePage === totalPages - 1 ? 0.4 : 1,
                      }}>»</button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── COL 3: Activity Feed ── */}
            <div className="card" style={{ padding: "0", overflow: "hidden" }}>
              <div style={{
                padding: "12px 16px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <div className="flex items-center gap-2">
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: simStatus.running ? "var(--success)" : "var(--border)",
                    animation: simStatus.running ? "pulse 2s infinite" : "none"
                  }} />
                  <h2 style={{ fontSize: "14px" }}>
                    {selectedAgent
                      ? `${selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)}'s Feed`
                      : "Activity Feed"}
                  </h2>
                </div>
                {selectedAgent && (
                  <button
                    onClick={() => setSelectedAgent(null)}
                    style={{
                      fontSize: "10px", padding: "3px 8px",
                      background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                      borderRadius: "4px", cursor: "pointer", color: "var(--text-dim)"
                    }}
                  >
                    Clear filter
                  </button>
                )}
              </div>

              <div
                ref={feedRef}
                style={{
                  maxHeight: "calc(100vh - 180px)", overflowY: "auto",
                  display: "flex", flexDirection: "column", gap: "1px"
                }}
              >
                {filteredActivities.length === 0 ? (
                  <div style={{ padding: "64px 24px", textAlign: "center", color: "var(--text-dim)" }}>
                    {simStatus.running
                      ? "Agents are thinking... activity will appear here."
                      : "Hit Start to begin the simulation."}
                  </div>
                ) : (
                  filteredActivities.map((activity, idx) => (
                    <ActivityCard key={idx} activity={activity} />
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ── Personality Modal ── */}
      {modalAgent && (
        <div
          onClick={() => setModalAgent(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px"
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: "640px", maxHeight: "80vh",
              background: "var(--bg-secondary)",
              border: `1px solid ${agentColor(modalAgent)}`,
              borderRadius: "12px",
              display: "flex", flexDirection: "column",
              overflow: "hidden"
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: "10px",
              flexShrink: 0
            }}>
              <AgentAvatar name={modalAgent} size={28} />
              <div>
                <div style={{ fontWeight: "700", fontSize: "15px", textTransform: "capitalize" }}>
                  {modalAgent}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                  agents/personalities/{modalAgent}.md
                </div>
              </div>
              <button
                onClick={() => setModalAgent(null)}
                style={{
                  marginLeft: "auto", padding: "4px 10px",
                  background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                  borderRadius: "4px", cursor: "pointer",
                  color: "var(--text-dim)", fontSize: "12px"
                }}
              >
                ✕ Close
              </button>
            </div>
            {/* Modal body */}
            <div style={{ overflowY: "auto", padding: "20px" }}>
              {personalities[modalAgent] ? (
                <pre style={{
                  fontSize: "12px", lineHeight: "1.8",
                  color: "var(--text-primary)", whiteSpace: "pre-wrap",
                  wordBreak: "break-word", margin: 0,
                  fontFamily: "'Fira Code', monospace"
                }}>
                  {personalities[modalAgent]}
                </pre>
              ) : (
                <div style={{ color: "var(--text-dim)", fontSize: "13px" }}>
                  Personality file not loaded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}

function ActivityCard({ activity }: { activity: Activity }) {
  const color = agentColor(activity.agent);

  if (activity.type === "reasoning") {
    return (
      <div style={{
        padding: "10px 16px",
        borderLeft: `3px solid ${color}22`,
        background: "var(--bg-secondary)"
      }}>
        <div className="flex items-center gap-2 mb-1">
          <AgentAvatar name={activity.agent} size={16} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>thinking</span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p style={{
          fontSize: "12px", lineHeight: "1.6",
          color: "var(--text-dim)", fontStyle: "italic",
          margin: 0, paddingLeft: "22px"
        }}>
          {activity.content}
        </p>
      </div>
    );
  }

  if (activity.type === "message") {
    const toLabel = activity.to === "marketplace" ? "marketplace" : activity.to;
    return (
      <div style={{ padding: "10px 16px", background: "var(--bg-primary)" }}>
        <div className="flex items-center gap-2 mb-2">
          <AgentAvatar name={activity.agent} size={20} />
          <span style={{ fontSize: "12px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
            {"->"} <span style={{ color: agentColor(activity.to || ""), textTransform: "capitalize" }}>
              {toLabel}
            </span>
          </span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div style={{
          marginLeft: "26px", padding: "8px 12px",
          background: `${color}11`, border: `1px solid ${color}33`,
          borderRadius: "0 8px 8px 8px",
          fontSize: "12px", lineHeight: "1.6", color: "var(--text-primary)"
        }}>
          {activity.content}
        </div>
        {(activity.txLink || activity.txHash) && (
          <div style={{ marginLeft: "26px", marginTop: "4px" }}>
            <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
              target="_blank" rel="noopener" className="text-mono"
              style={{ fontSize: "9px", color: "var(--accent)" }}>
              view on HashScan ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  if (activity.type === "action") {
    const actionColors: Record<string, string> = {
      bid: "#60a5fa",
      post_job: "#4ade80",
      accept_bid: "#a78bfa",
      submit_delivery: "#fbbf24",
      finalize_job: activity.success ? "#4ade80" : "#f87171",
      registered: "#4ade80",
      unregistered: "#f87171",
    };
    const actionColor = actionColors[activity.action || ""] || "var(--accent)";
    const actionLabels: Record<string, string> = {
      bid: "BID PLACED",
      post_job: "JOB POSTED",
      accept_bid: "BID ACCEPTED",
      submit_delivery: "DELIVERED",
      finalize_job: activity.success ? "JOB COMPLETE" : "JOB FAILED",
      registered: "REGISTERED",
      unregistered: "UNREGISTERED",
      already_registered: "ALREADY REGISTERED",
    };

    return (
      <div style={{
        padding: "10px 16px",
        borderLeft: `3px solid ${actionColor}`,
        background: `${actionColor}08`
      }}>
        <div className="flex items-center gap-2 mb-1">
          <AgentAvatar name={activity.agent} size={18} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{
            fontSize: "9px", fontWeight: "700", padding: "2px 6px",
            background: `${actionColor}22`, color: actionColor,
            borderRadius: "3px", letterSpacing: "0.5px"
          }}>
            {actionLabels[activity.action || ""] || activity.action?.toUpperCase()}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>

        <div style={{ paddingLeft: "24px" }}>
          {activity.action === "post_job" && activity.description && (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "3px" }}>
              "{activity.description}" — {activity.price} HBAR escrow
            </div>
          )}
          {activity.action === "bid" && (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "3px" }}>
              Job #{activity.jobId} — {activity.price} HBAR
            </div>
          )}
          {activity.action === "finalize_job" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "4px" }}>
              {/* Credibility-weighting callout — shown prominently when it kicks in */}
              {activity.rawRating !== undefined ? (
                <div style={{
                  padding: "8px 12px",
                  background: "rgba(251,191,36,0.08)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  lineHeight: "1.6"
                }}>
                  <div style={{ fontWeight: "700", color: "#fbbf24", marginBottom: "3px" }}>
                    ⚖️ Credibility Weighting Applied
                  </div>
                  <div style={{ color: "var(--text-dim)" }}>
                    Raw rating: <span style={{ color: "#f87171", fontWeight: "600" }}>{activity.rawRating}/100</span>
                    {" → "}
                    Credibility-adjusted: <span style={{ color: "#4ade80", fontWeight: "600" }}>{activity.rating}/100</span>
                    <span style={{ color: "#fbbf24" }}> ({activity.credibilityMultiplier}× multiplier)</span>
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: "10px", marginTop: "2px" }}>
                    Low-trust rater can't tank a worker's score — our ERC-8004 advantage
                  </div>
                </div>
              ) : (
                activity.rating !== undefined && (
                  <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
                    Rating: {activity.rating}/100
                  </span>
                )
              )}
              {activity.success && activity.payment && (
                <span style={{ color: "#4ade80", fontWeight: "600", fontSize: "11px" }}>
                  {activity.worker ? `${activity.worker} paid ` : ""}{activity.payment} HBAR
                </span>
              )}
              {!activity.success && activity.worker && (
                <span style={{ color: "#f87171", fontSize: "10px" }}>
                  {activity.worker} — job failed, escrow returned to poster
                </span>
              )}
            </div>
          )}
          {activity.content && (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "3px" }}>
              {activity.content}
            </div>
          )}
          {(activity.txLink || activity.txHash) && (
            <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
              target="_blank" rel="noopener" className="text-mono"
              style={{ fontSize: "9px", color: "var(--accent)" }}>
              view on HashScan ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  if (activity.type === "delivery") {
    // Skip deliverable cards with no content
    if (!activity.content || activity.content.trim() === "") return null;
    return (
      <div style={{
        padding: "10px 16px",
        background: "var(--bg-secondary)",
        borderLeft: `3px solid ${color}`
      }}>
        <div className="flex items-center gap-2 mb-2">
          <AgentAvatar name={activity.agent} size={18} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "capitalize", color }}>
            {activity.agent}
          </span>
          <span style={{
            fontSize: "9px", fontWeight: "700", padding: "2px 6px",
            background: "#f472b622", color: "#f472b6",
            borderRadius: "3px", letterSpacing: "0.5px"
          }}>
            DELIVERABLE
          </span>
          <span style={{ fontSize: "9px", color: "var(--text-dim)", marginLeft: "2px" }}>Job #{activity.jobId}</span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div style={{
          marginLeft: "24px", padding: "8px 12px",
          background: "rgba(244,114,182,0.05)", border: "1px solid rgba(244,114,182,0.2)",
          borderRadius: "4px", fontSize: "12px", lineHeight: "1.7",
          fontFamily: "monospace", whiteSpace: "pre-wrap", color: "var(--text-primary)",
          wordBreak: "break-word"
        }}>
          {normalizeNewlines(activity.content)}
        </div>
        {(activity.txLink || activity.txHash) && (
          <div style={{ marginLeft: "24px", marginTop: "4px" }}>
            <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
              target="_blank" rel="noopener" className="text-mono"
              style={{ fontSize: "9px", color: "var(--accent)" }}>
              decoded content on HashScan ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  if (activity.type === "client_rating") {
    return (
      <div style={{
        padding: "8px 16px",
        background: "rgba(167,139,250,0.05)",
        borderLeft: "3px solid #a78bfa",
        display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap"
      }}>
        <AgentAvatar name={activity.agent} size={16} />
        <span style={{ fontSize: "11px", textTransform: "capitalize", fontWeight: "600", color }}>
          {activity.agent}
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
          rated client{" "}
          <span style={{ color: agentColor(activity.to || ""), textTransform: "capitalize" }}>{activity.to}</span>
          {activity.rating !== undefined && (
            <span style={{ color: "#a78bfa", fontWeight: "600" }}> ★ {activity.rating}/100</span>
          )}
          {activity.content && <span style={{ fontStyle: "italic" }}> — {activity.content}</span>}
        </span>
        {(activity.txLink || activity.txHash) ? (
          <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
            target="_blank" rel="noopener"
            style={{ fontSize: "9px", color: "var(--accent)", marginLeft: "auto" }}>
            HashScan ↗
          </a>
        ) : (
          <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--text-dim)" }}>
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    );
  }

  if (activity.type === "report") {
    return (
      <div style={{
        padding: "8px 16px",
        background: "rgba(248,113,113,0.05)",
        borderLeft: "3px solid #f87171",
        display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap"
      }}>
        <AgentAvatar name={activity.agent} size={16} />
        <span style={{ fontSize: "11px", textTransform: "capitalize", fontWeight: "600", color }}>
          {activity.agent}
        </span>
        <span style={{
          fontSize: "9px", fontWeight: "700", padding: "2px 5px",
          background: "rgba(248,113,113,0.2)", color: "#f87171", borderRadius: "3px"
        }}>
          REPORTED
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
          <span style={{ color: agentColor(activity.to || ""), textTransform: "capitalize" }}>{activity.to}</span>
          {activity.content && ` — ${activity.content}`}
        </span>
        {(activity.txLink || activity.txHash) && (
          <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
            target="_blank" rel="noopener" className="text-mono"
            style={{ fontSize: "9px", color: "var(--accent)", marginLeft: "auto" }}>
            HashScan ↗
          </a>
        )}
      </div>
    );
  }

  if (activity.type === "registered" || activity.type === "unregistered") {
    const isReg = activity.type === "registered";
    return (
      <div style={{
        padding: "8px 16px",
        background: isReg ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
        borderLeft: `3px solid ${isReg ? "var(--success)" : "var(--error)"}`,
        display: "flex", alignItems: "center", gap: "8px"
      }}>
        <AgentAvatar name={activity.agent} size={16} />
        <span style={{ fontSize: "11px", textTransform: "capitalize", fontWeight: "600", color }}>
          {activity.agent}
        </span>
        <span style={{ fontSize: "11px", color: isReg ? "var(--success)" : "var(--error)" }}>
          {isReg ? "joined the network" : "left the network"}
        </span>
        {(activity.txLink || activity.txHash) && (
          <a href={activity.txLink || `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${activity.txHash}`}
            target="_blank" rel="noopener" className="text-mono"
            style={{ fontSize: "9px", color: "var(--accent)", marginLeft: "auto" }}>
            HashScan ↗
          </a>
        )}
      </div>
    );
  }

  return null;
}
