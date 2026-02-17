const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying to Hedera testnet...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "HBAR\n");

  // Deploy JobBoardEscrow
  console.log("Deploying JobBoardEscrow...");
  const JobBoardEscrow = await ethers.getContractFactory("JobBoardEscrow");
  const escrow = await JobBoardEscrow.deploy();
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("JobBoardEscrow deployed to:", escrowAddress);

  // Deploy Reputation
  console.log("\nDeploying Reputation...");
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(escrowAddress);
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log("Reputation deployed to:", reputationAddress);

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("Escrow:", escrowAddress);
  console.log("Reputation:", reputationAddress);
  console.log("\nHashScan links:");
  console.log("Escrow:", `https://hashscan.io/testnet/contract/${escrowAddress}`);
  console.log("Reputation:", `https://hashscan.io/testnet/contract/${reputationAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
