// const { BigNumber } = require("ethers");
// const { ethers, network } = require("hardhat");
const shell = require("shelljs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function getNonce(num) {
    if (num.length > 0)
        return num;
    return "0x" + crypto.randomBytes(32).toString("hex");
}

deployNew = async (contractName, params = []) => {
    const C = await hre.ethers.getContractFactory(contractName);
    return C.deploy(...params);
}

deployNewFromAbi = async(abi, bytecode, signer, params) => {
    const C = new hre.ethers.ContractFactory(abi, bytecode, signer);
    if (params) {
        return C.deploy(...params);
    } else {
        return C.deploy();
    }
}

function verifyContract(network, deployedAddress, args) {
    console.log("Verifying contract with", network, deployedAddress);
    console.log(hre.config.networks[network].accounts);
    let verifyCommand = `npx hardhat --network ${network} verify ${deployedAddress}`;
    for (let i in args)
        verifyCommand += ` ${args[i]}`;
    console.log(verifyCommand);
    shell.exec(verifyCommand);
}

function getDeploymentAddresses(networkName) {
    const PROJECT_ROOT = path.resolve(__dirname, "..");
    const DEPLOYMENT_PATH = path.resolve(PROJECT_ROOT, "deployments");

    let folderName = networkName
    if (networkName === "hardhat")
        folderName = "localhost";

    const networkFolderName = fs.readdirSync(DEPLOYMENT_PATH).filter((f) => f === folderName)[0]
    if (networkFolderName === undefined) {
        throw new Error("missing deployment files for endpoint " + folderName)
    }

    let rtnAddresses = {}
    const networkFolderPath = path.resolve(DEPLOYMENT_PATH, folderName)
    const files = fs.readdirSync(networkFolderPath).filter((f) => f.includes(".json"))
    files.forEach((file) => {
        const filepath = path.resolve(networkFolderPath, file)
        const data = JSON.parse(fs.readFileSync(filepath))
        const contractName = file.split(".")[0]
        rtnAddresses[contractName] = data.address
    })

    return rtnAddresses
}

module.exports = {
    deployNew,
    deployNewFromAbi,
    verifyContract,
    getDeploymentAddresses,
    getNonce,
}
