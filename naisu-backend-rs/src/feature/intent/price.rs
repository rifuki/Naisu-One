use serde::Deserialize;
use tracing::warn;

const FALLBACK_ETH_USD: f64 = 3_000.0;
const FALLBACK_SOL_USD: f64 = 150.0;

pub struct IntentPrices {
    pub start_price: String, // lamports, string uint256
    pub floor_price: String,
    pub from_usd:    f64,
    pub to_usd:      f64,
}

#[derive(Deserialize)]
struct CoinGeckoResponse {
    ethereum: Option<CgCoin>,
    solana:   Option<CgCoin>,
}

#[derive(Deserialize)]
struct CgCoin {
    usd: f64,
}

/// Compute start_price and floor_price (in lamports) for an ETH→SOL gasless intent.
/// `amount_wei` is the source amount as a decimal string (e.g. "1000000000000000000").
pub async fn compute_eth_to_sol_prices(amount_wei: &str) -> IntentPrices {
    let (eth_usd, sol_usd) = fetch_coingecko().await.unwrap_or_else(|e| {
        warn!(error = %e, "CoinGecko price fetch failed — using fallback prices");
        (FALLBACK_ETH_USD, FALLBACK_SOL_USD)
    });

    let amount_f64: f64 = amount_wei.parse().unwrap_or(0.0);
    let eth_amount  = amount_f64 / 1e18;
    let sol_amount  = eth_amount * (eth_usd / sol_usd);

    // start price: 97% of fair value (solver pays at least 97%)
    // floor price: 80% of fair value (minimum price before auction ends)
    let start_lamports = (sol_amount * 0.97 * 1e9) as u128;
    let floor_lamports = (sol_amount * 0.80 * 1e9) as u128;

    IntentPrices {
        start_price: start_lamports.to_string(),
        floor_price: floor_lamports.to_string(),
        from_usd:    eth_usd,
        to_usd:      sol_usd,
    }
}

async fn fetch_coingecko() -> eyre::Result<(f64, f64)> {
    let url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd";
    let resp: CoinGeckoResponse = reqwest::get(url).await?.json().await?;

    let eth = resp.ethereum.map(|c| c.usd).unwrap_or(FALLBACK_ETH_USD);
    let sol = resp.solana.map(|c| c.usd).unwrap_or(FALLBACK_SOL_USD);

    Ok((eth, sol))
}
