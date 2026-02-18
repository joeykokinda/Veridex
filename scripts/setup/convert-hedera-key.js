const { PrivateKey } = require("@hashgraph/sdk");
const readline = require("readline");

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("\n🔑 Hedera Key Converter");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("This tool converts Hedera DER format keys to Ethereum format.");
console.log("You can find your Hedera private key at: https://portal.hedera.com\n");

rl.question("Paste your Hedera private key (DER format, starts with 302e...): ", (derKey) => {
  try {
    // Remove any whitespace
    const cleanKey = derKey.trim();

    // Validate format
    if (!cleanKey.startsWith("302e")) {
      console.error("\n❌ Error: Invalid key format!");
      console.log("Expected: Starts with '302e...'");
      console.log("Got:", cleanKey.substring(0, 10) + "...");
      console.log("\n💡 Make sure you copied the PRIVATE KEY (not Account ID)");
      console.log("   from https://portal.hedera.com");
      rl.close();
      process.exit(1);
    }

    // Convert using Hedera SDK
    const privateKey = PrivateKey.fromStringDer(cleanKey);
    const ethereumFormat = "0x" + privateKey.toStringRaw();

    console.log("\n✅ Conversion successful!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nEthereum format:");
    console.log(ethereumFormat);
    console.log("\n📝 Add this to your .env file as:");
    console.log(`DEPLOYER_PRIVATE_KEY=${ethereumFormat}`);
    console.log("\n💡 Next step: Generate an agent wallet");
    console.log("   npm run setup:generate-wallet\n");

  } catch (error) {
    console.error("\n❌ Error converting key:", error.message);
    console.log("\n💡 Troubleshooting:");
    console.log("   - Make sure you pasted the complete key");
    console.log("   - Key should start with '302e020100300506032b6570...'");
    console.log("   - Get your key from https://portal.hedera.com");
    console.log("   - Make sure you're using a TESTNET key\n");
  }

  rl.close();
});
