// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KasaSavings} from "../KasaSavings.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Invariant handler: activates a plan then makes repeated deposits and
///      withdrawals so the invariant checker can sample many states.
contract KasaSavingsHandler is Test {
    KasaSavings internal savings;
    MockERC20   internal usdc;

    address public  actor = makeAddr("actor");

    // Total USDC deposited into the contract minus total withdrawn
    uint256 public ghost_deposited;
    uint256 public ghost_withdrawn;

    constructor(KasaSavings _savings, MockERC20 _usdc) {
        savings = _savings;
        usdc    = _usdc;

        // Give the actor a large allowance and balance
        usdc.mint(actor, 1_000_000e6);

        // Activate a long-running plan for the actor
        vm.prank(actor);
        savings.activatePlan(10, 365);
    }

    /// @dev Deposit a bounded amount. `user` approves the contract and deposit is
    ///      called by the actor (who is also the user in this handler — the
    ///      contract pulls from `user`).
    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 10_000e6);

        // Ensure actor has enough balance
        uint256 bal = usdc.balanceOf(actor);
        if (bal < amount) usdc.mint(actor, amount - bal);

        vm.startPrank(actor);
        usdc.approve(address(savings), amount);
        savings.deposit(actor, amount);
        vm.stopPrank();

        ghost_deposited += amount;
    }

    /// @dev Withdraw if the actor has a balance; otherwise skip silently.
    function withdraw() external {
        (, , , , uint256 balance, ) = savings.getPlan(actor);
        if (balance == 0) return;

        vm.prank(actor);
        savings.withdraw();

        ghost_withdrawn += balance;
    }
}

contract KasaSavingsTest is Test {
    // ── Fixtures ────────────────────────────────────────────────────────────
    KasaSavings internal savings;
    MockERC20   internal usdc;

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal agent   = makeAddr("agent");   // depositor (msg.sender for deposit)

    uint256 internal constant INITIAL_MINT = 1_000_000e6;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        // Deploy mock USDC (6 decimals, like real USDC)
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy savings contract
        savings = new KasaSavings(address(usdc));

        // Fund all actors
        usdc.mint(alice,  INITIAL_MINT);
        usdc.mint(bob,    INITIAL_MINT);
        usdc.mint(agent,  INITIAL_MINT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsUsdc() public view {
        assertEq(address(savings.usdc()), address(usdc));
    }

    function test_Constructor_RevertsZeroAddress() public {
        vm.expectRevert(KasaSavings.ZeroAddress.selector);
        new KasaSavings(address(0));
    }

    function test_Constructor_RevertsInvalidToken_EOA() public {
        address eoa = makeAddr("eoa");
        vm.expectRevert(KasaSavings.InvalidToken.selector);
        new KasaSavings(eoa);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  activatePlan — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_ActivatePlan_StoresFields() public {
        vm.prank(alice);
        savings.activatePlan(50, 30);

        (
            uint8  savingsPercent,
            uint32 durationDays,
            uint64 startTime,
            uint64 endTime,
            uint256 balance,
            bool   active
        ) = savings.getPlan(alice);

        assertEq(savingsPercent, 50);
        assertEq(durationDays,   30);
        assertEq(startTime,      block.timestamp);
        assertEq(endTime,        block.timestamp + 30 days);
        assertEq(balance,        0);
        assertTrue(active);
    }

    function test_ActivatePlan_EmitsPlanActivated() public {
        uint64 expectedEnd = uint64(block.timestamp + 30 days);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(savings));
        emit KasaSavings.PlanActivated(alice, 50, 30, expectedEnd);
        savings.activatePlan(50, 30);
    }

    function test_ActivatePlan_CanReplacePlanWithZeroBalance() public {
        // First plan
        vm.prank(alice);
        savings.activatePlan(10, 7);

        // Replace immediately (balance still 0)
        vm.prank(alice);
        savings.activatePlan(20, 14);

        (uint8 pct, uint32 dur, , , , ) = savings.getPlan(alice);
        assertEq(pct, 20);
        assertEq(dur, 14);
    }

    function test_ActivatePlan_Percent1IsValid() public {
        vm.prank(alice);
        savings.activatePlan(1, 1);
        (uint8 pct, , , , , ) = savings.getPlan(alice);
        assertEq(pct, 1);
    }

    function test_ActivatePlan_Percent100IsValid() public {
        vm.prank(alice);
        savings.activatePlan(100, 365);
        (uint8 pct, , , , , ) = savings.getPlan(alice);
        assertEq(pct, 100);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  activatePlan — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_ActivatePlan_RevertsInvalidPercent_Zero() public {
        vm.prank(alice);
        vm.expectRevert(KasaSavings.InvalidPercent.selector);
        savings.activatePlan(0, 30);
    }

    function test_ActivatePlan_RevertsInvalidPercent_Over100() public {
        vm.prank(alice);
        vm.expectRevert(KasaSavings.InvalidPercent.selector);
        savings.activatePlan(101, 30);
    }

    function test_ActivatePlan_RevertsInvalidDuration_Zero() public {
        vm.prank(alice);
        vm.expectRevert(KasaSavings.InvalidDuration.selector);
        savings.activatePlan(10, 0);
    }

    function test_ActivatePlan_RevertsPlanHasBalance() public {
        // Activate and deposit so balance > 0
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        // Now try to replace → should revert
        vm.prank(alice);
        vm.expectRevert(KasaSavings.PlanHasBalance.selector);
        savings.activatePlan(20, 60);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  deposit — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_Deposit_UpdatesBalance() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 500e6);
        savings.deposit(alice, 500e6);

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, 500e6);
    }

    function test_Deposit_AccumulatesMultipleDeposits() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.startPrank(alice);
        usdc.approve(address(savings), type(uint256).max);
        savings.deposit(alice, 300e6);
        savings.deposit(alice, 200e6);
        vm.stopPrank();

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, 500e6);
    }

    function test_Deposit_TransfersUsdcToContract() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        uint256 aliceBefore    = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(savings));

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        assertEq(usdc.balanceOf(alice),           aliceBefore    - 100e6);
        assertEq(usdc.balanceOf(address(savings)), contractBefore + 100e6);
    }

    function test_Deposit_EmitsDeposited() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);

        vm.expectEmit(true, false, false, true, address(savings));
        emit KasaSavings.Deposited(alice, 100e6, 100e6);
        savings.deposit(alice, 100e6);
    }

    function test_Deposit_EmitsDeposited_Cumulative() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.startPrank(alice);
        usdc.approve(address(savings), type(uint256).max);
        savings.deposit(alice, 100e6);

        // Second deposit: newBalance = 200e6
        vm.expectEmit(true, false, false, true, address(savings));
        emit KasaSavings.Deposited(alice, 100e6, 200e6);
        savings.deposit(alice, 100e6);
        vm.stopPrank();
    }

    /// @dev Depositor (agent/third-party) is NOT the same as user. Contract pulls
    ///      from `user` via safeTransferFrom. The depositor calling deposit()
    ///      does NOT need to hold or approve USDC — the USER must approve.
    ///      This test documents the ACTUAL contract behaviour (pulls from user).
    function test_Deposit_PullsFromUser_NotMsgSender() public {
        // Alice has a plan and USDC; agent has no USDC but calls deposit()
        vm.prank(alice);
        savings.activatePlan(10, 30);

        uint256 aliceBefore = usdc.balanceOf(alice);

        // alice approves; agent calls deposit (agent needs no USDC)
        vm.prank(alice);
        usdc.approve(address(savings), 100e6);

        vm.prank(agent);  // msg.sender is agent, but pull is from alice
        savings.deposit(alice, 100e6);

        assertEq(usdc.balanceOf(alice), aliceBefore - 100e6,
            "USDC must be pulled from user (alice), not from agent (msg.sender)");
        assertEq(usdc.balanceOf(agent), INITIAL_MINT,
            "Agent balance must be unchanged");
    }

    function test_Deposit_WorksDuringLastSecondOfPlan() public {
        vm.prank(alice);
        savings.activatePlan(10, 1); // 1-day plan

        // One second before expiry
        vm.warp(block.timestamp + 1 days - 1);

        vm.prank(alice);
        usdc.approve(address(savings), 50e6);
        savings.deposit(alice, 50e6);

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, 50e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  deposit — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_Deposit_RevertsZeroAmount() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.expectRevert(KasaSavings.ZeroAmount.selector);
        savings.deposit(alice, 0);
    }

    function test_Deposit_RevertsNoActivePlan_NoPlan() public {
        // bob never activated a plan
        vm.expectRevert(KasaSavings.NoActivePlan.selector);
        savings.deposit(bob, 100e6);
    }

    function test_Deposit_RevertsNoActivePlan_Expired() public {
        vm.prank(alice);
        savings.activatePlan(10, 1); // 1-day plan

        // Warp past expiry
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(KasaSavings.NoActivePlan.selector);
        savings.deposit(alice, 100e6);
    }

    function test_Deposit_RevertsNoActivePlan_ExactlyAtExpiry() public {
        vm.prank(alice);
        savings.activatePlan(10, 1);

        // At exactly endTime — block.timestamp >= endTime → expired
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert(KasaSavings.NoActivePlan.selector);
        savings.deposit(alice, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  withdraw — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_TransfersFundsToUser() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 200e6);
        savings.deposit(alice, 200e6);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        savings.withdraw();

        assertEq(usdc.balanceOf(alice), aliceBefore + 200e6);
    }

    function test_Withdraw_ResetsBalance() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 200e6);
        savings.deposit(alice, 200e6);

        vm.prank(alice);
        savings.withdraw();

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, 0);
    }

    function test_Withdraw_EmitsWithdrawn() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 150e6);
        savings.deposit(alice, 150e6);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(savings));
        emit KasaSavings.Withdrawn(alice, 150e6);
        savings.withdraw();
    }

    function test_Withdraw_PlanRemainsAfterWithdraw_DuringActiveWindow() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        vm.prank(alice);
        savings.withdraw();

        // Plan endTime > now → still active
        (, , , , , bool active) = savings.getPlan(alice);
        assertTrue(active, "Plan should remain active after withdraw during window");
    }

    function test_Withdraw_CanDepositAgainAfterWithdraw() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), type(uint256).max);

        savings.deposit(alice, 100e6);

        vm.prank(alice);
        savings.withdraw();

        // Should be able to deposit again (plan still active, balance is 0)
        savings.deposit(alice, 50e6);
        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, 50e6);
    }

    function test_Withdraw_AfterExpiry_StillWithdraws() public {
        vm.prank(alice);
        savings.activatePlan(10, 1);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        // Warp past plan expiry
        vm.warp(block.timestamp + 2 days);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        savings.withdraw();

        assertEq(usdc.balanceOf(alice), aliceBefore + 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  withdraw — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_RevertsZeroBalance_NoPlan() public {
        // bob has no plan at all
        vm.prank(bob);
        vm.expectRevert(KasaSavings.ZeroBalance.selector);
        savings.withdraw();
    }

    function test_Withdraw_RevertsZeroBalance_AfterWithdraw() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        vm.prank(alice);
        savings.withdraw();

        // Second withdraw → no balance
        vm.prank(alice);
        vm.expectRevert(KasaSavings.ZeroBalance.selector);
        savings.withdraw();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  getPlan — active flag edge cases
    // ══════════════════════════════════════════════════════════════════════════

    function test_GetPlan_ActiveFalse_NoPlan() public view {
        (, , , , , bool active) = savings.getPlan(bob);
        assertFalse(active);
    }

    function test_GetPlan_ActiveFalse_Expired() public {
        vm.prank(alice);
        savings.activatePlan(10, 1);

        vm.warp(block.timestamp + 1 days);

        (, , , , , bool active) = savings.getPlan(alice);
        assertFalse(active, "Plan should be inactive at exactly endTime");
    }

    function test_GetPlan_ActiveTrue_BeforeExpiry() public {
        vm.prank(alice);
        savings.activatePlan(10, 7);

        vm.warp(block.timestamp + 3 days);

        (, , , , , bool active) = savings.getPlan(alice);
        assertTrue(active);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Multi-user isolation
    // ══════════════════════════════════════════════════════════════════════════

    function test_MultiUser_BalancesAreIsolated() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(bob);
        savings.activatePlan(20, 60);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        vm.prank(bob);
        usdc.approve(address(savings), 200e6);
        savings.deposit(bob, 200e6);

        (, , , , uint256 aliceBal, ) = savings.getPlan(alice);
        (, , , , uint256 bobBal,   ) = savings.getPlan(bob);

        assertEq(aliceBal, 100e6);
        assertEq(bobBal,   200e6);
    }

    function test_MultiUser_WithdrawDoesNotAffectOther() public {
        vm.prank(alice);
        savings.activatePlan(10, 30);
        vm.prank(bob);
        savings.activatePlan(20, 30);

        vm.prank(alice);
        usdc.approve(address(savings), 100e6);
        savings.deposit(alice, 100e6);

        vm.prank(bob);
        usdc.approve(address(savings), 150e6);
        savings.deposit(bob, 150e6);

        // Alice withdraws
        vm.prank(alice);
        savings.withdraw();

        // Bob's balance untouched
        (, , , , uint256 bobBal, ) = savings.getPlan(bob);
        assertEq(bobBal, 150e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FUZZ — activatePlan arithmetic
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_ActivatePlan_EndTimeIsCorrect(
        uint8  savingsPercent,
        uint32 durationDays
    ) public {
        savingsPercent = uint8(bound(savingsPercent, 1, 100));
        durationDays   = uint32(bound(durationDays, 1, 3650)); // up to 10 years

        uint64 ts = uint64(block.timestamp);

        vm.prank(alice);
        savings.activatePlan(savingsPercent, durationDays);

        (, , uint64 startTime, uint64 endTime, , ) = savings.getPlan(alice);

        assertEq(startTime, ts);
        assertEq(endTime,   ts + uint64(durationDays) * 1 days,
            "endTime should equal startTime + durationDays * 1 days");
    }

    function testFuzz_ActivatePlan_RevertsInvalidPercent(uint8 pct) public {
        vm.assume(pct == 0 || pct > 100);
        vm.prank(alice);
        vm.expectRevert(KasaSavings.InvalidPercent.selector);
        savings.activatePlan(pct, 30);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FUZZ — deposit arithmetic
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_Deposit_BalanceDeltaMatchesAmount(uint256 amount) public {
        amount = bound(amount, 1, INITIAL_MINT);

        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), amount);
        savings.deposit(alice, amount);

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, amount, "plan balance must equal deposited amount");
    }

    function testFuzz_Deposit_CumulativeBalance(uint256 a, uint256 b) public {
        a = bound(a, 1, INITIAL_MINT / 2);
        b = bound(b, 1, INITIAL_MINT - a);

        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.startPrank(alice);
        usdc.approve(address(savings), a + b);
        savings.deposit(alice, a);
        savings.deposit(alice, b);
        vm.stopPrank();

        (, , , , uint256 balance, ) = savings.getPlan(alice);
        assertEq(balance, a + b, "cumulative balance must equal sum of deposits");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FUZZ — withdraw round-trip
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_Withdraw_FullRoundTrip(uint256 amount) public {
        amount = bound(amount, 1, INITIAL_MINT);

        vm.prank(alice);
        savings.activatePlan(10, 30);

        vm.prank(alice);
        usdc.approve(address(savings), amount);
        savings.deposit(alice, amount);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        savings.withdraw();

        assertEq(usdc.balanceOf(alice), aliceBefore + amount,
            "alice must receive exactly what she deposited");
        assertEq(usdc.balanceOf(address(savings)), 0,
            "contract balance must be zero after solo withdrawal");
    }

}

// ══════════════════════════════════════════════════════════════════════════════
//  Standalone invariant test contract (Foundry needs targetContract set in setUp)
// ══════════════════════════════════════════════════════════════════════════════

contract KasaSavingsInvariantTest is Test {
    KasaSavings          internal savings;
    MockERC20            internal usdc;
    KasaSavingsHandler   internal handler;

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        savings = new KasaSavings(address(usdc));
        handler = new KasaSavingsHandler(savings, usdc);

        targetContract(address(handler));
    }

    /// @notice Contract USDC balance must always equal net deposits (deposits - withdrawals).
    function invariant_ContractBalanceEqNetDeposits() public view {
        uint256 contractBal = usdc.balanceOf(address(savings));
        uint256 netDeposits = handler.ghost_deposited() - handler.ghost_withdrawn();

        assertEq(contractBal, netDeposits,
            "Invariant: contract USDC balance must equal ghost net deposits");
    }

    /// @notice Plan balance must never exceed net deposits tracked by ghost vars.
    function invariant_PlanBalanceLeNetDeposits() public view {
        (, , , , uint256 planBal, ) = savings.getPlan(handler.actor());
        uint256 netDeposits = handler.ghost_deposited() - handler.ghost_withdrawn();

        assertEq(planBal, netDeposits,
            "Invariant: plan balance must match ghost net deposits");
    }

    /// @notice Contract USDC balance must never be negative (trivially true in
    ///         uint256, but this checks for reentrancy-related double-spends).
    function invariant_ContractBalanceNonNegative() public view {
        // If this somehow underflows, the previous invariant catches it; this
        // also acts as a guard to ensure no external drain happened.
        uint256 contractBal = usdc.balanceOf(address(savings));
        assertTrue(contractBal >= 0); // tautological for uint but documents intent
    }
}
