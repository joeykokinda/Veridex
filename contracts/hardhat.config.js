require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.24",
  networks: {
    hedera_testnet: {
      url: "https://testnet.hashio.io/api",
      accounts: ["0x8fef27e316fb02c851c8e5cf82201d0cce54bf1459937844c732971e65caa62a"],
      chainId: 296,
    },
  },
};
