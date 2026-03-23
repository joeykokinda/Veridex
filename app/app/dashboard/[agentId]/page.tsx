"use client";

import Link from "next/link";
import { DashboardHeader } from "../../components/DashboardHeader";
import { useWallet } from "../../lib/wallet";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { keccak256, toUtf8Bytes } from "ethers";
import { useTour, TourBubble, TourStep } from "../../components/Tour";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name?: string;
  hcs_topic_id?: string;
  owner_wallet?: string;
  created_at: number;
  telegram_chat_id?: string;
  visibility?: string;
  api_key?: string;
}

interface Stats {
  totalActions: number;
  actionsToday: number;
  blockedActions: number;
  highRiskActions: number;
  totalEarned: number;
  reputationScore?: number;
  safetyScore?: number;
}

interface Log {
  id: string;
  agentId: string;
  action: string;
  tool?: string;
  description: string;
  riskLevel: string;
  blockReason?: string;
  phase?: string;
  hcsSequenceNumber?: string;
  timestamp: number;
}

interface Alert {
  id: string;
  agentId: string;
  triggerType: string;
  description: string;
  status: string;
  timestamp: number;
}

interface Policy {
  id: string;
  agentId: string;
  type: string;
  value: string;
  label?: string;
  created_at: number;
}

interface Earning {
  id: string;
  amount_hbar: number;
  source: string;
  split_dev: number;
  split_ops: number;
  split_reinvest: number;
  hcs_paystub_sequence?: string;
  timestamp: number;
}

interface Job {
  id: string;
  jobId: string;
  status: string;
  clientAddress?: string;
  agentAddress?: string;
  amount?: number;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
  txHash?: string;
}

interface AgentMemory {
  agentId: string;
  hcsTopicId: string;
  hcs_message_count: number;
  blocked_actions: Array<{ seq: number; action: string; reason: string; timestamp?: string }>;
  open_jobs: Array<{ jobId: string; status: string; amount?: number }>;
  recent_completions: Array<{ jobId: string; amount?: number; timestamp?: string }>;
  pending_earnings: number;
  lifetime_stats: { totalActions: number; blockedActions: number; safetyScore: number };
  summary: string;
}

interface Delegation {
  id: string;
  agent_id: string;
  delegate_address: string;
  delegator_address: string;
  allowed_actions: string;
  caveat_type: string;
  signature: string;
  delegation_hash: string;
  active: number;
  created_at: number;
}

const AGENT_ACTIONS = [
  { id: "web_search",     label: "Web Search",    desc: "Search the internet" },
  { id: "file_read",      label: "File Read",      desc: "Read local files" },
  { id: "file_write",     label: "File Write",     desc: "Write local files" },
  { id: "shell_exec",     label: "Shell Execute",  desc: "Run shell commands (high risk)" },
  { id: "api_call",       label: "API Calls",      desc: "Make HTTP requests" },
  { id: "earnings_split", label: "Earnings Split", desc: "Distribute HBAR earnings" },
  { id: "hbar_send",      label: "HBAR Send",      desc: "Send HBAR payments" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const RISK_COLORS: Record<string, string> = {
  blocked: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#10b981", info: "#3b82f6",
};

function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLORS[level] || "#71717a";
  return (
    <span style={{
      fontSize: "10px", padding: "2px 7px", borderRadius: "4px", fontWeight: 600,
      background: `${color}18`, border: `1px solid ${color}40`, color,
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>
      {level}
    </span>
  );
}

const JOB_STATUS_COLORS: Record<string, string> = {
  Posted: "#3b82f6", Funded: "#f59e0b", Submitted: "#14b8a6",
  Completed: "#10b981", Cancelled: "#6b7280", Failed: "#ef4444",
};

function ClaimBanner({ agentId, onClaimed }: { agentId: string; onClaimed: () => void }) {
  const { address, connect, isConnecting } = useWallet();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (!address) { connect(); return; }
    setClaiming(true);
    setError(null);
    try {
      const winEthereum = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!winEthereum) throw new Error("MetaMask not found");
      const msg = `veridex-claim:${agentId}`;
      const signature = await winEthereum.request({ method: "personal_sign", params: [msg, address] }) as string;
      const r = await fetch(`/api/proxy/v2/agent/${encodeURIComponent(agentId)}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const d = await r.json();
      if (d.claimed) { onClaimed(); }
      else setError(d.error || "Claim failed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Claim failed");
    }
    setClaiming(false);
  }

  return (
    <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "8px", padding: "14px 18px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#10b981", marginBottom: "2px" }}>This agent is unclaimed</div>
        <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
          {address ? "Connect your wallet and sign to become the operator. You'll be able to set policies, view earnings, and use the kill-switch." : "Connect your wallet to claim ownership of this agent and manage it."}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
        <button
          onClick={claim}
          disabled={claiming || isConnecting}
          style={{ background: "#10b981", border: "none", borderRadius: "6px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, color: "#000", cursor: "pointer", opacity: (claiming || isConnecting) ? 0.6 : 1, whiteSpace: "nowrap" as const }}
        >
          {claiming ? "Signing..." : isConnecting ? "Connecting..." : address ? "Claim this agent" : "Connect wallet to claim"}
        </button>
        {error && <div style={{ fontSize: "11px", color: "#ef4444" }}>{error}</div>}
      </div>
    </div>
  );
}

function scoreColor(value: number, threshHigh: number, threshMid: number) {
  return value >= threshHigh ? "#10b981" : value >= threshMid ? "#d4890a" : "#ef4444";
}

function ConnectAgentGuide({ agentId, apiKey }: { agentId: string; apiKey?: string }) {
  const skillUrl = "https://veridex.sbs/skill.md";
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  function copy(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ padding: "8px 0 40px" }}>
      {/* Heading */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>Connect your agent in 3 steps</div>
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>
          Your agent is registered. These three things are all it needs to start logging verified actions to Hedera HCS.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "620px" }}>
        {/* Step 1 — Skill URL */}
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", fontWeight: 700, marginTop: "2px", flexShrink: 0 }}>01</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Add the Veridex skill</div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "12px", lineHeight: 1.6 }}>
                In your OpenClaw (or any MCP-compatible agent) config, add the skill URL. This teaches your agent every available endpoint.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 14px" }}>
                <code style={{ flex: 1, fontSize: "12px", fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" as const }}>
                  {`{ "skills": ["${skillUrl}"] }`}
                </code>
                <button
                  onClick={() => copy(`{ "skills": ["${skillUrl}"] }`, setCopiedSkill)}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 10px", fontSize: "11px", color: copiedSkill ? "#10b981" : "var(--text-tertiary)", cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}
                >
                  {copiedSkill ? "copied ✓" : "copy"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 — API Key */}
        <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", fontWeight: 700, marginTop: "2px", flexShrink: 0 }}>02</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{ fontSize: "14px", fontWeight: 600 }}>Set your API key</div>
                <span style={{ fontSize: "10px", fontWeight: 700, background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "4px", padding: "1px 5px" }}>REQUIRED</span>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "12px", lineHeight: 1.6 }}>
                This key proves your agent&apos;s logs belong to you. Every <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.07)", padding: "1px 4px", borderRadius: "3px" }}>/api/log</code> call must include it as the <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.07)", padding: "1px 4px", borderRadius: "3px" }}>x-api-key</code> header — without it, requests are rejected. Store it as an environment variable in your agent.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 14px" }}>
                <code style={{ flex: 1, fontSize: "11px", fontFamily: "monospace", color: "rgba(255,255,255,0.85)", wordBreak: "break-all" as const, letterSpacing: "0.3px" }}>
                  {apiKey || "Loading..."}
                </code>
                <button
                  onClick={() => { if (apiKey) { navigator.clipboard.writeText(apiKey); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); } }}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 10px", fontSize: "11px", color: copiedKey ? "#10b981" : "var(--text-tertiary)", cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}
                >
                  {copiedKey ? "copied ✓" : "copy"}
                </button>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "10px" }}>
                Example: <code style={{ fontSize: "10px", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "3px" }}>export VERIDEX_API_KEY=&quot;{apiKey?.slice(0,8) || "..."}...&quot;</code>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 — Agent ID */}
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", fontWeight: 700, marginTop: "2px", flexShrink: 0 }}>03</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Use your agent ID in every log call</div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "12px", lineHeight: 1.6 }}>
                Pass this as <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.07)", padding: "1px 4px", borderRadius: "3px" }}>agentId</code> in every request body. This is the public identifier that shows up on your dashboard and the leaderboard.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 14px" }}>
                <code style={{ flex: 1, fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.7)", wordBreak: "break-all" as const }}>
                  {agentId}
                </code>
                <button
                  onClick={() => copy(agentId, setCopiedId)}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 10px", fontSize: "11px", color: copiedId ? "#10b981" : "var(--text-tertiary)", cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}
                >
                  {copiedId ? "copied ✓" : "copy"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Waiting indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite", flexShrink: 0 }} />
          <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            Waiting for your first action — this page will update automatically once your agent connects.
          </span>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}

function ScoreRing({ value, max = 1000, label, threshHigh, threshMid }: {
  value: number; max?: number; label: string; threshHigh: number; threshMid: number;
}) {
  const color = scoreColor(value, threshHigh, threshMid);
  const r = 30;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value / max, 0), 1);
  const dash = pct * circumference;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
          <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "17px", fontWeight: 700, fontFamily: "monospace", color, lineHeight: 1 }}>{value}</span>
          <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>/{max}</span>
        </div>
      </div>
      <span style={{ fontSize: "11px", color: "var(--text-tertiary)", letterSpacing: "0.2px" }}>{label}</span>
    </div>
  );
}

function EmptyGuide({ steps, note }: {
  steps: { num: string; title: string; body: string; code?: string }[];
  note?: string;
}) {
  return (
    <div style={{ padding: "8px 0 40px", maxWidth: "620px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {steps.map(s => (
          <div key={s.num} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px 20px" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", fontWeight: 700, marginTop: "2px", flexShrink: 0 }}>{s.num}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.65, marginBottom: s.code ? "12px" : 0 }}>{s.body}</div>
                {s.code && (
                  <pre style={{ margin: 0, background: "var(--bg-tertiary)", borderRadius: "6px", padding: "10px 14px", fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{s.code}</pre>
                )}
              </div>
            </div>
          </div>
        ))}
        {note && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite", flexShrink: 0 }} />
            <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>{note}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function JobsEmptyGuide() {
  return (
    <EmptyGuide
      steps={[
        {
          num: "01",
          title: "How jobs work",
          body: "Operators post jobs on-chain via the ERC-8183 marketplace. Your agent accepts a job, does the work, submits a deliverable hash, and gets paid in HBAR automatically.",
          code: `# Post a job (operator)\ncurl -X POST https://veridex.sbs/api/proxy/v2/jobs \\\n  -d '{"description":"Summarize report","amount":5,"agentId":"<your-id>"}'`,
        },
        {
          num: "02",
          title: "Accept a job in your agent",
          body: "Your agent calls the jobs endpoint to find open work, then accepts and completes it. The skill handles this automatically once installed.",
          code: `GET /api/proxy/v2/jobs          # list open jobs\nPOST /api/proxy/v2/jobs/:id/accept\nPOST /api/proxy/v2/jobs/:id/complete`,
        },
      ]}
      note="Waiting for job activity — jobs will appear here once your agent accepts or is assigned one."
    />
  );
}

function EarningsEmptyGuide() {
  return (
    <EmptyGuide
      steps={[
        {
          num: "01",
          title: "How earnings work",
          body: "When your agent completes a job, the HBAR payment is split between developer, operator, and reinvestment wallets according to your split config. Every payout is logged to Hedera HCS as an immutable paystub.",
        },
        {
          num: "02",
          title: "Configure your split",
          body: "Go to the Earnings tab split config (scroll down) to set your percentages: dev / ops / reinvest must add up to 100%. Changes apply to the next payout.",
          code: `Default split:\n  Developer  60%\n  Operator   30%\n  Reinvest   10%`,
        },
        {
          num: "03",
          title: "Complete a job to earn",
          body: "Earnings only appear after a job is completed and payment is released. Check the Jobs tab to see open or in-progress work for this agent.",
        },
      ]}
      note="No earnings yet — complete your first job to see the payout breakdown here."
    />
  );
}

function RecoveryEmptyGuide() {
  return (
    <EmptyGuide
      steps={[
        {
          num: "01",
          title: "What memory recovery is",
          body: "Every action your agent takes is written to a Hedera HCS topic — an immutable, tamper-proof log. If your agent restarts, loses wifi, or crashes, it reads this topic to recover its full context: open jobs, blocked actions, pending earnings.",
        },
        {
          num: "02",
          title: "Why there's nothing here yet",
          body: "Recovery context is built from HCS messages. Your agent hasn't logged any actions yet, so there's nothing to recover. Once activity starts flowing (Activity tab), this section will show a live snapshot of recoverable state.",
          code: `GET /api/proxy/v2/agent/:id/memory\n→ { openJobs, blockedActions, pendingEarnings, summary }`,
        },
        {
          num: "03",
          title: "How your agent uses it",
          body: "On startup, your agent calls the memory endpoint. Veridex replays the HCS topic and returns structured context so the agent picks up exactly where it left off — no local state files needed.",
        },
      ]}
      note="Waiting for HCS history — memory recovery data appears after your agent logs its first actions."
    />
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} title={`Copy ${label || ""}`} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", color: copied ? "var(--accent)" : "var(--text-tertiary)", cursor: "pointer", fontFamily: "monospace", whiteSpace: "nowrap" }}>
      {copied ? "copied" : "copy"}
    </button>
  );
}

type Tab = "activity" | "jobs" | "earnings" | "policies" | "recovery" | "settings" | "delegations";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const decodedId = decodeURIComponent(agentId);
  const { address } = useWallet();

  const [tab, setTab] = useState<Tab>("activity");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [hashScanUrl, setHashScanUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveLogs, setLiveLogs] = useState<Log[]>([]);

  // Activity filters
  const [riskFilter, setRiskFilter] = useState<string>("all");

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);

  // Policies form
  const [policyType, setPolicyType] = useState("blacklist_domain");
  const [policyValue, setPolicyValue] = useState("");
  const [policyLabel, setPolicyLabel] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [testingPolicyId, setTestingPolicyId] = useState<string | null>(null);
  const [policyTestResults, setPolicyTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Recovery / Memory
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  // Earnings split editor
  const [splitConfig, setSplitConfig] = useState({ dev: 60, ops: 30, reinvest: 10 });
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitSaved, setSplitSaved] = useState(false);

  // Telegram config
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramSaved, setTelegramSaved] = useState(false);
  const [telegramTestMsg, setTelegramTestMsg] = useState<string | null>(null);
  const [telegramTesting, setTelegramTesting] = useState(false);

  // Settings tab
  const [newName, setNewName] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [visibility, setVisibility] = useState<"public"|"private">("public");
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilitySaved, setVisibilitySaved] = useState(false);

  // Delegations tab
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [delegationsLoading, setDelegationsLoading] = useState(false);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectedCaveat, setSelectedCaveat] = useState("action_scope");
  const [delegationSigning, setDelegationSigning] = useState(false);
  const [delegationMsg, setDelegationMsg] = useState<string | null>(null);

  // Tour
  const searchParams = useSearchParams();
  const tourParam = searchParams?.get("tour");
  const agentTourSteps = useMemo<TourStep[]>(() => [
    {
      targetId: "tour-agent-stats",
      title: "Safety & reputation scores",
      body: "Every blocked action lowers the safety score. Below 600 triggers alerts. Reputation is calculated from task success, uptime, and peer ratings.",
      position: "bottom",
    },
    {
      targetId: "tour-activity-feed",
      title: "Live activity feed",
      body: "Every action your agent takes appears here in real-time. Blocked actions show the threat reason and link to the immutable Hedera HCS audit record.",
      position: "top",
    },
    {
      targetId: "tour-tab-policies",
      title: "Operator policies",
      body: "Restrict what your agent can do without touching its code. Rules are checked at every preflight — changes take effect immediately.",
      position: "bottom",
      action: { label: "Open Policies →", onClick: () => setTab("policies") },
      nextLabel: "Skip",
    },
    {
      targetId: "tour-policy-form",
      title: "Add a blocking rule",
      body: "Choose a type — blacklist a domain, block a shell command, cap HBAR spend, or use a regex. Try the quick demo buttons to fill in an example instantly.",
      position: "bottom",
    },
    {
      targetId: "tour-tab-recovery",
      title: "Memory recovery",
      body: "If your agent restarts or loses connectivity, it can replay its Hedera HCS topic to recover open jobs, blocked actions, and pending earnings — no local state needed.",
      position: "bottom",
      action: { label: "Open Recovery →", onClick: () => setTab("recovery") },
      nextLabel: "Skip",
    },
    {
      targetId: "tour-recovery-stats",
      title: "What your agent wakes up to",
      body: "HCS Messages is the total count written to your agent's Hedera topic. Blocked Actions shows what was stopped. Open Jobs and Completions let the agent pick up exactly where it left off — the Recovery Context box is what gets injected into the agent's LLM prompt on restart.",
      position: "bottom",
    },
    {
      targetId: "tour-tab-settings",
      title: "Telegram kill-switch",
      body: "Connect @veridex_manager_bot and you can manage this agent entirely from your phone. No dashboard needed — text a command, get a response.",
      position: "bottom",
      action: { label: "Open Settings →", onClick: () => setTab("settings") },
      nextLabel: "Skip",
    },
    {
      targetId: "tour-telegram-commands",
      title: "Commands you can send",
      body: "/block <agentId> quarantines the agent immediately — all future actions blocked. /unblock restores it. /status gives a live health report. /logs shows the last 10 actions. All from Telegram.",
      position: "bottom",
    },
    {
      targetId: "tour-telegram-connect",
      title: "Connect in 30 seconds",
      body: "Open @veridex_manager_bot on Telegram, send /start — it replies with your chat ID. Paste it here and hit Save. You'll get a test message to confirm it's working.",
      position: "bottom",
    },
    {
      targetId: "tour-tab-delegations",
      title: "ERC-7715 delegations",
      body: "Cryptographically scope your agent's capabilities. You sign off with MetaMask — Veridex enforces the allowed actions at every preflight. Revocable any time.",
      position: "bottom",
      action: { label: "Open Delegations →", onClick: () => setTab("delegations") },
      nextLabel: "Skip",
    },
    {
      targetId: "tour-delegation-form",
      title: "Sign & delegate",
      body: "Check the actions you want to allow, pick a caveat type, then hit Sign & Delegate. MetaMask signs the delegation — your agent can only do what you approved.",
      position: "bottom",
      nextLabel: "Done ✓",
    },
  ], []);
  const { step: tourStep, next: tourNext, skip: tourSkip, active: tourActive, restart: tourRestart } = useTour(agentTourSteps, false);

  // Auto-start tour when ?tour=1 is in URL
  useEffect(() => {
    if (tourParam === "1" && !loading) {
      tourRestart();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourParam, loading]);

  // ─── Fetch all data in parallel ─────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, logsRes, policiesRes] = await Promise.all([
        fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/stats`),
        fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/feed?limit=100`),
        fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/policies`),
      ]);
      if (statsRes.ok) {
        const d = await statsRes.json();
        setAgent(d.agent || null);
        setStats(d.stats || null);
        setEarnings(d.earnings || []);
        setAlerts(d.recentAlerts || []);
        setHashScanUrl(d.hashScanUrl || null);
      }
      if (logsRes.ok) {
        const d = await logsRes.json();
        setLogs(d.logs || []);
      }
      if (policiesRes.ok) {
        const d = await policiesRes.json();
        setPolicies(d.policies || []);
      }
    } catch {}
    setLoading(false);
  }, [decodedId]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ─── SSE live feed ────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/proxy/feed/live");
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.agentId === decodedId && ev.log) {
          setLiveLogs(prev => [ev.log as Log, ...prev].slice(0, 200));
        }
      } catch {}
    };
    return () => es.close();
  }, [decodedId]);

  // ─── Fetch jobs ─────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    if (!agent?.owner_wallet) return;
    try {
      const res = await fetch(`/api/proxy/v2/jobs/agent/${encodeURIComponent(agent.owner_wallet)}`);
      if (!res.ok) return;
      const d = await res.json();
      setJobs(d.jobs || []);
    } catch {}
  }, [agent?.owner_wallet]);

  useEffect(() => {
    if (tab === "jobs") fetchJobs();
  }, [tab, fetchJobs]);

  // ─── Fetch memory ─────────────────────────────────────────────────────────────

  const fetchMemory = useCallback(async () => {
    if (memory || memoryLoading) return;
    setMemoryLoading(true);
    try {
      const res = await fetch(`/api/proxy/v2/agent/${encodeURIComponent(decodedId)}/memory`);
      if (res.ok) setMemory(await res.json());
    } catch {}
    setMemoryLoading(false);
  }, [decodedId, memory, memoryLoading]);

  useEffect(() => {
    if (tab === "recovery") fetchMemory();
  }, [tab, fetchMemory]);

  // Sync agent name, telegram_chat_id, and visibility into local state when agent loads
  useEffect(() => {
    if (agent?.name) setNewName(agent.name);
    if (agent?.telegram_chat_id) setTelegramChatId(agent.telegram_chat_id);
    if (agent?.visibility) setVisibility(agent.visibility as "public"|"private");
  }, [agent?.name, agent?.telegram_chat_id, agent?.visibility]);

  // Fetch split config when earnings tab is active
  useEffect(() => {
    if (tab !== "earnings") return;
    fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/split-config`)
      .then(r => r.json())
      .then(d => { if (d.splitDev !== undefined) setSplitConfig({ dev: d.splitDev, ops: d.splitOps, reinvest: d.splitReinvest }); })
      .catch(() => {});
  }, [tab, decodedId]);

  // ─── Split config save ────────────────────────────────────────────────────────

  async function saveSplitConfig() {
    if (splitConfig.dev + splitConfig.ops + splitConfig.reinvest !== 100) return;
    setSplitSaving(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/split-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitDev: splitConfig.dev, splitOps: splitConfig.ops, splitReinvest: splitConfig.reinvest }),
      });
      setSplitSaved(true);
      setTimeout(() => setSplitSaved(false), 2000);
    } catch {}
    setSplitSaving(false);
  }

  // ─── Telegram config actions ──────────────────────────────────────────────────

  async function saveTelegramConfig() {
    if (!telegramChatId.trim()) return;
    setTelegramSaving(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/telegram-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: telegramChatId.trim() }),
      });
      setTelegramSaved(true);
      setTimeout(() => setTelegramSaved(false), 2000);
    } catch {}
    setTelegramSaving(false);
  }

  async function testTelegramConfig() {
    setTelegramTesting(true);
    setTelegramTestMsg(null);
    try {
      const r = await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/telegram-test`, { method: "POST" });
      const d = await r.json();
      setTelegramTestMsg(d.success ? "Sent to Telegram" : `Error: ${d.error || "Failed"}`);
      setTimeout(() => setTelegramTestMsg(null), 3000);
    } catch {
      setTelegramTestMsg("Network error");
      setTimeout(() => setTelegramTestMsg(null), 3000);
    }
    setTelegramTesting(false);
  }

  // ─── Settings actions ─────────────────────────────────────────────────────────

  async function saveVisibility(v: "public"|"private") {
    setVisibility(v);
    setVisibilitySaving(true);
    try {
      await fetch(`/api/proxy/v2/agent/${encodeURIComponent(decodedId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: v }),
      });
      setVisibilitySaved(true);
      setTimeout(() => setVisibilitySaved(false), 2000);
      fetchData();
    } catch {}
    setVisibilitySaving(false);
  }

  async function renameAgent() {
    if (!newName.trim()) return;
    setRenaming(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      fetchData();
    } catch {}
    setRenaming(false);
  }

  async function deleteAgent() {
    setDeleting(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}`, { method: "DELETE" });
      window.location.href = "/dashboard";
    } catch {}
    setDeleting(false);
  }

  async function exportLogs() {
    const r = await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/feed?limit=10000`);
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${decodedId}-logs.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Policy actions ───────────────────────────────────────────────────────────

  async function addPolicy() {
    if (!policyValue.trim()) return;
    setPolicyLoading(true);
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: policyType, value: policyValue.trim(), label: policyLabel.trim() || undefined }),
      });
      setPolicyValue(""); setPolicyLabel("");
      fetchData();
    } catch {}
    setPolicyLoading(false);
  }

  async function deletePolicy(id: string) {
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/policy/${id}`, { method: "DELETE" });
      fetchData();
    } catch {}
  }

  async function testPolicy(policy: Policy) {
    // Simulate locally — do NOT call /api/log, which would count as a real blocked action
    // and reduce the safety score. Policies are saved to DB on Add — they're active immediately.
    setTestingPolicyId(policy.id);
    setPolicyTestResults(prev => { const n = { ...prev }; delete n[policy.id]; return n; });
    await new Promise(r => setTimeout(r, 400));
    let desc = "";
    if (policy.type === "blacklist_domain") desc = `Requests to ${policy.value} blocked`;
    else if (policy.type === "blacklist_command") desc = `"${policy.value}" commands blocked`;
    else if (policy.type === "cap_hbar") desc = `HBAR sends over ${policy.value} HBAR blocked`;
    else if (policy.type === "block_file_path") desc = `Access to ${policy.value} blocked`;
    else if (policy.type === "regex_output") desc = `Output matching /${policy.value}/ blocked`;
    setPolicyTestResults(prev => ({ ...prev, [policy.id]: { ok: true, msg: `Rule active — ${desc}` } }));
    setTestingPolicyId(null);
  }

  async function resolveAlert(id: string) {
    try {
      await fetch(`/api/proxy/api/monitor/alert/${id}/resolve`, { method: "POST" });
      fetchData();
    } catch {}
  }

  // ─── Delegation actions ───────────────────────────────────────────────────────

  const fetchDelegations = useCallback(async () => {
    setDelegationsLoading(true);
    try {
      const res = await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/delegations`);
      if (res.ok) {
        const d = await res.json();
        setDelegations(d.delegations || []);
      }
    } catch {}
    setDelegationsLoading(false);
  }, [decodedId]);

  useEffect(() => {
    if (tab === "delegations") fetchDelegations();
  }, [tab, fetchDelegations]);

  async function signAndDelegate() {
    if (selectedActions.length === 0) {
      setDelegationMsg("Select at least one allowed action.");
      setTimeout(() => setDelegationMsg(null), 3000);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const winEthereum = typeof window !== "undefined" ? (window as any).ethereum : undefined;
    if (!winEthereum) {
      setDelegationMsg("MetaMask not found. Please install MetaMask.");
      setTimeout(() => setDelegationMsg(null), 4000);
      return;
    }
    setDelegationSigning(true);
    setDelegationMsg(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eth = winEthereum as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
      const connectedAddress = accounts[0];
      const delegation = {
        delegate: decodedId,
        delegator: connectedAddress,
        allowedActions: selectedActions,
        caveatType: selectedCaveat,
        timestamp: Date.now(),
        version: "erc7715-v1",
      };
      const msgStr = JSON.stringify(delegation);
      const signature = await eth.request({
        method: "personal_sign",
        params: [msgStr, connectedAddress],
      }) as string;
      const delegationHash = keccak256(toUtf8Bytes(msgStr));
      const res = await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/delegation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delegateAddress: decodedId,
          delegatorAddress: connectedAddress,
          allowedActions: selectedActions,
          signature,
          delegationHash,
          caveatType: selectedCaveat,
        }),
      });
      if (res.ok) {
        setDelegationMsg("Delegation created successfully.");
        setSelectedActions([]);
        fetchDelegations();
      } else {
        const err = await res.json().catch(() => ({}));
        setDelegationMsg(`Error: ${(err as { error?: string }).error || "Failed to create delegation"}`);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; code?: number };
      if (err?.code === 4001) {
        setDelegationMsg("Signature rejected by user.");
      } else {
        setDelegationMsg(`Error: ${err?.message || "Unknown error"}`);
      }
    }
    setTimeout(() => setDelegationMsg(null), 4000);
    setDelegationSigning(false);
  }

  async function revokeDelegation(delegationId: string) {
    try {
      await fetch(`/api/proxy/api/monitor/agent/${encodeURIComponent(decodedId)}/delegation/${delegationId}`, { method: "DELETE" });
      fetchDelegations();
    } catch {}
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const allLogs: Log[] = [...liveLogs, ...logs].reduce((acc: Log[], l) => {
    if (!acc.find(x => x.id === l.id)) acc.push(l);
    return acc;
  }, []).sort((a, b) => b.timestamp - a.timestamp);

  const filteredLogs = riskFilter === "all" ? allLogs : allLogs.filter(l =>
    riskFilter === "blocked" ? !!l.blockReason : l.riskLevel === riskFilter
  );

  const activeAlerts = alerts.filter(a => a.status !== "resolved");
  const isLive = liveLogs.length > 0 || (allLogs[0] && Date.now() - allLogs[0].timestamp < 3 * 60 * 1000);
  const totalEarned = stats?.totalEarned || 0;

  // ─── Loading / not found ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <DashboardHeader />
        <div style={{ maxWidth: "1100px", margin: "60px auto", padding: "0 24px", textAlign: "center", color: "var(--text-tertiary)" }}>
          Loading agent...
        </div>
      </>
    );
  }

  if (!agent) {
    return (
      <>
        <DashboardHeader />
        <div style={{ maxWidth: "1100px", margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ color: "var(--text-tertiary)", marginBottom: "16px" }}>Agent not found.</div>
          <Link href="/dashboard" style={{ color: "var(--accent)", fontSize: "14px" }}>← Back to Dashboard</Link>
        </div>
      </>
    );
  }

  // ─── Wallet ownership state ───────────────────────────────────────────────
  const ownerWallet = agent.owner_wallet?.toLowerCase();
  const connectedWallet = address?.toLowerCase();
  const isOwner = !!ownerWallet && ownerWallet === connectedWallet;
  const isClaimed = !!ownerWallet;
  // Claimed by someone else → show public-only view (trust score + HCS link, no controls)
  if (isClaimed && !isOwner) {
    return (
      <>
        <DashboardHeader />
        <div style={{ maxWidth: "600px", margin: "120px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>{agent.name || agent.id}</div>
          <div style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "20px" }}>{agent.id}</div>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "24px" }}>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>{stats?.safetyScore ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>safety score</div>
            </div>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>{stats?.totalActions ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>total actions</div>
            </div>
            {agent.hcs_topic_id && (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px 20px", textAlign: "center" }}>
                <a href={`https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`} target="_blank" rel="noopener" style={{ fontSize: "12px", fontFamily: "monospace", color: "#10b981", textDecoration: "none" }}>{agent.hcs_topic_id} ↗</a>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>HCS audit trail</div>
              </div>
            )}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            Managed by <span style={{ fontFamily: "monospace" }}>{agent.owner_wallet?.slice(0, 6)}...{agent.owner_wallet?.slice(-4)}</span>
          </div>
          <Link href="/dashboard" style={{ color: "var(--accent)", fontSize: "13px" }}>← Back to Dashboard</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <DashboardHeader />
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "72px 24px 32px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "20px" }}>
          <Link href="/dashboard" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>Dashboard</Link>
          <span style={{ margin: "0 8px" }}>›</span>
          <span style={{ color: "var(--text-primary)" }}>{agent.name || agent.id}</span>
        </div>

        {/* Unclaimed banner — agent is running but no operator has claimed it yet */}
        {!isClaimed && (
          <ClaimBanner agentId={decodedId} onClaimed={() => window.location.reload()} />
        )}

        {/* RogueBot warning banner */}
        {decodedId === "rogue-bot-demo" && (
          <div style={{ background: "rgba(180,50,50,0.05)", border: "1px solid rgba(180,50,50,0.25)", borderRadius: "8px", padding: "14px 18px", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#c0392b", marginBottom: "3px" }}>
              Untrusted agent — safety score {stats?.safetyScore ?? 245}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Blocked {stats?.blockedActions ?? 5} times for credential harvesting, RCE attempts, and privilege escalation. Every blocked action is written to Hedera HCS.
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <div className="name-wrap" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: decodedId === "rogue-bot-demo" ? "#c0392b" : "var(--text-primary)" }}>{agent.name || agent.id}</h1>
              <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>
                {agent.id.length > 20 ? agent.id.slice(0, 10) + "…" + agent.id.slice(-6) : agent.id}
              </span>
              <span className="name-copy-btn"><CopyButton text={agent.id} label="agent ID" /></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isLive ? "#10b981" : "#555" }} />
              <span style={{ fontSize: "12px", color: isLive ? "#10b981" : "var(--text-tertiary)" }}>
                {isLive ? "Live" : "Offline"}
              </span>
            </div>
            {activeAlerts.length > 0 && (
              <span style={{ fontSize: "12px", padding: "2px 10px", borderRadius: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
                {activeAlerts.length} alert{activeAlerts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Scores — donut rings */}
          {stats && (
            <div id="tour-agent-stats" style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "12px", alignItems: "flex-start" }}>
              <ScoreRing value={stats.safetyScore ?? 1000} label="safety score" threshHigh={900} threshMid={600} />
              <ScoreRing value={stats.reputationScore ?? 500} label="reputation"  threshHigh={700} threshMid={400} />
            </div>
          )}

          {/* Activity stats + HCS link */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {stats && [
              { label: "blocked", value: stats.blockedActions ?? 0, color: (stats.blockedActions ?? 0) > 0 ? "#c0392b" : "var(--text-tertiary)", bold: true, title: "Actions blocked before execution" },
              { label: "high risk", value: stats.highRiskActions ?? 0, color: (stats.highRiskActions ?? 0) > 0 ? "#d4890a" : "var(--text-tertiary)", bold: false, title: "High-risk actions flagged but allowed" },
              { label: "today", value: stats.actionsToday ?? 0, color: "var(--text-secondary)", bold: false, title: "Actions logged today" },
              { label: "total", value: stats.totalActions ?? 0, color: "var(--text-tertiary)", bold: false, title: "Total actions logged all time" },
            ].map(({ label, value, color, bold, title }) => (
              <div key={label} title={title} style={{ display: "flex", gap: "4px", alignItems: "baseline", padding: "2px 0" }}>
                <span style={{ fontSize: "13px", fontWeight: bold ? 700 : 500, fontFamily: "monospace", color }}>{value}</span>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{label}</span>
              </div>
            ))}
            {totalEarned > 0 && (
              <div style={{ display: "flex", gap: "4px", alignItems: "baseline", padding: "2px 0" }}>
                <span style={{ fontSize: "13px", fontWeight: 500, fontFamily: "monospace", color: "#d4890a" }}>{totalEarned.toFixed(4)} HBAR</span>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>earned</span>
              </div>
            )}
            {agent.hcs_topic_id && (
              <div className="hcs-wrap" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <a
                  href={hashScanUrl || `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}`}
                  target="_blank" rel="noopener"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", color: "var(--accent)", textDecoration: "none", fontFamily: "monospace" }}
                >
                  HCS {agent.hcs_topic_id} ↗
                </a>
                <span className="hcs-copy-btn"><CopyButton text={agent.hcs_topic_id} label="HCS topic" /></span>
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div id="tour-tab-bar" style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "28px", flexWrap: "wrap" }}>
          {(["activity", "jobs", "earnings", "policies", "recovery", "settings", "delegations"] as Tab[]).map(t => (
            <button
              key={t}
              id={`tour-tab-${t}`}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 16px", fontSize: "14px",
                cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)",
                fontWeight: tab === t ? 600 : 400,
                textTransform: "capitalize", marginBottom: "-1px",
                transition: "color 0.15s",
              }}
            >
              {t}
              {t === "activity" && liveLogs.length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", background: "var(--accent)", color: "#000", borderRadius: "8px", padding: "1px 5px", fontWeight: 700 }}>
                  LIVE
                </span>
              )}
              {t === "policies" && policies.length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-tertiary)" }}>{policies.length}</span>
              )}
              {t === "earnings" && earnings.length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-tertiary)" }}>{earnings.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Activity ───────────────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div id="tour-activity-feed">
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              {["all", "blocked", "high", "medium", "low"].map(f => (
                <button
                  key={f}
                  onClick={() => setRiskFilter(f)}
                  style={{
                    padding: "4px 12px", fontSize: "12px", borderRadius: "20px", cursor: "pointer",
                    border: `1px solid ${riskFilter === f ? "var(--accent)" : "var(--border)"}`,
                    background: riskFilter === f ? "var(--accent-dim)" : "transparent",
                    color: riskFilter === f ? "var(--accent)" : "var(--text-tertiary)",
                  }}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-tertiary)", alignSelf: "center" }}>
                {filteredLogs.length} entries
              </span>
            </div>

            {filteredLogs.length === 0 ? (
              allLogs.length === 0 ? (
                <ConnectAgentGuide agentId={decodedId} apiKey={agent?.api_key} />
              ) : (
                <div style={{ textAlign: "center", padding: "60px", color: "var(--text-tertiary)", fontSize: "14px" }}>
                  No entries match this filter.
                </div>
              )
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                {filteredLogs.map((log, i) => (
                  <div
                    key={log.id || i}
                    style={{
                      display: "grid", gridTemplateColumns: "80px 1fr auto auto",
                      gap: "12px", padding: "11px 14px", alignItems: "start",
                      background: log.blockReason ? "rgba(239,68,68,0.03)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      borderRadius: "4px",
                      borderLeft: log.blockReason ? "2px solid rgba(239,68,68,0.4)" : "2px solid transparent",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", paddingTop: "1px" }}>
                      {timeAgo(log.timestamp)}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: log.blockReason ? "4px" : 0 }}>
                        {log.description || log.action}
                      </div>
                      {log.blockReason && (
                        <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "2px" }}>
                          Blocked: {log.blockReason}
                          {" "}
                          <span style={{ color: "#f97316", fontFamily: "monospace" }}>
                            {/credential|ssh|passwd|shadow|ssl|kubernetes/i.test(log.blockReason) || /rce|curl.*bash|wget.*sh|reverse.shell|netcat/i.test(log.blockReason)
                              ? "−50 trust (critical)"
                              : "−15 trust (high)"}
                          </span>
                        </div>
                      )}
                    </div>
                    <RiskBadge level={log.blockReason ? "blocked" : log.riskLevel} />
                    {log.hcsSequenceNumber ? (
                      <a
                        href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${log.hcsSequenceNumber}` : "#"}
                        target="_blank" rel="noopener"
                        style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)", whiteSpace: "nowrap" }}
                      >
                        #{log.hcsSequenceNumber}
                      </a>
                    ) : <span />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Jobs ───────────────────────────────────────────────────────────── */}
        {tab === "jobs" && (
          <div>
            {jobs.length === 0 ? (
              <JobsEmptyGuide />
            ) : (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 120px auto", gap: "12px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <div>Job ID</div><div>Status</div><div>Amount</div><div>Updated</div><div>Tx</div>
                </div>
                {jobs.map((job, i) => {
                  const sc = JOB_STATUS_COLORS[job.status] || "#6b7280";
                  return (
                    <div key={job.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 120px auto", gap: "12px", padding: "12px 16px", alignItems: "center", borderBottom: i < jobs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                      <div style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)" }}>
                        {job.jobId || job.id}
                        {job.description && <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "inherit", marginTop: "2px" }}>{job.description.slice(0, 60)}</div>}
                      </div>
                      <div><span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: `${sc}18`, border: `1px solid ${sc}40`, color: sc }}>{job.status}</span></div>
                      <div style={{ fontSize: "13px", fontFamily: "monospace", color: "#f59e0b" }}>{job.amount ? `${job.amount} ℏ` : "—"}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{job.updatedAt ? timeAgo(job.updatedAt) : "—"}</div>
                      <div>
                        {job.txHash ? (
                          <a href={`https://hashscan.io/testnet/transaction/${job.txHash}`} target="_blank" rel="noopener" style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>View ↗</a>
                        ) : <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Earnings ───────────────────────────────────────────────────────── */}
        {tab === "earnings" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
              {[
                { label: "Total Earned", value: `${totalEarned.toFixed(4)} ℏ`, color: "#f59e0b" },
                { label: "Payments", value: earnings.length, color: "var(--text-primary)" },
                { label: "Avg Payment", value: earnings.length > 0 ? `${(totalEarned / earnings.length).toFixed(4)} ℏ` : "—", color: "var(--text-secondary)" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "monospace", color, marginBottom: "4px" }}>{value}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
                </div>
              ))}
            </div>

            {earnings.length === 0 ? (
              <EarningsEmptyGuide />
            ) : (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 200px 120px auto", gap: "12px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <div>Source</div><div>Amount</div><div>Split (dev/ops/reinvest)</div><div>When</div><div>HCS</div>
                </div>
                {earnings.map((e, i) => (
                  <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 200px 120px auto", gap: "12px", padding: "12px 16px", alignItems: "center", borderBottom: i < earnings.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>{e.source || "unknown"}</div>
                    <div style={{ fontSize: "14px", fontFamily: "monospace", fontWeight: 700, color: "#f59e0b" }}>{e.amount_hbar.toFixed(4)} ℏ</div>
                    <div style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                      <span style={{ color: "#10b981" }}>{e.split_dev}%</span> / <span style={{ color: "#3b82f6" }}>{e.split_ops}%</span> / <span style={{ color: "#f59e0b" }}>{e.split_reinvest}%</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{timeAgo(e.timestamp)}</div>
                    <div>
                      {e.hcs_paystub_sequence ? (
                        <a href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${e.hcs_paystub_sequence}` : "#"} target="_blank" rel="noopener" style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }}>
                          #{e.hcs_paystub_sequence} ↗
                        </a>
                      ) : <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>—</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Earnings split config editor */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Earnings Split Configuration</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "16px" }}>How HBAR earnings are distributed when this agent completes a job.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                {([
                  { key: "dev" as const, label: "Developer %", color: "#10b981" },
                  { key: "ops" as const, label: "Operations %", color: "#3b82f6" },
                  { key: "reinvest" as const, label: "Reinvest %", color: "#f59e0b" },
                ] as { key: "dev" | "ops" | "reinvest"; label: string; color: string }[]).map(({ key, label, color }) => (
                  <div key={key}>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>{label}</div>
                    <div style={{ position: "relative" }}>
                      <input
                        type="number" min={0} max={100}
                        value={splitConfig[key]}
                        onChange={e => setSplitConfig(s => ({ ...s, [key]: Number(e.target.value) }))}
                        style={{ width: "100%", padding: "8px 28px 8px 10px", fontSize: "15px", fontWeight: 700, color, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "monospace", boxSizing: "border-box" as const }}
                      />
                      <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", color: "var(--text-tertiary)" }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: splitConfig.dev + splitConfig.ops + splitConfig.reinvest === 100 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: splitConfig.dev + splitConfig.ops + splitConfig.reinvest === 100 ? "var(--accent)" : "#ef4444", border: `1px solid ${splitConfig.dev + splitConfig.ops + splitConfig.reinvest === 100 ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  {splitConfig.dev + splitConfig.ops + splitConfig.reinvest}/100
                </span>
                <button
                  onClick={saveSplitConfig}
                  disabled={splitSaving || splitConfig.dev + splitConfig.ops + splitConfig.reinvest !== 100}
                  style={{ padding: "7px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: (splitSaving || splitConfig.dev + splitConfig.ops + splitConfig.reinvest !== 100) ? 0.5 : 1 }}
                >
                  {splitSaved ? "Saved" : splitSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Policies ───────────────────────────────────────────────────────── */}
        {tab === "policies" && (
          <div>
            <div id="tour-policy-form" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Add Blocking Rule</div>
                <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "10px", background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7" }}>for operators</span>
              </div>

              {/* Demo quick-fill */}
              <div style={{ marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Quick demo:</span>
                <button
                  onClick={() => { setPolicyType("blacklist_domain"); setPolicyValue("china.com"); setPolicyLabel("No traffic to China"); }}
                  style={{ fontSize: "11px", padding: "3px 10px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", color: "#ef4444", cursor: "pointer", fontFamily: "monospace" }}
                >
                  block china.com
                </button>
                <button
                  onClick={() => { setPolicyType("blacklist_command"); setPolicyValue("curl"); setPolicyLabel("No curl allowed"); }}
                  style={{ fontSize: "11px", padding: "3px 10px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", color: "#ef4444", cursor: "pointer", fontFamily: "monospace" }}
                >
                  block curl
                </button>
                <button
                  onClick={() => { setPolicyType("cap_hbar"); setPolicyValue("10"); setPolicyLabel("Max 10 ℏ per tx"); }}
                  style={{ fontSize: "11px", padding: "3px 10px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", color: "#ef4444", cursor: "pointer", fontFamily: "monospace" }}
                >
                  cap 10 ℏ
                </button>
                <button
                  onClick={() => { setPolicyType("regex_output"); setPolicyValue("sk_live_.*"); setPolicyLabel("Block leaked API keys"); }}
                  style={{ fontSize: "11px", padding: "3px 10px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", color: "#ef4444", cursor: "pointer", fontFamily: "monospace" }}
                >
                  regex: sk_live_.*
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "170px 1fr 1fr auto", gap: "10px", alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Type</div>
                  <select value={policyType} onChange={e => setPolicyType(e.target.value)} style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer" }}>
                    <option value="blacklist_domain">blacklist_domain</option>
                    <option value="blacklist_command">blacklist_command</option>
                    <option value="cap_hbar">cap_hbar</option>
                    <option value="block_file_path">block_file_path</option>
                    <option value="regex_output">regex_output</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Value</div>
                  <input
                    type="text"
                    placeholder={
                      policyType === "blacklist_domain" ? "e.g. china.com" :
                      policyType === "blacklist_command" ? "e.g. curl" :
                      policyType === "cap_hbar" ? "e.g. 10" :
                      policyType === "block_file_path" ? "e.g. /etc/passwd" :
                      "e.g. sk_live_.*"
                    }
                    value={policyValue}
                    onChange={e => setPolicyValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addPolicy()}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "monospace", outline: "none" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Label (optional)</div>
                  <input type="text" placeholder="e.g. No traffic to China" value={policyLabel} onChange={e => setPolicyLabel(e.target.value)} style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "inherit", outline: "none" }} />
                </div>
                <button onClick={addPolicy} disabled={policyLoading || !policyValue.trim()} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: policyLoading || !policyValue.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}>
                  {policyLoading ? "..." : "Add Rule"}
                </button>
              </div>
            </div>

            {policies.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                No custom policies. Use the quick demo buttons above to add your first rule.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "32px" }}>
                {policies.map(policy => {
                  const triggerCount = logs.filter(l => l.blockReason && l.blockReason.includes(policy.value)).length;
                  const testResult = policyTestResults[policy.id];
                  return (
                    <div key={policy.id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", color: "#3b82f6", whiteSpace: "nowrap", fontFamily: "monospace" }}>{policy.type}</span>
                        <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)", flex: 1 }}>{policy.value}</span>
                        {policy.label && <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{policy.label}</span>}
                        {triggerCount > 0 && (
                          <span style={{ fontSize: "11px", padding: "1px 7px", borderRadius: "4px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                            {triggerCount} trigger{triggerCount !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{timeAgo(policy.created_at)}</span>
                        <button
                          onClick={() => testPolicy(policy)}
                          disabled={testingPolicyId === policy.id}
                          style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "11px", color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap", opacity: testingPolicyId === policy.id ? 0.5 : 1 }}
                        >
                          {testingPolicyId === policy.id ? "Testing..." : "Test Policy"}
                        </button>
                        <button onClick={() => deletePolicy(policy.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: "18px", lineHeight: 1, padding: "0 4px" }}>×</button>
                      </div>
                      {testResult && (
                        <div style={{ marginTop: "8px", fontSize: "12px", fontFamily: "monospace", color: testResult.ok ? "#10b981" : "#f59e0b", padding: "4px 8px", background: testResult.ok ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)", borderRadius: "4px" }}>
                          {testResult.msg}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeAlerts.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px", color: "#c0392b" }}>Active Alerts</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {activeAlerts.map(alert => (
                    <div key={alert.id} style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "12px 16px" }}>
                      <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", whiteSpace: "nowrap" }}>{alert.triggerType}</span>
                      <span style={{ fontSize: "13px", color: "var(--text-primary)", flex: 1 }}>{alert.description}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{timeAgo(alert.timestamp)}</span>
                      <button onClick={() => resolveAlert(alert.id)} style={{ background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", cursor: "pointer", color: "#ef4444", fontSize: "11px", padding: "3px 8px" }}>Resolve</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── Recovery ───────────────────────────────────────────────────────── */}
        {tab === "recovery" && (
          <div>
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>Verifiable Operational History</h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Every action is permanently written to Hedera HCS. After a crash or restart, your agent reads this topic to recover context — knowing what it tried, what was blocked, and which jobs are still open.
              </p>
            </div>

            {memoryLoading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px" }}>Reading Hedera HCS...</div>
            ) : !memory ? (
              <RecoveryEmptyGuide />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div id="tour-recovery-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                  {[
                    { label: "HCS Messages", value: memory.hcs_message_count || memory.lifetime_stats?.totalActions || 0, color: "var(--accent)" },
                    { label: "Blocked Actions", value: memory.blocked_actions.length || memory.lifetime_stats?.blockedActions || 0, color: "#c0392b" },
                    { label: "Open Jobs", value: memory.open_jobs.length, color: "#f59e0b" },
                    { label: "Completions", value: memory.recent_completions.length, color: "#10b981" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                      <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "monospace", color, marginBottom: "4px" }}>{value}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Recovery Context (sent to agent on restart)</div>
                  <pre style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}>
                    {memory.summary || "No summary available."}
                  </pre>
                </div>

                {memory.blocked_actions.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "20px" }}>
                    <div style={{ fontSize: "12px", color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>Blocked Actions — Permanently on HCS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {memory.blocked_actions.map((ba, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", fontSize: "13px" }}>
                          <a href={agent.hcs_topic_id ? `https://hashscan.io/testnet/topic/${agent.hcs_topic_id}/messages/${ba.seq}` : "#"} target="_blank" rel="noopener" style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--accent)", whiteSpace: "nowrap", paddingTop: "1px" }}>#{ba.seq}</a>
                          <div>
                            <span style={{ color: "#ef4444" }}>{ba.action}</span>
                            <span style={{ color: "var(--text-tertiary)", marginLeft: "8px" }}>— {ba.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {memory.open_jobs.length > 0 && (
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>Open Jobs</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {memory.open_jobs.map((job, i) => {
                        const sc = JOB_STATUS_COLORS[job.status] || "#6b7280";
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}>
                            <span style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "4px", background: `${sc}18`, border: `1px solid ${sc}40`, color: sc }}>{job.status}</span>
                            <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{job.jobId}</span>
                            {job.amount !== undefined && <span style={{ color: "#f59e0b" }}>{job.amount} ℏ</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Add to your agent startup (skill.md Step 0)</div>
                  <pre style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", overflowX: "auto", margin: 0, whiteSpace: "pre-wrap" }}>
{`const r = await fetch("https://veridex.sbs/v2/agent/${decodedId}/memory");
const memory = await r.json();
// memory.summary → plain-English LLM context
// memory.blocked_actions → what not to try again`}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Delegations ────────────────────────────────────────────────────── */}
        {tab === "delegations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Create Delegation */}
            <div id="tour-delegation-form" style={{ background: "var(--bg-secondary)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>Grant Capability Delegation (ERC-7715)</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "18px", lineHeight: 1.6 }}>
                Define exactly what this agent is allowed to do. The wallet owner signs the delegation — Veridex enforces it at every preflight check.
              </div>

              {/* Action checkboxes */}
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Allowed Actions</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                {AGENT_ACTIONS.map(a => {
                  const checked = selectedActions.includes(a.id);
                  return (
                    <label key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", background: checked ? "rgba(16,185,129,0.06)" : "var(--bg-tertiary)", border: `1px solid ${checked ? "rgba(16,185,129,0.4)" : "var(--border)"}`, borderRadius: "6px", cursor: "pointer", transition: "all 0.15s" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          if (e.target.checked) setSelectedActions(p => [...p, a.id]);
                          else setSelectedActions(p => p.filter(x => x !== a.id));
                        }}
                        style={{ marginTop: "2px", accentColor: "var(--accent)" }}
                      />
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: checked ? "var(--accent)" : "var(--text-primary)" }}>{a.label}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{a.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Caveat type */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "18px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Caveat Type</div>
                  <select
                    value={selectedCaveat}
                    onChange={e => setSelectedCaveat(e.target.value)}
                    style={{ padding: "7px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer" }}
                  >
                    <option value="action_scope">Action Scope</option>
                    <option value="time_bound">Time Bound</option>
                  </select>
                </div>
                <div style={{ alignSelf: "flex-end" }}>
                  <button
                    onClick={signAndDelegate}
                    disabled={delegationSigning || selectedActions.length === 0}
                    style={{ padding: "8px 20px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 700, color: "#000", cursor: "pointer", opacity: (delegationSigning || selectedActions.length === 0) ? 0.5 : 1 }}
                  >
                    {delegationSigning ? "Signing..." : "Sign & Delegate"}
                  </button>
                </div>
              </div>

              {delegationMsg && (
                <div style={{ fontSize: "13px", padding: "8px 12px", borderRadius: "6px", background: delegationMsg.startsWith("Error") || delegationMsg.startsWith("Select") || delegationMsg.startsWith("Signature") || delegationMsg.startsWith("MetaMask") ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)", border: `1px solid ${delegationMsg.startsWith("Error") || delegationMsg.startsWith("Select") || delegationMsg.startsWith("Signature") || delegationMsg.startsWith("MetaMask") ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`, color: delegationMsg.startsWith("Error") || delegationMsg.startsWith("Select") || delegationMsg.startsWith("Signature") || delegationMsg.startsWith("MetaMask") ? "#ef4444" : "var(--accent)" }}>
                  {delegationMsg}
                </div>
              )}
            </div>

            {/* Active Delegations */}
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px" }}>Active Delegations</div>
              {delegationsLoading ? (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-tertiary)", fontSize: "14px" }}>Loading...</div>
              ) : delegations.length === 0 ? (
                <div style={{ padding: "20px", background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: "8px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  No delegations. This agent operates with default Veridex blocking rules. Add a delegation above to scope its capabilities.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {delegations.map(d => {
                    let actions: string[] = [];
                    try { actions = JSON.parse(d.allowed_actions); } catch {}
                    const shortDelegator = d.delegator_address
                      ? `${d.delegator_address.slice(0, 6)}…${d.delegator_address.slice(-4)}`
                      : "unknown";
                    return (
                      <div key={d.id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                          <div>
                            <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px" }}>Delegator</div>
                            <div style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)" }}>{shortDelegator}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.3)", color: "#818cf8", whiteSpace: "nowrap" as const }}>
                              {d.caveat_type}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--text-tertiary)", whiteSpace: "nowrap" as const }}>{timeAgo(d.created_at)}</span>
                            <button
                              onClick={() => revokeDelegation(d.id)}
                              title="Revoke delegation"
                              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", color: "#ef4444", cursor: "pointer", fontSize: "14px", padding: "2px 8px", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                          {actions.map(act => (
                            <span key={act} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}>
                              {act}
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                          hash: {d.delegation_hash.slice(0, 12)}…
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Settings ───────────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* API Key */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <div style={{ fontSize: "14px", fontWeight: 600 }}>Agent API Key</div>
                <span style={{ fontSize: "10px", fontWeight: 700, background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "4px", padding: "2px 6px" }}>REQUIRED</span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "14px", lineHeight: 1.6 }}>
                Every <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.07)", padding: "1px 5px", borderRadius: "3px" }}>/api/log</code> call must include this as the <code style={{ fontSize: "11px", background: "rgba(255,255,255,0.07)", padding: "1px 5px", borderRadius: "3px" }}>x-api-key</code> header. Without it, your agent&apos;s requests will be rejected — this is what proves the logs belong to you.
              </div>
              {agent.api_key ? (
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <code style={{ flex: 1, fontSize: "12px", fontFamily: "monospace", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "9px 12px", color: "var(--text-primary)", letterSpacing: "0.5px", wordBreak: "break-all" as const }}>
                    {agent.api_key}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(agent.api_key!); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                    style={{ padding: "8px 14px", background: copiedKey ? "rgba(16,185,129,0.15)" : "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px", color: copiedKey ? "#10b981" : "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" as const, transition: "all 0.15s" }}
                  >
                    {copiedKey ? "Copied!" : "Copy"}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#f59e0b" }}>
                  No API key found. Re-register this agent via <code style={{ fontSize: "11px" }}>POST /v2/join</code> to generate one.
                </div>
              )}
              <div style={{ marginTop: "14px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "8px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>Usage</div>
                <pre style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-secondary)", margin: 0, whiteSpace: "pre-wrap" as const, lineHeight: 1.6 }}>{`curl -X POST https://veridex.sbs/api/proxy/api/log \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${agent.api_key || "YOUR_API_KEY"}" \\
  -d '{"agentId":"${decodedId}","action":"web_search","tool":"web_search","params":{"query":"example"},"phase":"before"}'`}</pre>
              </div>
            </div>

            {/* Rename */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Rename Agent</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "14px" }}>Change the display name for this agent in the dashboard.</div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Agent Name</div>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && renameAgent()}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "14px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const }}
                  />
                </div>
                <button
                  onClick={renameAgent}
                  disabled={renaming || !newName.trim()}
                  style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: (renaming || !newName.trim()) ? 0.5 : 1 }}
                >
                  {renaming ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {/* Export */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Export Activity Logs</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "14px" }}>Download complete activity log as JSON.</div>
              <button
                onClick={exportLogs}
                style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                Export JSON
              </button>
            </div>

            {/* Visibility */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Visibility</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "16px" }}>
                Controls whether this agent appears on the public leaderboard and whether its trust score is queryable without an API key.
              </div>
              <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                {(["public","private"] as const).map(v => (
                  <button key={v} onClick={() => saveVisibility(v)} disabled={visibilitySaving} style={{
                    flex: 1, padding: "10px 14px", borderRadius: "7px", fontSize: "13px", fontWeight: 600,
                    cursor: "pointer", border: "1px solid",
                    background: visibility === v ? (v === "public" ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.06)") : "transparent",
                    borderColor: visibility === v ? (v === "public" ? "#10b981" : "rgba(255,255,255,0.2)") : "var(--border)",
                    color: visibility === v ? (v === "public" ? "#10b981" : "var(--text-primary)") : "var(--text-tertiary)",
                  }}>
                    {v === "public" ? "Public" : "Private"}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>
                {visibility === "public"
                  ? "Appears on leaderboard. Trust score queryable by anyone. Other agents can discover and hire this agent."
                  : "Hidden from leaderboard. Trust score requires your API key. Use for internal agents and compliance logging."}
              </div>
              {visibilitySaved && <div style={{ fontSize: "12px", color: "#10b981", marginTop: "8px" }}>Saved</div>}
            </div>

            {/* Telegram */}
            <div id="tour-telegram-commands" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <div style={{ fontSize: "14px", fontWeight: 600 }}>Telegram Alerts</div>
                {agent.telegram_chat_id && (
                  <span style={{ fontSize: "11px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: "20px", padding: "2px 8px" }}>Connected</span>
                )}
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "20px" }}>
                Monitor this agent on the go — get instant Telegram messages when a blocked action or high-risk event fires, without opening the dashboard. You can also send commands to check status or quarantine the agent from your phone.
              </div>

              {/* How to set up */}
              <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px", padding: "14px 16px", marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Setup — takes 30 seconds</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                  {[
                    <>Open Telegram and search for <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>@veridex_manager_bot</span></>,
                    <>Send <span style={{ fontFamily: "monospace", color: "#10b981" }}>/start</span> — the bot replies with your chat ID (a number like <span style={{ fontFamily: "monospace", color: "var(--text-tertiary)" }}>123456789</span>)</>,
                    "Paste the chat ID in the field below and hit Save",
                    <>Hit <strong>Send test</strong> to confirm — you&apos;ll get a message in Telegram immediately</>,
                  ].map((text, i) => (
                    <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>{i + 1}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.65 }}>{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connect form */}
              <div id="tour-telegram-connect" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "180px" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>Your Telegram Chat ID</div>
                    <input
                      type="text"
                      placeholder="e.g. 123456789"
                      value={telegramChatId}
                      onChange={e => setTelegramChatId(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", fontSize: "13px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-primary)", fontFamily: "monospace", outline: "none", boxSizing: "border-box" as const }}
                    />
                  </div>
                  <button onClick={saveTelegramConfig} disabled={telegramSaving || !telegramChatId.trim()} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: (telegramSaving || !telegramChatId.trim()) ? 0.5 : 1, whiteSpace: "nowrap" }}>
                    {telegramSaved ? "Saved ✓" : telegramSaving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={testTelegramConfig} disabled={telegramTesting || !agent.telegram_chat_id} style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer", opacity: (telegramTesting || !agent.telegram_chat_id) ? 0.5 : 1, whiteSpace: "nowrap" }}>
                    {telegramTesting ? "Sending..." : "Send test"}
                  </button>
                  {telegramTestMsg && (
                    <span style={{ fontSize: "12px", color: telegramTestMsg.startsWith("Sent") ? "var(--accent)" : "#c0392b" }}>
                      {telegramTestMsg}
                    </span>
                  )}
                </div>
              </div>

              {/* Commands reference */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>What you can do from Telegram</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {[
                    { cmd: `/status ${decodedId}`, desc: "Full stats — actions, blocks, trust score, earnings" },
                    { cmd: `/logs ${decodedId}`, desc: "Recent activity feed for this agent" },
                    { cmd: `/block ${decodedId}`, desc: "Quarantine immediately — all future actions blocked" },
                    { cmd: `/unblock ${decodedId}`, desc: "Restore a quarantined agent" },
                    { cmd: "/agents", desc: "List all your agents with live status" },
                    { cmd: "/status", desc: "System-wide health across your whole fleet" },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--accent)", background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "4px", padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>{cmd}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.6, paddingTop: "2px" }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "8px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#ef4444", marginBottom: "4px" }}>Danger Zone</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "14px" }}>Permanently delete this agent and all its logs, alerts, and policies.</div>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  style={{ padding: "8px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "6px", fontSize: "13px", color: "#ef4444", cursor: "pointer" }}
                >
                  Delete Agent
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: "13px", color: "#fca5a5", marginBottom: "12px", fontWeight: 600 }}>
                    Are you sure? This cannot be undone.
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteAgent}
                      disabled={deleting}
                      style={{ padding: "8px 16px", background: "#ef4444", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#fff", cursor: "pointer", opacity: deleting ? 0.6 : 1 }}
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {tourActive && (
        <TourBubble steps={agentTourSteps} step={tourStep} next={tourNext} skip={tourSkip} />
      )}
      <style>{`
        .name-copy-btn { opacity: 0; transition: opacity 0.15s; }
        .name-wrap:hover .name-copy-btn { opacity: 1; }
        .hcs-copy-btn { opacity: 0; transition: opacity 0.15s; }
        .hcs-wrap:hover .hcs-copy-btn { opacity: 1; }
        .stat-pill:hover { background: rgba(255,255,255,0.04); }
      `}</style>
    </>
  );
}
