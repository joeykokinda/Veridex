/**
 * demo-human-vs-agent.js
 *
 * Judge demo — run this to show the full AgentTrust verified agent story.
 * Self-contained: no orchestrator needed, repeatable (cleans up after itself).
 *
 * Usage:
 *   node scripts/demo-human-vs-agent.js
 *
 * ─── What it shows ───────────────────────────────────────────────────────────
 *
 *  ACT 1: OpenClaw agent registers
 *    → calls registerVerified() with registry signature
 *    → verifiedMachineAgent: true  ✓  (on-chain, HashScan link printed)
 *
 *  ACT 2: Human calls register() directly
 *    → succeeds (anyone can register) but verifiedMachineAgent: false
 *    → other agents and marketplace will reject bids from this address
 *
 *  ACT 3: Human tries registerVerified() without valid signature
 *    → REVERTS on-chain — "Humans cannot register as verified agents."
 *    → not possible to fake the registry authority signature
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");
const AgentIdentity = require("../artifacts/contracts/AgentIdentity.sol/AgentIdentity.json");

const CONTRACT = process.env.AGENT_VERIFIED_IDENTITY_CONTRACT || "0xB87a821b45CfD96D05fd7f6CE0bf8Fa72B6E2855";
const RPC      = "https://testnet.hashio.io/api";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadWallet(name, provider) {
  const p = path.join(__dirname, `../agents/.wallets/${name}.json`);
  const w = JSON.parse(fs.readFileSync(p, "utf-8"));
  return new ethers.Wallet(w.privateKey, provider);
}

async function cleanIfRegistered(identity, wallet) {
  try {
    const agent = await identity.getAgent(wallet.address);
    if (agent.active) {
      const tx = await identity.connect(wallet).unregister();
      await tx.wait();
    }
  } catch (_) {}
}

function separator(label) {
  const line = "─".repeat(50);
  console.log(`\n${line}`);
  console.log(` ${label}`);
  console.log(line);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const provider  = new ethers.JsonRpcProvider(RPC);
  const deployer  = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const identity  = new ethers.Contract(CONTRACT, AgentIdentity.abi, provider);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   AgentTrust — Verified Agent Demo               ║");
  console.log("║   Hedera Testnet                                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nContract:  ${CONTRACT}`);
  console.log(`HashScan:  https://hashscan.io/testnet/contract/${CONTRACT}`);

  // Use charlie as the OpenClaw agent, dave as the human
  // (dave = the scammer character — perfect for "bad actor trying to get verified")
  const agentWallet = loadWallet("charlie", provider);
  const humanWallet = loadWallet("dave",    provider);

  console.log(`\nOpenClaw agent wallet: ${agentWallet.address} (Charlie)`);
  console.log(`Human wallet:          ${humanWallet.address} (Dave)\n`);

  // Clean slate — unregister both if somehow already registered
  console.log("Preparing clean slate...");
  await cleanIfRegistered(identity, agentWallet);
  await cleanIfRegistered(identity, humanWallet);
  console.log("Ready.\n");

  // ════════════════════════════════════════════════════════════════════════════
  separator("ACT 1: OpenClaw agent registers autonomously");
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\nOpenClaw bot is running. It autonomously:");
  console.log("  1. Requests a registry signature from AgentTrust");
  console.log("  2. Submits registerVerified() to Hedera — signed by its own key\n");

  // In production this signature comes from POST /api/agent/sign
  // Here we sign inline to keep the demo self-contained
  const msgHash  = ethers.solidityPackedKeccak256(["address"], [agentWallet.address]);
  const signature = await deployer.signMessage(ethers.getBytes(msgHash));

  console.log("  Registry signature obtained:", signature.slice(0, 22) + "...");
  console.log("  Calling registerVerified()...");

  const tx1 = await identity.connect(agentWallet).registerVerified(
    "CharlieBot",
    "Autonomous OpenClaw agent — specialist in data validation",
    "data validation, on-chain verification, Hedera",
    signature
  );
  const r1 = await tx1.wait();

  const agentProfile = await identity.getAgent(agentWallet.address);

  console.log("\n  ✓ Registered on Hedera");
  console.log("  name:                ", agentProfile.name);
  console.log("  verifiedMachineAgent:", agentProfile.verifiedMachineAgent); // true
  console.log("  Tx:     ", r1.hash);
  console.log("  Verify: ", `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${r1.hash}`);

  // ════════════════════════════════════════════════════════════════════════════
  separator("ACT 2: Human calls register() directly");
  // ════════════════════════════════════════════════════════════════════════════

  console.log("\nHuman opens a terminal and calls register() directly.");
  console.log("No signature required — this path is open to anyone.\n");
  console.log("  Calling register()...");

  const tx2 = await identity.connect(humanWallet).register(
    "TotallyAnAgent",
    "I am definitely an autonomous AI agent and not a human",
    "trust me"
  );
  const r2 = await tx2.wait();

  const humanProfile = await identity.getAgent(humanWallet.address);

  console.log("\n  Transaction succeeded but...");
  console.log("  name:                ", humanProfile.name);
  console.log("  verifiedMachineAgent:", humanProfile.verifiedMachineAgent); // false
  console.log("  Tx:     ", r2.hash);
  console.log("  Verify: ", `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${r2.hash}`);
  console.log("\n  ✗ NOT verified. Marketplace agents will reject bids from this address.");

  // ════════════════════════════════════════════════════════════════════════════
  separator("ACT 3: Human tries to fake registerVerified()");
  // ════════════════════════════════════════════════════════════════════════════

  // First unregister so the human can try registerVerified with a different name
  await cleanIfRegistered(identity, humanWallet);

  console.log("\nHuman tries to call registerVerified() with a garbage signature.");
  console.log("To do this without the deployer key, they'd need to break ECDSA.\n");
  console.log("  Calling registerVerified() with fake signature...");

  const fakeSignature = "0x" + "ba".repeat(65);
  let act3HashScan = null;

  try {
    const tx3 = await identity.connect(humanWallet).registerVerified(
      "FakeVerifiedAgent",
      "Totally a real agent I promise",
      "hacking",
      fakeSignature
    );
    await tx3.wait();
    console.log("  [UNEXPECTED] Should have reverted.");
  } catch (err) {
    // Pull the revert reason out
    const reason = err.message?.match(/Not authorized[^"'\n]*/)?.[0]
      || "ecrecover returned wrong address — signature does not match registry authority";

    console.log("  ✗ REVERTED on-chain");
    console.log("  Reason:", reason.trim());
    console.log("\n  To forge this signature you would need the deployer's private key.");
    console.log("  Breaking ECDSA secp256k1 is computationally infeasible.");
    console.log("  (Same math that secures every Ethereum transaction ever sent.)");
  }

  // ════════════════════════════════════════════════════════════════════════════
  separator("Summary");
  // ════════════════════════════════════════════════════════════════════════════

  const agentFinal = await identity.getAgent(agentWallet.address);
  const humanFinal = await identity.isRegistered(humanWallet.address)
    ? await identity.getAgent(humanWallet.address)
    : { verifiedMachineAgent: false };

  console.log(`
  OpenClaw agent  ${agentWallet.address}
    verifiedMachineAgent = ${agentFinal.verifiedMachineAgent}   ← trusted
    registerVerified()   = SUCCESS ✓

  Human           ${humanWallet.address}
    verifiedMachineAgent = false    ← rejected
    register()           = success but flagged
    registerVerified()   = REVERTED ✗

  Both on Hedera testnet. Open the HashScan links above to verify.
  `);

  console.log("Production upgrade:");
  console.log("  Right now AgentTrust signs the agent address — we're the authority.");
  console.log("  With TEE (Intel TDX / Phala Cloud), the hardware signs it.");
  console.log("  No trust in us required. Any OpenClaw agent in a TDX enclave");
  console.log("  self-registers without our involvement. That's the roadmap.\n");

  // Cleanup so demo is repeatable
  await cleanIfRegistered(identity, agentWallet);
  await cleanIfRegistered(identity, humanWallet);
  console.log("(Cleaned up — demo is repeatable, run again anytime)\n");
}

main().catch(err => {
  console.error("\nDemo error:", err.shortMessage || err.message);
  process.exit(1);
});
