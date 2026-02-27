use anchor_lang::prelude::*;

/// Wormhole Chain IDs
pub const WORMHOLE_CHAIN_SOLANA: u16 = 1;
pub const WORMHOLE_CHAIN_SUI: u16 = 21;
pub const WORMHOLE_CHAIN_ETHEREUM: u16 = 2;
pub const WORMHOLE_CHAIN_FUJI: u16 = 6;
pub const WORMHOLE_CHAIN_BASE_SEPOLIA: u16 = 10004;

/// Seed constants for PDAs
pub const CONFIG_SEED: &[u8] = b"config";
pub const FOREIGN_EMITTER_SEED: &[u8] = b"foreign_emitter";
pub const EMITTER_SEED: &[u8] = b"emitter";
pub const INTENT_SEED: &[u8] = b"intent";
pub const RECEIVED_SEED: &[u8] = b"received";

/// Wormhole Core Bridge Program (Devnet)
pub const WORMHOLE_CORE_BRIDGE_PROGRAM_ID: &str = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";

/// Consistency levels
pub const CONSISTENCY_LEVEL_CONFIRMED: u8 = 1;
pub const CONSISTENCY_LEVEL_FINALIZED: u8 = 32;

/// Status constants
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_FULFILLED: u8 = 1;
pub const STATUS_CANCELLED: u8 = 2;

/// Payload constants
pub const PAYLOAD_SIZE: usize = 96;
pub const INTENT_ID_OFFSET: usize = 0;
pub const SOLVER_OFFSET: usize = 32;
pub const AMOUNT_OFFSET: usize = 88;
