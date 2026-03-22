use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::{Router, routing::get};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::warn;

use crate::infrastructure::web::response::ApiSuccess;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct YieldRate {
    pub id:               &'static str,
    pub name:             &'static str,
    pub apy:              f64,
    #[serde(rename = "apyRaw")]
    pub apy_raw:          f64,
    #[serde(rename = "outputToken")]
    pub output_token:     &'static str,
    #[serde(rename = "receiveLabel")]
    pub receive_label:    &'static str,
    #[serde(rename = "riskLevel")]
    pub risk_level:       &'static str,
    #[serde(rename = "riskLabel")]
    pub risk_label:       &'static str,
    pub description:      &'static str,
    #[serde(rename = "devnetSupported")]
    pub devnet_supported: bool,
    #[serde(rename = "lastUpdated")]
    pub last_updated:     u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error:            Option<String>,
}

#[derive(Debug, Deserialize)]
struct MarinadeResponse {
    apy: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DefiLlamaPool {
    pool:    String,
    apy:     Option<f64>,
    #[serde(rename = "apyMean30d")]
    apy_mean: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DefiLlamaResponse {
    data: Vec<DefiLlamaPool>,
}

// ─── Fallbacks ────────────────────────────────────────────────────────────────

const FALLBACK_MARINADE: f64 = 0.0706;
const FALLBACK_JITO:     f64 = 0.059;
const FALLBACK_JUPSOL:   f64 = 0.0624;
const FALLBACK_KAMINO:   f64 = 0.038;
const CACHE_TTL: Duration    = Duration::from_secs(300); // 5 min

// DeFiLlama pool IDs
const POOL_MARINADE: &str = "b3f93865-5ec8-4662-90a0-11808e0aa2bd";
const POOL_JITO:     &str = "0e7d0722-9054-4907-8593-567b353c0900";
const POOL_JUPSOL:   &str = "52bd72a7-9e81-4112-abb4-71673e8de9bf";
const POOL_KAMINO:   &str = "525b2dab-ea6a-4cbc-a07f-84ce561d1f83";

// ─── Cache ────────────────────────────────────────────────────────────────────

struct Cache {
    rates:      Vec<YieldRate>,
    fetched_at: Instant,
}

static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<Cache>> {
    CACHE.get_or_init(|| Mutex::new(None))
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async fn fetch_marinade_apy() -> (f64, Option<String>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    match client.get("https://api.marinade.finance/tlv").send().await {
        Err(e) => (FALLBACK_MARINADE, Some(format!("Marinade API error: {e}"))),
        Ok(res) if !res.status().is_success() => (
            FALLBACK_MARINADE,
            Some(format!("Marinade API error: HTTP {}", res.status())),
        ),
        Ok(res) => match res.json::<MarinadeResponse>().await {
            Ok(data) => match data.apy {
                Some(raw) => (raw, None),
                None => (FALLBACK_MARINADE, Some("Missing apy field in Marinade response".into())),
            },
            Err(e) => (FALLBACK_MARINADE, Some(format!("Marinade parse error: {e}"))),
        },
    }
}

/// Fetch APY for a specific pool from DeFiLlama yields API.
/// Returns (apy_raw, error_message).
async fn fetch_defillama_apy(pool_id: &str, fallback: f64) -> (f64, Option<String>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let res = match client
        .get("https://yields.llama.fi/pools")
        .send()
        .await
    {
        Err(e) => return (fallback, Some(format!("DeFiLlama API error: {e}"))),
        Ok(r) if !r.status().is_success() => {
            return (fallback, Some(format!("DeFiLlama API error: HTTP {}", r.status())))
        }
        Ok(r) => r,
    };

    let data: DefiLlamaResponse = match res.json().await {
        Ok(v) => v,
        Err(e) => return (fallback, Some(format!("DeFiLlama parse error: {e}"))),
    };

    let pool = data.data.into_iter().find(|p| p.pool == pool_id);
    match pool {
        None => (fallback, Some(format!("Pool {pool_id} not found in DeFiLlama response"))),
        Some(p) => {
            // Prefer live APY, fall back to 30d mean
            let raw = p.apy.filter(|v| v.is_finite() && *v > 0.0)
                .or_else(|| p.apy_mean.filter(|v| v.is_finite() && *v > 0.0))
                .unwrap_or(fallback * 100.0); // DeFiLlama returns % (e.g. 7.06 not 0.0706)
            let normalized = if raw > 1.0 { raw / 100.0 } else { raw };
            (normalized, None)
        }
    }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

fn to_percent(raw: f64) -> f64 {
    if raw < 1.0 { raw * 100.0 } else { raw }
}

pub async fn get_yield_rates() -> ApiSuccess<Vec<YieldRate>> {
    let mut guard = cache().lock().await;

    // Return cached if fresh
    if let Some(ref c) = *guard {
        if c.fetched_at.elapsed() < CACHE_TTL {
            return ApiSuccess::default().with_data(c.rates.clone());
        }
    }

    // Fetch all in parallel — Marinade has its own API, rest from DeFiLlama
    let (marinade, jito, jupsol, kamino) = tokio::join!(
        fetch_marinade_apy(),
        fetch_defillama_apy(POOL_JITO,   FALLBACK_JITO),
        fetch_defillama_apy(POOL_JUPSOL, FALLBACK_JUPSOL),
        fetch_defillama_apy(POOL_KAMINO, FALLBACK_KAMINO),
    );

    // Marinade: also try DeFiLlama as cross-check if its own API gives fallback
    let marinade_apy = if marinade.1.is_some() {
        // Marinade API failed — try DeFiLlama
        let (llama_rate, llama_err) = fetch_defillama_apy(POOL_MARINADE, FALLBACK_MARINADE).await;
        if llama_err.is_none() { llama_rate } else { marinade.0 }
    } else {
        marinade.0
    };

    if let Some(ref e) = marinade.1  { warn!(error = %e, "Marinade APY fetch failed, using fallback"); }
    if let Some(ref e) = jito.1      { warn!(error = %e, "Jito APY fetch failed, using fallback"); }
    if let Some(ref e) = jupsol.1    { warn!(error = %e, "Jupiter APY fetch failed, using fallback"); }
    if let Some(ref e) = kamino.1    { warn!(error = %e, "Kamino APY fetch failed, using fallback"); }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let rates = vec![
        YieldRate {
            id:               "marinade",
            name:             "Marinade Finance",
            apy:              to_percent(marinade_apy),
            apy_raw:          marinade_apy,
            output_token:     "msol",
            receive_label:    "mSOL",
            risk_level:       "low",
            risk_label:       "Liquid staking",
            description:      "Stake SOL and receive liquid mSOL tokens earning native staking rewards.",
            devnet_supported: true,
            last_updated:     now,
            error:            marinade.1,
        },
        YieldRate {
            id:               "jito",
            name:             "Jito",
            apy:              to_percent(jito.0),
            apy_raw:          jito.0,
            output_token:     "jito",
            receive_label:    "jitoSOL",
            risk_level:       "low",
            risk_label:       "Liquid staking + MEV",
            description:      "Stake SOL with Jito and earn native staking rewards plus MEV tips from block builders.",
            devnet_supported: true,
            last_updated:     now,
            error:            jito.1,
        },
        YieldRate {
            id:               "jupsol",
            name:             "Jupiter",
            apy:              to_percent(jupsol.0),
            apy_raw:          jupsol.0,
            output_token:     "jupsol",
            receive_label:    "jupSOL",
            risk_level:       "low",
            risk_label:       "Liquid staking",
            description:      "Stake SOL via Jupiter's liquid staking and receive jupSOL tokens with competitive APY.",
            devnet_supported: true,
            last_updated:     now,
            error:            jupsol.1,
        },
        YieldRate {
            id:               "kamino",
            name:             "Kamino Finance",
            apy:              to_percent(kamino.0),
            apy_raw:          kamino.0,
            output_token:     "kamino",
            receive_label:    "kSOL",
            risk_level:       "medium",
            risk_label:       "Lending protocol",
            description:      "Lend SOL on Kamino Finance and earn variable lending interest from borrowers.",
            devnet_supported: true,
            last_updated:     now,
            error:            kamino.1,
        },
    ];

    *guard = Some(Cache { rates: rates.clone(), fetched_at: Instant::now() });

    ApiSuccess::default().with_data(rates)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

pub fn yield_routes() -> Router<crate::state::AppState> {
    Router::new().route("/rates", get(get_yield_rates))
}
