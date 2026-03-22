use serde::Deserialize;
use tracing::warn;

const FALLBACK_ETH_USD: f64 = 2_000.0;
const FALLBACK_SOL_USD: f64 = 90.0;
const FALLBACK_SUI_USD: f64 = 1.0;

// Pyth Hermes price feed IDs
const PYTH_ETH_ID: &str = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_SOL_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const PYTH_SUI_ID: &str = "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";

pub struct IntentPrices {
    pub start_price: String, // base units (lamports for SOL, MIST for SUI)
    pub floor_price: String,
    pub from_usd:    f64,
    pub to_usd:      f64,
}

#[derive(Deserialize)]
struct PythPriceResponse {
    parsed: Vec<PythParsed>,
}

#[derive(Deserialize)]
struct PythParsed {
    price: PythPrice,
}

#[derive(Deserialize)]
struct PythPrice {
    price: String,
    expo: i32,
}

pub enum ToChain {
    Solana,
    Sui,
}

/// Compute start_price and floor_price for an ETH→destination gasless intent.
/// `amount_wei` is the source amount as a decimal string (e.g. "1000000000000000000").
pub async fn compute_eth_to_dest_prices(amount_wei: &str, to_chain: ToChain) -> IntentPrices {
    let (eth_usd, sol_usd, sui_usd) = fetch_pyth().await.unwrap_or_else(|e| {
        warn!(error = %e, "Pyth price fetch failed — using fallback prices");
        (FALLBACK_ETH_USD, FALLBACK_SOL_USD, FALLBACK_SUI_USD)
    });

    let dest_usd = match to_chain {
        ToChain::Solana => sol_usd,
        ToChain::Sui    => sui_usd,
    };
    let dest_decimals = 1e9_f64; // SOL: lamports, SUI: MIST — both 9 decimals

    let amount_f64: f64 = amount_wei.parse().unwrap_or(0.0);
    let eth_amount  = amount_f64 / 1e18;
    let dest_amount = eth_amount * (eth_usd / dest_usd);

    // start price: 97% of fair value; floor: 80%
    let start_units = (dest_amount * 0.97 * dest_decimals) as u128;
    let floor_units = (dest_amount * 0.80 * dest_decimals) as u128;

    IntentPrices {
        start_price: start_units.to_string(),
        floor_price: floor_units.to_string(),
        from_usd:    eth_usd,
        to_usd:      dest_usd,
    }
}

/// Backwards-compatible alias for Solana (ETH→SOL).
pub async fn compute_eth_to_sol_prices(amount_wei: &str) -> IntentPrices {
    compute_eth_to_dest_prices(amount_wei, ToChain::Solana).await
}

fn parse_pyth_price(parsed: &PythParsed) -> f64 {
    let raw: f64 = parsed.price.price.parse().unwrap_or(0.0);
    let expo = parsed.price.expo;
    raw * 10f64.powi(expo)
}

async fn fetch_pyth() -> eyre::Result<(f64, f64, f64)> {
    let ids = format!(
        "ids[]={}&ids[]={}&ids[]={}",
        PYTH_ETH_ID, PYTH_SOL_ID, PYTH_SUI_ID
    );
    let url = format!("https://hermes.pyth.network/v2/updates/price/latest?{ids}");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let resp: PythPriceResponse = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await?
        .json()
        .await?;

    if resp.parsed.len() < 3 {
        eyre::bail!("Pyth returned fewer than 3 price feeds");
    }

    let eth = parse_pyth_price(&resp.parsed[0]);
    let sol = parse_pyth_price(&resp.parsed[1]);
    let sui = parse_pyth_price(&resp.parsed[2]);

    Ok((eth, sol, sui))
}
