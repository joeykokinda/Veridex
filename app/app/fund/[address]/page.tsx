"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Logo } from "../../components/Logo";

const HEDERA_RPC = "https://testnet.hashio.io/api";
const MIN_HBAR = 2; // HBAR needed to register + a few txns

export default function FundPage({ params }: { params: { address: string } }) {
  const address = params.address;
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceNum, setBalanceNum] = useState<number>(0);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const isValidAddress = address && ethers.isAddress(address);

  const checkBalance = async () => {
    if (!isValidAddress) return;
    setChecking(true);
    try {
      const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
      const raw = await provider.getBalance(address);
      const hbar = parseFloat(ethers.formatEther(raw));
      setBalance(hbar.toFixed(4));
      setBalanceNum(hbar);
    } catch {
      setBalance("error");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isValidAddress) checkBalance();
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ready = balanceNum >= MIN_HBAR;

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            <Logo size={20} />
            <span style={{ color: "var(--accent)", fontSize: "14px", marginLeft: "4px" }}>/ Fund Agent</span>
          </Link>
          <nav className="nav">
            <Link href="/dashboard">Agents</Link>
            <Link href="/live">Live Feed</Link>
            <Link href="/register">Register</Link>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "48px 0" }}>
        <div className="container" style={{ maxWidth: "600px" }}>

          {/* Step indicator */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "32px", fontSize: "12px", color: "var(--text-dim)" }}>
            <span style={{ color: "var(--accent)", fontWeight: "700" }}>Step 1</span>
            <span>Fund your agent wallet</span>
            <span style={{ margin: "0 4px" }}>→</span>
            <Link href="/register" style={{ color: "var(--text-dim)" }}>Step 2: Register</Link>
          </div>

          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Fund Your Agent Wallet</h1>
          <p className="text-dim" style={{ fontSize: "14px", marginBottom: "32px", lineHeight: "1.7" }}>
            Your agent needs ~{MIN_HBAR} HBAR to pay for the <code style={{ fontSize: "12px", background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: "3px" }}>registerVerified()</code> transaction on Hedera testnet.
          </p>

          {!isValidAddress ? (
            <div className="card" style={{ padding: "24px", textAlign: "center", color: "var(--error)" }}>
              Invalid address: <code style={{ fontFamily: "monospace" }}>{address}</code>
            </div>
          ) : (
            <>
              {/* Address card */}
              <div className="card" style={{ padding: "20px 24px", marginBottom: "20px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                  Your Agent Address (Hedera Testnet)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <code style={{
                    flex: 1, fontFamily: "monospace", fontSize: "13px",
                    padding: "10px 14px", background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)", borderRadius: "6px",
                    wordBreak: "break-all", lineHeight: "1.5"
                  }}>
                    {address}
                  </code>
                  <button onClick={copyAddress} style={{
                    padding: "10px 14px", background: copied ? "rgba(74,222,128,0.15)" : "var(--bg-tertiary)",
                    border: `1px solid ${copied ? "#4ade80" : "var(--border)"}`,
                    borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                    color: copied ? "#4ade80" : "var(--text)", transition: "all 0.2s", whiteSpace: "nowrap"
                  }}>
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>

                {/* Balance */}
                <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "4px" }}>Current Balance</div>
                    <div style={{ fontSize: "22px", fontWeight: "700", fontFamily: "monospace", color: ready ? "#4ade80" : balance === null ? "var(--text-dim)" : "#f59e0b" }}>
                      {balance === null ? "checking..." : balance === "error" ? "—" : `${balance} HBAR`}
                    </div>
                  </div>
                  <button onClick={checkBalance} disabled={checking} style={{
                    padding: "8px 16px", background: "var(--bg-secondary)",
                    border: "1px solid var(--border)", borderRadius: "6px",
                    cursor: checking ? "not-allowed" : "pointer", fontSize: "12px", color: "var(--text)"
                  }}>
                    {checking ? "Checking..." : "Refresh"}
                  </button>
                </div>

                {ready && (
                  <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: "6px", fontSize: "13px", color: "#4ade80", fontWeight: "600" }}>
                    ✓ Funded! You're ready to register.
                  </div>
                )}
              </div>

              {/* How to get HBAR */}
              {!ready && (
                <div className="card" style={{ padding: "20px 24px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "16px" }}>How to get testnet HBAR</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ padding: "14px", background: "var(--bg-tertiary)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: "600", fontSize: "13px", marginBottom: "4px", color: "var(--accent)" }}>
                        Option 1 — Hedera Developer Portal
                      </div>
                      <p className="text-dim" style={{ fontSize: "12px", lineHeight: "1.6", margin: "0 0 8px" }}>
                        Create a free account at portal.hedera.com and request testnet HBAR.
                      </p>
                      <a href="https://portal.hedera.com/register" target="_blank" rel="noopener"
                        style={{ fontSize: "12px", color: "var(--accent)", fontFamily: "monospace" }}>
                        portal.hedera.com/register ↗
                      </a>
                    </div>

                    <div style={{ padding: "14px", background: "var(--bg-tertiary)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: "600", fontSize: "13px", marginBottom: "4px", color: "var(--accent)" }}>
                        Option 2 — Ask at the AgentTrust booth
                      </div>
                      <p className="text-dim" style={{ fontSize: "12px", lineHeight: "1.6", margin: 0 }}>
                        At ETHDenver, find us and we'll fund your agent address on the spot.
                        Copy your address above and bring it over.
                      </p>
                    </div>

                    <div style={{ padding: "14px", background: "var(--bg-tertiary)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: "600", fontSize: "13px", marginBottom: "4px", color: "var(--accent)" }}>
                        Option 3 — Hedera Faucet (Discord)
                      </div>
                      <p className="text-dim" style={{ fontSize: "12px", lineHeight: "1.6", margin: "0 0 8px" }}>
                        Join the Hedera Discord and use the <code style={{ fontSize: "11px", background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: "3px" }}>#testnet-faucet</code> channel.
                      </p>
                      <a href="https://discord.gg/hedera" target="_blank" rel="noopener"
                        style={{ fontSize: "12px", color: "var(--accent)", fontFamily: "monospace" }}>
                        discord.gg/hedera ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Next step */}
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <Link href={`/register?address=${address}`}
                  className="btn"
                  style={{
                    height: "44px", padding: "0 28px", fontSize: "14px",
                    background: ready ? "#10b981" : "var(--bg-secondary)",
                    borderColor: ready ? "#10b981" : "var(--border)",
                    color: ready ? "#000" : "var(--text-dim)",
                    fontWeight: ready ? "700" : "400",
                    cursor: "pointer"
                  }}>
                  {ready ? "Register Your Agent →" : "Go to Registration →"}
                </Link>
                <a href={`https://hashscan.io/testnet/account/${address}`} target="_blank" rel="noopener"
                  style={{ fontSize: "12px", color: "var(--accent)", fontFamily: "monospace" }}>
                  view on HashScan ↗
                </a>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
