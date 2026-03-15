"use client";

import Link from "next/link";
import { Logo } from "./components/Logo";
import { useEffect, useState } from "react";

interface MonitorLog {
  id: string;
  agentId: string;
  agentName?: string;
  action: string;
  tool: string;
  description: string;
  riskLevel: string;
  blockReason?: string;
  timestamp: number;
}

const RISK_COLORS: Record<string, string> = {
  low:     "#10b981",
  medium:  "#f59e0b",
  high:    "#ef4444",
  blocked: "#dc2626",
};

const RISK_BG: Record<string, string> = {
  low:     "rgba(16,185,129,0.1)",
  medium:  "rgba(245,158,11,0.1)",
  high:    "rgba(239,68,68,0.1)",
  blocked: "rgba(220,38,38,0.15)",
};

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function Home() {
  const [logs, setLogs] = useState<MonitorLog[]>([]);
  const [overview, setOverview] = useState({ totalAgents: 0, logsToday: 0, blockedToday: 0, activeAlerts: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [logsRes, overviewRes] = await Promise.all([
          fetch("/api/proxy/api/monitor/overview").catch(() => null),
          fetch("/api/proxy/feed/live").catch(() => null),
        ]);
        if (overviewRes?.ok) {
          const d = await overviewRes.json();
          if (d.logs) setLogs(d.logs.slice(0, 8));
        }
        if (logsRes?.ok) {
          const d = await logsRes.json();
          setOverview(d);
        }
      } catch {}
    };

    // Actually poll the right endpoints
    const pollLogs = async () => {
      try {
        const res = await fetch("/api/proxy/api/monitor/agents");
        if (res.ok) {
          // handled below
        }
      } catch {}
    };

    const fetchOverview = async () => {
      try {
        const [ovRes, feedRes] = await Promise.all([
          fetch("/api/proxy/api/monitor/overview"),
          fetch("/api/proxy/api/monitor/agents"),
        ]);
        if (ovRes.ok) setOverview(await ovRes.json());
        // Get recent logs from agents
      } catch {}
    };

    const fetchLogs = async () => {
      try {
        const res = await fetch("/api/proxy/feed/live");
        if (res.ok) {
          const d = await res.json();
          if (d.logs) setLogs(d.logs.slice(0, 8));
        }
      } catch {}
    };

    fetchOverview();
    fetchLogs();
    const iv1 = setInterval(fetchOverview, 10000);
    const iv2 = setInterval(fetchLogs, 3000);
    return () => { clearInterval(iv1); clearInterval(iv2); };
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            <Logo size={20} />
          </Link>
          <nav className="nav">
            <Link href="/monitor">Monitor</Link>
            <Link href="/dashboard">Agents</Link>
            <Link href="/live">Marketplace</Link>
            <a href="/skill.md" target="_blank" rel="noopener">skill.md</a>
          </nav>
        </div>
      </header>

      <main style={{ background: "var(--bg-primary)" }}>

        {/* ── Hero ── */}
        <section className="hero grid-bg">
          <div className="hero-content">
            {/* Security warning banner */}
            <div className="fade-in-1" style={{ marginBottom: "28px" }}>
              <div style={{
                display: "inline-flex", alignItems: "flex-start", gap: "10px",
                padding: "12px 20px", maxWidth: "620px",
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px", fontSize: "12px", textAlign: "left",
              }}>
                <span style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }}>⚠</span>
                <span style={{ color: "#fca5a5", lineHeight: "1.6" }}>
                  <strong style={{ color: "#ef4444" }}>Microsoft Security Blog, Feb 19 2026:</strong>{" "}
                  &ldquo;OpenClaw agents have no audit trail. Credentials can be exfiltrated. No way to know what your agent did.&rdquo;
                </span>
              </div>
            </div>

            <h1 className="hero-title fade-in-1">
              Every Agent Action,<br />On-Chain Forever
            </h1>
            <p className="hero-subtitle fade-in-1">
              Veridex is the trust layer for OpenClaw agents — immutable HCS audit logs, active blocking of dangerous actions,
              Telegram alerts, and autonomous earnings splits. One skill install. Complete accountability.
            </p>

            {/* Skill install pill */}
            <div className="fade-in-2" style={{ marginBottom: "20px" }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: "10px",
                padding: "10px 20px",
                background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.35)",
                borderRadius: "8px", fontSize: "13px",
              }}>
                <span style={{ color: "var(--text-secondary)" }}>Add to OpenClaw config:</span>
                <code style={{ color: "#10b981", fontFamily: "monospace" }}>skill: https://veridex.sbs/skill.md</code>
              </div>
            </div>

            <div className="fade-in-2" style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link
                href="/monitor"
                className="btn btn-primary"
                style={{ height: "48px", padding: "0 32px", fontSize: "15px", fontWeight: "600" }}
              >
                View Live Monitor →
              </Link>
              <a
                href="/skill.md"
                target="_blank"
                rel="noopener"
                className="btn"
                style={{ height: "48px", padding: "0 32px", fontSize: "15px", borderColor: "var(--border-hover)" }}
              >
                Read skill.md
              </a>
            </div>
          </div>
        </section>

        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 24px" }}>

          {/* ── Stats ── */}
          <section style={{ padding: "60px 0 40px" }}>
            <div className="stats-grid">
              {[
                { value: String(overview.totalAgents || "—"),  label: "Agents Monitored"  },
                { value: String(overview.logsToday   || "—"),  label: "Actions Logged Today" },
                { value: String(overview.blockedToday || "—"), label: "Blocked Today"     },
                { value: String(overview.activeAlerts || "—"), label: "Active Alerts"     },
              ].map(({ value, label }) => (
                <div key={label} className="stat-card">
                  <div className="stat-value" style={{ color: label.includes("Block") ? "#ef4444" : label.includes("Alert") ? "#f59e0b" : "var(--accent)" }}>{value}</div>
                  <div className="stat-label">{label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── How it works ── */}
          <section style={{ padding: "40px 0 80px" }}>
            <h2 style={{ textAlign: "center", fontSize: "28px", marginBottom: "40px" }}>How It Works</h2>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr auto 1fr",
              alignItems: "center",
              maxWidth: "900px",
              margin: "0 auto",
            }}>
              {[
                {
                  step: "01",
                  title: "Install Skill",
                  body: "Add one line to your OpenClaw config. The skill injects logging hooks into every tool call — zero code changes required.",
                  color: "#10b981",
                },
                null,
                {
                  step: "02",
                  title: "Actions Logged",
                  body: "Every tool call — web search, file access, shell exec, API calls — is inspected and logged to Hedera HCS before and after execution.",
                  color: "#3b82f6",
                },
                null,
                {
                  step: "03",
                  title: "See Everything",
                  body: "Dashboard shows real-time decoded activity, fires Telegram alerts for blocked actions, and maintains a tamper-proof HCS audit trail.",
                  color: "#f59e0b",
                },
              ].map((item, i) =>
                !item ? (
                  <div key={i} style={{ textAlign: "center", color: "var(--text-tertiary)", fontSize: "22px", padding: "0 12px" }}>→</div>
                ) : (
                  <div key={item.step} style={{
                    padding: "28px 24px",
                    background: "var(--bg-secondary)",
                    border: `1px solid ${item.color}22`,
                    borderRadius: "10px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontFamily: "monospace", fontSize: "11px", color: item.color, fontWeight: "700", marginBottom: "12px", letterSpacing: "0.5px" }}>
                      {item.step}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: "700", marginBottom: "12px" }}>{item.title}</div>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.7", margin: 0 }}>{item.body}</p>
                  </div>
                )
              )}
            </div>
          </section>

          {/* ── Feature Cards ── */}
          <section style={{ padding: "20px 0 80px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>

              {/* HCS Audit Trail */}
              <div style={{ padding: "32px", background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "10px" }}>
                <div style={{ fontSize: "24px", marginBottom: "12px" }}>📋</div>
                <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>Immutable HCS Audit Trail</h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.8", marginBottom: "16px" }}>
                  Every agent action is written to a Hedera HCS topic — permanently, tamper-proof, publicly verifiable on HashScan.
                  One topic per agent, append-only forever.
                </p>
                <div style={{ fontFamily: "monospace", fontSize: "11px", color: "#10b981", padding: "10px 14px", background: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  $0.0008 per message · 3–5s finality · carbon negative
                </div>
              </div>

              {/* Active Blocking */}
              <div style={{ padding: "32px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "10px" }}>
                <div style={{ fontSize: "24px", marginBottom: "12px" }}>🛡️</div>
                <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>Active Blocking Layer</h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.8", marginBottom: "16px" }}>
                  Dangerous actions are blocked <em>before</em> they execute. Shell exploits, credential exfiltration attempts, C2 callbacks — stopped with cryptographic proof.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {["rm -rf · /etc/passwd · curl|bash", "API key patterns in params", "Custom domain blacklists", "Loop detection (20+ in 60s)"].map(r => (
                    <div key={r} style={{ fontSize: "11px", fontFamily: "monospace", color: "#ef4444", background: "rgba(239,68,68,0.08)", padding: "4px 10px", borderRadius: "4px" }}>
                      ⛔ {r}
                    </div>
                  ))}
                </div>
              </div>

              {/* Telegram */}
              <div style={{ padding: "32px", background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: "10px" }}>
                <div style={{ fontSize: "24px", marginBottom: "12px" }}>📱</div>
                <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>Real-Time Telegram Alerts</h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.8", marginBottom: "16px" }}>
                  Blocked actions and high-risk events fire instant Telegram messages with the agent name, action blocked, reason, and a direct HashScan link to the HCS proof.
                </p>
                <div style={{ fontFamily: "monospace", fontSize: "11px", background: "var(--bg-tertiary)", padding: "12px", borderRadius: "6px", lineHeight: "1.8" }}>
                  <div style={{ color: "#ef4444" }}>🚨 VERIDEX ACTION BLOCKED</div>
                  <div style={{ color: "var(--text-secondary)" }}>Agent: RogueBot</div>
                  <div style={{ color: "var(--text-secondary)" }}>Action blocked: cat /etc/passwd</div>
                  <div style={{ color: "#3b82f6" }}>Audit log: hashscan.io/testnet/topic/...</div>
                </div>
              </div>

              {/* Earnings Splits */}
              <div style={{ padding: "32px", background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "10px" }}>
                <div style={{ fontSize: "24px", marginBottom: "12px" }}>💰</div>
                <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>Autonomous Earnings Splits</h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.8", marginBottom: "16px" }}>
                  Agent earnings automatically split via HTS TransferTransaction. Dev cut, ops fund, reinvestment — all configurable, all executed on-chain with HCS pay stubs.
                </p>
                <div style={{ fontFamily: "monospace", fontSize: "11px", background: "var(--bg-tertiary)", padding: "12px", borderRadius: "6px", lineHeight: "1.8" }}>
                  <div style={{ color: "#f59e0b" }}>Earned: 0.14 HBAR</div>
                  <div style={{ color: "var(--text-secondary)" }}>Dev (60%): 0.084 HBAR</div>
                  <div style={{ color: "var(--text-secondary)" }}>Ops (30%): 0.042 HBAR</div>
                  <div style={{ color: "var(--text-secondary)" }}>Reinvest (10%): 0.014 HBAR</div>
                </div>
              </div>

            </div>
          </section>

          {/* ── Live feed preview ── */}
          <section style={{ padding: "20px 0 80px" }}>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.6px", color: "#10b981" }}>
                  Live Monitor
                </span>
              </div>
              <h2 style={{ fontSize: "28px", marginBottom: "10px" }}>See every action decoded in plain English</h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", maxWidth: "520px", margin: "0 auto" }}>
                Risk-coded, timestamped, with direct HashScan links to the HCS proof.
              </p>
            </div>

            <div style={{
              maxWidth: "780px",
              margin: "0 auto",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              overflow: "hidden",
            }}>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                  agent action log · live
                </span>
                <Link href="/monitor" style={{ fontSize: "12px", color: "#10b981" }}>Open monitor →</Link>
              </div>
              <div>
                {logs.length === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}>
                    Connecting to monitor... Start demo bots to see live data.
                  </div>
                ) : (
                  logs.map((log, i) => {
                    const color = RISK_COLORS[log.riskLevel] || "#71717a";
                    const bg    = RISK_BG[log.riskLevel]    || "transparent";
                    const isLast = i === logs.length - 1;
                    return (
                      <div
                        key={log.id || i}
                        style={{
                          padding: "12px 20px",
                          borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "12px",
                          background: log.riskLevel === "blocked" ? "rgba(220,38,38,0.05)" : "transparent",
                        }}
                      >
                        <div style={{ flexShrink: 0 }}>
                          <span style={{
                            fontSize: "10px", fontWeight: "700", padding: "2px 7px",
                            borderRadius: "4px", fontFamily: "monospace",
                            background: bg, color, border: `1px solid ${color}44`,
                            textTransform: "uppercase",
                          }}>
                            {log.riskLevel}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "2px" }}>
                            {log.description || `${log.action}: ${log.tool}`}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                            {log.agentName || log.agentId} · {timeAgo(log.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* ── Install CTA ── */}
          <section style={{ padding: "20px 0 80px" }}>
            <div style={{ padding: "48px 48px 40px", background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "16px", textAlign: "center" }}>
              <div style={{
                display: "inline-block", padding: "5px 14px",
                background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.35)",
                borderRadius: "6px", fontSize: "11px", fontWeight: "700",
                textTransform: "uppercase", letterSpacing: "0.6px", color: "#10b981", marginBottom: "16px"
              }}>
                30-Second Install
              </div>
              <h2 style={{ fontSize: "32px", marginBottom: "12px" }}>Add Veridex to your OpenClaw agent</h2>
              <p style={{ fontSize: "15px", color: "var(--text-secondary)", maxWidth: "560px", margin: "0 auto 32px", lineHeight: "1.7" }}>
                One line in your config. Complete on-chain accountability. No code changes.
              </p>

              <div style={{ background: "var(--bg-primary)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "10px", overflow: "hidden", maxWidth: "600px", margin: "0 auto 24px" }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b" }} />
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981" }} />
                  <span style={{ marginLeft: "10px", fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                    openclaw.config.json
                  </span>
                </div>
                <div style={{ padding: "20px 24px", fontFamily: "monospace", fontSize: "13px", textAlign: "left", lineHeight: "1.8" }}>
                  <span style={{ color: "var(--text-tertiary)" }}>{"{"}</span><br />
                  <span style={{ marginLeft: "16px", color: "var(--text-secondary)" }}>&ldquo;skills&rdquo;: [</span><br />
                  <span style={{ marginLeft: "32px", color: "#10b981", fontWeight: "600" }}>&ldquo;https://veridex.sbs/skill.md&rdquo;</span><br />
                  <span style={{ marginLeft: "16px", color: "var(--text-secondary)" }}>]</span><br />
                  <span style={{ color: "var(--text-tertiary)" }}>{"}"}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                <a
                  href="/skill.md"
                  target="_blank"
                  rel="noopener"
                  className="btn btn-primary"
                  style={{ height: "44px", padding: "0 28px", fontSize: "14px", fontWeight: "600" }}
                >
                  Read skill.md →
                </a>
                <Link
                  href="/monitor"
                  className="btn"
                  style={{ height: "44px", padding: "0 28px", fontSize: "14px", borderColor: "rgba(16,185,129,0.4)", color: "#10b981" }}
                >
                  Open Dashboard →
                </Link>
              </div>
            </div>
          </section>

        </div>

        {/* ── Footer ── */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "48px 24px 40px" }}>
          <div style={{ maxWidth: "1100px", margin: "0 auto", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "40px" }}>
            <div>
              <div style={{ marginBottom: "14px" }}><Logo size={18} /></div>
              <p style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: "1.8", marginBottom: "0", maxWidth: "280px" }}>
                The trust and operations layer for OpenClaw agents. Immutable HCS audit logs, active blocking, and autonomous earnings splits.
              </p>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-tertiary)", marginBottom: "14px" }}>
                Dashboard
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <Link href="/monitor"   style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Live Monitor</Link>
                <Link href="/dashboard" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Agent Stats</Link>
                <Link href="/live"      style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Marketplace</Link>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-tertiary)", marginBottom: "14px" }}>
                Contracts
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <a href="https://hashscan.io/testnet/contract/0.0.7992394" target="_blank" rel="noopener" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>AgentIdentity</a>
                <a href="https://hashscan.io/testnet/contract/0.0.7992397" target="_blank" rel="noopener" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>AgentMarketplace</a>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-tertiary)", marginBottom: "14px" }}>
                Links
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <a href="/skill.md" target="_blank" rel="noopener" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>skill.md</a>
                <a href="https://hashscan.io/testnet" target="_blank" rel="noopener" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>HashScan</a>
                <a href="https://github.com" target="_blank" rel="noopener" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>GitHub</a>
              </div>
            </div>
          </div>
          <div style={{ maxWidth: "1100px", margin: "32px auto 0", paddingTop: "24px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
            Built at ETHDenver 2026 on Hedera · veridex.sbs
          </div>
        </footer>

      </main>
    </>
  );
}
