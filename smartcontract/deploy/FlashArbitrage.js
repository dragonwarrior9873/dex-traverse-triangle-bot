const { verifyContract } = require("../utils/helpers");

module.exports = async function ({ deployments, getNamedAccounts }) {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    
    let router0, router1;
    if (hre.network.name === "bscTestnet") {
        router0 = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
        router1 = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
    }
    else if (hre.network.name === "bsc") {
        router0 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
        router1 = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
    }
    else if (hre.network.name === "goerli") {
        router0 = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
        router1 = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
    }

    console.log(`Network: ${hre.network.name}`);
    console.log(`Deployer: ${deployer}`);
    console.log(`Router 0: ${router0}`);
    console.log(`Router 1: ${router1}`);

    console.log("Waiting for Deploy...");
    const tc = await deploy("FlashArbitrage", {
        from: deployer,
        args: [ router0, router1 ],
        log: true,
        waitConfirmations: 1,
    });

    //verifyContract(hre.network.name, tc.address, tc.args);
}

module.exports.tags = ["FlashArbitrage"];
