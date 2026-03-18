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
const E_INVALID_RECIPIENT: u64 = 7; // Invalid recipient address format

// === Constants ===
const EVM_ADDRESS_LENGTH: u64 = 20; // EVM addresses are 20 bytes

// === Status ===
const STATUS_OPEN:      u8 = 0;
const STATUS_FULFILLED: u8 = 1;
const STATUS_CANCELLED: u8 = 2;

// === Wormhole Chain IDs ===
const BASE_SEPOLIA_CHAIN_ID: u16 = 10004; // Base Sepolia testnet

// === Structs ===

public struct AdminCap has key, store {
    id: UID,
}

/// Shared object holding Wormhole emitter + replay-protection table.
/// Created once via initialize_bridge_state() after package publish.
public struct BridgeState has key {
    id: UID,
    emitter_cap: EmitterCap,
    processed_vaas: Table<bytes32::Bytes32, bool>,
    registered_evm_emitters: Table<u16, vector<u8>>, // Map chain_id -> emitter address
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
    status: u8
}

// === Events ===

public struct IntentCreated has copy, drop {
    intent_id: ID,
    creator: address,
    recipient: vector<u8>,
    destination_chain: u16,
    amount: u64,
    start_price: u64,
    floor_price: u64,
    deadline: u64,
    created_at: u64
}

public struct IntentFulfilled has copy, drop {
    intent_id: ID,
    solver: address,
    fulfilled_at: u64
}

public struct IntentCancelled has copy, drop {
    intent_id: ID,
    cancelled_at: u64
}

// === Init ===

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Called by admin after publish to create the BridgeState shared object.
/// @param registered_evm_emitters Vector of tuples (chain_id, emitter_address)
public fun initialize_bridge_state(
    _admin_cap: &AdminCap,
    wormhole_state: &mut WormholeState,
    ctx: &mut TxContext
) {
    let emitter_cap = emitter::new(wormhole_state, ctx);
    let state = BridgeState {
        id: object::new(ctx),
        emitter_cap,
        processed_vaas: table::new(ctx),
        registered_evm_emitters: table::new(ctx),
    };
    transfer::share_object(state);
}

/// Register an EVM emitter for a specific chain (admin only)
public fun register_evm_emitter(
    _admin_cap: &AdminCap,
    state: &mut BridgeState,
    chain_id: u16,
    emitter_address: vector<u8>
) {
    // Validate chain ID
    assert!(
        chain_id == BASE_SEPOLIA_CHAIN_ID,
        E_INVALID_PARAMS
    );
    // Validate emitter address (32 bytes)
    assert!(emitter_address.length() == 32, E_INVALID_PARAMS);
    
    state.registered_evm_emitters.add(chain_id, emitter_address);
}

// === Helper Functions ===

/// Validates that recipient is a valid EVM address (20 bytes)
/// For Sui -> EVM direction, recipient must be 20 bytes
fun validate_evm_recipient(recipient: &vector<u8>) {
    assert!(recipient.length() == EVM_ADDRESS_LENGTH, E_INVALID_RECIPIENT);
    
    // Check that it's not all zeros (invalid address)
    let mut is_zero = true;
    let mut i = 0;
    while (i < recipient.length()) {
        if (*recipient.borrow(i) != 0) {
            is_zero = false;
            break
        };
        i = i + 1;
    };
    assert!(!is_zero, E_INVALID_RECIPIENT);
}

// === User Functions ===

public fun create_intent(
    coin: Coin<SUI>,
    recipient: vector<u8>,
    destination_chain: u16,
    start_price: u64,
    floor_price: u64,
    duration_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let amount = coin.value();
    assert!(amount > 0, E_INVALID_PARAMS);
    assert!(start_price >= floor_price, E_INVALID_PARAMS);
    assert!(duration_ms > 0, E_INVALID_PARAMS);
    
    // Validate recipient is valid EVM address (20 bytes) for cross-chain to EVM
    validate_evm_recipient(&recipient);

    let now = clock.timestamp_ms();
    let deadline = now + duration_ms;

    let intent = Intent {
        id: object::new(ctx),
        creator: ctx.sender(),
        recipient,
        destination_chain,
        locked_balance: coin.into_balance(),
        start_price,
        floor_price,
        deadline,
        created_at: now,
        status: STATUS_OPEN
    };

    event::emit(IntentCreated {
        intent_id: object::id(&intent),
        creator: ctx.sender(),
        recipient: intent.recipient,
        destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        created_at: now
    });

    transfer::public_share_object(intent);
}

public fun cancel_intent(
    intent: &mut Intent,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(intent.status == STATUS_OPEN, E_ALREADY_FULFILLED);
    assert!(intent.creator == ctx.sender(), E_NOT_CREATOR);

    intent.status = STATUS_CANCELLED;

    let amount = intent.locked_balance.value();
    let refund = intent.locked_balance.split(amount);
    let refund_coin = coin::from_balance(refund, ctx);
    transfer::public_transfer(refund_coin, intent.creator);

    event::emit(IntentCancelled {
        intent_id: object::id(intent),
        cancelled_at: clock.timestamp_ms(),
    });
}

public fun get_auction_price(intent: &Intent, clock: &Clock): u64 {
    let now = clock.timestamp_ms();

    if (now >= intent.deadline) {
        return intent.floor_price
    };

    if (now <= intent.created_at) {
        return intent.start_price
    };

    let elapsed = now - intent.created_at;
    let duration = intent.deadline - intent.created_at;
    let price_range = intent.start_price - intent.floor_price;
    let decay = (((price_range as u128) * (elapsed as u128)) / (duration as u128)) as u64;

    intent.start_price - decay
}

// === Solver Functions (Wormhole) ===

/// EVM→Sui direction: Solver sends SUI to recipient and publishes Wormhole proof.
/// The returned sequence number is used by the solver to fetch the VAA from Wormhole,
/// which is then submitted to the EVM's settleOrder() to claim locked ETH.
///
/// @param bridge_state     Shared BridgeState (contains EmitterCap)
/// @param payment          SUI coin to send to the recipient
/// @param recipient        Sui address of the user who should receive SUI
/// @param order_id         32-byte EVM order ID (big-endian bytes32)
/// @param solver_evm_address  20-byte solver EVM address
/// @param wormhole_state   Wormhole shared state object
/// @param message_fee      SUI coin covering Wormhole message fee
/// @param clock            Sui Clock object (0x6)
public fun solve_and_prove(
    bridge_state: &mut BridgeState,
    payment: Coin<SUI>,
    recipient: address,
    order_id: vector<u8>,         // 32 bytes
    solver_evm_address: vector<u8>, // 20 bytes
    wormhole_state: &mut WormholeState,
    message_fee: Coin<SUI>,
    clock: &Clock,
    _ctx: &mut TxContext,
): u64 {
    assert!(vector::length(&order_id) == 32, E_INVALID_PARAMS);
    assert!(vector::length(&solver_evm_address) == 20, E_INVALID_PARAMS);

    let amount_mist = payment.value();
    assert!(amount_mist > 0, E_INVALID_PARAMS);

    // Transfer SUI to the recipient (user on Sui)
    transfer::public_transfer(payment, recipient);

    // Build 96-byte Wormhole payload (mirrors EVM ABI-encoded tuple):
    // [0..32]  order_id (already 32 bytes)
    // [32..64] solver EVM address (12 zero bytes + 20 byte address)
    // [64..96] amount in MIST (24 zero bytes + 8 byte big-endian u64)
    let mut payload = vector::empty<u8>();

    // Append order_id (32 bytes)
    vector::append(&mut payload, order_id);

    // Append solver EVM address padded to 32 bytes (left-pad with 12 zeros)
    let mut i = 0u8;
    while (i < 12) {
        vector::push_back(&mut payload, 0u8);
        i = i + 1;
    };
    vector::append(&mut payload, solver_evm_address);

    // Append amount_mist (u64) as big-endian 32-byte value (left-pad with 24 zeros)
    let mut j = 0u8;
    while (j < 24) {
        vector::push_back(&mut payload, 0u8);
        j = j + 1;
    };
    vector::append(&mut payload, u64_to_bytes_be(amount_mist));

    // Publish via Wormhole
    let msg_ticket = publish_message::prepare_message(
        &mut bridge_state.emitter_cap,
        0,      // nonce
        payload,
    );
    let sequence = publish_message::publish_message(
        wormhole_state,
        message_fee,
        msg_ticket,
        clock,
    );

    sequence
}

/// Sui→EVM direction: Solver submits Wormhole VAA proving they sent ETH on EVM.
/// Releases the locked SUI to the solver as reward.
///
/// @param bridge_state   Shared BridgeState (holds processed_vaas + emitter config)
/// @param intent         The Sui Intent object (shared)
/// @param vaa_bytes      Raw Wormhole VAA bytes from the EVM fulfillAndProve() tx
/// @param wormhole_state Wormhole shared state object
/// @param clock          Sui Clock object (0x6)
public fun claim_with_vaa(
    bridge_state: &mut BridgeState,
    intent: &mut Intent,
    vaa_bytes: vector<u8>,
    wormhole_state: &WormholeState,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. Parse and verify VAA (Wormhole Guardians signature check)
    let parsed_vaa = vaa::parse_and_verify(wormhole_state, vaa_bytes, clock);

    // 2. Validate emitter chain and address
    let emitter_chain = vaa::emitter_chain(&parsed_vaa);
    let emitter_addr = vaa::emitter_address(&parsed_vaa);
    let emitter_bytes = external_address::to_bytes(emitter_addr);
    
    // Check if emitter is registered for this chain
    assert!(table::contains(&bridge_state.registered_evm_emitters, emitter_chain), E_INVALID_EMITTER);
    let registered_emitter = table::borrow(&bridge_state.registered_evm_emitters, emitter_chain);
    assert!(emitter_bytes == *registered_emitter, E_INVALID_EMITTER);

    // 3. Replay protection using VAA hash
    let vaa_hash = vaa::digest(&parsed_vaa);
    assert!(
        !table::contains(&bridge_state.processed_vaas, vaa_hash),
        E_ALREADY_PROCESSED
    );
    table::add(&mut bridge_state.processed_vaas, vaa_hash, true);

    // 4. Decode 96-byte payload:
    //    [0..32]  intent_id (bytes32)
    //    [32..64] solver address padded (32 bytes; last 20 bytes = EVM addr, not used here)
    //    [64..96] amount in Gwei (uint256 right-aligned)
    let payload = vaa::take_payload(parsed_vaa);
    assert!(vector::length(&payload) >= 96, E_INVALID_PARAMS);

    // Extract intent_id bytes (first 32 bytes) for validation
    let mut intent_id_from_payload = vector::empty<u8>();
    let mut k = 0;
    while (k < 32) {
        vector::push_back(&mut intent_id_from_payload, *vector::borrow(&payload, k));
        k = k + 1;
    };

    // Extract amount in Gwei (last 8 bytes of the 96-byte payload, bytes 88..96)
    let amount_gwei = bytes_be_to_u64(&payload, 88);

    // 5. Validate intent
    assert!(intent.status == STATUS_OPEN, E_ALREADY_FULFILLED);
    let now = clock.timestamp_ms();
    assert!(now <= intent.deadline, E_EXPIRED);

    // Check that the solver paid at least the floor price in Gwei
    assert!(amount_gwei >= intent.floor_price, E_PRICE_TOO_LOW);

    // Validate intentId matches this Intent object
    let expected_id = object::id_to_bytes(&object::id(intent));
    assert!(intent_id_from_payload == expected_id, E_INVALID_PARAMS);

    // 6. Mark fulfilled and release locked SUI to solver (tx.sender = solver)
    intent.status = STATUS_FULFILLED;

    let locked_amount = intent.locked_balance.value();
    let reward = intent.locked_balance.split(locked_amount);
    let reward_coin = coin::from_balance(reward, ctx);
    transfer::public_transfer(reward_coin, ctx.sender());

    event::emit(IntentFulfilled {
        intent_id: object::id(intent),
        solver: ctx.sender(),
        fulfilled_at: now,
    });
}



// === Private Helpers ===

/// Converts u64 to big-endian 8-byte vector.
fun u64_to_bytes_be(value: u64): vector<u8> {
    let mut bytes = vector::empty<u8>();
    let mut i = 8u8;
    while (i > 0) {
        i = i - 1;
        vector::push_back(&mut bytes, ((value >> (i * 8)) & 0xFF) as u8);
    };
    bytes
}

/// Reads 8 bytes from `data` starting at `offset` as big-endian u64.
fun bytes_be_to_u64(data: &vector<u8>, offset: u64): u64 {
    let mut result = 0u64;
    let mut i = 0u64;
    while (i < 8) {
        result = (result << 8) | (*vector::borrow(data, offset + i) as u64);
        i = i + 1;
    };
    result
}
