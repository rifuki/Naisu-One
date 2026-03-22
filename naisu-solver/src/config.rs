use eyre::{Result, WrapErr};
use std::env;

fn require_env(key: &str) -> Result<String> {
    env::var(key).wrap_err_with(|| format!("Missing required environment variable: {}", key))
}

#[derive(Debug, Clone)]
pub struct Config {
    // Sui
    pub sui_rpc_url: String,
    pub sui_rpc_fallbacks: Vec<String>,
    pub sui_private_key: String,
    pub sui_package_id: String,

    // Sui Wormhole
    pub sui_wormhole_state_id: String,
    pub sui_bridge_state_id: String,
    pub sui_emitter_address: String,

    // EVM (shared key + Wormhole — Base Sepolia)
    pub evm_private_key: String,
    pub evm_wormhole_address: String,
    pub evm_emitter_address: String,

    // EVM (Base Sepolia)
    pub base_rpc_url: String,
    pub evm_ws_url: Option<String>,  // BASE_SEPOLIA_WS_URL — optional, for WS mode (e.g. Alchemy wss://)
    pub base_contract_address: String,
    pub base_chain_id: u64,

    // Solana
    pub solana_rpc_url: String,
    pub solana_ws_url: Option<String>, // SOLANA_WS_URL — optional, defaults to derived from RPC URL
    pub solana_private_key: String,
    pub solana_program_id: String,
    pub liquid_staking_program_id: String, // mock-staking program for jupSOL/kSOL vaults

    // Solana Wormhole
    pub solana_wormhole_program_id: String,
    pub solana_emitter_address: String,

    // Wormhole API
    pub wormhole_api_url: String,

    // Strategy
    pub min_profit_bps: u64,

    // Solver network (optional — enables registration + coordinator WS connection)
    pub solver_name:               Option<String>,
    pub solver_backend_url:        Option<String>,
    pub solver_quote_discount_bps: u64,   // discount off startPrice for user; e.g. 200 = 2%
    pub solver_eta_seconds:        u64,   // solver's claimed fill time
}

impl Config {
    pub fn load() -> Result<Self> {
        dotenvy::dotenv().ok();

        Ok(Self {
            sui_rpc_url: require_env("SUI_RPC_URL")?,
            sui_rpc_fallbacks: env::var("SUI_RPC_FALLBACKS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            sui_private_key: require_env("SUI_PRIVATE_KEY")?,
            sui_package_id: require_env("SUI_PACKAGE_ID")?,

            sui_wormhole_state_id: require_env("SUI_WORMHOLE_STATE_ID")?,
            sui_bridge_state_id: require_env("SUI_BRIDGE_STATE_ID")?,
            sui_emitter_address: require_env("SUI_EMITTER_ADDRESS")?,

            evm_private_key: require_env("EVM_PRIVATE_KEY")?,
            evm_emitter_address: require_env("EVM_EMITTER_ADDRESS")?,
            evm_wormhole_address: require_env("EVM_WORMHOLE_ADDRESS")?,

            base_rpc_url: env::var("BASE_SEPOLIA_RPC_URL")
                .unwrap_or_else(|_| "https://sepolia.base.org".to_string()),
            evm_ws_url: env::var("BASE_SEPOLIA_WS_URL").ok(),
            base_contract_address: require_env("BASE_SEPOLIA_CONTRACT_ADDRESS")?,
            base_chain_id: env::var("BASE_SEPOLIA_CHAIN_ID")
                .unwrap_or_else(|_| "84532".to_string())
                .parse()
                .unwrap_or(84532),

            solana_rpc_url: require_env("SOLANA_RPC_URL")?,
            solana_ws_url: env::var("SOLANA_WS_URL").ok(),
            solana_private_key: require_env("SOLANA_PRIVATE_KEY")?,
            solana_program_id: require_env("SOLANA_PROGRAM_ID")?,
            liquid_staking_program_id: env::var("LIQUID_STAKING_PROGRAM_ID")
                .unwrap_or_else(|_| "9W1HN3QiTTUjBgr6ACPQT6jR6SQwgBdi2mFbb44aiWvJ".to_string()),

            solana_wormhole_program_id: require_env("SOLANA_WORMHOLE_PROGRAM_ID")?,
            solana_emitter_address: require_env("SOLANA_EMITTER_ADDRESS")?,

            wormhole_api_url: env::var("WORMHOLE_RPC_URL")
                .unwrap_or_else(|_| "https://api.testnet.wormholescan.io".to_string()),

            min_profit_bps: env::var("MIN_PROFIT_BPS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()?,

            solver_name:               env::var("SOLVER_NAME").ok(),
            solver_backend_url:        env::var("SOLVER_BACKEND_URL").ok(),
            solver_quote_discount_bps: env::var("SOLVER_QUOTE_DISCOUNT_BPS")
                .unwrap_or_else(|_| "200".to_string())
                .parse()
                .unwrap_or(200),
            solver_eta_seconds:        env::var("SOLVER_ETA_SECONDS")
                .unwrap_or_else(|_| "11".to_string())
                .parse()
                .unwrap_or(11),
        })
    }
}
