/**
 * deploy-all.js
 * Deploys AgentIdentity + AgentMarketplace, links them, updates .env + deployments.json
 *
 * Usage: npx hardhat run scripts/deploy-all.js --network hedera_testnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYING AGENTTRUST CONTRACTS");
  console.log("=".repeat(60));
  console.log("Deployer:", deployer.address);
  console.log("Network: Hedera Testnet\n");

  // 1. Deploy AgentIdentity
  console.log("1/3 Deploying AgentIdentity...");
  const AgentIdentity = await hre.ethers.getContractFactory("AgentIdentity");
  const identity = await AgentIdentity.deploy();
  await identity.waitForDeployment();
  const identityAddress = await identity.getAddress();
  console.log("    AgentIdentity deployed:", identityAddress);
  console.log("    HashScan:", `https://hashscan.io/testnet/address/${identityAddress}`);

  // 2. Deploy AgentMarketplace
  console.log("\n2/3 Deploying AgentMarketplace...");
  const AgentMarketplace = await hre.ethers.getContractFactory("AgentMarketplace");
  const marketplace = await AgentMarketplace.deploy(identityAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("    AgentMarketplace deployed:", marketplaceAddress);
  console.log("    HashScan:", `https://hashscan.io/testnet/address/${marketplaceAddress}`);

  // 3. Link marketplace in identity contract
  console.log("\n3/3 Linking marketplace → identity (setMarketplace)...");
  const tx = await identity.setMarketplace(marketplaceAddress);
  const receipt = await tx.wait();
  console.log("    Linked:", `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${receipt.hash}`);

  // 4. Update deployments.json
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deploymentData = {
    AgentIdentity: {
      address: identityAddress,
      network: "hedera-testnet",
      chainId: 296,
      deployedAt: new Date().toISOString()
    },
    AgentMarketplace: {
      address: marketplaceAddress,
      network: "hedera-testnet",
      chainId: 296,
      deployedAt: new Date().toISOString()
    }
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deploymentData, null, 2));
  console.log("\nSaved deployments.json");

  // 5. Update .env
  const envPath = path.join(__dirname, "..", ".env");
  let env = fs.readFileSync(envPath, "utf-8");

  // Update or append each address
  const updates = {
    AGENT_IDENTITY_CONTRACT: identityAddress,
    AGENT_VERIFIED_IDENTITY_CONTRACT: identityAddress,  // now one contract for both
    AGENT_MARKETPLACE_CONTRACT: marketplaceAddress,
    NEXT_PUBLIC_CONTRACT_ADDRESS: identityAddress,
    NEXT_PUBLIC_MARKETPLACE_ADDRESS: marketplaceAddress
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*`, "m");
    if (regex.test(env)) {
      env = env.replace(regex, `${key}=${value}`);
    } else {
      env += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, env);
  console.log("Updated .env");

  // 6. Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("AgentIdentity:    ", identityAddress);
  console.log("AgentMarketplace: ", marketplaceAddress);
  console.log("");
  console.log("HashScan:");
  console.log("  Identity:    https://hashscan.io/testnet/address/" + identityAddress);
  console.log("  Marketplace: https://hashscan.io/testnet/address/" + marketplaceAddress);
  console.log("");
  console.log("Next: node scripts/fresh-register.js");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
