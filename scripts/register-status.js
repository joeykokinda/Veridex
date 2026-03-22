/**
 * register-status.js
 * Registers a demo AI agent on Status Network with gasPrice=0.
 * This is the "AI agent performs onchain action" proof for the Status Network prize.
 *
 * Usage:
 *   npx hardhat run scripts/register-status.js --network status-network
 *
 * Requires deployments-status.json to exist (run deploy-status.js first).
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  const deploymentsPath = path.join(__dirname, "..", "deployments-status.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("deployments-status.json not found. Run deploy-status.js first.");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath));
  const identityAddress = deployments.AgentIdentity.address;

  console.log("\n" + "=".repeat(60));
  console.log("REGISTERING AI AGENT — STATUS NETWORK SEPOLIA (GASLESS)");
  console.log("=".repeat(60));
  console.log("Deployer:        ", deployer.address);
  console.log("AgentIdentity:   ", identityAddress);
  console.log("Gas Price:        0 (natively gasless)");
  console.log("");

  const AgentIdentity = await ethers.getContractFactory("AgentIdentity");
  const identity = AgentIdentity.attach(identityAddress);

  // Register the deployer as an AI agent with gasPrice=0
  console.log("Registering agent (gasPrice=0)...");
  const tx = await identity.register(
    "VeridexBot",           // name
    "AI agent for Veridex trust layer — ETHDenver 2026",  // metadata
    { gasPrice: 0 }
  );
  const receipt = await tx.wait();

  console.log("Registered! Tx hash:", receipt.hash);
  console.log("Gas used:          ", receipt.gasUsed.toString(), "(protocol sets price=0)");

  // Append proof to deployments file
  deployments.gaslessRegisterTx = receipt.hash;
  deployments.gaslessRegisterGasUsed = receipt.gasUsed.toString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("GASLESS REGISTRATION COMPLETE");
  console.log("=".repeat(60));
  console.log("Proof tx hash: ", receipt.hash);
  console.log("This tx has gasPrice=0 — qualifying gasless transaction.");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
