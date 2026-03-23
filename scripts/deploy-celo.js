/**
 * deploy-celo.js
 * Deploys AgentIdentity + AgentMarketplace + ContentRegistry to Celo Alfajores testnet.
 * Links AgentMarketplace into AgentIdentity via setMarketplace().
 * Saves results to deployments-celo.json — does NOT touch deployments.json (Hedera).
 *
 * Prerequisites:
 *   Fund your deployer wallet with testnet CELO before running.
 *   Faucet: https://faucet.celo.org/celo-sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-celo.js --network celo
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYING VERIDEX CONTRACTS — CELO ALFAJORES");
  console.log("=".repeat(60));
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(balance), "CELO");
  console.log("Network:    Celo Alfajores (chain 11142220)");
  console.log("");

  if (balance === 0n) {
    throw new Error(
      "Deployer wallet has zero balance.\n" +
      "Fund it at: https://faucet.celo.org/celo-sepolia\n" +
      "Wallet: " + deployer.address
    );
  }

  // 1. Deploy AgentIdentity
  console.log("1/4 Deploying AgentIdentity...");
  const AgentIdentity = await ethers.getContractFactory("AgentIdentity");
  const identity = await AgentIdentity.deploy();
  await identity.waitForDeployment();
  const identityAddress = await identity.getAddress();
  console.log("    AgentIdentity deployed:", identityAddress);
  console.log("    Explorer: https://celo-sepolia.celoscan.io/address/" + identityAddress);

  // 2. Deploy AgentMarketplace (constructor takes AgentIdentity address)
  console.log("\n2/4 Deploying AgentMarketplace...");
  const AgentMarketplace = await ethers.getContractFactory("AgentMarketplace");
  const marketplace = await AgentMarketplace.deploy(identityAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("    AgentMarketplace deployed:", marketplaceAddress);
  console.log("    Explorer: https://celo-sepolia.celoscan.io/address/" + marketplaceAddress);

  // 3. Deploy ContentRegistry (no constructor args)
  console.log("\n3/4 Deploying ContentRegistry...");
  const ContentRegistry = await ethers.getContractFactory("ContentRegistry");
  const registry = await ContentRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("    ContentRegistry deployed:", registryAddress);
  console.log("    Explorer: https://celo-sepolia.celoscan.io/address/" + registryAddress);

  // 4. Link marketplace into identity contract
  console.log("\n4/4 Linking marketplace -> identity (setMarketplace)...");
  const tx = await identity.setMarketplace(marketplaceAddress);
  const receipt = await tx.wait();
  console.log("    Linked. Tx hash:", receipt.hash);

  // 5. Save to deployments-celo.json (separate from Hedera deployments.json)
  const deploymentsPath = path.join(__dirname, "..", "deployments-celo.json");
  const deploymentData = {
    network: "celo-sepolia",
    chainId: 11142220,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    AgentIdentity: {
      address: identityAddress
    },
    AgentMarketplace: {
      address: marketplaceAddress
    },
    ContentRegistry: {
      address: registryAddress
    }
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deploymentData, null, 2));
  console.log("\nSaved deployments-celo.json");

  // 6. Summary
  console.log("\n" + "=".repeat(60));
  console.log("CELO DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("AgentIdentity:    ", identityAddress);
  console.log("AgentMarketplace: ", marketplaceAddress);
  console.log("ContentRegistry:  ", registryAddress);
  console.log("");
  console.log("Add these to your .env:");
  console.log("  CELO_AGENT_IDENTITY_CONTRACT=" + identityAddress);
  console.log("  CELO_AGENT_MARKETPLACE_CONTRACT=" + marketplaceAddress);
  console.log("  CELO_CONTENT_REGISTRY_CONTRACT=" + registryAddress);
  console.log("");
  console.log("CeloScan:");
  console.log("  Identity:    https://celo-sepolia.celoscan.io/address/" + identityAddress);
  console.log("  Marketplace: https://celo-sepolia.celoscan.io/address/" + marketplaceAddress);
  console.log("  Registry:    https://celo-sepolia.celoscan.io/address/" + registryAddress);
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
