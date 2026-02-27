#!/bin/bash
# Deploy Sui Intent Bridge with EVM emitters pre-registered
# Run this after wallet setup

set -e

echo "=== Sui Intent Bridge Redeploy with EVM Emitters ==="
echo ""

# Check wallet
SUI_ADDRESS=$(sui client active-address 2>/dev/null || echo "")
if [ -z "$SUI_ADDRESS" ]; then
    echo "❌ No active Sui address. Create wallet first:"
    echo "   sui client new-address ed25519"
    exit 1
fi
echo "✅ Using Sui address: $SUI_ADDRESS"

# Check balance
BALANCE=$(sui client gas --json 2>/dev/null | jq -r '[.[].gasCoinId] | length' || echo "0")
echo "💰 Gas objects: $BALANCE"
if [ "$BALANCE" -lt 2 ]; then
    echo "❌ Need more SUI gas. Get from faucet:"
    echo "   sui client faucet --network testnet"
    exit 1
fi

# 1. Modify Move code to add emitters in initialize
echo ""
echo "Step 1: Patching Move code to pre-register EVM emitters..."

# Backup original
cp sources/intent_bridge.move sources/intent_bridge.move.bak

# Create patched version with emitters
cat > sources/intent_bridge.move << 'MOVE_EOF'
module intent_bridge::intent_bridge;

use sui::{balance::Balance, clock::Clock, coin::{Self, Coin}, event, sui::SUI, table::{Self, Table}};
use wormhole::state::{State as WormholeState};
use wormhole::publish_message;
use wormhole::vaa;
use wormhole::emitter::{Self, EmitterCap};
use wormhole::external_address;
use wormhole::bytes32;

// === Errors ===
const E_INVALID_PARAMS: u64   = 0;
const E_NOT_CREATOR: u64      = 1;
const E_ALREADY_FULFILLED: u64 = 2;
const E_EXPIRED: u64           = 3;
const E_INVALID_EMITTER: u64  = 4;
const E_ALREADY_PROCESSED: u64 = 5;
const E_PRICE_TOO_LOW: u64    = 6;
const E_INVALID_RECIPIENT: u64 = 7;

// === Constants ===
const EVM_ADDRESS_LENGTH: u64 = 20;

// === Status ===
const STATUS_OPEN:      u8 = 0;
const STATUS_FULFILLED: u8 = 1;
const STATUS_CANCELLED: u8 = 2;

// === Wormhole Chain IDs ===
const BASE_SEPOLIA_CHAIN_ID: u16 = 10004;
const AVALANCHE_FUJI_CHAIN_ID: u16 = 6;

// === EVM Contract Addresses (padded to 32 bytes) ===
const FUJI_CONTRACT: vector<u8> = vector[
    0,0,0,0,0,0,0,0,0,0,0,0,
    0x27,0x47,0x68,0xb4,0xB1,0x68,0x41,0xd2,0x3b,0x82,0x48,0xd1,
    0x31,0x1f,0xBD,0xc7,0x60,0x80,0x3E,0x65
];
const BASE_CONTRACT: vector<u8> = vector[
    0,0,0,0,0,0,0,0,0,0,0,0,
    0x66,0x6b,0xa2,0x30,0xd7,0x9b,0x3a,0x2f,0xc0,0x71,0x3a,0xd3,
    0xa6,0xbb,0xb6,0x7a,0xa4,0x67,0xaf,0x05
];

public struct AdminCap has key, store { id: UID }

public struct BridgeState has key {
    id: UID,
    emitter_cap: EmitterCap,
    processed_vaas: Table<bytes32::Bytes32, bool>,
    registered_evm_emitters: Table<u16, vector<u8>>,
}

public struct Intent has key, store {
    id: UID,
    creator: address,
    recipient: vector<u8>,
    destination_chain: u16,
    locked_balance: Balance<SUI>,
    start_price: u64,
    floor_price: u64,
    deadline: u64,
    created_at: u64,
    status: u8,
    bump: u8,
}

// === Events ===
public struct IntentCreated has copy, drop {
    intent_id: address,
    creator: address,
    recipient: vector<u8>,
    destination_chain: u16,
    amount: u64,
    start_price: u64,
    floor_price: u64,
    deadline: u64,
}

public struct IntentFulfilled has copy, drop {
    intent_id: address,
    solver: address,
    amount_paid: u64,
}

public struct IntentCancelled has copy, drop {
    intent_id: address,
}

/// Initialize bridge state with EVM emitters pre-registered
public fun initialize_bridge_state(
    _admin_cap: &AdminCap,
    wormhole_state: &mut WormholeState,
    ctx: &mut TxContext
) {
    let emitter_cap = emitter::new(wormhole_state, ctx);
    let mut state = BridgeState {
        id: object::new(ctx),
        emitter_cap,
        processed_vaas: table::new(ctx),
        registered_evm_emitters: table::new(ctx),
    };
    
    // Pre-register EVM emitters
    state.registered_evm_emitters.add(AVALANCHE_FUJI_CHAIN_ID, FUJI_CONTRACT);
    state.registered_evm_emitters.add(BASE_SEPOLIA_CHAIN_ID, BASE_CONTRACT);
    
    transfer::share_object(state);
}

/// Admin-only: Register additional EVM emitters (for future use)
public fun register_evm_emitter(
    _admin_cap: &AdminCap,
    state: &mut BridgeState,
    chain_id: u16,
    emitter_address: vector<u8>
) {
    assert!(
        chain_id == BASE_SEPOLIA_CHAIN_ID || chain_id == AVALANCHE_FUJI_CHAIN_ID,
        E_INVALID_PARAMS
    );
    assert!(emitter_address.length() == 32, E_INVALID_PARAMS);
    
    if (state.registered_evm_emitters.contains(chain_id)) {
        state.registered_evm_emitters.remove(chain_id);
    };
    state.registered_evm_emitters.add(chain_id, emitter_address);
}

// === Create Intent (Sui -> EVM) ===
public entry fun create_intent(
    recipient: vector<u8>,
    destination_chain: u16,
    locked_coins: Coin<SUI>,
    start_price: u64,
    floor_price: u64,
    deadline: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    validate_evm_recipient(&recipient);
    
    let amount = locked_coins.value();
    assert!(amount > 0, E_INVALID_PARAMS);
    assert!(floor_price > 0 && floor_price <= start_price, E_INVALID_PARAMS);
    assert!(deadline > clock.timestamp_ms() / 1000, E_INVALID_PARAMS);
    
    let id = object::new(ctx);
    let intent_id = id.uid_to_address();
    let created_at = clock.timestamp_ms() / 1000;
    
    event::emit(IntentCreated {
        intent_id,
        creator: ctx.sender(),
        recipient,
        destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
    });
    
    let intent = Intent {
        id,
        creator: ctx.sender(),
        recipient,
        destination_chain,
        locked_balance: locked_coins.into_balance(),
        start_price,
        floor_price,
        deadline,
        created_at,
        status: STATUS_OPEN,
        bump: 0,
    };
    
    transfer::share_object(intent);
}

// === Solve & Prove (Solver side) ===
public entry fun solve_and_prove(
    intent: &mut Intent,
    payment: Coin<SUI>,
    bridge_state: &mut BridgeState,
    wormhole_state: &mut WormholeState,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let now = clock.timestamp_ms() / 1000;
    assert!(now <= intent.deadline, E_EXPIRED);
    assert!(intent.status == STATUS_OPEN, E_ALREADY_FULFILLED);
    
    let payment_amount = payment.value();
    let required = calculate_current_price(intent, now);
    assert!(payment_amount >= required, E_PRICE_TOO_LOW);
    
    // Send payment to creator
    transfer::public_transfer(payment, intent.creator);
    
    // Publish Wormhole message as proof
    let payload = encode_proof_payload(intent.id.uid_to_address(), intent.creator, payment_amount);
    let _sequence = publish_message::publish_message(
        &mut bridge_state.emitter_cap,
        wormhole_state,
        0, // nonce
        payload,
        ctx,
    );
    
    intent.status = STATUS_FULFILLED;
    
    event::emit(IntentFulfilled {
        intent_id: intent.id.uid_to_address(),
        solver: ctx.sender(),
        amount_paid: payment_amount,
    });
}

// === Claim with VAA (EVM -> Sui) ===
public entry fun claim_with_vaa(
    intent: &mut Intent,
    bridge_state: &mut BridgeState,
    wormhole_state: &mut WormholeState,
    vaa_bytes: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(intent.status == STATUS_OPEN, E_ALREADY_FULFILLED);
    
    let parsed_vaa = vaa::parse_and_verify(wormhole_state, vaa_bytes, clock);
    let emitter_chain = vaa::emitter_chain(&parsed_vaa);
    let emitter_addr = vaa::emitter_address(&parsed_vaa);
    
    // Verify emitter is registered
    assert!(bridge_state.registered_evm_emitters.contains(emitter_chain), E_INVALID_EMITTER);
    let registered = bridge_state.registered_evm_emitters.borrow(emitter_chain);
    let emitter_bytes = external_address::to_bytes(emitter_addr);
    assert!(emitter_bytes == *registered, E_INVALID_EMITTER);
    
    // Replay protection
    let vaa_hash = vaa::digest(&parsed_vaa);
    assert!(!bridge_state.processed_vaas.contains(vaa_hash), E_ALREADY_PROCESSED);
    bridge_state.processed_vaas.add(vaa_hash, true);
    
    // Decode payload and verify
    let payload = vaa::payload(&parsed_vaa);
    let (order_id, _recipient, _amount) = decode_evm_payload(payload);
    assert!(order_id == intent.id.uid_to_address(), E_INVALID_PARAMS);
    
    // Transfer locked SUI to solver
    let amount = intent.locked_balance.value();
    let sui_coin = intent.locked_balance.split(amount).into_coin(ctx);
    transfer::public_transfer(sui_coin, ctx.sender());
    
    intent.status = STATUS_FULFILLED;
}

// === Cancel Intent ===
public entry fun cancel_intent(
    intent: &mut Intent,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(intent.creator == ctx.sender(), E_NOT_CREATOR);
    assert!(intent.status == STATUS_OPEN, E_ALREADY_FULFILLED);
    let now = clock.timestamp_ms() / 1000;
    assert!(now > intent.deadline, E_INVALID_PARAMS);
    
    let amount = intent.locked_balance.value();
    let sui_coin = intent.locked_balance.split(amount).into_coin(ctx);
    transfer::public_transfer(sui_coin, intent.creator);
    
    intent.status = STATUS_CANCELLED;
    event::emit(IntentCancelled { intent_id: intent.id.uid_to_address() });
}

// === Helper Functions ===
fun validate_evm_recipient(recipient: &vector<u8>) {
    assert!(recipient.length() == EVM_ADDRESS_LENGTH, E_INVALID_RECIPIENT);
    let mut all_zeros = true;
    let mut i = 0;
    while (i < recipient.length()) {
        if (*recipient.borrow(i) != 0) { all_zeros = false; break };
        i = i + 1;
    };
    assert!(!all_zeros, E_INVALID_RECIPIENT);
}

fun calculate_current_price(intent: &Intent, now: u64): u64 {
    if (now >= intent.deadline) { return intent.floor_price };
    let elapsed = now - intent.created_at;
    let duration = intent.deadline - intent.created_at;
    if (duration == 0) { return intent.floor_price };
    let price_drop = ((intent.start_price - intent.floor_price) as u128) * (elapsed as u128) / (duration as u128);
    intent.start_price - (price_drop as u64)
}

fun encode_proof_payload(order_id: address, recipient: address, amount: u64): vector<u8> {
    let mut payload = vector::empty<u8>();
    payload.append(address::to_bytes(order_id));
    payload.append(address::to_bytes(recipient));
    payload.append(bcs::to_bytes(&amount));
    payload
}

fun decode_evm_payload(payload: vector<u8>): (address, vector<u8>, u64) {
    // Payload format: order_id(32) + recipient(20) + amount(8)
    let order_id = address::from_bytes(vector::slice(&payload, 0, 32));
    let recipient = vector::slice(&payload, 32, 52);
    let amount_bytes = vector::slice(&payload, 52, 60);
    let amount = bcs::new(amount_bytes).peel_u64();
    (order_id, recipient, amount)
}

// === View Functions ===
public fun get_intent_status(intent: &Intent): u8 { intent.status }
public fun get_intent_amount(intent: &Intent): u64 { intent.locked_balance.value() }
public fun get_current_price(intent: &Intent, clock: &Clock): u64 {
    calculate_current_price(intent, clock.timestamp_ms() / 1000)
}
MOVE_EOF

echo "✅ Move code patched with pre-registered EVM emitters"

# 2. Publish
echo ""
echo "Step 2: Publishing to Testnet..."
sui client publish --network testnet --gas-budget 500000000

echo ""
echo "=== Done! ==="
echo "Update solver/.env dengan:"
echo "  SUI_PACKAGE_ID=<new_package_id>"
echo "  SUI_EMITTER_ADDRESS=<new_emitter_address>"
