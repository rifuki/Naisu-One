use sui_sdk::types::base_types::SuiAddress;
use sui_sdk::SuiClientBuilder;
use std::str::FromStr;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    println!("Connecting to Sui Testnet...");
    let sui = SuiClientBuilder::default()
        .build("https://fullnode.testnet.sui.io:443")
        .await?;

    let address = SuiAddress::from_str("0xb551e15fa68cdd2cb08a70bc152e9f029ce7cbe79edaa2dd3337e7534d0b1686").unwrap(); // Solver address

    println!("1. Fetching gas price...");
    let start = Instant::now();
    let gas_price = sui.read_api().get_reference_gas_price().await?;
    println!("Gas price: {} (took {:?})", gas_price, start.elapsed());

    println!("2. Fetching coins...");
    let start = Instant::now();
    let coins = sui.coin_read_api().get_coins(address, None, None, Some(1)).await?;
    println!("Got {} coins (took {:?})", coins.data.len(), start.elapsed());
    
    Ok(())
}
