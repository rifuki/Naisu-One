use anchor_lang::prelude::*;

/// Global program configuration
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Admin/owner pubkey — can register foreign emitters
    pub owner: Pubkey,
    /// Wormhole Core Bridge program config PDA
    pub wormhole_bridge: Pubkey,
    /// Bump seed for PDA
    pub bump: u8,
}

/// Registered foreign emitter for a specific chain
#[account]
#[derive(InitSpace)]
pub struct ForeignEmitter {
    /// Wormhole chain ID (e.g., 6 = Fuji, 10004 = Base Sepolia, 21 = Sui)
    pub chain: u16,
    /// 32-byte emitter address (contract address left-padded for EVM, EmitterCap for Sui)
    pub address: [u8; 32],
    /// Bump seed for PDA
    pub bump: u8,
}

/// Intent account - represents a cross-chain intent
#[account]
#[derive(InitSpace)]
pub struct Intent {
    /// Unique intent ID (32 bytes)
    pub intent_id: [u8; 32],
    /// Creator's pubkey
    pub creator: Pubkey,
    /// Recipient address on destination chain (32 bytes, format depends on chain)
    pub recipient: [u8; 32],
    /// Wormhole chain ID of destination (e.g., 6 = Fuji, 10004 = Base Sepolia)
    pub destination_chain: u16,
    /// Locked SOL amount in lamports
    pub amount: u64,
    /// Dutch auction start price (in destination chain's smallest unit)
    pub start_price: u64,
    /// Dutch auction floor price
    pub floor_price: u64,
    /// Unix timestamp deadline
    pub deadline: i64,
    /// Unix timestamp created
    pub created_at: i64,
    /// Status: 0=Open, 1=Fulfilled, 2=Cancelled
    pub status: u8,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

/// Replay protection — one per processed VAA
#[account]
#[derive(InitSpace)]
pub struct Received {
    /// Wormhole chain ID of the emitter
    pub emitter_chain: u16,
    /// Wormhole sequence number
    pub sequence: u64,
    /// Bump seed
    pub bump: u8,
}

/// Events
#[event]
pub struct IntentCreated {
    pub intent_id: [u8; 32],
    pub creator: Pubkey,
    pub recipient: [u8; 32],
    pub destination_chain: u16,
    pub amount: u64,
    pub start_price: u64,
    pub floor_price: u64,
    pub deadline: i64,
    pub created_at: i64,
}

#[event]
pub struct IntentCancelled {
    pub intent_id: [u8; 32],
    pub cancelled_at: i64,
}

#[event]
pub struct IntentFulfilled {
    pub intent_id: [u8; 32],
    pub solver: Pubkey,
    pub fulfilled_at: i64,
}

#[event]
pub struct EmitterRegistered {
    pub chain: u16,
    pub address: [u8; 32],
}
