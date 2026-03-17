use sui_sdk::SuiClientBuilder;
use sui_types::base_types::SuiAddress;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let url = std::env::var("SUI_RPC_URL").unwrap_or("https://fullnode.testnet.sui.io:443".to_string());
    let sui = SuiClientBuilder::default().build(&url).await?;
    let address = SuiAddress::from_str("0x000...").unwrap(); // Need the solver address
    let coins = sui.coin_read_api().get_coins(address, None, None, None).await?;
    println!("Got {} coins", coins.data.len());
    Ok(())
}
