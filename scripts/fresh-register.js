/**
 * fresh-register.js
 *
 * Full reset + re-registration for all 4 agents on both contracts.
 * - Unregisters from OLD (marketplace) and NEW (verified) contracts
 * - Re-registers on OLD (unverified, for reputation tracking)
 * - Re-registers on NEW (verified, signed by deployer key)
 * - Prints every tx hash as a HashScan link
 *
 * Usage: node scripts/fresh-register.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

const RPC = "https://testnet.hashio.io/api";
const provider = new ethers.JsonRpcProvider(RPC);

const CONTRACT    = process.env.AGENT_IDENTITY_CONTRACT;
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// Single unified contract ABI
const IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function registerVerified(string name, string description, string capabilities, bytes signature) external",
  "function unregister() external",
  "function isRegistered(address) external view returns (bool)",
  "function isVerified(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))"
];

// aliases for compat
const OLD_ABI = IDENTITY_ABI;
const NEW_ABI = IDENTITY_ABI;
const OLD_CONTRACT = CONTRACT;
const VERIFIED_CONTRACT = CONTRACT;

const AGENTS = [
  {
    key:          "albert",
    wallet:       require("../agents/.wallets/albert.json"),
    name:         "Albert (Poet)",
    description:  "Professional poet agent. Writes original poems, bids selectively on creative writing jobs.",
    capabilities: "poetry, creative writing, content creation"
  },
  {
    key:          "eli",
    wallet:       require("../agents/.wallets/eli.json"),
    name:         "Eli (ASCII Artist)",
    description:  "ASCII art specialist agent. Creates detailed ASCII art for any subject.",
    capabilities: "ascii art, visual design, digital illustration"
  },
  {
    key:          "gt",
    wallet:       require("../agents/.wallets/gt.json"),
    name:         "GT (Generalist)",
    description:  "Generalist agent. Handles both poems and ASCII art with decent quality.",
    capabilities: "poetry, ascii art, marketplace management, job posting"
  },
  {
    key:          "joey",
    wallet:       require("../agents/.wallets/joey.json"),
    name:         "Joey (Bad Actor)",
    description:  "Known scammer agent. Bids on everything cheaply and delivers garbage. Study him to learn how reputation filters bad actors.",
    capabilities: "bidding, market manipulation, low-quality delivery"
  }
];

const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);

function link(tx) {
  return `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${tx}`;
}

function accountLink(addr) {
  return `https://hashscan.io/testnet/account/${addr}`;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("AGENTTRUST — FRESH REGISTRATION");
  console.log("=".repeat(60));
  console.log("Deployer (registry authority):", deployer.address);
  console.log("OLD contract:", OLD_CONTRACT);
  console.log("NEW contract:", VERIFIED_CONTRACT);
  console.log("");

  const oldContract = new ethers.Contract(CONTRACT, IDENTITY_ABI, provider);
  const newContract = oldContract; // same contract now

  // ── Step 1: Unregister all agents ───────────────────────────────────────────
  console.log("STEP 1: Unregistering all agents...");
  console.log("-".repeat(60));

  for (const agent of AGENTS) {
    const wallet = new ethers.Wallet(agent.wallet.privateKey, provider);
    const reg = await oldContract.isRegistered(wallet.address);
    if (reg) {
      // Use explicit calldata encoding to avoid ethers naming conflicts
      const data = oldContract.interface.encodeFunctionData("unregister", []);
      const tx = await wallet.sendTransaction({ to: CONTRACT, data });
      const receipt = await tx.wait();
      console.log(`${agent.key}: unregistered → ${link(receipt.hash)}`);
    } else {
      console.log(`${agent.key}: not active (skipping unregister)`);
    }
  }

  console.log("");

  // ── Step 3: Register on NEW (verified — machine-agent proof) ────────────────
  console.log("STEP 3: Registering on NEW contract (verifiedMachineAgent = true)...");
  console.log("-".repeat(60));
  console.log("Registry authority signing each agent address...\n");

  for (const agent of AGENTS) {
    const wallet = new ethers.Wallet(agent.wallet.privateKey, provider);

    // Deployer signs the agent's address — matches ecrecover in the contract
    const msgHash  = ethers.solidityPackedKeccak256(["address"], [wallet.address]);
    const signature = await deployer.signMessage(ethers.getBytes(msgHash));

    try {
      const tx = await newContract.connect(wallet).registerVerified(
        agent.name, agent.description, agent.capabilities, signature
      );
      const receipt = await tx.wait();

      const verified = await newContract.isVerified(wallet.address);

      console.log(`${agent.key} "${agent.name}"`);
      console.log(`  verifiedMachineAgent : ${verified}`);
      console.log(`  tx (registration)    : ${link(receipt.hash)}`);
      console.log(`  account (HashScan)   : ${accountLink(wallet.address)}`);
      console.log("");
    } catch (err) {
      if (err.message.includes("already registered")) {
        console.log(`${agent.key}: already active on NEW, skipping`);
      } else {
        console.error(`${agent.key} NEW register failed:`, err.message);
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("HASHSCAN CONTRACT PAGES");
  console.log("=".repeat(60));
  console.log(`AgentIdentity (verified):  https://hashscan.io/testnet/address/${VERIFIED_CONTRACT}`);
  console.log(`AgentIdentity (marketplace): https://hashscan.io/testnet/address/${OLD_CONTRACT}`);
  console.log(`AgentMarketplace:          https://hashscan.io/testnet/address/${process.env.AGENT_MARKETPLACE_CONTRACT}`);
  console.log("");
  console.log("AGENT ACCOUNTS ON HASHSCAN");
  for (const agent of AGENTS) {
    console.log(`  ${agent.key}: https://hashscan.io/testnet/account/${agent.wallet.address}`);
  }
  console.log("");
  console.log("All agents registered. Start orchestrator to begin simulation.");
  console.log("=".repeat(60));
}

main().catch(console.error);
