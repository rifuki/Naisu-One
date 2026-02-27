// Test file untuk debug address derivation
// Run: cargo run --bin test_address

use intent_solver::config::Config;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    color_eyre::install()?;
    
    let config = Config::load()?;
    
    println!("=== DEBUG ADDRESS DERIVATION ===\n");
    
    // SUI
    println!("SUI:");
    println!("  Private key prefix: {}...", &config.sui_private_key[..20.min(config.sui_private_key.len())]);
    
    match get_sui_address(&config) {
        Ok(addr) => {
            let addr_str = format!("{}", addr);
            println!("  Derived address: {}", addr_str);
            println!("  Expected address: 0x0B755E8fDf4239198d99B3431C44Af112a29810f");
            
            // Coba fetch balance dengan address benar (hardcoded)
            println!("\n  Fetching balance with derived address...");
            match get_sui_balance_for_address(&config, addr).await {
                Ok(bal) => println!("  Balance: {:.4} SUI", bal),
                Err(e) => println!("  Error: {}", e),
            }
        }
        Err(e) => println!("  Error deriving: {}", e),
    }
    
    // SOL
    println!("\nSOL:");
    println!("  Private key length: {} chars", config.solana_private_key.len());
    println!("  Private key: {}...", &config.solana_private_key[..32.min(config.solana_private_key.len())]);
    
    match get_solana_address(&config) {
        Ok(addr) => {
            println!("  Derived address: {}", addr);
            println!("  Expected address: 7WkNZxoz6xTScAEYQY2nohJQibvxrxevkMmMLPJNBzDW");
        }
        Err(e) => println!("  Error deriving: {}", e),
    }
    
    Ok(())
}

fn get_sui_address(config: &Config) -> eyre::Result<sui_sdk::types::base_types::SuiAddress> {
    use sui_sdk::types::crypto::SuiKeyPair;
    let keypair = SuiKeyPair::decode(&config.sui_private_key)?;
    let address = sui_sdk::types::base_types::SuiAddress::from(&keypair.public());
    Ok(address)
}

async fn get_sui_balance_for_address(
    config: &Config,
    address: sui_sdk::types::base_types::SuiAddress
) -> eyre::Result<f64> {
    use sui_sdk::SuiClientBuilder;
    
    let sui_client = SuiClientBuilder::default()
        .build(&config.sui_rpc_url)
        .await?;
    
    let coins = sui_client.coin_read_api().get_all_coins(address, None, None).await?;
    let total: u64 = coins.data.iter().map(|c| c.balance as u64).sum();
    Ok(total as f64 / 1_000_000_000.0)
}

fn get_solana_address(config: &Config) -> eyre::Result<String> {
    let key_str = &config.solana_private_key;
    println!("  Key length: {} chars", key_str.len());
    
    // Try base58 first (88 chars = standard Solana keypair format)
    if key_str.len() == 88 {
        println!("  Trying base58 decode...");
        let bytes = bs58::decode(key_str).into_vec()?;
        println!("  Decoded to {} bytes", bytes.len());
        if bytes.len() == 64 {
            println!("  Detected: 64-byte keypair (base58)");
            return Ok(bs58::encode(&bytes[32..64]).into_string());
        }
    }
    
    // Try hex
    println!("  Trying hex decode...");
    let bytes = hex::decode(key_str)?;
    println!("  Decoded to {} bytes", bytes.len());
    
    if bytes.len() == 64 {
        println!("  Detected: 64-byte keypair (hex)");
        Ok(bs58::encode(&bytes[32..64]).into_string())
    } else if bytes.len() == 32 {
        println!("  Detected: 32-byte seed (hex)");
        use ed25519_dalek::SigningKey;
        let signing_key = SigningKey::from_bytes(&bytes.try_into().unwrap());
        Ok(bs58::encode(signing_key.verifying_key().as_bytes()).into_string())
    } else {
        Err(eyre::eyre!("Invalid key length: {} bytes", bytes.len()))
    }
}
