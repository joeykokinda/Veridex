const { ethers } = require("ethers");
require("dotenv").config();

const AgentIdentity = require("./artifacts/contracts/AgentIdentity.sol/AgentIdentity.json");

async function test() {
  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    AgentIdentity.abi,
    provider
  );
  
  const aliceAddress = "0x93503b299127881D0d663401dF7C2892b737bbab";
  
  console.log("Querying agent:", aliceAddress);
  console.log("Contract:", process.env.AGENT_IDENTITY_CONTRACT);
  
  try {
    const agent = await contract.getAgent(aliceAddress);
    console.log("\nAgent data:");
    console.log("Name:", agent.name);
    console.log("Active:", agent.active);
    console.log("RegisteredAt:", agent.registeredAt.toString());
    console.log("Reputation:", agent.reputationScore.toString());
  } catch (error) {
    console.error("Error:", error.message);
  }
}

test();
