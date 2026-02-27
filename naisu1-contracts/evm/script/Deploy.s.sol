// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IntentBridge} from "../src/IntentBridge.sol";

contract Deploy is Script {
    function run() external {
        address wormholeAddress = vm.envAddress("WORMHOLE_ADDRESS");
        uint8 cl = uint8(vm.envOr("CONSISTENCY_LEVEL", uint256(1)));

        vm.startBroadcast();
        IntentBridge bridge = new IntentBridge(wormholeAddress, cl);
        console.log("IntentBridge deployed at:", address(bridge));
        console.log("Owner:", msg.sender);
        console.log("Wormhole:", wormholeAddress);
        console.log("consistencyLevel:", cl);

        // Register Sui emitter (chain 21)
        bytes32 suiEmitter = vm.envBytes32("SUI_EMITTER_ADDRESS");
        bridge.registerEmitter(21, suiEmitter);
        console.log("Registered Sui emitter (chain 21):");
        console.logBytes32(suiEmitter);

        // Register Solana emitter (chain 1)
        bytes32 solanaEmitter = vm.envBytes32("SOLANA_EMITTER_ADDRESS");
        bridge.registerEmitter(1, solanaEmitter);
        console.log("Registered Solana emitter (chain 1):");
        console.logBytes32(solanaEmitter);

        vm.stopBroadcast();
    }
}
