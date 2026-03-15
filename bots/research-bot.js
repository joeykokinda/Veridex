#!/usr/bin/env node
/**
 * Veridex Demo Bot — ResearchBot
 * Simulates a benign research agent doing web searches, reading URLs, summarizing.
 * All actions are logged to Veridex via POST /api/log.
 * Registers itself on startup with the Veridex monitoring system.
 */

const API_BASE = process.env.VERIDEX_API || "http://localhost:3001";
const AGENT_ID = "research-bot-demo";
const AGENT_NAME = "ResearchBot";

const SEARCH_QUERIES = [
  "latest developments in AI agent frameworks",
  "Hedera hashgraph transaction throughput 2025",
  "OpenClaw agent marketplace best practices",
  "decentralized reputation systems comparison",
  "autonomous agent security considerations",
  "smart contract audit tools 2025",
  "on-chain agent coordination patterns",
  "HBAR tokenomics Q1 2026",
  "ERC-8004 reputation standard implementation",
  "multi-agent system design patterns"
];

const URLS_TO_READ = [
  "https://hedera.com/blog",
  "https://docs.hedera.com/hedera",
  "https://github.com/openclaw/agents",
  "https://hashscan.io/testnet",
  "https://hedera.com/use-cases/ai"
];

const TOPICS_TO_SUMMARIZE = [
  "AI agent coordination mechanisms",
  "Hedera consensus service use cases",
  "Autonomous payment systems",
  "Trust and reputation in agent networks"
];

let sessionId = `research-${Date.now()}`;
let registered = false;

async function log(action, tool, params, phase = "after") {
  try {
    const resp = await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: AGENT_ID,
        sessionId,
        action,
        tool,
        params,
        phase,
        timestamp: Date.now()
      })
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    console.error(`[ResearchBot] Log error: ${e.message}`);
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
        ownerWallet: "0xDEMO0000000000000000000000000000000000001"
      })
    });
    const data = await resp.json();
    console.log(`[ResearchBot] Registered. HCS Topic: ${data.hcsTopicId || "pending"}`);
    if (data.hashScanUrl) console.log(`[ResearchBot] Audit log: ${data.hashScanUrl}`);
    registered = true;
  } catch (e) {
    console.error(`[ResearchBot] Registration failed: ${e.message}`);
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function doSearch() {
  const query = pick(SEARCH_QUERIES);
  console.log(`[ResearchBot] Searching: "${query}"`);

  // pre-action log
  await log("web_search", "web_search", { query }, "before");

  // simulate delay
  await sleep(500 + Math.random() * 1000);

  // post-action log
  await log("web_search", "web_search", { query, results: 10, topResult: "hedera.com" }, "after");
}

async function doReadUrl() {
  const url = pick(URLS_TO_READ);
  console.log(`[ResearchBot] Reading: ${url}`);

  await log("api_call", "http_request", { url, method: "GET" }, "before");
  await sleep(300 + Math.random() * 700);
  await log("api_call", "http_request", { url, method: "GET", status: 200, bytes: 12400 }, "after");
}

async function doSummarize() {
  const topic = pick(TOPICS_TO_SUMMARIZE);
  const outputFile = `/tmp/summary-${Date.now()}.txt`;
  console.log(`[ResearchBot] Summarizing: "${topic}"`);

  await log("file_write", "file_write", { path: outputFile, topic }, "before");
  await sleep(200 + Math.random() * 400);
  await log("file_write", "file_write", { path: outputFile, bytes: 2048 }, "after");
}

async function tick() {
  // Randomly do one of the three actions
  const r = Math.random();
  if (r < 0.5) {
    await doSearch();
  } else if (r < 0.8) {
    await doReadUrl();
  } else {
    await doSummarize();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`[ResearchBot] Starting up...`);
  await register();

  // Tick every 30 seconds
  const INTERVAL_MS = 30000;
  console.log(`[ResearchBot] Running — logging every ${INTERVAL_MS / 1000}s`);

  await tick(); // immediate first tick
  setInterval(tick, INTERVAL_MS);
}

main().catch(console.error);
