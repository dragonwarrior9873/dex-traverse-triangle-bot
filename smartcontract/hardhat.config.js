require("dotenv").config();
require('hardhat-contract-sizer');
require(`@nomiclabs/hardhat-etherscan`);
require("solidity-coverage");
require('hardhat-gas-reporter');
require('hardhat-deploy');
require('hardhat-deploy-ethers');
require('@openzeppelin/hardhat-upgrades');
require('./tasks');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.10",
    contractSizer: {
        alphaSort: false,
        runOnCompile: true,
        disambiguatePaths: false,
    },
    namedAccounts: {
        deployer: {
            default: 0,    // wallet address 0, of the mnemonic in .env
        },
        proxyOwner: {
            default: 1,
        },
    },
    networks:{
        goerli: {
            url: "https://ethereum-goerli.publicnode.com",
            chainId: 5,
            accounts:[process.env.PRIVATE_KEY],
        },
        bsc: {
            url: "https://bsc-dataseed.binance.org",
            chainId: 56,
            gasPrice: 20000000000,
            accounts: [process.env.PRIVATE_KEY],
        },
        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            // gasPrice: 20000000000,
            accounts: [process.env.PRIVATE_KEY],
        },
        hardhat: {
            gasPrice: 10000000000, // Set the gas price to 20 Gwei
            // Other configurations...
        }
    },
    etherscan: {
        apiKey: {
            goerli: process.env.ETH_SCAN_API_KEY,
            bsc: process.env.BSC_SCAN_API_KEY,
            bscTestnet: process.env.BSC_SCAN_API_KEY
        }
    },
    settings: {
        optimizer: {
            enabled: true,
            runs: 200,
        },
    },
    allowUnlimitedContractSize: true,
};
