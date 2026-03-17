#!/bin/bash
# Register EVM contract as emitter in Sui Intent Bridge
# Run this after deploying EVM contract

set -e

# Config
SUI_NETWORK="testnet"
PACKAGE_ID="0x920f52f8b6734e5333330d50b8b6925d38b39c6d0498dd0053b76e889365cecb"
BRIDGE_STATE_ID="${SUI_BRIDGE_STATE_ID:-<BRIDGE_STATE_OBJECT_ID>}"
ADMIN_CAP_ID="${SUI_ADMIN_CAP_ID:-<ADMIN_CAP_OBJECT_ID>}"
WORMHOLE_STATE_ID="${SUI_WORMHOLE_STATE_ID:-0x31358d6172184ea454b5b8c14f8aee67a3ea43b05d545246559aa7a6661bc9e7}"

# EVM Contract Addresses (padded to 32 bytes)
AVALANCHE_FUJI_CONTRACT="0x000000000000000000000000274768b4b16841d23b8248d1311fbdc760803e65"
BASE_SEPOLIA_CONTRACT="0x000000000000000000000000274768b4b16841d23b8248d1311fbdc760803e65"

# Chain IDs
AVALANCHE_FUJI_CHAIN_ID=6
BASE_SEPOLIA_CHAIN_ID=10004

echo "Registering EVM emitters..."
echo "Package: $PACKAGE_ID"
echo "Bridge State: $BRIDGE_STATE_ID"
echo ""

if [ "$BRIDGE_STATE_ID" = "<BRIDGE_STATE_OBJECT_ID>" ]; then
    echo "ERROR: Please set SUI_BRIDGE_STATE_ID environment variable"
    echo "Example: export SUI_BRIDGE_STATE_ID=0x..."
    exit 1
fi

if [ "$ADMIN_CAP_ID" = "<ADMIN_CAP_OBJECT_ID>" ]; then
    echo "ERROR: Please set SUI_ADMIN_CAP_ID environment variable"
    echo "Example: export SUI_ADMIN_CAP_ID=0x..."
    exit 1
fi

# Register Avalanche Fuji emitter
echo "Registering Avalanche Fuji (chain_id=$AVALANCHE_FUJI_CHAIN_ID) emitter..."
sui client call \
    --package "$PACKAGE_ID" \
    --module intent_bridge \
    --function register_evm_emitter \
    --args \
        "$ADMIN_CAP_ID" \
        "$BRIDGE_STATE_ID" \
        "$AVALANCHE_FUJI_CHAIN_ID" \
        "$AVALANCHE_FUJI_CONTRACT" \
    --gas-budget 10000000 \
    --network "$SUI_NETWORK"

echo ""
echo "Registering Base Sepolia (chain_id=$BASE_SEPOLIA_CHAIN_ID) emitter..."
sui client call \
    --package "$PACKAGE_ID" \
    --module intent_bridge \
    --function register_evm_emitter \
    --args \
        "$ADMIN_CAP_ID" \
        "$BRIDGE_STATE_ID" \
        "$BASE_SEPOLIA_CHAIN_ID" \
        "$BASE_SEPOLIA_CONTRACT" \
    --gas-budget 10000000 \
    --network "$SUI_NETWORK"

echo ""
echo "✅ EVM emitters registered successfully!"
echo ""
echo "Set these in solver/.env:"
echo "EVM_EMITTER_ADDRESS=$AVALANCHE_FUJI_CONTRACT"
