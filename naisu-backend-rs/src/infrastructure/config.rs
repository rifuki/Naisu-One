use std::env;

use eyre::{Result, WrapErr};

fn require_env(key: &str) -> Result<String> {
    env::var(key).wrap_err_with(|| format!("Missing required environment variable: {key}"))
}

fn get_rust_env() -> Result<String> {
    let rust_env = require_env("RUST_ENV")?;
    if cfg!(debug_assertions) && rust_env == "production" {
        eyre::bail!("RUST_ENV cannot be 'production' in debug mode");
    } else if !cfg!(debug_assertions) && rust_env != "production" {
        eyre::bail!("RUST_ENV must be 'production' in release mode");
    } else {
        Ok(rust_env)
    }
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub cors_allowed_origins: Vec<String>,
}

impl ServerConfig {
    fn from_env() -> Result<Self> {
        let port = require_env("PORT")?
            .parse::<u16>()
            .wrap_err("PORT must be a valid u16 integer")?;
        let cors_allowed_origins = env::var("CORS_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "*".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        Ok(Self {
            port,
            cors_allowed_origins,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub rpc_url: String,
    pub ws_url: Option<String>,
    pub contract_address: String,
    pub chain_id: u64,
}

impl ChainConfig {
    fn from_env() -> Result<Self> {
        let rpc_url = require_env("BASE_SEPOLIA_RPC_URL")?;
        let ws_url = env::var("BASE_SEPOLIA_WS_URL").ok();
        let contract_address = require_env("BASE_SEPOLIA_CONTRACT_ADDRESS")?;
        let chain_id = env::var("BASE_SEPOLIA_CHAIN_ID")
            .unwrap_or_else(|_| "84532".to_string())
            .parse::<u64>()
            .wrap_err("BASE_SEPOLIA_CHAIN_ID must be a valid u64")?;

        Ok(Self {
            rpc_url,
            ws_url,
            contract_address,
            chain_id,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub rust_env: String,
    pub is_production: bool,
    pub server: ServerConfig,
    pub chain: ChainConfig,
    pub database_url: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let rust_env = get_rust_env()?;
        let is_production = rust_env == "production";
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://data/naisu.db".to_string());

        Ok(Self {
            rust_env,
            is_production,
            server: ServerConfig::from_env()?,
            chain: ChainConfig::from_env()?,
            database_url,
        })
    }
}
