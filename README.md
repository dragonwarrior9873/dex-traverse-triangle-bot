# DeFi Arbitrage Bot
This bot monitors an opportunity and executes an arbitrage in the specific token pair between PancakeSwap and SushiSwap

## Download
```sh
git clone https://github.com/BlueBeam321/DeFiArbitrageBot.git # you can also download the zip file
```

## Compile & Deploy Smart Contract
1. Go to the contract directory in the repository you just cloned
```sh
cd DeFiArbitrageBot/smartcontract
```
2. Set the private key
- Clone ".env.example" and rename it to ".env" in directory "smartcontract"
- Set the value of PRIVATE_KEY to your private key in the content of ".env"
3. Install all packages to compile and deploy the smart contract
```sh
npm install
```
4. Compile the smart contract
```sh
npm run compile
```
5. Deploy the smart contract
```sh
npm run deploy
```
Deployed contract's address will be displayed in terminal.

## Configure & Run the Bot
1. Go to the backend directory
```sh
cd DeFiArbitrageBot/backend
```
2. Set the private key and the contract address
- Clone ".env.example" and rename it to ".env" in directory "backend"
- Set the value of PRIV_KEY to your private key in the content of ".env"
- Update the value of ARBITRAGE_ADDRESS to deployed contract's address in "src/config.json"
3. Install all packages
```sh
npm install
```
4. Run the bot
```sh
npm start
```
5. Pack the bot
```sh
npm run package
```