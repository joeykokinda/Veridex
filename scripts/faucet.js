/**
 * faucet.js — Get 2 HBAR testnet gas from Veridex faucet
 *
 * Usage:
 *   node faucet.js
 *   AGENT_PRIVATE_KEY=0x... node faucet.js
 *
 * If no AGENT_PRIVATE_KEY is set, generates a new wallet and saves it to .agent-wallet.json
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const API         = process.env.VERIDEX_API || "http://65.108.100.145:3001";
const WALLET_FILE = ".agent-wallet.json";

function loadOrCreateWallet() {
  if (process.env.AGENT_PRIVATE_KEY) {
    const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
    console.log("Using wallet from AGENT_PRIVATE_KEY");
    return { wallet, isNew: false };
  }

  if (fs.existsSync(WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    const wallet = new ethers.Wallet(data.privateKey);
    console.log(`Using saved wallet from ${WALLET_FILE}`);
    return { wallet, isNew: false };
  }

  const wallet = ethers.Wallet.createRandom();
  fs.writeFileSync(WALLET_FILE, JSON.stringify({
    address: wallet.address,
    privateKey: wallet.privateKey
  }, null, 2));
  return { wallet, isNew: true };
}

async function main() {
  console.log("\n=== Veridex Faucet ===\n");

  const { wallet, isNew } = loadOrCreateWallet();

  if (isNew) {
    console.log("Generated new wallet — saved to", WALLET_FILE);
    console.log("  Address:     ", wallet.address);
    console.log("  Private key: ", wallet.privateKey);
    console.log("\n  Save your private key! Run subsequent commands with:");
    console.log("  export AGENT_PRIVATE_KEY=" + wallet.privateKey + "\n");
  } else {
    console.log("Address:", wallet.address);
  }

  console.log(`\nRequesting 2 HBAR from faucet...`);
  console.log(`  POST ${API}/api/faucet`);

  let res, data;
  try {
    res  = await fetch(`${API}/api/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address })
    });
    data = await res.json();
  } catch (err) {
    console.error("\n  Could not reach Veridex API:", err.message);
    console.error("  Make sure the orchestrator is running at", API);
    process.exit(1);
  }

  if (res.status === 429) {
    console.log("\n  Already funded recently:", data.error);
    console.log("  Your wallet already has HBAR. Proceed to:");
    console.log("  node register.js");
    return;
  }

  if (!res.ok) {
    console.error("\n  Faucet error:", data.error || res.status);
    process.exit(1);
  }

  if (data.alreadyFunded) {
    console.log("\n  Already funded —", data.balance);
    console.log("  Proceed to: node register.js");
    return;
  }

  console.log("\n  Sent:", data.amount);
  console.log("  New balance:", data.newBalance);
  console.log("\nNext step:");
  if (!process.env.AGENT_PRIVATE_KEY) {
    console.log("  export AGENT_PRIVATE_KEY=" + wallet.privateKey);
  }
  console.log("  node register.js");
}

main().catch(err => { console.error(err); process.exit(1); });
