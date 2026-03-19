// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IntentBridge} from "../src/IntentBridge.sol";
import {MockWormhole} from "../src/MockWormhole.sol";
import {MockPyth} from "../src/MockPyth.sol";

contract IntentBridgeTest is Test {
    IntentBridge public bridge;
    MockWormhole public mockWormhole;
    MockPyth     public mockPyth;

    address public creator = makeAddr("creator");
    address public solver  = makeAddr("solver");

    bytes32 constant SUI_EMITTER    = bytes32(uint256(0xDEAD));
    bytes32 constant SOLANA_EMITTER = bytes32(uint256(0xBEEF));
    uint16  constant SUI_CHAIN_ID    = 21;
    uint16  constant SOLANA_CHAIN_ID = 1;

    uint256 constant WORMHOLE_FEE = 0.001 ether;

    // Mock prices: ETH=$2000, SOL=$100 (expo=-8)
    // → 1 ETH = 20 SOL = 20_000_000_000 lamports
    int64  constant ETH_PRICE_RAW = 200_000_000_000; // $2000 * 1e8
    int64  constant SOL_PRICE_RAW =  10_000_000_000; // $100  * 1e8
    int32  constant PRICE_EXPO    = -8;

    // Safe startPrice/floorPrice for 1 ETH → Solana orders:
    //   expected = 20_000_000_000, window ±30%
    //   startPrice <= 130% = 26_000_000_000
    //   floorPrice >= 70%  = 14_000_000_000
    uint256 constant SOL_START = 22_000_000_000; // 22 SOL (within 130%)
    uint256 constant SOL_FLOOR = 15_000_000_000; // 15 SOL (above 70%)

    // Pyth feed IDs (same as contract constants)
    bytes32 constant ETH_USD_FEED = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 constant SOL_USD_FEED = 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d;

    function setUp() public {
        mockWormhole = new MockWormhole(WORMHOLE_FEE);
        mockPyth     = new MockPyth(300); // 5-min staleness tolerance

        // Set mock prices for ETH/USD and SOL/USD
        mockPyth.setPrice(ETH_USD_FEED, ETH_PRICE_RAW, 1_000_000, PRICE_EXPO);
        mockPyth.setPrice(SOL_USD_FEED, SOL_PRICE_RAW, 1_000_000, PRICE_EXPO);

        bridge = new IntentBridge(address(mockWormhole), 1, address(mockPyth));
        bridge.registerEmitter(SUI_CHAIN_ID, SUI_EMITTER);
        bridge.registerEmitter(SOLANA_CHAIN_ID, SOLANA_EMITTER);

        vm.deal(creator, 10 ether);
        vm.deal(solver,  10 ether);
    }

    // ── createOrder ──────────────────────────────────────────────────────────

    function testCreateOrder() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);

        (address _creator,,, uint256 _amount,,,,,uint8 _status,,,,) = bridge.orders(orderId);
        assertEq(_creator, creator);
        assertEq(_amount, 1 ether);
        assertEq(_status, 0);
    }

    function testCancelOrder() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);

        uint256 beforeBalance = creator.balance;
        vm.prank(creator);
        bridge.cancelOrder(orderId);

        assertEq(creator.balance, beforeBalance + 1 ether);
        (,,,,,,,,uint8 status,,,,) = bridge.orders(orderId);
        assertEq(status, 2);
    }

    function testCancelNotCreator() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 100, 0);

        vm.prank(solver);
        vm.expectRevert("Not creator");
        bridge.cancelOrder(orderId);
    }

    function testAuctionPriceDecay() public {
        uint256 t = block.timestamp;
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 100, 0);
        assertEq(bridge.getAuctionPrice(orderId), 1000);

        vm.warp(t + 50);
        assertEq(bridge.getAuctionPrice(orderId), 750);

        vm.warp(t + 100);
        assertEq(bridge.getAuctionPrice(orderId), 500);

        vm.warp(t + 1000);
        assertEq(bridge.getAuctionPrice(orderId), 500);
    }

    // ── fulfillAndProve ───────────────────────────────────────────────────────

    function testFulfillAndProve() public {
        address recipient = makeAddr("user");
        bytes32 intentId = bytes32(uint256(0xABCD));

        uint256 amountToSend = 0.5 ether;
        uint256 totalValue = amountToSend + WORMHOLE_FEE;
        uint256 recipientBefore = recipient.balance;

        vm.prank(solver);
        uint64 sequence = bridge.fulfillAndProve{value: totalValue}(intentId, recipient);

        assertEq(recipient.balance, recipientBefore + amountToSend);
        assertEq(address(mockWormhole).balance, WORMHOLE_FEE);
        assertEq(sequence, 0);
    }

    function testFulfillAndProveInsufficientValue() public {
        vm.prank(solver);
        vm.expectRevert("Insufficient value: need ETH + Wormhole fee");
        bridge.fulfillAndProve{value: WORMHOLE_FEE}(bytes32(0), makeAddr("user"));
    }

    // ── settleOrder (Sui→EVM) ─────────────────────────────────────────────────

    function testSettleOrderSui() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);

        uint256 amountMist = 600;
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(amountMist)
        );
        mockWormhole.setNextVM(SUI_CHAIN_ID, SUI_EMITTER, keccak256("vaa_sui"), payload, true, "");

        uint256 solverBefore = solver.balance;
        vm.prank(solver);
        bridge.settleOrder(hex"deadbeef");

        assertEq(solver.balance, solverBefore + 1 ether);
        (,,,,,,,,uint8 status,,,,) = bridge.orders(orderId);
        assertEq(status, 1);
    }

    // ── settleOrder (Solana→EVM) ──────────────────────────────────────────────

    function testSettleOrderSolana() public {
        // Solana-destined order (destinationChain=1)
        // 1 ETH @ $2000, SOL @ $100 → expected = 20_000_000_000 lamports (20 SOL)
        // startPrice=22 SOL (110% of market ✓), floorPrice=15 SOL (75% of market ✓)
        bytes32 solanaRecipient = bytes32(uint256(0xDA1C0B2C3D4E5F67));
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(solanaRecipient, 1, SOL_START, SOL_FLOOR, 3600, 0);

        // Solver sends SOL (amountLamports >= floorPrice)
        uint256 amountLamports = SOL_FLOOR;
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(amountLamports)
        );
        mockWormhole.setNextVM(SOLANA_CHAIN_ID, SOLANA_EMITTER, keccak256("vaa_sol"), payload, true, "");

        uint256 solverBefore = solver.balance;
        vm.prank(solver);
        bridge.settleOrder(hex"cafe");

        assertEq(solver.balance, solverBefore + 1 ether);
        (,,,,,,,,uint8 status,,,,) = bridge.orders(orderId);
        assertEq(status, 1);
    }

    // ── settleOrder edge cases ────────────────────────────────────────────────

    function testSettleOrderReplayProtection() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);

        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(uint256(600))
        );
        mockWormhole.setNextVM(SUI_CHAIN_ID, SUI_EMITTER, keccak256("replay_vaa"), payload, true, "");
        vm.prank(solver);
        bridge.settleOrder(hex"aa");

        mockWormhole.setNextVM(SUI_CHAIN_ID, SUI_EMITTER, keccak256("replay_vaa"), payload, true, "");
        vm.prank(solver);
        vm.expectRevert("VAA already processed");
        bridge.settleOrder(hex"aa");
    }

    function testSettleOrderUnknownChain() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(uint256(600))
        );
        // Unknown chain ID (e.g. 999)
        mockWormhole.setNextVM(999, SUI_EMITTER, keccak256("h_unk"), payload, true, "");
        vm.prank(solver);
        vm.expectRevert("Unknown source chain");
        bridge.settleOrder(hex"aa");
    }

    function testSettleOrderWrongEmitter() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(uint256(600))
        );
        // Correct chain, wrong emitter address
        mockWormhole.setNextVM(SUI_CHAIN_ID, bytes32(uint256(0xBAD)), keccak256("h_wrong"), payload, true, "");
        vm.prank(solver);
        vm.expectRevert("Wrong emitter");
        bridge.settleOrder(hex"aa");
    }

    function testSettleOrderInvalidVAA() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, 0);
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(uint256(600))
        );
        mockWormhole.setNextVM(SUI_CHAIN_ID, SUI_EMITTER, keccak256("h_inv"), payload, false, "Invalid signature");
        vm.prank(solver);
        vm.expectRevert("Invalid signature");
        bridge.settleOrder(hex"aa");
    }

    // ── Admin: registerEmitter + ownership ───────────────────────────────────

    function testRegisterEmitterOnlyOwner() public {
        vm.prank(solver); // not owner
        vm.expectRevert("Not owner");
        bridge.registerEmitter(6, bytes32(uint256(0xABC)));
    }

    function testTransferOwnership() public {
        bridge.transferOwnership(creator);
        assertEq(bridge.owner(), creator);
    }
}
