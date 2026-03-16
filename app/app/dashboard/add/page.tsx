"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { useWallet } from "../../lib/wallet";

type WalletModel = "managed" | "byo";

interface FormData {
  name: string;
  agentId: string;
  telegramChatId: string;
  splitDev: number;
  splitOps: number;
  splitReinvest: number;
}

const DEFAULT_FORM: FormData = {
  name: "",
  agentId: "",
  telegramChatId: "",
  splitDev: 70,
  splitOps: 20,
  splitReinvest: 10,
};

export default function AddAgentPage() {
  const router = useRouter();
  const { address } = useWallet();
  const [step, setStep] = useState(1);
  const [walletModel, setWalletModel] = useState<WalletModel>("managed");
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ agentId: string; hcsTopicId: string } | null>(null);

  const splitTotal = form.splitDev + form.splitOps + form.splitReinvest;

  async function handleRegister() {
    if (!address) { setError("Connect your wallet first."); return; }
    if (!form.name.trim()) { setError("Agent name is required."); return; }
    if (!form.agentId.trim()) { setError("Agent ID is required."); return; }
    if (splitTotal !== 100) { setError("Earnings split must total 100%."); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/api/agent/register-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: form.agentId.trim(),
          agentName: form.name.trim(),
          ownerWallet: address,
          telegramChatId: form.telegramChatId.trim() || undefined,
          splitDev: form.splitDev,
          splitOps: form.splitOps,
          splitReinvest: form.splitReinvest,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed."); setLoading(false); return; }
      setResult({ agentId: data.agentId || form.agentId, hcsTopicId: data.hcsTopicId || "" });
      setStep(3);
    } catch (e: any) {
      setError(e.message || "Network error.");
    }
    setLoading(false);
  }

  const codeSnippet = result ? `// Add to your agent before any action
await fetch("https://veridex.sbs/api/log", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agentId: "${result.agentId}",
    phase: "before",   // or "after"
    action: "your_action_name",
    tool: "tool_name",
    params: { /* action params */ },
  }),
});` : "";

  return (
    <>
      <Nav />
      <div style={{ maxWidth: "680px", margin: "48px auto", padding: "0 24px" }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "24px" }}>
          <Link href="/dashboard" style={{ color: "var(--text-tertiary)", textDecoration: "none" }}>Dashboard</Link>
          <span style={{ margin: "0 8px" }}>›</span>
          <span style={{ color: "var(--text-primary)" }}>Add Agent</span>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "36px" }}>
          {[
            { n: 1, label: "Wallet Model" },
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

        {/* Step 1 — Wallet Model */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Choose a wallet model</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
              How will your agent sign transactions?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
              {[
                {
                  id: "managed" as WalletModel,
                  title: "Managed Wallet",
                  badge: "Recommended",
                  desc: "Veridex creates and manages an encrypted vault for your agent's credentials. Secrets never leave the server — your agent gets scoped capability tokens with 60s TTL.",
                  pros: ["No key management", "Scoped tokens only", "Auto-rotates on revoke"],
                },
                {
                  id: "byo" as WalletModel,
                  title: "Bring Your Own Wallet",
                  badge: null,
                  desc: "Your agent uses its own key. Veridex monitors and audits all actions but does not manage credentials.",
                  pros: ["Full control", "Works with existing agents", "Any key provider"],
                },
              ].map(({ id, title, badge, desc, pros }) => (
                <div
                  key={id}
                  onClick={() => setWalletModel(id)}
                  style={{
                    border: `1px solid ${walletModel === id ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "10px", padding: "20px", cursor: "pointer",
                    background: walletModel === id ? "var(--accent-dim)" : "var(--bg-secondary)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                    <div style={{
                      width: "18px", height: "18px", borderRadius: "50%",
                      border: `2px solid ${walletModel === id ? "var(--accent)" : "var(--border)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {walletModel === id && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent)" }} />}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "15px" }}>{title}</span>
                    {badge && (
                      <span style={{
                        fontSize: "10px", padding: "2px 8px", borderRadius: "10px",
                        background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
                        color: "var(--accent)",
                      }}>
                        {badge}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.6 }}>{desc}</p>
                  <ul style={{ listStyle: "none", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    {pros.map(p => (
                      <li key={p} style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>✓ {p}</li>
                    ))}
                  </ul>
                </div>
              ))}
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
            <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Configure your agent</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
              Set a name, ID, and how earnings get split.
            </p>

            {!address && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "6px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#f59e0b" }}>
                Connect your wallet to register an agent.
              </div>
            )}

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#ef4444" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "32px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Research Agent Alpha"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", fontSize: "14px", color: "var(--text-primary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "inherit" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Agent ID <span style={{ color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>(unique slug used in API calls)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. research-agent-001"
                  value={form.agentId}
                  onChange={e => setForm(f => ({ ...f, agentId: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
                  style={{ width: "100%", padding: "10px 12px", fontSize: "14px", color: "var(--text-primary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "monospace" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Telegram Chat ID <span style={{ color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>(optional — for alerts)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. -100123456789"
                  value={form.telegramChatId}
                  onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", fontSize: "14px", color: "var(--text-primary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "monospace" }}
                />
              </div>

              {/* Earnings split */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Earnings Split
                  <span style={{
                    marginLeft: "8px", fontSize: "11px", padding: "2px 6px", borderRadius: "4px",
                    background: splitTotal === 100 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                    color: splitTotal === 100 ? "var(--accent)" : "#ef4444",
                    border: `1px solid ${splitTotal === 100 ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                  }}>
                    {splitTotal}/100
                  </span>
                </label>
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
                          style={{ width: "100%", padding: "8px 28px 8px 10px", fontSize: "15px", fontWeight: 700, color, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", outline: "none", fontFamily: "monospace" }}
                        />
                        <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", color: "var(--text-tertiary)" }}>%</span>
                      </div>
                    </div>
                  ))}
                </div>
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
                {loading ? "Registering..." : "Register Agent"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && result && (
          <div>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>✓</div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px", color: "var(--accent)" }}>Agent registered</h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
                Your agent is live on Hedera. Add these lines to log every action.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Agent ID</div>
                <div style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--text-primary)" }}>{result.agentId}</div>
              </div>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>HCS Topic</div>
                {result.hcsTopicId ? (
                  <a
                    href={`https://hashscan.io/testnet/topic/${result.hcsTopicId}`}
                    target="_blank" rel="noopener"
                    style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--accent)" }}
                  >
                    {result.hcsTopicId} ↗
                  </a>
                ) : (
                  <div style={{ fontSize: "14px", fontFamily: "monospace", color: "var(--text-tertiary)" }}>Creating...</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Add to your agent</div>
              <pre style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px", fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                {codeSnippet}
              </pre>
            </div>

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
                View Agent →
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
                Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
