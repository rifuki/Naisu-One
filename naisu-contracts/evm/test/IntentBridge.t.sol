// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IntentBridge} from "../src/IntentBridge.sol";
import {MockWormhole} from "../src/MockWormhole.sol";

contract IntentBridgeTest is Test {
    IntentBridge public bridge;
    MockWormhole public mockWormhole;

    address public creator = makeAddr("creator");
    address public solver  = makeAddr("solver");

    bytes32 constant SUI_EMITTER    = bytes32(uint256(0xDEAD));
    bytes32 constant SOLANA_EMITTER = bytes32(uint256(0xBEEF));
    uint16  constant SUI_CHAIN_ID    = 21;
    uint16  constant SOLANA_CHAIN_ID = 1;

    uint256 constant WORMHOLE_FEE = 0.001 ether;

    function setUp() public {
        mockWormhole = new MockWormhole(WORMHOLE_FEE);
        bridge = new IntentBridge(address(mockWormhole), 1);
        bridge.registerEmitter(SUI_CHAIN_ID, SUI_EMITTER);
        bridge.registerEmitter(SOLANA_CHAIN_ID, SOLANA_EMITTER);

        vm.deal(creator, 10 ether);
        vm.deal(solver,  10 ether);
    }

    // ── createOrder ──────────────────────────────────────────────────────────

    function testCreateOrder() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);

        (address _creator,,, uint256 _amount,,,,,uint8 _status,,,) = bridge.orders(orderId);
        assertEq(_creator, creator);
        assertEq(_amount, 1 ether);
        assertEq(_status, 0);
    }

    function testCancelOrder() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);

        uint256 beforeBalance = creator.balance;
        vm.prank(creator);
        bridge.cancelOrder(orderId);

        assertEq(creator.balance, beforeBalance + 1 ether);
        (,,,,,,,,uint8 status,,,) = bridge.orders(orderId);
        assertEq(status, 2);
    }

    function testCancelNotCreator() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 100, false);

        vm.prank(solver);
        vm.expectRevert("Not creator");
        bridge.cancelOrder(orderId);
    }

    function testAuctionPriceDecay() public {
        uint256 t = block.timestamp;
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 100, false);
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
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);

        uint256 amountMist = 600;
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(amountMist)
        );
        mockWormhole.setNextVM(SUI_CHAIN_ID, SUI_EMITTER, keccak256("vaa_sui"), payload, true, "");

        uint256 solverBefore = solver.balance;
        vm.prank(solver);
        bridge.settleOrder(hex"deadbeef");

        assertEq(solver.balance, solverBefore + 1 ether);
        (,,,,,,,,uint8 status,,,) = bridge.orders(orderId);
        assertEq(status, 1);
    }

    // ── settleOrder (Solana→EVM) ──────────────────────────────────────────────

    function testSettleOrderSolana() public {
        // Solana-destined order (destinationChain=1)
        bytes32 solanaRecipient = bytes32(uint256(0xDA1C0B2C3D4E5F67));
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(solanaRecipient, 1, 1000, 500, 3600, false);

        // Solver sends SOL (amountLamports >= floorPrice)
        uint256 amountLamports = 700;
        bytes memory payload = abi.encodePacked(
            orderId, bytes32(uint256(uint160(solver))), bytes32(amountLamports)
        );
        mockWormhole.setNextVM(SOLANA_CHAIN_ID, SOLANA_EMITTER, keccak256("vaa_sol"), payload, true, "");

        uint256 solverBefore = solver.balance;
        vm.prank(solver);
        bridge.settleOrder(hex"cafe");

        assertEq(solver.balance, solverBefore + 1 ether);
        (,,,,,,,,uint8 status,,,) = bridge.orders(orderId);
        assertEq(status, 1);
    }

    // ── settleOrder edge cases ────────────────────────────────────────────────

    function testSettleOrderReplayProtection() public {
        vm.prank(creator);
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);

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
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);
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
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);
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
        bytes32 orderId = bridge.createOrder{value: 1 ether}(bytes32(uint256(0x1234)), 21, 1000, 500, 3600, false);
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
