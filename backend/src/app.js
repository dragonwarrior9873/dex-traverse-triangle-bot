const dotenv = require("dotenv");
const BigNumber = require("bignumber.js");
const Web3 = require("web3");
const fs = require("fs");
const { doFlashArbitrage } = require("./flashBot");
const { doNormalArbitrage } = require("./normalBot");

const config = require("./config.json");
const erc20ABI = require("./abi/erc20.json");
const routerABI = require("./abi/router.json");
const factoryABI = require("./abi/factory.json");
const pairABI = require("./abi/pair.json");

dotenv.config();

const flashBotEnable = true;

const activeConfig = config[config.active];
const exchangeNames = {
    [activeConfig.ROUTER0_ADDRESS]: "PancakeSwap",
    [activeConfig.ROUTER1_ADDRESS]: "SushiSwap",
};
const web3 = new Web3(activeConfig.RPC_URL);

const getReadableAmount = (amountInWei, decimals) => {
    const bn = new BigNumber(amountInWei + "e-" + decimals);
    return Number(bn.toString());
};

const printPairs = async (router, count) => {
    const routerContract = new web3.eth.Contract(routerABI, router);

    const factoryAddr = await routerContract.methods.factory().call();
    const factoryContract = new web3.eth.Contract(factoryABI, factoryAddr);

    let allPairsLength = await factoryContract.methods.allPairsLength().call();
    console.log(`Detected ${allPairsLength} pairs in ${exchangeNames[router]}`);

    if (count > 0 && allPairsLength > count)
        allPairsLength = count;

    console.log(`${allPairsLength} Pairs in ${exchangeNames[router]}`);
    for (let i = 0; i < allPairsLength; i++) {
        try {
            const pairAddr = await factoryContract.methods.allPairs(i).call();
            const pairContract = await new web3.eth.Contract(pairABI, pairAddr);

            const token0Addr = await pairContract.methods.token0().call();
            const token0Contract = await new web3.eth.Contract(erc20ABI, token0Addr);
            // const token0Name = await token0Contract.methods.name().call();
            const token0Symbol = await token0Contract.methods.symbol().call();

            const token1Addr = await pairContract.methods.token1().call();
            const token1Contract = await new web3.eth.Contract(erc20ABI, token1Addr);
            // const token1Name = await token1Contract.methods.name().call();
            const token1Symbol = await token1Contract.methods.symbol().call();

            const reserves = await pairContract.methods.getReserves().call();
            const tokenPrice = (+reserves[0] === 0) ? 0 : +reserves[1] / +reserves[0];

            console.log(`Pair ${i}: ${token0Symbol}(${token0Addr})/${token1Symbol}(${token1Addr}) - ${tokenPrice}, (${reserves[0]}, ${reserves[1]})`);
            //console.log(`Pair ${i}: ${token0Symbol}/${token1Symbol} - ${tokenPrice}, (${reserves[0]}, ${reserves[1]})`);
        }
        catch (err) {

        }
    }
}

const FILENAME = "exchanges.json";
var exchangeStats = {};
const loadExchangeStatsForToken = async (router0, router1, COUNT) => {
    const routerContract0 = new web3.eth.Contract(routerABI, router0);
    const routerContract1 = new web3.eth.Contract(routerABI, router1);

    var factoryContract = {};
    const factoryAddr0 = await routerContract0.methods.factory().call();
    factoryContract[router0] = new web3.eth.Contract(factoryABI, factoryAddr0);

    const factoryAddr1 = await routerContract1.methods.factory().call();
    factoryContract[router1] = new web3.eth.Contract(factoryABI, factoryAddr1);

    const firstPairsLength = await factoryContract[router0].methods.allPairsLength().call();
    const secondPairsLength = await factoryContract[router1].methods.allPairsLength().call();
    let pairsLength = Number(firstPairsLength) > Number(secondPairsLength) ? Number(secondPairsLength) : Number(firstPairsLength);
    const exchangeA = Number(firstPairsLength) > Number(secondPairsLength) ? router1 : router0;
    const exchangeB = Number(firstPairsLength) > Number(secondPairsLength) ? router0 : router1;

    if (COUNT && COUNT > 0 && pairsLength > COUNT)
        pairsLength = COUNT;

    console.log("Loading exchange stats...", pairsLength);

    exchangeStats = {};
    for (let i = 0; i < pairsLength; i++) {
        // process.stdout.write(".");
        try {
            const pairAddrA = await factoryContract[exchangeA].methods.allPairs(i).call();
            const pairContractA = await new web3.eth.Contract(pairABI, pairAddrA);

            const token0Addr = await pairContractA.methods.token0().call();
            const token0Contract = await new web3.eth.Contract(erc20ABI, token0Addr);
            const token0Symbol = await token0Contract.methods.symbol().call();
            const token0Decimals = await token0Contract.methods.decimals().call();

            const token1Addr = await pairContractA.methods.token1().call();
            const token1Contract = await new web3.eth.Contract(erc20ABI, token1Addr);
            const token1Symbol = await token1Contract.methods.symbol().call();
            const token1Decimals = await token1Contract.methods.decimals().call();

            const pairAddrB = await factoryContract[exchangeB].methods.getPair(token0Addr, token1Addr).call();
            if (pairAddrB === "0x0000000000000000000000000000000000000000")
                continue;
            
            const pairContractB = await new web3.eth.Contract(pairABI, pairAddrB);

            const reservesA = await pairContractA.methods.getReserves().call();
            const tokenPriceA = (+reservesA[0] == 0) ? 0 : +reservesA[1] / +reservesA[0];

            const reservesB = await pairContractB.methods.getReserves().call();
            const tokenPriceB = (+reservesB[0] == 0) ? 0 : +reservesB[1] / +reservesB[0];

            const pairName = `${token0Symbol}/${token1Symbol}`;
            exchangeStats[pairName] = {};
            exchangeStats[pairName][exchangeNames[exchangeA]] = {
                price: tokenPriceA,
                token0: {
                    address: token0Addr,
                    symbol: token0Symbol,
                    amount: getReadableAmount(reservesA[0], token0Decimals),
                },
                token1: {
                    address: token1Addr,
                    symbol: token1Symbol,
                    amount: getReadableAmount(reservesA[1], token1Decimals),
                },
            };
            exchangeStats[pairName][exchangeNames[exchangeB]] = {
                price: tokenPriceB,
                token0: {
                    address: token0Addr,
                    symbol: token0Symbol,
                    amount: getReadableAmount(reservesB[0], token0Decimals),
                },
                token1: {
                    address: token1Addr,
                    symbol: token1Symbol,
                    amount: getReadableAmount(reservesB[1], token1Decimals),
                },
            };
            console.log(`${pairName}:${JSON.stringify(exchangeStats[pairName])}`);
            fs.writeFileSync(FILENAME, JSON.stringify(exchangeStats));
        }
        catch (err) {
            console.log(err);
        }
    }
    // console.log(JSON.stringify(exchangeStats));
};

const main = async () => {
    /* Print pairs for testing */
    if (activeConfig.PRINT_PAIRS) {
        // await printPairs(activeConfig.ROUTER0_ADDRESS, 100);
        // await printPairs(activeConfig.ROUTER1_ADDRESS, 100);
        await loadExchangeStatsForToken(activeConfig.ROUTER0_ADDRESS, activeConfig.ROUTER1_ADDRESS);
    }

    if (flashBotEnable)
        await doFlashArbitrage(web3, activeConfig);
    else
        await doNormalArbitrage(web3, activeConfig);
}

main();
