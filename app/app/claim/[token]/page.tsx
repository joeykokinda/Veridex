"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "../../components/Nav";
import { useWallet } from "../../lib/wallet";

interface AgentInfo {
  agentId: string;
  name: string;
  hcsTopicId: string;
  claimed: boolean;
  ownerWallet: string | null;
}

export default function ClaimPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { address, connect, isConnecting } = useWallet();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/proxy/api/agent/claim/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setAgent(data);
        setLoading(false);
      })
      .catch(() => { setError("Could not load agent info."); setLoading(false); });
  }, [token]);

  async function claim() {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/api/agent/claim/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerWallet: address || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Claim failed."); setClaiming(false); return; }
      // Store claimed agent IDs in localStorage so dashboard can show them without wallet
      if (agent?.agentId) {
        const stored = JSON.parse(localStorage.getItem("veridex_claimed_agents") || "[]");
        if (!stored.includes(agent.agentId)) {
          localStorage.setItem("veridex_claimed_agents", JSON.stringify([...stored, agent.agentId]));
        }
      }
      setClaimed(true);
      setTimeout(() => router.push(`/dashboard/${agent?.agentId}`), 2000);
    } catch {
      setError("Network error.");
    }
    setClaiming(false);
  }

  return (
    <>
      <Nav />
      <div style={{ maxWidth: "480px", margin: "80px auto", padding: "0 24px" }}>

        {loading && (
          <p style={{ color: "var(--text-tertiary)", fontFamily: "monospace", fontSize: "13px" }}>Loading…</p>
        )}

        {error && !loading && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✕</div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Invalid claim link</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "24px" }}>This link is invalid or has already been used.</p>
            <Link href="/dashboard" style={{ color: "var(--accent)", fontSize: "14px" }}>Go to dashboard</Link>
          </div>
        )}

        {agent && !error && !claimed && (
          <div>
            <div style={{ marginBottom: "32px" }}>
              <p style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>
                Agent claiming ownership
              </p>
              <h1 style={{ fontSize: "26px", fontWeight: 800, marginBottom: "8px" }}>
                {agent.name || agent.agentId}
              </h1>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Your agent has registered with Veridex and sent you this link. Claim it to connect it to your account and see its activity in your dashboard.
              </p>
            </div>

            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "20px", marginBottom: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Agent ID</div>
                  <div style={{ fontFamily: "monospace", fontSize: "14px", color: "var(--text-primary)" }}>{agent.agentId}</div>
                </div>
                {agent.hcsTopicId && (
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>HCS Audit Topic</div>
                    <a
                      href={`https://hashscan.io/testnet/topic/${agent.hcsTopicId}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--accent)", textDecoration: "none" }}
                    >
                      {agent.hcsTopicId} ↗
                    </a>
                  </div>
                )}
              </div>
            </div>

            {agent.claimed ? (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "8px", padding: "14px 16px", fontSize: "13px", color: "#f59e0b", marginBottom: "24px" }}>
                This agent has already been claimed.
              </div>
            ) : (
              <>
                {/* Optional wallet section */}
                <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-primary)" }}>Optional:</strong> Connect your wallet to enable on-chain payments and earnings for your agent. You can also do this later in the dashboard.
                </div>

                {!address ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button
                      onClick={connect}
                      disabled={isConnecting}
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "11px 20px", fontSize: "14px", color: "var(--text-secondary)", cursor: "pointer", opacity: isConnecting ? 0.6 : 1 }}
                    >
                      {isConnecting ? "Connecting…" : "Connect wallet (optional)"}
                    </button>
                    <button
                      onClick={claim}
                      disabled={claiming}
                      style={{ background: "var(--accent)", border: "none", borderRadius: "8px", padding: "12px 20px", fontSize: "14px", fontWeight: 700, color: "#000", cursor: "pointer", opacity: claiming ? 0.7 : 1 }}
                    >
                      {claiming ? "Claiming…" : "Claim without wallet"}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "11px 16px", fontSize: "13px", fontFamily: "monospace", color: "var(--accent)" }}>
                      ✓ {address.slice(0, 6)}…{address.slice(-4)} connected
                    </div>
                    <button
                      onClick={claim}
                      disabled={claiming}
                      style={{ background: "var(--accent)", border: "none", borderRadius: "8px", padding: "12px 20px", fontSize: "14px", fontWeight: 700, color: "#000", cursor: "pointer", opacity: claiming ? 0.7 : 1 }}
                    >
                      {claiming ? "Claiming…" : "Claim agent"}
                    </button>
                  </div>
                )}

                {error && (
                  <div style={{ marginTop: "12px", color: "#ef4444", fontSize: "13px" }}>{error}</div>
                )}
              </>
            )}
          </div>
        )}

        {claimed && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: "24px" }}>
              ✓
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--accent)", marginBottom: "8px" }}>Agent claimed</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Taking you to your dashboard…</p>
          </div>
        )}

      </div>
    </>
  );
}
