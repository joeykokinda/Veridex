const { PrivateKey } = require("@hashgraph/sdk");

// Paste your Hedera private key here
const hederaKey = "0x8fef27e316fb02c851c8e5cf82201d0cce54bf1459937844c732971e65caa62a";

const pk = PrivateKey.fromStringDer(hederaKey);
const ethereumKey = "0x" + pk.toStringRaw();

console.log("Ethereum format:", ethereumKey);