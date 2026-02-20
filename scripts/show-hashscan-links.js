/**
 * show-hashscan-links.js
 * Print verified links for all 4 agents: registration tx, account page, contracts
 *
 * NOTE on HashScan vs Mirror Node:
 *   HashScan's /tx/{evmHash} search doesn't reliably find EVM contract call txs.
 *   Use these instead:
 *   - Contract pages: https://hashscan.io/testnet/contract/{hedera_id}
 *   - Transaction lookup: https://testnet.mirrornode.hedera.com/api/v1/contracts/results/{evmHash}
 *   - Account pages: https://hashscan.io/testnet/account/{evmAddress}  ← these work fine
 */
require("dotenv").config();
const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");

const IDENTITY_ABI = [
  "event AgentRegistered(address indexed agentAddress, string name, bool verified, uint256 timestamp)",
  "function totalAgents() external view returns (uint256)",
  "function isVerified(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

const wallets = {
  albert: require("../agents/.wallets/albert.json").address,
  eli:    require("../agents/.wallets/eli.json").address,
  gt:     require("../agents/.wallets/gt.json").address,
  joey:   require("../agents/.wallets/joey.json").address,
};

async function main() {
  const newAddr  = process.env.AGENT_VERIFIED_IDENTITY_CONTRACT;
  const oldAddr  = process.env.AGENT_IDENTITY_CONTRACT;
  const mktAddr  = process.env.AGENT_MARKETPLACE_CONTRACT;

  const newContract = new ethers.Contract(newAddr, IDENTITY_ABI, provider);

  console.log("=".repeat(60));
  console.log("AGENTTRUST — HEDERA TESTNET HASHSCAN LINKS");
  console.log("=".repeat(60));
  console.log("");
  console.log("CONTRACT ADDRESSES:");
  console.log(`  AgentIdentity (verified):  ${newAddr}`);
  console.log(`  HashScan: https://hashscan.io/testnet/address/${newAddr}`);
  console.log("");
  console.log(`  AgentIdentity (marketplace): ${oldAddr}`);
  console.log(`  HashScan: https://hashscan.io/testnet/address/${oldAddr}`);
  console.log("");
  console.log(`  AgentMarketplace: ${mktAddr}`);
  console.log(`  HashScan: https://hashscan.io/testnet/address/${mktAddr}`);
  console.log("");

  // Query AgentRegistered events on new (verified) contract
  const filter = newContract.filters.AgentRegistered();
  let events = [];
  try {
    events = await newContract.queryFilter(filter, 0, "latest");
  } catch (e) {
    console.log("Could not fetch events:", e.message);
  }

  const addrToName = {};
  for (const [name, addr] of Object.entries(wallets)) {
    addrToName[addr.toLowerCase()] = name;
  }

  console.log("AGENT REGISTRATIONS (on verified contract):");
  console.log("-".repeat(60));

  for (const ev of events) {
    const addr = ev.args.agentAddress.toLowerCase();
    const agentKey = addrToName[addr];
    if (!agentKey) continue;

    const name = ev.args.name;
    const verified = ev.args.verified;

    console.log(`\n${agentKey.toUpperCase()} — "${name}"`);
    console.log(`  verifiedMachineAgent : ${verified}`);
    console.log(`  Wallet address       : ${ev.args.agentAddress}`);
    console.log(`  Registration tx      : ${ev.transactionHash}`);
    console.log(`  Mirror Node (tx)     : https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${ev.transactionHash}`);
    console.log(`  HashScan (account)   : https://hashscan.io/testnet/account/${ev.args.agentAddress}`);
  }

  console.log("");
  console.log("-".repeat(60));
  console.log("LIVE ON-CHAIN AGENT PROFILES:");
  console.log("-".repeat(60));

  for (const [agentKey, addr] of Object.entries(wallets)) {
    try {
      const agent = await newContract.getAgent(addr);
      const verified = await newContract.isVerified(addr);
      console.log(`\n${agentKey.toUpperCase()}`);
      console.log(`  name                 : ${agent.name}`);
      console.log(`  verifiedMachineAgent : ${verified}`);
      console.log(`  jobsCompleted        : ${agent.jobsCompleted}`);
      console.log(`  reputationScore      : ${agent.reputationScore}/1000`);
      console.log(`  HashScan (account)   : https://hashscan.io/testnet/account/${addr}`);
    } catch (e) {
      console.log(`${agentKey}: error fetching — ${e.message}`);
    }
  }

  console.log("");
  console.log("=".repeat(60));
}

main().catch(console.error);
