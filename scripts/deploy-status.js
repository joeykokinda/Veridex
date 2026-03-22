/**
 * deploy-status.js
 * Deploys AgentIdentity + AgentMarketplace + ContentRegistry to Status Network Sepolia.
 * Status Network has gas=0 at the protocol level — all transactions are natively gasless.
 * Saves results to deployments-status.json.
 *
 * Prerequisites:
 *   Fund deployer wallet with testnet ETH from Status Network faucet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-status.js --network status-network
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYING VERIDEX CONTRACTS — STATUS NETWORK SEPOLIA");
  console.log("=".repeat(60));
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(balance), "ETH");
  console.log("Chain ID:   1660990954");
  console.log("Gas Price:  0 (natively gasless!)");
  console.log("");

  // 1. Deploy AgentIdentity
  console.log("1/4 Deploying AgentIdentity...");
  const AgentIdentity = await ethers.getContractFactory("AgentIdentity");
  const identity = await AgentIdentity.deploy({ gasPrice: 0 });
  await identity.waitForDeployment();
  const identityAddress = await identity.getAddress();
  console.log("    AgentIdentity deployed:", identityAddress);

  // 2. Deploy AgentMarketplace
  console.log("\n2/4 Deploying AgentMarketplace...");
  const AgentMarketplace = await ethers.getContractFactory("AgentMarketplace");
  const marketplace = await AgentMarketplace.deploy(identityAddress, { gasPrice: 0 });
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("    AgentMarketplace deployed:", marketplaceAddress);

  // 3. Deploy ContentRegistry
  console.log("\n3/4 Deploying ContentRegistry...");
  const ContentRegistry = await ethers.getContractFactory("ContentRegistry");
  const registry = await ContentRegistry.deploy({ gasPrice: 0 });
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("    ContentRegistry deployed:", registryAddress);

  // 4. Link marketplace -> identity
  console.log("\n4/4 Linking marketplace -> identity (setMarketplace)...");
  const tx = await identity.setMarketplace(marketplaceAddress, { gasPrice: 0 });
  const receipt = await tx.wait();
  console.log("    Linked. Tx hash:", receipt.hash);

  // 5. Save deployments
  const deploymentsPath = path.join(__dirname, "..", "deployments-status.json");
  const deploymentData = {
    network: "status-network-sepolia",
    chainId: 1660990954,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    gasless: true,
    AgentIdentity: { address: identityAddress },
    AgentMarketplace: { address: marketplaceAddress },
    ContentRegistry: { address: registryAddress },
    proofTx: receipt.hash
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deploymentData, null, 2));
  console.log("\nSaved deployments-status.json");

  // 6. Summary
  console.log("\n" + "=".repeat(60));
  console.log("STATUS NETWORK DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("AgentIdentity:    ", identityAddress);
  console.log("AgentMarketplace: ", marketplaceAddress);
  console.log("ContentRegistry:  ", registryAddress);
  console.log("Gasless proof tx: ", receipt.hash);
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
