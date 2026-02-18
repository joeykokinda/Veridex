const { ethers } = require("ethers");
require("dotenv").config();

// ABI for the AgentIdentity contract (only functions we need)
const AGENT_IDENTITY_ABI = [
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active))"
];

async function main() {
  // Check required environment variables
  if (!process.env.AGENT_ALPHA_PRIVATE_KEY) {
    console.error("ERROR: AGENT_ALPHA_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  if (!process.env.AGENT_IDENTITY_CONTRACT) {
    console.error("ERROR: AGENT_IDENTITY_CONTRACT not found in .env");
    console.log("Deploy the contract first: npm run deploy");
    process.exit(1);
  }

  // Connect to Hedera testnet
  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const wallet = new ethers.Wallet(process.env.AGENT_ALPHA_PRIVATE_KEY, provider);
  
  // Connect to the contract
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AGENT_IDENTITY_ABI,
    wallet
  );

  const agentAddress = wallet.address;

  console.log("Checking agent status...");
  console.log("Address:", agentAddress, "\n");

  try {
    // Check if registered
    const isRegistered = await contract.isRegistered(agentAddress);

    if (!isRegistered) {
      console.log("Not registered yet");
      console.log("\nRegister your agent with: npm run register");
      return;
    }

    // Fetch agent profile
    const agent = await contract.getAgent(agentAddress);
    const registeredDate = new Date(Number(agent.registeredAt) * 1000);

    console.log("Registered Agent");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Name:", agent.name);
    console.log("Description:", agent.description);
    console.log("Capabilities:", agent.capabilities);
    console.log("Registered:", registeredDate.toLocaleString());
    console.log("Address:", agentAddress);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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
