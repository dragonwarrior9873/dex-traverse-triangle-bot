// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import '@uniswap/lib/contracts/libraries/Babylonian.sol';
import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract FlashArbitrage is Ownable {
    using SafeMath for uint256;

    uint256 private constant DEADLINE = 300;

    IUniswapV2Router02 public aRouter;
    IUniswapV2Factory private aFactory;

    IUniswapV2Router02 public bRouter;
    IUniswapV2Factory private bFactory;

    event WithdrawToken(address to, uint256 value);

    constructor(address _aRouter, address _bRouter) {
        aRouter = IUniswapV2Router02(_aRouter);
        aFactory = IUniswapV2Factory(aRouter.factory());

        bRouter = IUniswapV2Router02(_bRouter);
        bFactory = IUniswapV2Factory(bRouter.factory());
    }

    function computeProfitMaximizingTrade(
        uint256 aReserve0,
        uint256 aReserve1,
        uint256 bReserve0,
        uint256 bReserve1
    ) pure internal returns (bool aToB, uint256 amountIn) {
        aToB = aReserve0.mul(bReserve1) < bReserve0.mul(aReserve1);
        if (aToB) {
            uint256 a = Babylonian.sqrt((bReserve0.mul(bReserve1) / aReserve0.mul(997)).mul(aReserve1.mul(1000)));
            uint256 b = bReserve1.mul(1000) / 997;
            if (a < b)
                return (false, 0);
            amountIn = a.sub(b);
            if (amountIn > aReserve1)
                amountIn = 0;
        }
        else {
            uint256 a = Babylonian.sqrt((aReserve0.mul(aReserve1) / bReserve0.mul(997)).mul(bReserve1.mul(1000)));
            uint256 b = aReserve1.mul(1000) / 997;
            if (a < b)
                return (false, 0);
            amountIn = a.sub(b);
            if (amountIn > bReserve1)
                amountIn = 0;
        }
    }

    function execute(address _sender, uint _amount0, uint _amount1, bytes calldata _data) internal {
        (uint amountRequired, bool aToB, address token0, address token1) = abi.decode(_data, (uint, bool, address, address));
        address[] memory path = new address[](2);
        path[0] = token1;
        path[1] = token0;

        uint amount = (token0 <= token1) ? _amount1 : _amount0;
        IUniswapV2Router02 router = aToB ? bRouter : aRouter;

        IERC20(token1).approve(address(router), amount);
        uint amountReceived = router.swapExactTokensForTokens(amount, 0, path, address(this), block.timestamp + DEADLINE)[1];

        IERC20(token0).transfer(msg.sender, amountRequired);
        IERC20(token0).transfer(_sender, amountReceived - amountRequired);
    }

    function pancakeCall(address _sender, uint _amount0, uint _amount1, bytes calldata _data) external {
        execute(_sender, _amount0, _amount1, _data);
    }

    function uniswapV2Call(address _sender, uint _amount0, uint _amount1, bytes calldata _data) external {
        execute(_sender, _amount0, _amount1, _data);
    }

    function setRouters(address _aRouter, address _bRouter) external onlyOwner {
        require(_aRouter != address(0), "Invalid _aRouter!");
        require(_bRouter != address(0), "Invalid _bRouter!");

        aRouter = IUniswapV2Router02(_aRouter);
        aFactory = IUniswapV2Factory(aRouter.factory());

        bRouter = IUniswapV2Router02(_bRouter);
        bFactory = IUniswapV2Factory(bRouter.factory());
    }

    function checkTrading(address token0, address token1) public view returns (bool aToB, uint256 amount, uint256 profit) {
        IUniswapV2Pair aPair = IUniswapV2Pair(aFactory.getPair(token0, token1));
        IUniswapV2Pair bPair = IUniswapV2Pair(bFactory.getPair(token0, token1));

        bool positive = token0 <= token1;
        (uint112 aReserve0, uint112 aReserve1,) = aPair.getReserves();
        (uint112 bReserve0, uint112 bReserve1,) = bPair.getReserves();
        (aReserve0, aReserve1) = positive ? (aReserve0, aReserve1) : (aReserve1, aReserve0);
        (bReserve0, bReserve1) = positive ? (bReserve0, bReserve1) : (bReserve1, bReserve0);

        (aToB, amount) = computeProfitMaximizingTrade(uint256(aReserve0), uint256(aReserve1), uint256(bReserve0), uint256(bReserve1));
        if (amount == 0)
            return (false, 0, 0);
        
        if (aToB) {
            uint bAmount0 = bRouter.getAmountOut(uint(amount), uint(bReserve1), uint(bReserve0));
            uint aAmount0 = aRouter.getAmountIn(uint(amount), uint(aReserve0), uint(aReserve1));
            if (bAmount0 <= aAmount0)
                return (false, 0, 0);
            
            profit = uint256(bAmount0) - uint256(aAmount0);
        }
        else {
            uint aAmount0 = aRouter.getAmountOut(uint(amount), uint(aReserve1), uint(aReserve0));
            uint bAmount0 = bRouter.getAmountIn(uint(amount), uint(bReserve0), uint(bReserve1));
            if (aAmount0 <= bAmount0)
                return (false, 0, 0);
            
            profit = uint256(aAmount0) - uint256(bAmount0);
        }
    }

    function trade(address token0, address token1, bool aToB, uint256 amount) external onlyOwner {
        IUniswapV2Pair aPair = IUniswapV2Pair(aFactory.getPair(token0, token1));
        IUniswapV2Pair bPair = IUniswapV2Pair(bFactory.getPair(token0, token1));
        IUniswapV2Router02 router = aToB ? aRouter : bRouter;
        IUniswapV2Pair pair = aToB ? aPair : bPair;

        bool positive = token0 <= token1;
        uint256 preBalance = IERC20(token0).balanceOf(address(this));

        (uint reserve0, uint reserve1,) = pair.getReserves();
        if (!positive)
            (reserve0, reserve1) = (reserve1, reserve0);
        uint256 amount0 = router.getAmountIn(amount, reserve0, reserve1);
        bytes memory data = abi.encode(amount0, aToB, token0, token1);
        if (positive)
            pair.swap(0, amount, address(this), data);
        else
            pair.swap(amount, 0, address(this), data);

        uint256 postBalance = IERC20(token0).balanceOf(address(this));
        require(postBalance > preBalance, "Trading loss!!!");
    }

    function withdrawToken(address token) external onlyOwner returns (bool) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "There is no token balance!");
        bool check = IERC20(token).transfer(msg.sender, balance);

        emit WithdrawToken(msg.sender, balance);
        return check;
    }
}
