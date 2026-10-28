// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title KasaSavings
/// @notice USDC auto-savings contract where each user can maintain one active plan at a time.
contract KasaSavings is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidPercent();
    error InvalidDuration();
    error ZeroAmount();
    error NoActivePlan();
    error ZeroBalance();
    error PlanHasBalance();
    error InvalidToken();

    struct Plan {
        uint8 savingsPercent;
        uint32 durationDays;
        uint64 startTime;
        uint64 endTime;
        uint256 balance;
    }

    mapping(address => Plan) private plans;

    IERC20 public immutable usdc;
    uint256 public totalTracked;

    event PlanActivated(address indexed user, uint8 savingsPercent, uint32 durationDays, uint64 endTime);
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address usdc_) Ownable(msg.sender) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert InvalidToken();
        usdc = IERC20(usdc_);
    }

    /// @notice Create or replace caller's savings plan.
    /// @dev Replacing an existing plan requires zero balance (withdraw first).
    function activatePlan(uint8 savingsPercent, uint32 durationDays) external {
        if (savingsPercent == 0 || savingsPercent > 100) revert InvalidPercent();
        if (durationDays == 0) revert InvalidDuration();

        Plan storage current = plans[msg.sender];
        if (current.balance != 0) revert PlanHasBalance();

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + (uint256(durationDays) * 1 days));

        plans[msg.sender] = Plan({
            savingsPercent: savingsPercent,
            durationDays: durationDays,
            startTime: startTime,
            endTime: endTime,
            balance: 0
        });

        emit PlanActivated(msg.sender, savingsPercent, durationDays, endTime);
    }

    /// @notice Deposit USDC toward a user's active plan.
    /// @dev Pulls from `user` (not msg.sender) — intentional design. `user` must have pre-approved
    ///      this contract. Only addresses that have called `activatePlan` can have USDC pulled from
    ///      them; no approval = no transfer. The Kasa agent calls this on behalf of the user after
    ///      detecting an inbound transfer. Deposit amount is trusted to match the user's configured
    ///      savingsPercent — this is not enforced on-chain.
    function deposit(address user, uint256 amount) external {
        require(user == msg.sender, "only self");
        if (amount == 0) revert ZeroAmount();

        Plan storage plan = plans[user];
        if (plan.endTime == 0 || block.timestamp >= plan.endTime) revert NoActivePlan();

        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(user, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;

        plan.balance += received;
        totalTracked += received;

        emit Deposited(user, received, plan.balance);
    }

    /// @notice Withdraw full accumulated balance for caller.
    /// @dev Plan remains active/inactive based on endTime; only balance is reset.
    function withdraw() external nonReentrant {
        Plan storage plan = plans[msg.sender];
        uint256 amount = plan.balance;
        if (amount == 0) revert ZeroBalance();

        plan.balance = 0;
        totalTracked -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Emergency path to withdraw full accumulated balance for caller.
    function emergencyWithdraw() external nonReentrant {
        Plan storage plan = plans[msg.sender];
        uint256 amount = plan.balance;
        if (amount == 0) revert ZeroBalance();

        plan.balance = 0;
        totalTracked -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function rescueStray(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        uint256 stray = usdc.balanceOf(address(this)) - totalTracked;
        usdc.safeTransfer(to, stray);
    }

    function getPlan(address user)
        external
        view
        returns (
            uint8 savingsPercent,
            uint32 durationDays,
            uint64 startTime,
            uint64 endTime,
            uint256 balance,
            bool active
        )
    {
        Plan memory plan = plans[user];

        return (
            plan.savingsPercent,
            plan.durationDays,
            plan.startTime,
            plan.endTime,
            plan.balance,
            plan.endTime > 0 && block.timestamp < plan.endTime
        );
    }
}
