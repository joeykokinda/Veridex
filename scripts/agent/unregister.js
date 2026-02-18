//TESTING ONLY

const { ethers } = require("ethers");
require("dotenv").config();

const AGENT_IDENTITY_ABI = [
  "function unregister() external",
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

async function main() {
  if (!process.env.AGENT_ALPHA_PRIVATE_KEY) {
    console.error("ERROR: AGENT_ALPHA_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  if (!process.env.AGENT_IDENTITY_CONTRACT) {
    console.error("ERROR: AGENT_IDENTITY_CONTRACT not found in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const wallet = new ethers.Wallet(process.env.AGENT_ALPHA_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AGENT_IDENTITY_ABI,
    wallet
  );

  const agentAddress = wallet.address;

  console.log("Agent Address:", agentAddress);

  try {
    const isRegistered = await contract.isRegistered(agentAddress);

    if (!isRegistered) {
      console.log("ERROR: Agent is not registered");
      process.exit(1);
    }

    console.log("Unregistering agent...");
    
    const tx = await contract.unregister();
    console.log("Transaction:", tx.hash);
    console.log("Waiting for confirmation...");

    await tx.wait();

    console.log("Agent unregistered!");
    console.log("\nNote: Your data is preserved on-chain.");
    console.log("You can re-register anytime with 'npm run register'\n");

  } catch (error) {
    console.error("ERROR:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
