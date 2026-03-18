"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { Logo } from "./components/Logo";
import { Nav } from "./components/Nav";
import { useWallet } from "./lib/wallet";

interface OverviewStats { totalAgents: number; logsToday: number; blockedToday: number; totalHbar: number; }
interface FeedEntry { id: string; agentId: string; agentName?: string; description: string; riskLevel: string; action: string; timestamp: number; }

const DEMO_FEED: FeedEntry[] = [
  { id: "d1", agentId: "research-bot-demo", agentName: "ResearchBot", description: 'web_search "Hedera HCS throughput benchmarks"', riskLevel: "low",     action: "web_search",     timestamp: 0 },
  { id: "d2", agentId: "trading-bot-demo",  agentName: "TradingBot",  description: "earnings_split 3.2 ℏ → dev 60% · ops 30% · reinvest 10%", riskLevel: "low", action: "earnings_split", timestamp: 0 },
  { id: "d3", agentId: "rogue-bot-demo",    agentName: "RogueBot",    description: "shell_exec cat /etc/passwd — credential harvest", riskLevel: "blocked", action: "shell_exec", timestamp: 0 },
  { id: "d4", agentId: "data-bot-demo",     agentName: "DataBot",     description: "file_read /var/app/reports/quarterly.csv — 2.1MB", riskLevel: "low", action: "file_read", timestamp: 0 },
  { id: "d5", agentId: "api-bot-demo",      agentName: "APIBot",      description: "api_call POST https://partner-api.io/webhook — 200 OK", riskLevel: "low", action: "api_call", timestamp: 0 },
];

const DEMO_STATS = { totalAgents: 5, logsToday: 1284, blockedToday: 17, totalHbar: 48.3 };

const RISK_COLOR: Record<string, string> = { low: "#10b981", medium: "#f59e0b", high: "#ef4444", blocked: "#dc2626" };
const RISK_BG:    Record<string, string> = { low: "transparent", medium: "transparent", high: "rgba(239,68,68,0.04)", blocked: "rgba(220,38,38,0.07)" };

function LiveFeedStrip() {
  const [entries, setEntries] = useState<FeedEntry[]>(() =>
    DEMO_FEED.slice(0, 3).map((e, i) => ({ ...e, timestamp: Date.now() - (3 - i) * 18000 }))
  );
  const idxRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const next = DEMO_FEED[idxRef.current % DEMO_FEED.length];
      idxRef.current++;
      setEntries(prev => [{ ...next, id: `${next.id}-${Date.now()}`, timestamp: Date.now() }, ...prev].slice(0, 3));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden", width: "100%", maxWidth: "860px" }}>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px", background: "#111113" }}>
        <div style={{ display: "flex", gap: "5px" }}>
          {["#ef4444","#f59e0b","#10b981"].map(c => <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
        </div>
        <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace", flex: 1 }}>veridex — live agent feed</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "livepulse 2s infinite" }} />
          <span style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}>live</span>
        </div>
      </div>
      {entries.map((e, i) => (
        <div key={e.id} style={{ padding: "8px 16px", borderBottom: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", gap: "10px", alignItems: "center", background: RISK_BG[e.riskLevel] }}>
          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "3px", fontFamily: "monospace", textTransform: "uppercase" as const, flexShrink: 0, color: RISK_COLOR[e.riskLevel], border: `1px solid ${RISK_COLOR[e.riskLevel]}44`, background: `${RISK_COLOR[e.riskLevel]}11`, minWidth: "52px", textAlign: "center" as const }}>
            {e.riskLevel}
          </span>
          <span style={{ fontSize: "13px", color: e.riskLevel === "blocked" ? "#fca5a5" : "var(--text-secondary)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {e.riskLevel === "blocked" && <span style={{ color: "#ef4444" }}>⛔ </span>}
            {e.description}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace", flexShrink: 0 }}>
            {e.agentName} · {Math.floor((Date.now() - e.timestamp) / 1000)}s ago
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const { connect, isConnecting } = useWallet();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/proxy/api/monitor/overview");
        if (r.ok) setStats(await r.json());
        else setStats(DEMO_STATS);
      } catch { setStats(DEMO_STATS); }
    };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  const snippet = `{\n  "skills": ["https://veridex.sbs/skill.md"]\n}`;
  function copy() { navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }

  const s = stats ?? DEMO_STATS;

  return (
    <>
      <Nav />
      <main>

        {/* ── HERO ─────────────────────────────────────────────── */}
        <section style={{ padding: "100px 24px 64px", maxWidth: "820px", margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "20px", padding: "4px 14px", display: "inline-block", marginBottom: "32px" }}>
            OpenClaw · Hedera HCS · ERC-8004 · ERC-8183
          </div>
          <h1 style={{ fontSize: "clamp(34px,5.5vw,56px)", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-1.5px", marginBottom: "24px" }}>
            Trust infrastructure<br />
            <span style={{ color: "#10b981" }}>for autonomous agents</span>
          </h1>
          <p style={{ fontSize: "18px", color: "var(--text-secondary)", lineHeight: 1.75, marginBottom: "12px", maxWidth: "600px", margin: "0 auto 12px" }}>
            Agents can earn, spend, coordinate, and execute.
          </p>
          <p style={{ fontSize: "18px", color: "var(--text-tertiary)", lineHeight: 1.75, marginBottom: "40px", maxWidth: "600px", margin: "0 auto 40px" }}>
            Without Veridex, they cannot do it safely or verifiably.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/dashboard" style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "13px 28px", fontSize: "15px", fontWeight: 700, color: "#000", textDecoration: "none", display: "inline-block" }}>
              Open Dashboard
            </Link>
            <Link href="/leaderboard" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "13px 28px", fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", textDecoration: "none", display: "inline-block" }}>
              View Live Feed
            </Link>
          </div>
        </section>

        {/* ── LIVE STRIP ───────────────────────────────────────── */}
        <section style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column" as const, alignItems: "center", gap: "14px" }}>
          <LiveFeedStrip />
          <div style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-tertiary)", display: "flex", gap: "24px", flexWrap: "wrap", justifyContent: "center" }}>
            {[
              `${s.totalAgents} agents monitored`,
              `${s.logsToday.toLocaleString()} actions logged`,
              `${s.blockedToday} blocked`,
              `${s.totalHbar.toFixed(1)} ℏ tracked`,
            ].map(item => <span key={item}>{item}</span>)}
          </div>
        </section>

        {/* ── PRIMARY PROBLEM ──────────────────────────────────── */}
        <section style={{ padding: "80px 24px", maxWidth: "860px", margin: "0 auto" }}>
          <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>The problem</p>
          <h2 style={{ fontSize: "clamp(24px,4vw,38px)", fontWeight: 800, lineHeight: 1.15, marginBottom: "20px", letterSpacing: "-0.5px" }}>
            The problem isn&apos;t that<br />agents are powerful.
          </h2>
          <p style={{ fontSize: "20px", color: "#10b981", fontWeight: 600, marginBottom: "32px" }}>
            It&apos;s that they act without a shared trust layer.
          </p>
          <p style={{ fontSize: "16px", color: "var(--text-secondary)", lineHeight: 1.8, marginBottom: "44px", maxWidth: "640px" }}>
            Autonomous agents can search the web, execute shell commands, move money, accept jobs from other agents, and call external services — continuously, 24/7, with your credentials.
            But their behavior is still opaque: no immutable audit trail, no pre-execution enforcement, no portable reputation, no verifiable recovery after failure.
          </p>

          {/* What agents can do — the gap */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ padding: "28px", borderRight: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#10b981", marginBottom: "18px", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>What agents can do</div>
              {["Execute tools and shell commands","Access files and credentials","Move funds and accept jobs","Call external services and APIs","Interact with other agents"].map(item => (
                <div key={item} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                  <span style={{ color: "#10b981", fontSize: "13px", flexShrink: 0, marginTop: "2px" }}>✓</span>
                  <span style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "28px", background: "rgba(239,68,68,0.03)" }}>
              <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#ef4444", marginBottom: "18px", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>What no one can verify</div>
              {["That they did what was intended","That dangerous actions were stopped","That state can be recovered after failure","That earnings were fairly accounted for","That behavior was what was claimed"].map(item => (
                <div key={item} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                  <span style={{ color: "#ef4444", fontSize: "13px", flexShrink: 0, marginTop: "2px" }}>✕</span>
                  <span style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── WHY IT MATTERS NOW ───────────────────────────────── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "72px 24px", background: "rgba(16,185,129,0.02)" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto" }}>
            <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Why it matters now</p>
            <h2 style={{ fontSize: "clamp(22px,3.5vw,30px)", fontWeight: 700, marginBottom: "24px", lineHeight: 1.2 }}>
              As agent-to-agent commerce emerges,<br />trust cannot depend on local logs.
            </h2>
            <p style={{ fontSize: "16px", color: "var(--text-secondary)", lineHeight: 1.8, marginBottom: "32px" }}>
              When agents transact autonomously, reputation and accountability need tamper-proof attestation —
              not private dashboards or post-hoc debugging.
              Repeated low-cost settlement, verifiable action history, and on-chain reputation scores
              are the primitives agent economies require.
            </p>
            <p style={{ fontSize: "15px", color: "var(--text-tertiary)", lineHeight: 1.8, fontStyle: "italic" }}>
              Hedera is optimized exactly for this: $0.0008 per message, 3–5 second finality,
              immutable append-only topics. The economics of per-action attestation only work here.
            </p>
          </div>
        </section>

        {/* ── SECURITY PROOF-POINT (supporting, not thesis) ────── */}
        <section style={{ padding: "72px 24px", maxWidth: "820px", margin: "0 auto" }}>
          <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>What opacity looks like in practice</p>
          <h2 style={{ fontSize: "clamp(20px,3vw,26px)", fontWeight: 700, marginBottom: "20px" }}>
            The security model is currently absurd.
          </h2>
          <div style={{ fontFamily: "monospace", background: "#0d0d0f", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "18px 22px", marginBottom: "16px", fontSize: "13px", lineHeight: 2.1 }}>
            {[["OPENAI_API_KEY","sk-proj-BL9z..."],["WALLET_PRIVATE_KEY","0xdeadbeef..."],["STRIPE_SECRET","sk_live_9xK..."],["DATABASE_URL","postgres://prod..."]].map(([k,v]) => (
              <div key={k}><span style={{ color: "#10b981" }}>{k}</span><span style={{ color: "#555" }}>=</span><span style={{ color: "#fca5a5" }}>{v}</span></div>
            ))}
            <div style={{ color: "#555", marginTop: "8px" }}># one prompt injection, unsafe skill, or malicious tool call</div>
            <div style={{ color: "#555" }}># and the agent acts before anyone can prove or prevent it</div>
          </div>
          <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>
            Credential exposure is the most visible symptom. But the deeper problem is that every action —
            safe or unsafe — happens with no tamper-proof record and no pre-execution gate.
            That makes agents unsuitable for trust-sensitive coordination at scale.
          </p>
        </section>

        {/* ── POSITIONING ──────────────────────────────────────── */}
        <section style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "72px 24px", background: "rgba(16,185,129,0.02)" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto" }}>
            <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>What Veridex is</p>
            <h2 style={{ fontSize: "clamp(22px,3.5vw,32px)", fontWeight: 700, marginBottom: "12px" }}>
              Not a security scanner.<br />Trust middleware for agent commerce.
            </h2>
            <p style={{ fontSize: "15px", color: "var(--text-tertiary)", marginBottom: "36px", lineHeight: 1.7 }}>
              Every action flows through Veridex before execution — intercepted, evaluated, logged to Hedera, and settled.
            </p>
            <div style={{ fontFamily: "monospace", fontSize: "14px", background: "#0d0d0f", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "8px", padding: "20px 24px", lineHeight: 2.4, marginBottom: "32px" }}>
              <span style={{ color: "var(--text-tertiary)" }}>agent</span>
              {[["preflight","#f59e0b"],["decision","#10b981"],["execution","var(--text-secondary)"],["settlement","#818cf8"]].map(([label, color]) => (
                <span key={label}><span style={{ color: "#333" }}> → </span><span style={{ color }}>{label}</span></span>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px" }}>
              {[
                { label: "Immutable attestation", sub: "Hedera HCS — every action, tamper-proof" },
                { label: "Pre-execution blocking", sub: "dangerous behavior stopped before it runs" },
                { label: "Portable reputation", sub: "ERC-8004 on-chain score, verifiable by any agent" },
                { label: "Provable settlement", sub: "ERC-8183 earnings split with HCS pay stubs" },
              ].map(c => (
                <div key={c.label} style={{ padding: "16px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#10b981", marginBottom: "6px" }}>{c.label}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CORE MECHANISMS ──────────────────────────────────── */}
        <section style={{ padding: "80px 24px", maxWidth: "900px", margin: "0 auto" }}>
          <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Core system</p>
          <h2 style={{ fontSize: "clamp(22px,3.5vw,30px)", fontWeight: 700, marginBottom: "52px" }}>Five mechanisms. No gaps.</h2>

          <div style={{ display: "flex", flexDirection: "column" as const, gap: "48px" }}>

            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "8px" }}>01</div>
                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>Pre-execution interception</div>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>Every tool call routed through a synchronous preflight. Decision returned before the action runs. No bypass.</p>
              </div>
              <div style={{ flex: "1 1 240px", fontFamily: "monospace", fontSize: "13px", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 18px", lineHeight: 2 }}>
                <div style={{ color: "#555", marginBottom: "6px" }}>POST /api/log</div>
                <div><span style={{ color: "#10b981" }}>allowed: true</span><span style={{ color: "var(--text-tertiary)" }}> → proceed</span></div>
                <div><span style={{ color: "#ef4444" }}>allowed: false</span><span style={{ color: "var(--text-tertiary)" }}> → abort</span></div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "8px" }}>02</div>
                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>Deterministic blocking engine</div>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>Pattern + behavioral detection. Evaluated synchronously before execution. Custom per-agent policies supported.</p>
              </div>
              <div style={{ flex: "1 1 240px", fontFamily: "monospace", fontSize: "12px", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 18px", lineHeight: 2.1 }}>
                {["credential access (/etc/shadow, keys)", "RCE (curl | bash, wget | sh)", "privilege escalation (/root/)", "anomaly bursts — loop detection", "custom policy per agent"].map(p => (
                  <div key={p} style={{ color: "var(--text-tertiary)" }}>— {p}</div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "8px" }}>03</div>
                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>Immutable audit on Hedera HCS</div>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>Every action encrypted and appended to a per-agent topic. Final in 3–5 seconds. Externally verifiable. Independent of your infrastructure.</p>
              </div>
              <div style={{ flex: "1 1 240px", fontFamily: "monospace", fontSize: "13px", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 18px", lineHeight: 2.1 }}>
                {[["encrypted","AES-256-GCM per agent"],["appended","per-agent HCS topic"],["final","~3–5 seconds"],["verifiable","HashScan link on every log"]].map(([k,v]) => (
                  <div key={k}><span style={{ color: "#10b981" }}>{k}</span><span style={{ color: "var(--text-tertiary)" }}>  {v}</span></div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "8px" }}>04</div>
                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>Deterministic recovery</div>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>On restart, one call reconstructs full operational state from HCS. Agent resumes from cryptographic truth — not local memory.</p>
              </div>
              <div style={{ flex: "1 1 240px", fontFamily: "monospace", fontSize: "13px", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 18px", lineHeight: 2.1 }}>
                <div style={{ color: "#555", marginBottom: "8px" }}>GET /v2/agent/:id/memory</div>
                {["open jobs","blocked actions","pending earnings"].map(r => (
                  <div key={r} style={{ color: "var(--text-tertiary)" }}>→ {r}</div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "8px" }}>05</div>
                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>Provable earnings settlement</div>
                <p style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.7 }}>ERC-8183 job earnings split automatically via HTS, logged to HCS as a cryptographic pay stub. Any agent or developer can verify every payment.</p>
              </div>
              <div style={{ flex: "1 1 240px", fontFamily: "monospace", fontSize: "13px", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 18px", lineHeight: 2.1 }}>
                <div style={{ color: "var(--text-secondary)", marginBottom: "8px" }}>ℏ → dev / ops / reinvest</div>
                {[["split","via HTS transfer"],["logged","to HCS topic"],["pay stub","verifiable on HashScan"]].map(([k,v]) => (
                  <div key={k}><span style={{ color: "#10b981" }}>{k}</span><span style={{ color: "var(--text-tertiary)" }}>  {v}</span></div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ── WHY HEDERA ───────────────────────────────────────── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "72px 24px" }}>
          <div style={{ maxWidth: "640px", margin: "0 auto" }}>
            <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Why Hedera</p>
            <h2 style={{ fontSize: "clamp(20px,3vw,26px)", fontWeight: 700, marginBottom: "10px" }}>
              Per-action attestation only works at this cost.
            </h2>
            <p style={{ fontSize: "14px", color: "var(--text-tertiary)", marginBottom: "32px", lineHeight: 1.7 }}>
              Agent-scale logging isn&apos;t viable on other chains. Hedera is the only network where $0.0008 per message + 3–5s finality makes this economically sane.
            </p>
            <div style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", fontFamily: "monospace", fontSize: "13px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--border)", padding: "10px 16px", background: "#111113", color: "var(--text-tertiary)", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                <span>Network</span><span style={{ textAlign: "right" as const }}>100 actions / day</span><span />
              </div>
              {[
                { network: "Ethereum", cost: "$300 – $5,000", note: "", dim: true },
                { network: "Solana",   cost: "~$2.50",        note: "", dim: true },
                { network: "Hedera",   cost: "$0.08",         note: "← only viable option", dim: false },
              ].map(r => (
                <div key={r.network} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: r.dim ? "transparent" : "rgba(16,185,129,0.04)", alignItems: "center" }}>
                  <span style={{ color: r.dim ? "var(--text-tertiary)" : "var(--text-primary)" }}>{r.network}</span>
                  <span style={{ textAlign: "right" as const, color: r.dim ? "var(--text-tertiary)" : "#10b981", fontWeight: r.dim ? 400 : 700 }}>{r.cost}</span>
                  <span style={{ textAlign: "right" as const, fontSize: "11px", color: "#10b981" }}>{r.note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── INSTALL ──────────────────────────────────────────── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "72px 24px" }}>
          <div style={{ maxWidth: "560px", margin: "0 auto" }}>
            <p style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-tertiary)", marginBottom: "16px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Get started</p>
            <h2 style={{ fontSize: "clamp(20px,3vw,26px)", fontWeight: 700, marginBottom: "10px" }}>30 seconds to install</h2>
            <p style={{ fontSize: "14px", color: "var(--text-tertiary)", marginBottom: "24px" }}>Add one line to your OpenClaw config.</p>
            <div style={{ position: "relative", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "8px", padding: "18px 20px", marginBottom: "20px" }}>
              <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.7 }}>{snippet}</pre>
              <button onClick={copy} style={{ position: "absolute", top: "10px", right: "10px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "5px", padding: "3px 10px", fontSize: "11px", color: "var(--text-tertiary)", cursor: "pointer" }}>
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 2.2 }}>
              <span style={{ color: "#10b981" }}>→</span> all actions intercepted and logged to Hedera<br />
              <span style={{ color: "#10b981" }}>→</span> unsafe behavior blocked before execution<br />
              <span style={{ color: "#10b981" }}>→</span> agent appears in dashboard immediately
            </div>
          </div>
        </section>

        {/* ── CLOSING CTA ──────────────────────────────────────── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "80px 24px 100px", maxWidth: "700px", margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(22px,4vw,34px)", fontWeight: 800, lineHeight: 1.2, marginBottom: "16px", letterSpacing: "-0.5px" }}>
            You are building more than<br />an agent security tool.
          </h2>
          <p style={{ fontSize: "16px", color: "var(--text-secondary)", lineHeight: 1.75, marginBottom: "8px" }}>
            You are building trust middleware for agent commerce.
          </p>
          <p style={{ fontSize: "15px", color: "var(--text-tertiary)", lineHeight: 1.75, marginBottom: "44px" }}>
            Immutable attestations. Pre-execution policy. Portable reputation. Provable settlement.
            The primitives agent economies need to function.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/dashboard" style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "13px 28px", fontSize: "15px", fontWeight: 700, color: "#000", textDecoration: "none", display: "inline-block" }}>
              Launch Dashboard
            </Link>
            <Link href="/leaderboard" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "13px 28px", fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", textDecoration: "none", display: "inline-block" }}>
              View Live System
            </Link>
            <button onClick={connect} disabled={isConnecting} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "13px 28px", fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", cursor: "pointer", opacity: isConnecting ? 0.7 : 1 }}>
              {isConnecting ? "Connecting..." : "Install Skill"}
            </button>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────── */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 24px" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-tertiary)", fontSize: "13px" }}>
              <Logo size={14} /> <span>Veridex — ETHDenver 2026</span>
            </div>
            <div style={{ display: "flex", gap: "24px" }}>
              {[["Dashboard","/dashboard"],["Leaderboard","/leaderboard"],["skill.md","/skill.md"],["HashScan","https://hashscan.io/testnet"]].map(([label,href]) => (
                <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener" style={{ fontSize: "13px", color: "var(--text-tertiary)", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>
        </footer>

      </main>
      <style>{`
        @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </>
  );
}
