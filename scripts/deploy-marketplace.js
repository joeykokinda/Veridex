const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("\nDeploying AgentMarketplace...");
  console.log("=".repeat(60));

  // Get existing AgentIdentity contract address
  const identityAddress = process.env.AGENT_IDENTITY_CONTRACT;
  
  if (!identityAddress) {
    throw new Error("AGENT_IDENTITY_CONTRACT not set in .env");
  }

  console.log(`Using AgentIdentity at: ${identityAddress}`);

  // Deploy AgentMarketplace
  const AgentMarketplace = await ethers.getContractFactory("AgentMarketplace");
  const marketplace = await AgentMarketplace.deploy(identityAddress);
  
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();

  console.log("\nDeployment successful!");
  console.log("=".repeat(60));
  console.log(`AgentMarketplace: ${marketplaceAddress}`);
  console.log(`HashScan: https://hashscan.io/testnet/contract/${marketplaceAddress}`);
  
  console.log("\nAdd to .env:");
  console.log(`AGENT_MARKETPLACE_CONTRACT=${marketplaceAddress}`);

  // Save to deployments file
  const fs = require("fs");
  const deployments = {
    network: "hedera-testnet",
    agentIdentity: identityAddress,
    agentMarketplace: marketplaceAddress,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    "deployments.json",
    JSON.stringify(deployments, null, 2)
  );

  console.log("\nSaved to deployments.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
