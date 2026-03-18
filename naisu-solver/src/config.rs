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

    // EVM chain 1 (primary — Avalanche Fuji)
    pub evm_rpc_url: String,
    pub evm_private_key: String,
    pub evm_contract_address: String,
    pub evm_chain_id: u64,
    pub evm_wormhole_address: String,
    pub evm_emitter_address: String,

    // EVM chain 2 (Base Sepolia)
    pub evm2_rpc_url: String,
    pub evm2_ws_url: Option<String>,  // EVM2_WS_URL — required for WS mode (e.g. Alchemy wss://)
    pub evm2_contract_address: String,
    pub evm2_chain_id: u64,

    // Solana
    pub solana_rpc_url: String,
    pub solana_ws_url: Option<String>, // SOLANA_WS_URL — optional, defaults to derived from RPC URL
    pub solana_private_key: String,
    pub solana_program_id: String,

    // Solana Wormhole
    pub solana_wormhole_program_id: String,
    pub solana_emitter_address: String,

    // Solana Liquid Staking
    pub liquid_staking_program_id: String,
    pub liquid_staking_pool_authority: String,

    // Wormhole API
    pub wormhole_api_url: String,

    // Strategy
    pub min_profit_bps: u64,
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

            evm_rpc_url: require_env("EVM_RPC_URL")?,
            evm_private_key: require_env("EVM_PRIVATE_KEY")?,
            evm_contract_address: require_env("EVM_CONTRACT_ADDRESS")?,
            evm_chain_id: env::var("EVM_CHAIN_ID")
                .unwrap_or_else(|_| "0".to_string())
                .parse()
                .unwrap_or(0),
            evm_emitter_address: require_env("EVM_EMITTER_ADDRESS")?,
            evm_wormhole_address: require_env("EVM_WORMHOLE_ADDRESS")?,

            evm2_rpc_url: env::var("EVM2_RPC_URL")
                .unwrap_or_else(|_| "https://sepolia.base.org".to_string()),
            evm2_ws_url: env::var("EVM2_WS_URL").ok(),
            evm2_contract_address: require_env("EVM2_CONTRACT_ADDRESS")?,
            evm2_chain_id: env::var("EVM2_CHAIN_ID")
                .unwrap_or_else(|_| "84532".to_string())
                .parse()
                .unwrap_or(84532),

            solana_rpc_url: require_env("SOLANA_RPC_URL")?,
            solana_ws_url: env::var("SOLANA_WS_URL").ok(),
            solana_private_key: require_env("SOLANA_PRIVATE_KEY")?,
            solana_program_id: require_env("SOLANA_PROGRAM_ID")?,

            solana_wormhole_program_id: require_env("SOLANA_WORMHOLE_PROGRAM_ID")?,
            solana_emitter_address: require_env("SOLANA_EMITTER_ADDRESS")?,

            liquid_staking_program_id: env::var("LIQUID_STAKING_PROGRAM_ID").unwrap_or_default(),
            liquid_staking_pool_authority: env::var("LIQUID_STAKING_POOL_AUTHORITY")
                .unwrap_or_default(),

            wormhole_api_url: env::var("WORMHOLE_RPC_URL")
                .unwrap_or_else(|_| "https://api.testnet.wormholescan.io".to_string()),

            min_profit_bps: env::var("MIN_PROFIT_BPS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()?,
        })
    }
}
