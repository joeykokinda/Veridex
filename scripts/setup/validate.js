require("dotenv").config();

console.log("\n🔍 Setup Validation Check");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Checking if your environment is properly configured...\n");

let allGood = true;
const issues = [];
const warnings = [];

// Check 1: .env file exists
console.log("📄 Checking .env file...");
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", "..", ".env");

if (!fs.existsSync(envPath)) {
  console.log("   ❌ .env file not found");
  issues.push("Create .env file: cp .env.example .env");
  allGood = false;
} else {
  console.log("   ✅ .env file exists");
}

// Check 2: Deployer private key
console.log("\n🔑 Checking DEPLOYER_PRIVATE_KEY...");
if (!process.env.DEPLOYER_PRIVATE_KEY) {
  console.log("   ❌ Not set in .env");
  issues.push("Run: npm run setup:convert-key");
  allGood = false;
} else if (!process.env.DEPLOYER_PRIVATE_KEY.startsWith("0x")) {
  console.log("   ❌ Invalid format (must start with 0x)");
  issues.push("Run: npm run setup:convert-key");
  allGood = false;
} else if (process.env.DEPLOYER_PRIVATE_KEY === "0x...") {
  console.log("   ❌ Still has placeholder value");
  issues.push("Run: npm run setup:convert-key");
  allGood = false;
} else {
  console.log("   ✅ Set correctly");
}

// Check 3: Agent private key
console.log("\n🤖 Checking AGENT_ALPHA_PRIVATE_KEY...");
if (!process.env.AGENT_ALPHA_PRIVATE_KEY) {
  console.log("   ❌ Not set in .env");
  issues.push("Run: npm run setup:generate-wallet");
  allGood = false;
} else if (!process.env.AGENT_ALPHA_PRIVATE_KEY.startsWith("0x")) {
  console.log("   ❌ Invalid format (must start with 0x)");
  issues.push("Run: npm run setup:generate-wallet");
  allGood = false;
} else if (process.env.AGENT_ALPHA_PRIVATE_KEY === "0x...") {
  console.log("   ❌ Still has placeholder value");
  issues.push("Run: npm run setup:generate-wallet");
  allGood = false;
} else {
  console.log("   ✅ Set correctly");
}

// Check 4: Contract address
console.log("\n📝 Checking AGENT_IDENTITY_CONTRACT...");
if (!process.env.AGENT_IDENTITY_CONTRACT || process.env.AGENT_IDENTITY_CONTRACT === "0x...") {
  console.log("   ⚠️  Not deployed yet");
  warnings.push("Deploy contract: npm run deploy");
} else if (!process.env.AGENT_IDENTITY_CONTRACT.startsWith("0x")) {
  console.log("   ❌ Invalid format (must start with 0x)");
  issues.push("Re-deploy: npm run deploy");
  allGood = false;
} else {
  console.log("   ✅ Contract deployed");
}

// Check 5: Anthropic API key (optional)
console.log("\n🧠 Checking ANTHROPIC_API_KEY...");
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith("sk-ant-...")) {
  console.log("   ⚠️  Not set (optional for OpenClaw)");
  warnings.push("Get API key from console.anthropic.com");
} else {
  console.log("   ✅ Set correctly");
}

// Check 6: Dependencies
console.log("\n📦 Checking dependencies...");
const nodeModulesPath = path.join(__dirname, "..", "..", "node_modules");
if (!fs.existsSync(nodeModulesPath)) {
  console.log("   ❌ node_modules not found");
  issues.push("Run: npm install");
  allGood = false;
} else {
  console.log("   ✅ Dependencies installed");
}

// Summary
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

if (allGood && issues.length === 0) {
  console.log("\n✅ Setup is complete!");
  
  if (warnings.length > 0) {
    console.log("\n⚠️  Optional steps remaining:");
    warnings.forEach((warning, idx) => {
      console.log(`   ${idx + 1}. ${warning}`);
    });
  }
  
  console.log("\n💡 Next steps:");
  if (!process.env.AGENT_IDENTITY_CONTRACT || process.env.AGENT_IDENTITY_CONTRACT === "0x...") {
    console.log("   1. npm run deploy");
    console.log("   2. Add contract address to .env");
    console.log("   3. npm run register");
  } else {
    console.log("   1. npm run register");
    console.log("   2. npm run status");
  }
  console.log("");
  
} else {
  console.log("\n❌ Setup incomplete. Please fix these issues:\n");
  issues.forEach((issue, idx) => {
    console.log(`   ${idx + 1}. ${issue}`);
  });
  console.log("\n💡 See SETUP.md for detailed instructions\n");
  process.exit(1);
}
