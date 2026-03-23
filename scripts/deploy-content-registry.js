/**
 * Deploy ContentRegistry to Hedera testnet
 * After deploy: add CONTENT_REGISTRY_CONTRACT=<address> to .env
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  console.log("Deploying ContentRegistry to Hedera testnet...\n");

  const ContentRegistry = await hre.ethers.getContractFactory("ContentRegistry");
  const registry = await ContentRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();

  console.log("ContentRegistry deployed!");
  console.log("   Address:", address);
  console.log("   Network: Hedera Testnet");
  console.log("\nView on HashScan:");
  console.log(`   https://hashscan.io/testnet/contract/${address}`);
  console.log("\nAdd to your .env file:");
  console.log(`   CONTENT_REGISTRY_CONTRACT=${address}`);

  // Auto-patch .env if it exists
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, "utf-8");
    if (env.includes("CONTENT_REGISTRY_CONTRACT=")) {
      env = env.replace(/CONTENT_REGISTRY_CONTRACT=.*/, `CONTENT_REGISTRY_CONTRACT=${address}`);
    } else {
      env += `\nCONTENT_REGISTRY_CONTRACT=${address}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log("\n✓ .env updated automatically");
  }

  // Save to deployments.json
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  }
  deployments.ContentRegistry = {
    address,
    network: "hedera-testnet",
    chainId: 296,
    deployedAt: new Date().toISOString()
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("✓ deployments.json updated");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
