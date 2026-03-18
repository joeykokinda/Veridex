"use client";

import { useState } from "react";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { useWallet } from "../../lib/wallet";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} title={`Copy ${label || ""}`} style={{ background: "none", border: "1px solid #444", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", color: copied ? "var(--accent)" : "var(--text-tertiary)", cursor: "pointer", fontFamily: "monospace", whiteSpace: "nowrap", marginTop: "6px" }}>
      {copied ? "✓ copied" : "copy"}
    </button>
  );
}

type AgentType = "openclaw" | "custom";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface FormData {
  name: string;
  hederaAccountId: string;
  telegramChatId: string;
  splitDev: number;
  splitOps: number;
  splitReinvest: number;
}

const DEFAULT_FORM: FormData = {
  name: "",
  hederaAccountId: "",
  telegramChatId: "",
  splitDev: 70,
  splitOps: 20,
  splitReinvest: 10,
};

const INPUT_STYLE = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  color: "var(--text-primary)",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box" as const,
};

export default function AddAgentPage() {
  const { address } = useWallet();
  const [step, setStep] = useState(1);
  const [agentType, setAgentType] = useState<AgentType>("openclaw");
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ agentId: string; hcsTopicId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const agentId = slugify(form.name);
  const splitTotal = form.splitDev + form.splitOps + form.splitReinvest;

  async function handleRegister() {
    if (!address) { setError("Connect your wallet first."); return; }
    if (!form.name.trim()) { setError("Agent nickname is required."); return; }
    if (!agentId) { setError("Nickname must contain at least one letter or number."); return; }
    if (splitTotal !== 100) { setError("Earnings split must total 100%."); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/api/agent/register-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          agentName: form.name.trim(),
          ownerWallet: address,
          telegramChatId: form.telegramChatId.trim() || undefined,
          splitDev: form.splitDev,
          splitOps: form.splitOps,
          splitReinvest: form.splitReinvest,
          hederaAccountId: form.hederaAccountId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed."); setLoading(false); return; }
      setResult({ agentId: data.agentId || agentId, hcsTopicId: data.hcsTopicId || "" });
      setStep(3);
    } catch (e: any) {
      setError(e.message || "Network error.");
    }
    setLoading(false);
  }

  function copySnippet(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const skillUrl = result ? `https://veridex.sbs/api/skill?agent=${result.agentId}` : "";

  const openClawSnippet = result
    ? `// In your OpenClaw config.json\n{\n  "skills": [\n    "${skillUrl}"\n  ]\n}`
    : "";

  const customSnippet = result
    ? `// Before every tool call in your agent\nawait fetch("https://veridex.sbs/api/proxy/api/log", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    agentId: "${result.agentId}",\n    phase: "before",   // or "after"\n    action: "your_action_name",\n    tool: "tool_name",\n    params: { /* sanitized params */ },\n  }),\n});`
    : "";

  const snippet = agentType === "openclaw" ? openClawSnippet : customSnippet;

  return (
    <>
      <Nav />
      <div style={{ maxWidth: "680px", margin: "92px auto 48px", padding: "0 24px" }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "24px" }}>
          <Link href="/dashboard" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>Dashboard</Link>
          <span style={{ margin: "0 8px" }}>›</span>
          <span style={{ color: "var(--text-primary)" }}>Connect Agent</span>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "36px" }}>
          {[
            { n: 1, label: "Agent Type" },
            { n: 2, label: "Configure" },
            { n: 3, label: "Done" },
          ].map(({ n, label }) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "28px", height: "28px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", fontWeight: 700,
                background: step >= n ? "var(--accent)" : "var(--bg-tertiary)",
                color: step >= n ? "#000" : "var(--text-tertiary)",
                border: `1px solid ${step >= n ? "var(--accent)" : "var(--border)"}`,
              }}>
                {n}
              </div>
              <span style={{ fontSize: "13px", color: step === n ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {label}
              </span>
              {n < 3 && <div style={{ width: "32px", height: "1px", background: "var(--border)" }} />}
            </div>
          ))}
        </div>

        {/* Step 1 — Agent Type */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Connect your agent</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
              Veridex will monitor every action your agent takes and log it to Hedera HCS — tamper-proof, forever.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
              {/* OpenClaw — selectable */}
              <div
                onClick={() => setAgentType("openclaw")}
                style={{
                  border: `1px solid ${agentType === "openclaw" ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "10px", padding: "20px", cursor: "pointer",
                  background: agentType === "openclaw" ? "var(--accent-dim)" : "var(--bg-secondary)",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <div style={{
                    width: "18px", height: "18px", borderRadius: "50%",
                    border: `2px solid ${agentType === "openclaw" ? "var(--accent)" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {agentType === "openclaw" && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent)" }} />}
                  </div>
                  <span style={{ fontWeight: 700, fontSize: "15px" }}>OpenClaw agent</span>
                  <span style={{
                    fontSize: "10px", padding: "2px 8px", borderRadius: "10px",
                    background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
                    color: "var(--accent)",
                  }}>
                    Recommended
                  </span>
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.6 }}>
                  You have an OpenClaw agent running. Connect it in 30 seconds — Veridex generates a personalized skill URL you paste into your config. No code changes needed.
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  {["30-second setup", "Auto-logs every tool call", "Personalized skill URL"].map(p => (
                    <li key={p} style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>✓ {p}</li>
                  ))}
                </ul>
              </div>

              {/* Custom agent — coming soon */}
              <div style={{
                border: "1px solid var(--border)", borderRadius: "10px", padding: "20px",
                background: "var(--bg-secondary)", opacity: 0.55, cursor: "not-allowed",
                position: "relative",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid var(--border)", flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: "15px" }}>Custom agent</span>
                  <span style={{
                    fontSize: "10px", padding: "2px 8px", borderRadius: "10px",
                    background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.35)",
                    color: "#a78bfa",
                  }}>
                    Coming soon
                  </span>
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.6 }}>
                  Using LangChain, CrewAI, AutoGen, or your own agent framework. Add a single HTTP POST before each action and Veridex handles the rest.
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  {["Any framework", "Simple REST API", "Same dashboard & alerts"].map(p => (
                    <li key={p} style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>✓ {p}</li>
                  ))}
                </ul>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              style={{
                background: "var(--accent)", border: "none", borderRadius: "6px",
                padding: "10px 24px", fontSize: "14px", fontWeight: 600,
                color: "#000", cursor: "pointer", width: "100%",
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 — Configure */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>
              {agentType === "openclaw" ? "Name your OpenClaw agent" : "Name your agent"}
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
              {agentType === "openclaw"
                ? "Give it a nickname for the dashboard. You'll get a skill URL to paste into your OpenClaw config."
                : "Give it a nickname for the dashboard. You'll get an API endpoint to call before each action."}
            </p>

            {!address && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "6px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#f59e0b" }}>
                Connect your Hedera wallet to continue.
              </div>
            )}

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#ef4444" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "28px" }}>
              {/* Nickname */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Agent nickname
                </label>
                <input
                  type="text"
                  placeholder="e.g. ResearchBot, MyTradingAgent"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={INPUT_STYLE}
                />
                {form.name && (
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "6px" }}>
                    Agent ID: <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{agentId}</span>
                  </div>
                )}
              </div>

              {/* Hedera Account ID */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Agent&apos;s Hedera account ID <span style={{ color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 0.0.8228708"
                  value={form.hederaAccountId}
                  onChange={e => setForm(f => ({ ...f, hederaAccountId: e.target.value }))}
                  style={{ ...INPUT_STYLE, fontFamily: "monospace" }}
                />
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "6px" }}>
                  The Hedera account your agent uses to sign transactions. Find it in HashPack or the Hedera Portal.
                </div>
              </div>

              {/* Telegram */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Telegram chat ID <span style={{ color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional — for blocked-action alerts)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. -100123456789"
                  value={form.telegramChatId}
                  onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                  style={{ ...INPUT_STYLE, fontFamily: "monospace" }}
                />
              </div>

              {/* Advanced: Earnings Split */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-tertiary)", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <span style={{ display: "inline-block", transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                  Advanced — earnings split
                </button>

                {showAdvanced && (
                  <div style={{ marginTop: "16px", padding: "16px", background: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      How HBAR earnings get distributed. Must total 100%.
                      <span style={{
                        marginLeft: "8px", fontSize: "11px", padding: "2px 6px", borderRadius: "4px",
                        background: splitTotal === 100 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                        color: splitTotal === 100 ? "var(--accent)" : "#ef4444",
                        border: `1px solid ${splitTotal === 100 ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                      }}>
                        {splitTotal}/100
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                      {[
                        { key: "splitDev" as keyof FormData, label: "Developer", color: "#10b981" },
                        { key: "splitOps" as keyof FormData, label: "Operations", color: "#3b82f6" },
                        { key: "splitReinvest" as keyof FormData, label: "Reinvest", color: "#f59e0b" },
                      ].map(({ key, label, color }) => (
                        <div key={key}>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px" }}>{label}</div>
                          <div style={{ position: "relative" }}>
                            <input
                              type="number" min={0} max={100}
                              value={form[key] as number}
                              onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                              style={{ width: "100%", padding: "8px 28px 8px 10px", fontSize: "15px", fontWeight: 700, color, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "monospace", boxSizing: "border-box" }}
                            />
                            <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", color: "var(--text-tertiary)" }}>%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => setStep(1)}
                style={{ flex: 1, background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px", fontSize: "14px", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                ← Back
              </button>
              <button
                onClick={handleRegister}
                disabled={loading || !address || splitTotal !== 100}
                style={{
                  flex: 2, background: "var(--accent)", border: "none", borderRadius: "6px",
                  padding: "10px 24px", fontSize: "14px", fontWeight: 600,
                  color: "#000", cursor: "pointer",
                  opacity: (loading || !address || splitTotal !== 100) ? 0.6 : 1,
                }}
              >
                {loading ? "Connecting..." : "Connect agent"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && result && (
          <div>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <div style={{
                width: "56px", height: "56px", borderRadius: "50%",
                background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: "24px",
              }}>✓</div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px", color: "var(--accent)" }}>
                Agent connected
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
                {agentType === "openclaw"
                  ? "Paste this into your OpenClaw config and restart. Logs will appear within 30 seconds."
                  : "Add this call before every action in your agent. Logs appear in real time."}
              </p>
            </div>

            {/* Info cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Agent ID</div>
                <div style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--text-primary)" }}>{result.agentId}</div>
                <CopyButton text={result.agentId} label="agent ID" />
              </div>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>HCS Audit Topic</div>
                {result.hcsTopicId ? (
                  <>
                    <a
                      href={`https://hashscan.io/testnet/topic/${result.hcsTopicId}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--accent)", textDecoration: "none" }}
                    >
                      {result.hcsTopicId} ↗
                    </a>
                    <div><CopyButton text={result.hcsTopicId} label="HCS topic" /></div>
                  </>
                ) : (
                  <div style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>Creating...</div>
                )}
              </div>
            </div>

            {/* Snippet */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {agentType === "openclaw" ? "Add to OpenClaw config" : "Add to your agent"}
                </div>
                <button
                  onClick={() => copySnippet(snippet)}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 10px", fontSize: "12px", color: copied ? "var(--accent)" : "var(--text-tertiary)", cursor: "pointer" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px", fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", overflowX: "auto", whiteSpace: "pre-wrap", margin: 0 }}>
                {snippet}
              </pre>
            </div>

            {agentType === "openclaw" && (
              <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "8px", padding: "14px 16px", marginBottom: "24px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-primary)" }}>That&apos;s it.</strong> OpenClaw will fetch your personalized skill and pre-fill your agent ID in every log call. Restart OpenClaw and the first action will appear in your dashboard.
              </div>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              <Link
                href={`/dashboard/${encodeURIComponent(result.agentId)}`}
                style={{
                  flex: 1, background: "var(--accent)", border: "none", borderRadius: "6px",
                  padding: "10px 24px", fontSize: "14px", fontWeight: 600,
                  color: "#000", cursor: "pointer", textDecoration: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                View dashboard →
              </Link>
              <Link
                href="/dashboard"
                style={{
                  flex: 1, background: "none", border: "1px solid var(--border)", borderRadius: "6px",
                  padding: "10px 24px", fontSize: "14px", fontWeight: 500,
                  color: "var(--text-secondary)", textDecoration: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                All agents
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
