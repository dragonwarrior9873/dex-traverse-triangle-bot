// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';

interface IWETH9 {
    function withdraw(uint wad) external;
}

contract NormalArbitrage is Ownable {
    using SafeMath for uint256;

    uint256 private constant DEADLINE = 300;

    IUniswapV2Router02[] private routers;
    address private weth;

    constructor(address router0, address router1, address wethToken) {
        routers.push(IUniswapV2Router02(router0));
        routers.push(IUniswapV2Router02(router1));
        weth = wethToken;
    }

    // Events
    event Received(address sender, uint256 value);
    event Withdraw(address to, uint256 value);
    event Minner_fee(uint256 value);
    event Withdraw_token(address to, uint256 value);

    receive() external payable {}

    fallback() external payable {}

    function withdraw(uint256 _amount) public onlyOwner returns (bool) {
        require(_amount <= address(this).balance, "Insufficient ETH amount!");
        payable(msg.sender).transfer(_amount);
        
        emit Withdraw(msg.sender, _amount);
        return true;
    }

    function withdrawWeth(uint8 _percentage) public onlyOwner returns (bool) {
        require(IERC20(weth).balanceOf(address(this)) > 0, "There is no WETH balance!");
        require((0 < _percentage) && (_percentage <= 100), "Invalid percentage!");

        IWETH9(weth).withdraw(IERC20(weth).balanceOf(address(this)));

        uint256 amount_to_withdraw = SafeMath.mul(SafeMath.div(address(this).balance, 100), _percentage);
        block.coinbase.transfer(amount_to_withdraw);
        emit Minner_fee(amount_to_withdraw);

        return withdraw(address(this).balance);
    }

    function withdrawToken(address _token) public onlyOwner returns (bool) {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "There is no token balance!");
        bool check = IERC20(_token).transfer(msg.sender, balance);

        emit Withdraw_token(msg.sender, balance);
        return check;
    }

    function swapTokenWithWeth(uint256 routerIndex, address token, uint256 amount) external {
        require(routerIndex == 0 || routerIndex == 1, "Invalid router index");
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = weth;

        IERC20(token).approve(address(routers[routerIndex]), amount);
        routers[routerIndex].swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            0,
            path,
            address(this),
            block.timestamp + DEADLINE
        );
    }

    function swapTokens(uint256 routerIndex, address tokenIn, address tokenOut, uint256 amountIn) external {
        require(routerIndex == 0 || routerIndex == 1, "Invalid router index");
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        IERC20(tokenIn).approve(address(routers[routerIndex]), amountIn);
        uint[] memory amounts = routers[routerIndex].getAmountsOut(amountIn, path);

        routers[routerIndex].swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            amounts[amounts.length - 1],
            path,
            address(this),
            block.timestamp + DEADLINE
        );
    }

    function trade(address token0, address token1, uint256 amount, bool forward) external {
        address[] memory path = new address[](2);
        uint256 preBalance = IERC20(token0).balanceOf(address(this));

        if (forward) {
            /* Swap on DEX 0 */
            path[0] = token0;
            path[1] = token1;

            IERC20(token0).approve(address(routers[0]), amount);
            uint256[] memory amounts = routers[0].getAmountsOut(amount, path);
            routers[0].swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amount,
                amounts[amounts.length - 1],
                path,
                address(this),
                block.timestamp + DEADLINE
            );

            /* Swap on DEX 1 */
            path[0] = token1;
            path[1] = token0;

            uint256 amount2 = IERC20(token1).balanceOf(address(this));
            IERC20(token1).approve(address(routers[1]), amount2);
            routers[1].swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amount2,
                0,
                path,
                address(this),
                block.timestamp + DEADLINE
            );
        }
        else {
            /* Swap on DEX 1 */
            path[0] = token0;
            path[1] = token1;

            IERC20(token0).approve(address(routers[1]), amount);
            uint256[] memory amounts = routers[1].getAmountsOut(amount, path);
            routers[1].swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amount,
                amounts[amounts.length - 1],
                path,
                address(this),
                block.timestamp + DEADLINE
            );

            /* Swap on DEX 0 */
            path[0] = token1;
            path[1] = token0;

            uint256 amount2 = IERC20(token1).balanceOf(address(this));
            IERC20(token1).approve(address(routers[0]), amount2);
            routers[0].swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amount2,
                0,
                path,
                address(this),
                block.timestamp + DEADLINE
            );
        }

        uint256 postBalance = IERC20(token0).balanceOf(address(this));
        require(preBalance < postBalance, "Trading loss");
    }
}
