const BigNumber = require("bignumber.js");
const erc20ABI = require("./abi/erc20.json");
const routerABI = require("./abi/router.json");
const factoryABI = require("./abi/factory.json");
const pairABI = require("./abi/pair.json");
const arbitrageABI = require("./abi/flashArbitrage.json");

const LOG_TRY_TIME = 10000;

var web3;
var _myAccount;
var _tokenContract;
var _flashArbitrageContract;
var _contractBalanceInWei = 0;
var _ethPrice = 0;
var _lastTryTime = 0;

const getReadableAmount = (amountInWei, decimals) => {
    const bn = new BigNumber(amountInWei + "e-" + decimals);
    return Number(bn.toString());
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
        };
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
    //console.log("tx ===> ", tx);
    let signedTx = await _myAccount.signTransaction(tx);
    await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    .on("receipt", async (receipt) => {
        if (callback)
            callback(null, receipt);
    })
    .on("error", (error, receipt) => {
        if (callback)
            callback(error, receipt);
    });
};

const init = async (priv_key, config) => {
    printLog("info", "[FlashArbitrage: init] Starting...");

    _myAccount = web3.eth.accounts.privateKeyToAccount(priv_key);

    _tokenContract = new web3.eth.Contract(erc20ABI, config.TOKEN0);
    _flashArbitrageContract = new web3.eth.Contract(arbitrageABI, config.FLASH_ARBITRAGE_ADDRESS);
    try {
        const router0 = await _flashArbitrageContract.methods.aRouter().call();
        const router1 = await _flashArbitrageContract.methods.bRouter().call();
        if (router0.toUpperCase() !== config.ROUTER0_ADDRESS.toUpperCase() || router1.toUpperCase() !== config.ROUTER1_ADDRESS.toUpperCase()) {
            const setRouters = _flashArbitrageContract.methods.setRouters(config.ROUTER0_ADDRESS, config.ROUTER1_ADDRESS);
            const currentGasPrice = await getCurrentGasPrices();
            const gasEst = await setRouters.estimateGas({ from: _myAccount.address });
            const setTokenDone = async (error, receipt) => {
                if (error) {
                    printLog("error", `[FlashArbitrage: setRouters failed] hash=${receipt.transactionHash}`);
                    return;
                }
                printLog("info", `[FlashArbitrage: setRouters done] hash=${receipt.transactionHash}`);
            };
            await signAndSendTransaction(setRouters, _myAccount.address, _flashArbitrageContract.options.address, gasEst, currentGasPrice.high, setTokenDone);
        }
    }
    catch (error) {
        console.log(error);
    }

    _contractBalanceInWei = await _tokenContract.methods.balanceOf(_flashArbitrageContract.options.address).call();

    printLog("debug", `[FlashArbitrage: init] ROUTER0: ${config.ROUTER0_ADDRESS}`);
    printLog("debug", `[FlashArbitrage: init] ROUTER1: ${config.ROUTER1_ADDRESS}`);

    if (config.TOKEN0.toUpperCase() === config.ETH.toUpperCase()) {
        _ethPrice = 1;
        printLog("debug", `[FlashArbitrage: init] ETH Price: ${_ethPrice}`);
    }
    else {
        try {
            const routerContract = new web3.eth.Contract(routerABI, config.ROUTER0_ADDRESS);
            const factoryAddr = await routerContract.methods.factory().call();
            const factoryContract = new web3.eth.Contract(factoryABI, factoryAddr);
            const pairAddr = await factoryContract.methods.getPair(config.TOKEN0, config.ETH).call();
            const pairContract = new web3.eth.Contract(pairABI, pairAddr);
            RR = await pairContract.methods.getReserves().call();
            _ethPrice = RR[0] / RR[1]; // {1}ETH = {_ethPrice}TOKEN0
            printLog("debug", `[FlashArbitrage: init] ETH Price: ${_ethPrice}`);
        }
        catch (error) {
            console.log(error);
        }
    }

    printLog("info", "[FlashArbitrage: init] Done!");

    const msg = {
        command: "account",
        account: {
            address: _flashArbitrageContract.options.address,
            currency: config.TOKEN0,
        }
    };
    process.stdout.write(JSON.stringify(msg) + "\r\n");
}

const processArbitrage = async (config, decimals0, decimals1) => {
    try {
        const result = await _flashArbitrageContract.methods.checkTrading(config.TOKEN0, config.TOKEN1).call();
        const amount = getReadableAmount(result[1], decimals1);
        if (amount === 0) {
            const curTime = Date.now();
            if (_lastTryTime === 0 || curTime - _lastTryTime >= LOG_TRY_TIME) {
                printLog("debug", `[FlashArbitrage: No Arbitrage!!!] Amount: ${amount}`);
                _lastTryTime = curTime;
            }
            return;
        }
        
        const aToB = result[0];
        const amountInWei = result[1]; // TOKEN1
        const profitInWei = result[2]; // TOKEN0
        const trading = _flashArbitrageContract.methods.trade(config.TOKEN0, config.TOKEN1, aToB, amountInWei);
        const currentGasPrice = await getCurrentGasPrices();
        const gasPrice = Number(currentGasPrice.high);
        const gasEst = await trading.estimateGas({ from: _myAccount.address });
        const profit = getReadableAmount(profitInWei, decimals0) - (web3.utils.fromWei((gasEst * gasPrice).toString(), "ether") * _ethPrice);
        if (profit > 0) {
            _lastTryTime = 0;

            const tradeDone = async (error, receipt) => {
                if (error) {
                    printLog("error", `[FlashArbitrage: trading failed] hash=${receipt.transactionHash}`);
                    return;
                }

                const balanceInWei = await _tokenContract.methods.balanceOf(_flashArbitrageContract.options.address).call();
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
                printLog("info", `[FlashArbitrage: trading done] hash=${receipt.transactionHash}, preBalance=${preBalance}, postBalance=${postBalance}, gasFee=${gasFee}`);
            };
            await signAndSendTransaction(trading, _myAccount.address, _flashArbitrageContract.options.address, gasEst, gasPrice, tradeDone);
        }
        else {
            const curTime = Date.now();
            if (_lastTryTime === 0 || curTime - _lastTryTime >= LOG_TRY_TIME) {
                printLog("debug", `[FlashArbitrage: No Arbitrage!!!] Amount: ${amount}, Profit: ${profit}`);
                _lastTryTime = curTime;
            }
        }
    }
    catch (error) {
        console.log(error);
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

exports.doFlashArbitrage = async (_web3, _config) => {
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
