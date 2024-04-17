const BigNumber = require("bignumber.js");
const erc20ABI = require("./abi/erc20.json");
const routerABI = require("./abi/router.json");
const factoryABI = require("./abi/factory.json");
const pairABI = require("./abi/pair.json");
const arbitrageABI = require("./abi/normalArbitrage.json");

const P_INDEX = "PancakeSwap";
const S_INDEX = "SushiSwap";

const LOG_TRY_TIME = 10000;

var web3;
var _myAccount;
var _routerContract = {};
var _pairContract = {};

var _tokenContract;
var _normalArbitrageContract;
var _contractBalanceInWei = 0;
var _ethPrice = 0;
var _lastTryTime = 0;

const getTokenPrice = async (index) => {
    const reserves = await _pairContract[index].methods.getReserves().call();
    const tokenPrice = reserves[1] / reserves[0];
    printLog("info", `[NormalArbitrage: getTokenPrice] ${index}: R0=${reserves[0]}, R1=${reserves[1]}, P=${tokenPrice}`);
    return tokenPrice;
};

const getReadableAmount = (amountInWei, decimals) => {
    const bn = new BigNumber(amountInWei + "e-" + decimals);
    return Number(bn.toString());
};

const getWeiAmount = (amount, decimals) => {
    const bn = new BigNumber(amount + "e" + decimals);
    return bn.toFixed(0);
};

const printLog = (level, message) => {
    const msg = {
        command: "log",
        time: Date.now(),
        level: level,
        log: message,
    };
    process.stdout.write(JSON.stringify(msg) + "\r\n");
};

const getCurrentGasPrices = async () => {
    try {
        //this URL is for Ethereum mainnet and Ethereum testnets
        let GAS_STATION = `https://api.debank.com/chain/gas_price_dict_v2?chain=bsc`;
        var response = await axios.get(GAS_STATION);
        var prices = {
            low: Math.floor(response.data.data.slow.price),
            medium: Math.floor(response.data.data.normal.price),
            high: Math.floor(response.data.data.fast.price),
        };
        return prices;
    } catch (error) {
        //console.log(error);
        const price = await web3.eth.getGasPrice();
        return {
            low: price,
            medium: price,
            high: price
        }
    }
};

const signAndSendTransaction = async (data, from, to, gas, gasPrice, callback) => {
    var nonce = await web3.eth.getTransactionCount(from, "pending");
    nonce = web3.utils.toHex(nonce);
    let encodedABI = data.encodeABI();

    let tx = {
        from: from,
        to: to,
        gas: gas,
        gasPrice: gasPrice,
        data: encodedABI,
        nonce,
    };
    let signedTx = await _myAccount.signTransaction(tx);
    await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    //.on("transactionHash", (hash) => {
    //    printLog("debug", `[NormalArbitrage: TX] hash=${hash}`);
    //})
    .on("receipt", async (receipt) => {
        if (callback)
            callback(null, receipt);
    })
    .on("error", (error, receipt) => {
        if (callback)
            callback(error, receipt);
    });
};

const getProfit = async (amountIn, forward, PP, SS, gasFee, decimals) => {
    let profit;
    const amountIn2 = getReadableAmount(amountIn.toString(), decimals);
    let fee = Number(web3.utils.fromWei(gasFee.toString(), "ether"));
    if (forward) {
        const b = await _routerContract[P_INDEX].methods.getAmountOut(amountIn, PP[0], PP[1]).call();
        const a = await _routerContract[S_INDEX].methods.getAmountOut(b, SS[1], SS[0]).call();
        let amountOut = getReadableAmount(a.toString(), decimals);
        profit = (amountOut - amountIn2) / _ethPrice;
    }
    else {
        const b = await _routerContract[S_INDEX].methods.getAmountOut(amountIn, SS[0], SS[1]).call();
        const a = await _routerContract[P_INDEX].methods.getAmountOut(b, PP[1], PP[0]).call();
        let amountOut = getReadableAmount(a.toString(), decimals);
        profit = (amountOut - amountIn2) / _ethPrice;
    }
    profit -= fee;
    return profit;
}

const init = async (priv_key, config) => {
    printLog("info", "[NormalArbitrage: init] Starting...");

    _myAccount = web3.eth.accounts.privateKeyToAccount(priv_key);

    _tokenContract = new web3.eth.Contract(erc20ABI, config.TOKEN0);
    _normalArbitrageContract = new web3.eth.Contract(arbitrageABI, config.NORMAL_ARBITRAGE_ADDRESS);
    _contractBalanceInWei = await _tokenContract.methods.balanceOf(_normalArbitrageContract.options.address).call();

    /* Initialize DEX 0 (PancakeSwap) */
    _routerContract[P_INDEX] = new web3.eth.Contract(routerABI, config.ROUTER0_ADDRESS);

    const factoryAddr0 = await _routerContract[P_INDEX].methods.factory().call();
    const factoryContract0 = new web3.eth.Contract(factoryABI, factoryAddr0);

    const pairAddr0 = await factoryContract0.methods.getPair(config.TOKEN0, config.TOKEN1).call();
    _pairContract[P_INDEX] = new web3.eth.Contract(pairABI, pairAddr0);
    
    /* Initialize DEX 1 (SushiSwap) */
    _routerContract[S_INDEX] = new web3.eth.Contract(routerABI, config.ROUTER1_ADDRESS);

    const factoryAddr1 = await _routerContract[S_INDEX].methods.factory().call();
    const factoryContract1 = new web3.eth.Contract(factoryABI, factoryAddr1);

    const pairAddr1 = await factoryContract1.methods.getPair(config.TOKEN0, config.TOKEN1).call();
    _pairContract[S_INDEX] = new web3.eth.Contract(pairABI, pairAddr1);

    printLog("debug", `[NormalArbitrage: init] ROUTER0: ${config.ROUTER0_ADDRESS}, FACTORY: ${factoryAddr0}, PAIR: ${pairAddr0}`);
    printLog("debug", `[NormalArbitrage: init] ROUTER1: ${config.ROUTER1_ADDRESS}, FACTORY: ${factoryAddr1}, PAIR: ${pairAddr1}`);

    try {
        const pairAddr = await factoryContract0.methods.getPair(config.TOKEN0, config.ETH).call();
        const pairContract = new web3.eth.Contract(pairABI, pairAddr);
        RR = await pairContract.methods.getReserves().call();
        _ethPrice = RR[0] / RR[1]; // {1}ETH = {_ethPrice}TOKEN0
        printLog("debug", `[NormalArbitrage: init] ETH Price: ${_ethPrice}`);
    }
    catch (error) {
        console.log(error);
    }
    
    await getTokenPrice(P_INDEX);
    await getTokenPrice(S_INDEX);

    printLog("info", "[NormalArbitrage: init] Done!");

    const msg = {
        command: "account",
        account: {
            address: _normalArbitrageContract?.options.address,
            currency: config.TOKEN0,
        }
    };
    process.stdout.write(JSON.stringify(msg) + "\r\n");
}

const processArbitrage = async (config, decimals0, decimals1) => {
    try {
        let PP = await _pairContract[P_INDEX].methods.getReserves().call();
        let SS = await _pairContract[S_INDEX].methods.getReserves().call();
        const P1 = getReadableAmount(PP[1], decimals1);
        const P0 = getReadableAmount(PP[0], decimals0);
        const S1 = getReadableAmount(SS[1], decimals1);
        const S0 = getReadableAmount(SS[0], decimals0);

        let diffPrice = (P1 / P0) - (S1 / S0);
        if (diffPrice > -0.000000001 && diffPrice < 0.000000001) {
            const curTime = Date.now();
            if (_lastTryTime === 0 || curTime - _lastTryTime >= LOG_TRY_TIME) {
                printLog("debug", `[NormalArbitrage: Same prices!!! No arbitrage] diffPrice=${diffPrice}`);
                _lastTryTime = curTime;
            }
            return;
        }
        
        let forward = diffPrice > 0;
        let amount;
        if (forward) {
            amount = (P1 * S0 - P0 * S1) / (P1 + S1) / 2;
        }
        else {
            amount = (P0 * S1 - P1 * S0) / (P1 + S1) / 2;
        }
        // amount -= 0.1;

        let balance = getReadableAmount(_contractBalanceInWei, decimals0);
        if (balance < amount) {
            if (config.AUTO_TRANSFER) {
                const myBalanceInWei = await _tokenContract.methods.balanceOf(_myAccount.address).call();
                const myBalance = getReadableAmount(myBalanceInWei, decimals0);
    
                let neededAmount = amount - balance + 0.1;
                if (myBalance > neededAmount) {
                    const neededAmountInWei = getWeiAmount(neededAmount.toString(), decimals0);
                    let transferring = _tokenContract.methods.transfer(_normalArbitrageContract.options.address, neededAmountInWei);
                    let currentGasPrice = await getCurrentGasPrices();
                    let gasEst = await transferring.estimateGas({ from: _myAccount.address });
                    const transferDone = async (error, receipt) => {
                        if (error) {
                            printLog("error", `[NormalArbitrage: transferring failed] hash=${receipt.transactionHash}`);
                            return;
                        }
    
                        const balanceInWei = await _tokenContract.methods.balanceOf(_normalArbitrageContract.options.address).call();
                        const postBalance = getReadableAmount(balanceInWei, decimals0);
                        const preBalance = getReadableAmount(_contractBalanceInWei, decimals0);
                        const gasFeeInWei = receipt.gasUsed * receipt.effectiveGasPrice;
                        const gasFee = Number(web3.utils.fromWei(gasFeeInWei.toString(), "ether"));
    
                        const msg = {
                            command: "transaction",
                            time: Date.now(),
                            amount: neededAmount,
                            balance: postBalance,
                            txnFee: gasFee,
                            txn: receipt.transactionHash,
                        };
                        process.stdout.write(JSON.stringify(msg) + "\r\n");
    
                        _contractBalanceInWei = balanceInWei;
                        printLog("info", `[NormalArbitrage: transferring done] hash=${receipt.transactionHash}, amount=${neededAmount}, preBalance=${preBalance}, postBalance=${postBalance}, gasFee=${gasFee}`);
                    };
                    await signAndSendTransaction(transferring, _myAccount.address, config.TOKEN0, gasEst, currentGasPrice.high, transferDone);
                }
                else
                    amount = balance;
            }
            else
                amount = balance;
            
            if (amount <= 0.000000001) {
                const curTime = Date.now();
                if (_lastTryTime === 0 || curTime - _lastTryTime >= LOG_TRY_TIME) {
                    printLog("debug", `[NormalArbitrage: Insufficient Balance] Balance: ${balance}`);
                    _lastTryTime = curTime;
                }
                return;
            }
        }

        if (amount > 0) {
            _lastTryTime = 0;

            const amountInWei = getWeiAmount(amount.toFixed(6).toString(), decimals0);
            let trading = _normalArbitrageContract.methods.trade(config.TOKEN0, config.TOKEN1, amountInWei, forward);
            const currentGasPrice = await getCurrentGasPrices();
            const gasPrice = Number(currentGasPrice.high);
            const gasEst = await trading.estimateGas({ from: _myAccount.address });
            let profit = await getProfit(amountInWei, forward, PP, SS, gasEst * gasPrice, decimals0);
            if (profit < 0) {
                const curTime = Date.now();
                if (_lastTryTime === 0 || curTime - _lastTryTime >= LOG_TRY_TIME) {
                    printLog("debug", `[NormalArbitrage: No Arbitrage!!!] DiffPrice: ${diffPrice}, Pancake: (${P0}, ${P1}), Sushi: (${S0}, ${S1}), Amount: ${amount}, Profit: ${profit}`);
                    _lastTryTime = curTime;
                }
                return;
            }
            printLog("info", `[NormalArbitrage: Arbitrage!!!] DiffPrice: ${diffPrice}, Pancake: (${P0}, ${P1}), Sushi: (${S0}, ${S1}), Amount: ${amount}, Profit: ${profit}`);

            const tradeDone = async (error, receipt) => {
                if (error) {
                    printLog("error", `[NormalArbitrage: trading failed] hash=${receipt.transactionHash}`);
                    return;
                }

                const balanceInWei = await _tokenContract.methods.balanceOf(_normalArbitrageContract.options.address).call();
                const postBalance = getReadableAmount(balanceInWei, decimals0);
                const preBalance = getReadableAmount(_contractBalanceInWei, decimals0);
                const gasFeeInWei = receipt.gasUsed * receipt.effectiveGasPrice;
                const gasFee = Number(web3.utils.fromWei(gasFeeInWei.toString(), "ether"));

                const msg = {
                    command: "trade",
                    time: Date.now(),
                    preBalance: preBalance,
                    postBalance: postBalance,
                    txnFee: gasFee,
                    txn: receipt.transactionHash,
                };
                process.stdout.write(JSON.stringify(msg) + "\r\n");
                
                _contractBalanceInWei = balanceInWei;
                printLog("info", `[NormalArbitrage: trading done] hash=${receipt.transactionHash}, preBalance=${preBalance}, postBalance=${postBalance}, gasFee=${gasFee}`);
            };
            await signAndSendTransaction(trading, _myAccount.address, _normalArbitrageContract.options.address, gasEst, gasPrice, tradeDone);
        }
    }
    catch (error) {
        console.log(error);
    }
}

process.stdin.on('data', (data) => {
    process.stdout.write(`received: ${data}`);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

exports.doNormalArbitrage = async (_web3, _config) => {
    web3 = _web3;

    await init(process.env.PRIV_KEY, _config);

    const decimals0 = await _tokenContract.methods.decimals().call();
    const token1Contract = await new web3.eth.Contract(erc20ABI, _config.TOKEN1);
    const decimals1 = await token1Contract.methods.decimals().call();

    while (true) {
        await processArbitrage(_config, decimals0, decimals1);
        await sleep(100);
    }
}
