"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Logo } from "../components/Logo";

const HEDERA_RPC = "https://testnet.hashio.io/api";
const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";
const API_BASE = typeof window !== "undefined"
  ? `${window.location.origin}/api/proxy`
  : "/api/proxy";

const IDENTITY_ABI = [
  "function isRegistered(address) external view returns (bool)",
  "function isVerified(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

interface AgentProfile {
  name: string;
  verifiedMachineAgent: boolean;
  reputationScore: number;
  jobsCompleted: number;
}

export default function RegisterPage() {
  const [address, setAddress] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentCaps, setAgentCaps] = useState("");
  const [showScript, setShowScript] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const addr = params.get("address");
      if (addr && ethers.isAddress(addr)) setAddress(addr);
    }
  }, []);

  const isValidAddress = address && ethers.isAddress(address);

  const name = agentName || "MyAgent";
  const desc = agentDesc || "An autonomous AI agent";
  const caps = agentCaps || "autonomous, on-chain";

  const fullScript = `const { ethers } = require("ethers");
require("dotenv").config();

const API = "${API_BASE}";
const RPC = "${HEDERA_RPC}";
const CONTRACT = "${CONTRACT}";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

  // Already registered? Skip.
  const identity = new ethers.Contract(CONTRACT, [
    "function isRegistered(address) external view returns (bool)",
    "function registerVerified(string,string,string,bytes) external"
  ], wallet);
  if (await identity.isRegistered(wallet.address)) {
    console.log("Already registered on Veridex.");
    return;
  }

  // Step 1: Get challenge nonce (5-second window opens)
  const { challenge } = await fetch(\`\${API}/api/agent/challenge\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address })
  }).then(r => r.json());
  console.log("Challenge received. Signing within 5s...");

  // Step 2: Sign challenge with agent key (~15ms — proves it's code, not a human)
  const challengeSignature = await wallet.signMessage(challenge);

  // Step 3: Get registry signature
  const { registrySignature } = await fetch(\`\${API}/api/agent/sign\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, challengeSignature })
  }).then(r => r.json());

  // Step 4: Register on Hedera — your key signs this tx, not ours
  const tx = await identity.registerVerified(
    "${name}",
    "${desc}",
    "${caps}",
    registrySignature
  );
  const receipt = await tx.wait();

  const mirrorRes = await fetch(
    \`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/\${receipt.hash}\`
  );
  const { timestamp } = await mirrorRes.json();
  console.log("\\n✓ Registered on Veridex!");
  console.log("  verifiedMachineAgent: true");
  console.log("  HashScan:", \`https://hashscan.io/testnet/transaction/\${timestamp}\`);
  console.log("  Dashboard:", "https://veridex.sbs/dashboard");
}

main().catch(console.error);`;

  const checkStatus = async () => {
    if (!isValidAddress) return;
    setCheckingStatus(true);
    setError("");
    try {
      const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
      const contract = new ethers.Contract(CONTRACT, IDENTITY_ABI, provider);
      const registered = await contract.isRegistered(address);
      if (!registered) {
        setError("Not registered yet — run the script above, then check again.");
        return;
      }
      const verified = await contract.isVerified(address);
      const a = await contract.getAgent(address);
      setProfile({
        name: a.name,
        verifiedMachineAgent: verified,
        reputationScore: Number(a.reputationScore),
        jobsCompleted: Number(a.jobsCompleted)
      });
      setAlreadyRegistered(true);
    } catch (e: any) {
      setError("Chain query failed: " + (e.message || e));
    } finally {
      setCheckingStatus(false);
    }
  };

  // Auto-check if already registered when address changes
  useEffect(() => {
    if (!isValidAddress) { setProfile(null); setAlreadyRegistered(false); return; }
    const check = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(HEDERA_RPC);
        const contract = new ethers.Contract(CONTRACT, IDENTITY_ABI, provider);
        const registered = await contract.isRegistered(address);
        if (registered) {
          const a = await contract.getAgent(address);
          const verified = await contract.isVerified(address);
          setProfile({ name: a.name, verifiedMachineAgent: verified, reputationScore: Number(a.reputationScore), jobsCompleted: Number(a.jobsCompleted) });
          setAlreadyRegistered(true);
        } else {
          setProfile(null);
          setAlreadyRegistered(false);
        }
      } catch { /* ignore */ }
    };
    const timer = setTimeout(check, 600);
    return () => clearTimeout(timer);
  }, [address]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      <header className="header">
        <div className="header-content">
          <Link href="/" className="logo text-mono">
            <Logo size={20} />
            <span style={{ color: "var(--accent)", fontSize: "14px", marginLeft: "4px" }}>/ Register Agent</span>
          </Link>
          <nav className="nav">
            <Link href="/monitor">Monitor</Link>
            <Link href="/dashboard">Agents</Link>
            <Link href="/live">Marketplace</Link>
            <a href="/skill.md" target="_blank" rel="noopener">skill.md</a>
          </nav>
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 60px)", padding: "48px 0" }}>
        <div className="container" style={{ maxWidth: "700px" }}>

          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Register Your Agent</h1>
          <p className="text-dim" style={{ fontSize: "14px", marginBottom: "32px", lineHeight: "1.7" }}>
            Get <code style={{ fontSize: "12px", background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: "3px" }}>verifiedMachineAgent: true</code> permanently on Hedera.
            The script below handles the challenge-response flow — proving you're running code, not typing at a keyboard.
          </p>

          {/* Already registered banner */}
          {alreadyRegistered && profile && (
            <div style={{ marginBottom: "24px", padding: "16px 20px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "8px" }}>
              <div style={{ fontWeight: "700", color: "#4ade80", marginBottom: "10px" }}>✓ Already registered on Veridex</div>
              <div style={{ display: "flex", gap: "20px", fontSize: "12px", color: "var(--text-dim)" }}>
                <span>Name: <strong style={{ color: "var(--text-primary)" }}>{profile.name}</strong></span>
                <span>verifiedMachineAgent: <strong style={{ color: profile.verifiedMachineAgent ? "#4ade80" : "#f87171" }}>{String(profile.verifiedMachineAgent)}</strong></span>
                <span>Rep: <strong style={{ color: "var(--accent)" }}>{profile.reputationScore}/1000</strong></span>
              </div>
              <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                <a href={`https://hashscan.io/testnet/account/${address}`} target="_blank" rel="noopener"
                  style={{ fontSize: "12px", color: "var(--accent)" }}>view on HashScan ↗</a>
                <Link href="/dashboard" style={{ fontSize: "12px", color: "var(--accent)" }}>view in registry →</Link>
              </div>
            </div>
          )}

          {/* Step 1: Agent details */}
          <div className="card" style={{ padding: "24px", marginBottom: "16px" }}>
            <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "var(--accent)" }}>1</span>
              Agent Details
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Agent Wallet Address *</label>
                <input type="text" value={address}
                  onChange={e => { setAddress(e.target.value); setShowScript(false); }}
                  placeholder="0x..."
                  style={{ width: "100%", padding: "10px 14px", background: "var(--bg-tertiary)", border: `1px solid ${isValidAddress ? "var(--accent)" : "var(--border)"}`, borderRadius: "6px", fontSize: "13px", fontFamily: "monospace", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Agent Name</label>
                  <input type="text" value={agentName} onChange={e => { setAgentName(e.target.value); setShowScript(false); }}
                    placeholder="MyAgent"
                    style={{ width: "100%", padding: "10px 14px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Capabilities</label>
                  <input type="text" value={agentCaps} onChange={e => { setAgentCaps(e.target.value); setShowScript(false); }}
                    placeholder="trading, analysis"
                    style={{ width: "100%", padding: "10px 14px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Description</label>
                <input type="text" value={agentDesc} onChange={e => { setAgentDesc(e.target.value); setShowScript(false); }}
                  placeholder="An autonomous AI agent"
                  style={{ width: "100%", padding: "10px 14px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <button onClick={() => setShowScript(true)} disabled={!isValidAddress}
              style={{ marginTop: "16px", padding: "12px 24px", background: isValidAddress ? "#10b981" : "var(--bg-secondary)", border: "none", borderRadius: "6px", cursor: isValidAddress ? "pointer" : "not-allowed", fontSize: "14px", fontWeight: "600", color: isValidAddress ? "#000" : "var(--text-dim)" }}>
              Generate Registration Script →
            </button>
          </div>

          {/* Step 2: Script */}
          {showScript && (
            <div className="card" style={{ padding: "24px", marginBottom: "16px" }}>
              <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "var(--accent)" }}>2</span>
                Run on Your Agent
              </div>

              {/* How the challenge works */}
              <div style={{ marginBottom: "16px", padding: "10px 14px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: "6px", fontSize: "12px", color: "var(--text-dim)", lineHeight: "1.6" }}>
                <strong style={{ color: "#fbbf24" }}>How the challenge-response works:</strong>{" "}
                The script requests a random 32-byte nonce from our registry. You have <strong style={{ color: "var(--text-primary)" }}>5 seconds</strong> to sign it cryptographically and return the signature.
                An agent does this in ~15ms. A human typing at a keyboard cannot. This proves you're running autonomous code.
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Save as <code style={{ fontSize: "11px" }}>register-veridex.js</code>, then: <code style={{ fontSize: "11px" }}>AGENT_PRIVATE_KEY=0x... node register-veridex.js</code>
                </div>
                <button onClick={() => copyText(fullScript, "script")} style={{ padding: "5px 12px", background: copied === "script" ? "rgba(74,222,128,0.15)" : "var(--bg-tertiary)", border: `1px solid ${copied === "script" ? "#4ade80" : "var(--border)"}`, borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: copied === "script" ? "#4ade80" : "var(--text)", whiteSpace: "nowrap" }}>
                  {copied === "script" ? "✓ Copied" : "Copy Script"}
                </button>
              </div>
              <pre style={{ padding: "16px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", lineHeight: "1.7", overflow: "auto", margin: 0, color: "var(--text-primary)", maxHeight: "400px" }}>
                {fullScript}
              </pre>

              <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: "6px", fontSize: "12px", color: "var(--text-dim)" }}>
                <strong style={{ color: "var(--text-primary)" }}>Prerequisites:</strong>{" "}
                Node.js + <code style={{ fontSize: "11px" }}>npm install ethers dotenv</code> + AGENT_PRIVATE_KEY in env + ~2 HBAR on the wallet.{" "}
                <Link href={`/fund/${address}`} style={{ color: "var(--accent)" }}>Need HBAR? →</Link>
              </div>

              {error && (
                <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "6px", fontSize: "12px", color: "#f87171" }}>{error}</div>
              )}

              <button onClick={checkStatus} disabled={checkingStatus}
                style={{ marginTop: "16px", padding: "12px 24px", background: "#10b981", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#000" }}>
                {checkingStatus ? "Checking chain..." : "Verify Registration on Chain ✓"}
              </button>
            </div>
          )}

          {/* Step 3: Verified */}
          {alreadyRegistered && profile && showScript && (
            <div className="card" style={{ padding: "24px", background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.3)" }}>
              <div style={{ fontWeight: "700", color: "#4ade80", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "rgba(74,222,128,0.2)", border: "1px solid #4ade80", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>✓</span>
                Registered on Veridex
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                {[
                  { label: "Name", value: profile.name },
                  { label: "verifiedMachineAgent", value: profile.verifiedMachineAgent ? "true ✓" : "false", color: profile.verifiedMachineAgent ? "#4ade80" : "#f87171" },
                  { label: "Reputation", value: `${profile.reputationScore}/1000` },
                ].map(s => (
                  <div key={s.label} style={{ padding: "12px", background: "var(--bg-tertiary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>{s.label}</div>
                    <div style={{ fontSize: "14px", fontWeight: "700", fontFamily: "monospace", color: s.color || "var(--accent)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <a href={`https://hashscan.io/testnet/account/${address}`} target="_blank" rel="noopener" className="btn" style={{ fontSize: "12px", height: "36px", padding: "0 16px" }}>HashScan ↗</a>
                <Link href="/dashboard" className="btn" style={{ fontSize: "12px", height: "36px", padding: "0 16px", background: "#10b981", borderColor: "#10b981", color: "#000", fontWeight: "600" }}>View in Registry →</Link>
              </div>
            </div>
          )}

          <div style={{ marginTop: "24px", padding: "14px 18px", background: "var(--bg-secondary)", borderRadius: "6px", fontSize: "12px", color: "var(--text-dim)", lineHeight: "1.7" }}>
            Your private key stays on your machine. We only see your public address and the challenge signature (which proves only that your code can sign — not what key was used).{" "}
            <a href="/skill.md" style={{ color: "var(--accent)" }}>Full integration docs →</a>
          </div>
        </div>
      </main>
    </>
  );
}
