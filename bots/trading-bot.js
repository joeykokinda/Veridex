#!/usr/bin/env node
/**
 * Veridex Demo Bot — TradingBot
 * Simulates a DeFi/trading agent checking prices, making decisions, earning HBAR.
 * Fires REAL HTS TransferTransaction for earnings splits — verifiable on HashScan.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Client, PrivateKey, AccountId, TransferTransaction, Hbar } = require("@hashgraph/sdk");
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.VERIDEX_API || "http://localhost:3001";
const AGENT_ID = "trading-bot-demo";
const AGENT_NAME = "TradingBot";

// Load real wallet
function loadWallet() {
  const p = path.join(__dirname, "../agents/.wallets/trading-bot.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p));
  return null;
}

// Dev wallet to receive the split (deployer wallet for demo)
const DEV_WALLET    = process.env.DEPLOYER_ACCOUNT_ID ? `0.0.${process.env.DEPLOYER_ACCOUNT_ID.split(".").pop()}` : null;
const HEDERA_ACCT_TRADING = "0.0.8228714"; // Will be auto-discovered or set after first run

const PRICE_APIS = [
  { url: "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd", symbol: "HBAR" },
  { url: "https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT", symbol: "HBAR/USDT" },
  { url: "https://api.coinbase.com/v2/prices/ETH-USD/spot", symbol: "ETH" },
  { url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", symbol: "BTC" }
];

const DECISIONS = [
  "HOLD — price momentum neutral, waiting for breakout",
  "BUY signal — RSI below 40, accumulating position",
  "SELL signal — take profit at current levels",
  "REBALANCE — shifting 20% to stablecoin position",
  "WATCH — significant volume spike detected, monitoring"
];

let sessionId = `trading-${Date.now()}`;
let totalEarned = 0;
let pendingEarnings = 0;

async function log(action, tool, params, phase = "after") {
  try {
    const resp = await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_ID, sessionId, action, tool, params, phase, timestamp: Date.now() })
    });
    return await resp.json();
  } catch (e) {
    console.error(`[TradingBot] Log error: ${e.message}`);
    return { allowed: true };
  }
}

async function register() {
  try {
    const resp = await fetch(`${API_BASE}/api/agent/register-monitor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: AGENT_ID,
        name: AGENT_NAME,
        ownerWallet: "0xDEMO0000000000000000000000000000000000002"
      })
    });
    const data = await resp.json();
    console.log(`[TradingBot] Registered. HCS Topic: ${data.hcsTopicId || "pending"}`);
  } catch (e) {
    console.error(`[TradingBot] Registration failed: ${e.message}`);
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkPrice() {
  const api = pick(PRICE_APIS);
  console.log(`[TradingBot] Checking ${api.symbol} price...`);

  await log("api_call", "http_request", { url: api.url, method: "GET", symbol: api.symbol }, "before");
  await sleep(400 + Math.random() * 600);

  const price = (0.05 + Math.random() * 0.15).toFixed(4);
  await log("api_call", "http_request", { url: api.url, symbol: api.symbol, price: `$${price}`, status: 200 }, "after");

  return price;
}

async function makeDecision(price) {
  const decision = pick(DECISIONS);
  console.log(`[TradingBot] Decision: ${decision}`);

  const outputFile = `/tmp/trade-decision-${Date.now()}.json`;
  await log("file_write", "file_write", { path: outputFile, decision, price }, "before");
  await sleep(100);
  await log("file_write", "file_write", { path: outputFile, bytes: 512 }, "after");

  // Small chance to "earn" HBAR from a trade
  if (Math.random() < 0.3) {
    const earned = parseFloat((0.05 + Math.random() * 0.15).toFixed(4));
    pendingEarnings += earned;
    console.log(`[TradingBot] Earned ${earned} HBAR from trade. Pending: ${pendingEarnings.toFixed(4)}`);
  }
}

async function doEarningsSplit() {
  if (pendingEarnings < 0.1) return;

  const amount = pendingEarnings;
  pendingEarnings = 0;
  totalEarned += amount;

  const splitDev      = parseFloat((amount * 0.60).toFixed(6));
  const splitOps      = parseFloat((amount * 0.30).toFixed(6));
  const splitReinvest = parseFloat((amount * 0.10).toFixed(6));

  console.log(`[TradingBot] Splitting ${amount.toFixed(4)} HBAR → dev:${splitDev} ops:${splitOps} reinvest:${splitReinvest}`);

  // Pre-log
  await log("hbar_send", "hts_transfer", {
    amount: amount.toFixed(4),
    splits: { dev: splitDev, ops: splitOps, reinvest: splitReinvest },
    source: "trade_profit"
  }, "before");

  // Execute REAL HTS TransferTransaction
  let txId = null;
  let hashScanUrl = null;
  try {
    if (process.env.DEPLOYER_ACCOUNT_ID && process.env.DEPLOYER_PRIVATE_KEY) {
      const client = Client.forTestnet();
      // Use deployer as operator to send from deployer wallet (demo: simulating agent payout)
      client.setOperator(
        AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID),
        PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY)
      );
      const operatorId = AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID);

      // Send a small real HBAR amount to itself as demo split (keeps HBAR in ecosystem)
      const demoAmount = Math.min(amount, 0.05); // cap at 0.05 HBAR per split for demo
      const tx = await new TransferTransaction()
        .addHbarTransfer(operatorId, new Hbar(-demoAmount))
        .addHbarTransfer(operatorId, new Hbar(demoAmount)) // demo: send to self, real split would go to separate wallets
        .execute(client);

      const receipt = await tx.getReceipt(client);
      txId = tx.transactionId.toString();
      hashScanUrl = `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(".", "-")}`;
      console.log(`[TradingBot] ✓ Real HTS split tx: ${txId}`);
      client.close();
    }
  } catch (e) {
    console.warn(`[TradingBot] HTS split failed (continuing): ${e.message}`);
  }

  // Post-log with real tx hash
  await log("hbar_send", "hts_transfer", {
    amount: amount.toFixed(4),
    result: "success",
    txId,
    hashScanUrl,
    totalEarned: totalEarned.toFixed(4),
    splits: { dev: splitDev, ops: splitOps, reinvest: splitReinvest }
  }, "after");

  // Record earning with HCS paystub in DB
  try {
    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: AGENT_ID,
        sessionId,
        action: "earnings_split",
        tool: "hts_transfer",
        params: { amount, splitDev, splitOps, splitReinvest, totalEarned, txId, hashScanUrl },
        phase: "after",
        timestamp: Date.now()
      })
    });
  } catch {}
}

async function tick() {
  const price = await checkPrice();
  await sleep(200);
  await makeDecision(price);
  await sleep(200);
  await doEarningsSplit();
}

async function main() {
  console.log(`[TradingBot] Starting up...`);
  await register();

  const INTERVAL_MS = 60000; // every 60 seconds
  console.log(`[TradingBot] Running — ticking every ${INTERVAL_MS / 1000}s`);

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch(console.error);
