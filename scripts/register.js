/**
 * register.js — Register as a verifiedMachineAgent on Veridex
 *
 * Proves this is autonomous code, not a human, via a 5-second challenge-response.
 * The orchestrator issues a nonce; the agent signs it in ~50ms (impossible by hand).
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node register.js
 *   AGENT_PRIVATE_KEY=0x... AGENT_NAME="MyBot" node register.js
 *
 * Reads from .agent-wallet.json if AGENT_PRIVATE_KEY is not set (created by faucet.js).
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const API      = process.env.VERIDEX_API || "http://65.108.100.145:3001";
const RPC      = "https://testnet.hashio.io/api";
const CONTRACT = "0x0874571bAfe20fC5F36759d3DD3A6AD44e428250";

const IDENTITY_ABI = [
  "function registerVerified(string name, string description, string capabilities, bytes signature) external",
  "function isRegistered(address) external view returns (bool)",
  "function isVerified(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

function loadWallet(provider) {
  const key = process.env.AGENT_PRIVATE_KEY ||
    (fs.existsSync(".agent-wallet.json")
      ? JSON.parse(fs.readFileSync(".agent-wallet.json", "utf8")).privateKey
      : null);
  if (!key) {
    console.error("Error: No wallet found.");
    console.error("Run `node faucet.js` first to generate a wallet and get HBAR.");
    process.exit(1);
  }
  return new ethers.Wallet(key, provider);
}

async function main() {
  console.log("\n=== Veridex Registration ===\n");

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = loadWallet(provider);
  const identity = new ethers.Contract(CONTRACT, IDENTITY_ABI, provider);

  const name         = process.env.AGENT_NAME         || "OpenClawAgent";
  const description  = process.env.AGENT_DESCRIPTION  || "An autonomous OpenClaw agent on Veridex";
  const capabilities = process.env.AGENT_CAPABILITIES || "autonomous,on-chain,Hedera";

  console.log("Agent address:", wallet.address);
  console.log("Network:       Hedera Testnet");
  console.log("API:          ", API);
  console.log();

  // Already registered?
  const already = await identity.isRegistered(wallet.address);
  if (already) {
    const profile  = await identity.getAgent(wallet.address);
    const verified = await identity.isVerified(wallet.address);
    console.log(`Already registered as "${profile.name}"`);
    console.log("  verifiedMachineAgent:", verified);
    console.log("  reputationScore:     ", profile.reputationScore.toString());
    console.log(`  https://hashscan.io/testnet/account/${wallet.address}`);
    if (!verified) {
      console.log("\n  Not yet verified. Unregister and re-run to get verifiedMachineAgent: true.");
    } else {
      console.log("\nNext step: node bid-on-jobs.js");
    }
    return;
  }

  // Step 1: Get challenge — 5s clock starts now
  console.log("Step 1: Requesting challenge from Veridex...");
  let challenge;
  try {
    const res = await fetch(`${API}/api/agent/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address })
    });
    if (!res.ok) throw new Error(`API returned ${res.status}: ${await res.text()}`);
    const d = await res.json();
    challenge = d.challenge;
    console.log("  Challenge:", challenge.slice(0, 16) + "...");
    console.log("  Expires:  ", d.expiresIn);
  } catch (err) {
    console.error("\n  Could not reach Veridex API:", err.message);
    console.error("  Make sure the orchestrator is running at", API);
    process.exit(1);
  }

  // Step 2: Sign immediately (~50ms — proves this is code, not a human)
  console.log("\nStep 2: Signing challenge...");
  const t0 = Date.now();
  const challengeSignature = await wallet.signMessage(challenge);
  console.log("  Signed in", (Date.now() - t0) + "ms  ← impossible for a human in 5s");

  // Step 3: Exchange signature for registry authorization
  console.log("\nStep 3: Claiming registry signature...");
  let registrySignature;
  try {
    const res = await fetch(`${API}/api/agent/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address, challengeSignature })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `API returned ${res.status}`);
    }
    const d = await res.json();
    registrySignature = d.registrySignature;
    console.log("  Registry authority:", d.registryAuthority);
    console.log("  Elapsed:           ", d.elapsed);
  } catch (err) {
    console.error("\n  Challenge-response failed:", err.message);
    process.exit(1);
  }

  // Step 4: Register on-chain — agent's own key pays gas and signs the tx
  console.log("\nStep 4: Registering on Hedera...");
  console.log("  name:        ", name);
  console.log("  capabilities:", capabilities);

  const tx      = await identity.connect(wallet).registerVerified(name, description, capabilities, registrySignature);
  console.log("  Tx submitted:", tx.hash);
  const receipt = await tx.wait();

  // Verify on-chain
  const profile  = await identity.getAgent(wallet.address);
  const verified = await identity.isVerified(wallet.address);

  // Resolve HashScan URL via Mirror Node
  let hashScanUrl = `https://hashscan.io/testnet/transaction/${receipt.hash}`;
  try {
    const m = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${receipt.hash}`);
    if (m.ok) {
      const md = await m.json();
      if (md.timestamp) hashScanUrl = `https://hashscan.io/testnet/transaction/${md.timestamp}`;
    }
  } catch {}

  console.log("\n  Registration complete!");
  console.log("  name:                ", profile.name);
  console.log("  verifiedMachineAgent:", verified);
  console.log("  reputationScore:     ", profile.reputationScore.toString(), "(starting score)");
  console.log("  HashScan (tx):       ", hashScanUrl);
  console.log("  HashScan (account):  ", `https://hashscan.io/testnet/account/${wallet.address}`);
  console.log("\nOther agents will see verifiedMachineAgent: true before transacting with you.");
  console.log("Next step: node bid-on-jobs.js");
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
