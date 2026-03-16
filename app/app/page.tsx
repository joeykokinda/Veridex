"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { Logo } from "./components/Logo";
import { Nav } from "./components/Nav";
import { useWallet } from "./lib/wallet";

interface OverviewStats { totalAgents: number; logsToday: number; blockedToday: number; totalHbar: number; }
interface FeedEntry { id: string; agentId: string; agentName?: string; description: string; riskLevel: string; action: string; timestamp: number; }

function LiveFeedDemo() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/proxy/feed/live");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "init" && data.logs) setEntries(data.logs.slice(0, 12).reverse());
        else if (data.type === "log" && data.log) setEntries(prev => [data.log, ...prev].slice(0, 12));
      } catch {}
    };
    return () => es.close();
  }, []);

  const RISK_COLOR: Record<string, string> = { low: "#10b981", medium: "#f59e0b", high: "#ef4444", blocked: "#dc2626" };
  const RISK_BG:    Record<string, string> = { low: "transparent", medium: "transparent", high: "rgba(239,68,68,0.04)", blocked: "rgba(220,38,38,0.07)" };

  return (
    <div style={{ background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden", maxWidth: "640px", width: "100%" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px", background: "#111113" }}>
        <div style={{ display: "flex", gap: "6px" }}>
          {["#ef4444","#f59e0b","#10b981"].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
        </div>
        <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace", flex: 1 }}>veridex — live agent feed</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#10b981" : "#555", animation: connected ? "livepulse 2s infinite" : "none" }} />
          <span style={{ fontSize: "11px", color: connected ? "#10b981" : "var(--text-tertiary)", fontFamily: "monospace" }}>{connected ? "live" : "connecting..."}</span>
        </div>
      </div>
      <div style={{ minHeight: "300px" }}>
        {entries.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px", fontFamily: "monospace" }}>Waiting for agent activity...</div>
        ) : (
          entries.map((e, i) => (
            <div key={e.id || i} style={{ padding: "9px 16px", borderBottom: i < entries.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", gap: "10px", alignItems: "flex-start", background: RISK_BG[e.riskLevel] || "transparent" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "3px", fontFamily: "monospace", textTransform: "uppercase" as const, flexShrink: 0, marginTop: "2px", color: RISK_COLOR[e.riskLevel] || "#aaa", border: `1px solid ${RISK_COLOR[e.riskLevel] || "#aaa"}44`, background: `${RISK_COLOR[e.riskLevel] || "#aaa"}11` }}>
                {e.riskLevel}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", color: e.riskLevel === "blocked" ? "#fca5a5" : "var(--text-primary)", lineHeight: 1.4 }}>
                  {e.riskLevel === "blocked" && <span style={{ color: "#ef4444" }}>⛔ </span>}
                  {e.description || e.action}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace", marginTop: "2px" }}>
                  {e.agentName || e.agentId} · {Math.floor((Date.now() - e.timestamp) / 1000)}s ago
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { connect, isConnecting } = useWallet();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => { try { const r = await fetch("/api/proxy/api/monitor/overview"); if (r.ok) setStats(await r.json()); } catch {} };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  const snippet = `{\n  "skills": ["https://veridex.sbs/skill.md"]\n}`;
  function copy() { navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }

  return (
    <>
      <Nav />
      <main>

        {/* Hero */}
        <section style={{ padding: "90px 24px 70px", maxWidth: "1200px", margin: "0 auto", display: "flex", gap: "60px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 440px", minWidth: 0 }}>
            <div style={{ display: "inline-block", fontSize: "12px", fontFamily: "monospace", color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "20px", padding: "4px 12px", marginBottom: "24px" }}>
              OpenClaw · Hedera HCS · ERC-8004 · ERC-8183
            </div>
            <h1 style={{ fontSize: "50px", fontWeight: 800, lineHeight: 1.1, marginBottom: "20px", letterSpacing: "-1px" }}>
              Your agents are running.<br />
              <span style={{ color: "#10b981" }}>Do you know what they&apos;re doing?</span>
            </h1>
            <p style={{ fontSize: "17px", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "36px", maxWidth: "460px" }}>
              Veridex logs every action your OpenClaw agents take to Hedera HCS.
              Block dangerous actions before they execute. Recover full state after a crash.
              Tamper-proof. Permanent. Verifiable on HashScan.
            </p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button onClick={connect} disabled={isConnecting} style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "12px 28px", fontSize: "15px", fontWeight: 700, color: "#000", cursor: "pointer", opacity: isConnecting ? 0.7 : 1 }}>
                {isConnecting ? "Connecting..." : "Connect Wallet →"}
              </button>
              <Link href="/leaderboard" style={{ display: "inline-flex", alignItems: "center", background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 28px", fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", textDecoration: "none" }}>
                View live demo
              </Link>
            </div>
          </div>
          <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", justifyContent: "center" }}>
            <LiveFeedDemo />
          </div>
        </section>

        {/* Stats bar */}
        <section style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "28px 24px" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", gap: "48px", justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { label: "HCS messages logged", value: stats?.logsToday ?? "—" },
              { label: "Agents monitored",     value: stats?.totalAgents ?? "—" },
              { label: "Actions blocked today",value: stats?.blockedToday ?? "—" },
              { label: "HBAR tracked",         value: stats ? `${stats.totalHbar.toFixed(2)} ℏ` : "—" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "30px", fontWeight: 700, fontFamily: "monospace", color: "#10b981" }}>{s.value}</div>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "4px" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Problem */}
        <section style={{ padding: "80px 24px", maxWidth: "1100px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "52px" }}>
            <h2 style={{ fontSize: "34px", fontWeight: 700, marginBottom: "12px" }}>The problem with agents today</h2>
            <p style={{ fontSize: "16px", color: "var(--text-tertiary)" }}>Every developer starts with this. It&apos;s a disaster waiting to happen.</p>
          </div>
          <div style={{ fontFamily: "monospace", background: "#0d0d0f", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "20px 24px", marginBottom: "52px", fontSize: "13px", lineHeight: 2 }}>
            <div style={{ color: "#555", marginBottom: "4px" }}># your agent .env — full permanent access to everything</div>
            {[["OPENAI_API_KEY","sk-proj-BL9z..."],["WALLET_PRIVATE_KEY","0xdeadbeef..."],["STRIPE_SECRET","sk_live_9xK..."],["DATABASE_URL","postgres://prod..."]].map(([k,v]) => (
              <div key={k}><span style={{ color: "#10b981" }}>{k}</span><span style={{ color: "var(--text-tertiary)" }}>=</span><span style={{ color: "#fca5a5" }}>{v}</span></div>
            ))}
            <div style={{ color: "#555", marginTop: "8px" }}># one prompt injection → everything exposed. permanently.</div>
          </div>
          <div style={{ display: "flex", gap: "48px", flexWrap: "wrap" }}>
            {[
              { icon: "○", title: "Complete blindness", body: "Your agent runs 24/7 with your credentials and you have no idea what it's actually doing. No logs. No audit trail. No proof." },
              { icon: "○", title: "No audit trail", body: "When something goes wrong — a rogue action, unexpected spend, compromised tool — there's no record. You can't prove what happened." },
              { icon: "○", title: "Crash = lost context", body: "When your agent crashes it wakes up amnesiac. Open jobs get abandoned. Pending HBAR uncollected. It retries blocked actions." },
            ].map(c => (
              <div key={c.title} style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ fontSize: "16px", marginBottom: "10px", color: "var(--text-tertiary)" }}>{c.icon}</div>
                <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>{c.title}</div>
                <div style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Solution */}
        <section style={{ padding: "0 24px 80px", maxWidth: "1100px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "44px" }}>
            <h2 style={{ fontSize: "34px", fontWeight: 700, marginBottom: "12px" }}>What Veridex does</h2>
            <p style={{ fontSize: "16px", color: "var(--text-tertiary)" }}>Three layers. Each one solves a real problem.</p>
          </div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {[
              { icon: "⬛", title: "Immutable audit trail on Hedera HCS", body: "Every action logged before it executes. Tamper-proof. Permanent. Click any entry to verify on HashScan. Even if your server burns down, the history is on-chain." },
              { icon: "⬛", title: "Active blocking before execution", body: "Shell exploits, credential leaks, C2 callbacks, unauthorized API calls — blocked before they execute. Blocked actions logged to HCS too. Your agent can't hide what it tried." },
              { icon: "⬛", title: "Verifiable crash recovery", body: "One API call at startup. Agent gets its full operational state from HCS: open jobs, pending earnings, what was blocked. Cryptographically proven. Can't be tampered with." },
            ].map(c => (
              <div key={c.title} style={{ flex: 1, minWidth: "200px", padding: "24px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px" }}>
                <div style={{ fontSize: "14px", color: "#10b981", fontFamily: "monospace", marginBottom: "12px" }}>{c.icon}</div>
                <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "10px", color: "#10b981" }}>{c.title}</div>
                <div style={{ fontSize: "14px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Install */}
        <section style={{ padding: "0 24px 100px", maxWidth: "620px", margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "30px", fontWeight: 700, marginBottom: "12px" }}>30 seconds to install</h2>
          <p style={{ fontSize: "16px", color: "var(--text-tertiary)", marginBottom: "28px" }}>Add one line to your OpenClaw config. That&apos;s it.</p>
          <div style={{ position: "relative", background: "#0d0d0f", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px 20px", textAlign: "left", marginBottom: "14px" }}>
            <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.7 }}>{snippet}</pre>
            <button onClick={copy} style={{ position: "absolute", top: "10px", right: "10px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "5px", padding: "3px 10px", fontSize: "11px", color: "var(--text-tertiary)", cursor: "pointer" }}>
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "28px" }}>Your agent will be logged to Hedera HCS and appear in the monitor immediately.</p>
          <button onClick={connect} style={{ background: "#10b981", border: "none", borderRadius: "8px", padding: "12px 32px", fontSize: "15px", fontWeight: 700, color: "#000", cursor: "pointer" }}>
            Connect Wallet to get started →
          </button>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 24px" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-tertiary)", fontSize: "14px" }}>
              <Logo size={15} /> <span>Veridex — ETHDenver 2026</span>
            </div>
            <div style={{ display: "flex", gap: "24px" }}>
              {[["Dashboard","/dashboard"],["Leaderboard","/leaderboard"],["skill.md","/skill.md"],["HashScan","https://hashscan.io/testnet"]].map(([label,href]) => (
                <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener" style={{ fontSize: "13px", color: "var(--text-tertiary)", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>
        </footer>
      </main>
      <style>{`@keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </>
  );
}
