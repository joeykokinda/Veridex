const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying AgentIdentity to Hedera testnet...\n");

  // Deploy the contract
  const AgentIdentity = await hre.ethers.getContractFactory("AgentIdentity");
  const agentIdentity = await AgentIdentity.deploy();

  // Wait for deployment to complete
  await agentIdentity.waitForDeployment();

  const contractAddress = await agentIdentity.getAddress();

  console.log("AgentIdentity deployed!\n");
  console.log("Contract Details:");
  console.log("   Address:", contractAddress);
  console.log("   Network: Hedera Testnet");
  console.log("   Chain ID: 296");
  console.log("\nView on HashScan:");
  console.log(`   https://hashscan.io/testnet/contract/${contractAddress}`);
  console.log("\nAdd this to your .env file:");
  console.log(`   AGENT_IDENTITY_CONTRACT=${contractAddress}`);

  // Save deployment info
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deploymentData = {
    AgentIdentity: {
      address: contractAddress,
      network: "hedera-testnet",
      chainId: 296,
      deployedAt: new Date().toISOString()
    }
  };

  fs.writeFileSync(
    deploymentsPath,
    JSON.stringify(deploymentData, null, 2)
  );

  console.log("\nDeployment info saved to deployments.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
