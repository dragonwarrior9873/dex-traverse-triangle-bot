const fs = require("fs");

const exchangeGoerli = require("./exchanges-goerli.json");
const exchangeBSC = require("./exchanges-bsc.json");
const exchangeETH = require("./exchanges-eth.json");

const isArbitragalbe = (itemA, itemB, amountThreshold, ratioThreshold) => {
    if (itemA.price === 0 || itemB.price === 0)
        return false;

    if (itemA.token0.amount < amountThreshold || itemA.token1.amount < amountThreshold)
        return false;

    if (itemB.token0.amount < amountThreshold || itemB.token1.amount < amountThreshold)
        return false;

    const maxPrice = Math.max(itemA.price, itemB.price);
    const minPrice = Math.min(itemA.price, itemB.price);
    if (minPrice / maxPrice > ratioThreshold)
        return false;

    return true;
}

const printArbitragableInfo = (exchangeInfo, fileName) => {
    const amountThreshold = 1;
    const ratioThreshold = 0.9;
    let arbitrageInfo = {};
    for (let pairName in exchangeInfo) {
        const itemA = exchangeInfo[pairName]["PancakeSwap"];
        const itemB = exchangeInfo[pairName]["SushiSwap"];
        if (isArbitragalbe(itemA, itemB, amountThreshold, ratioThreshold))
            arbitrageInfo[pairName] = exchangeInfo[pairName];
    }
    fs.writeFileSync(fileName, JSON.stringify(arbitrageInfo));
}

// printArbitragableInfo(exchangeGoerli, "arb-exchanges-goerli.json");
// printArbitragableInfo(exchangeBSC, "arb-exchanges-bsc.json");
printArbitragableInfo(exchangeETH, "arb-exchanges-eth.json");
