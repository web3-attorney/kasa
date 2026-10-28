// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./KasaRegistry.sol";

contract KasaRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error UnknownRecipient();
    error ZeroAmount();
    error MemoTooLong();
    error ZeroAddress();
    error InvalidUSDC();
    error InvalidRegistry();

    IERC20 public immutable usdc;
    KasaRegistry public immutable registry;
    uint256 private _paymentNonce;

    event Payment(
        uint256 indexed nonce,
        address indexed from,
        address indexed to,
        string toUsername,
        uint256 amount,
        string memo,
        uint256 timestamp
    );

    constructor(address usdc_, address registry_) {
        if (usdc_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        if (registry_.code.length == 0) revert InvalidRegistry();
        if (usdc_.code.length == 0) revert InvalidUSDC();

        usdc = IERC20(usdc_);
        registry = KasaRegistry(registry_);
    }

    function send(string calldata toUsername, uint256 amount, string calldata memo) external nonReentrant {
        string memory username = toUsername;
        if (bytes(username).length > 0 && bytes(username)[0] == "@") {
            bytes memory usernameBytes = bytes(username);
            bytes memory normalized = new bytes(usernameBytes.length - 1);
            for (uint256 i = 1; i < usernameBytes.length; ++i) {
                normalized[i - 1] = usernameBytes[i];
            }
            username = string(normalized);
        }

        address to = registry.resolve(username);
        require(to != address(0), "zero address");

        _executePayment(to, username, amount, memo);
    }

    function sendToAddress(address to, uint256 amount, string calldata memo) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        _executePayment(to, "", amount, memo);
    }

    function _executePayment(address to, string memory toUsername, uint256 amount, string calldata memo) internal {
        if (amount == 0) revert ZeroAmount();
        if (bytes(memo).length > 280) revert MemoTooLong();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.safeTransfer(to, amount);

        uint256 nonce = ++_paymentNonce;
        emit Payment(nonce, msg.sender, to, toUsername, amount, memo, block.timestamp);
    }
}
