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

// ─── Fallbacks ────────────────────────────────────────────────────────────────

const FALLBACK_MARINADE: f64 = 0.065;
const FALLBACK_MARGINFI: f64 = 0.078;
const CACHE_TTL: Duration    = Duration::from_secs(300); // 5 min

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

async fn fetch_marginfi_apy() -> (f64, Option<String>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    let res = match client
        .get("https://marginfi-v2-ui-data.vercel.app/banks")
        .send()
        .await
    {
        Err(e) => return (FALLBACK_MARGINFI, Some(format!("marginfi API error: {e}"))),
        Ok(r) if !r.status().is_success() => {
            return (FALLBACK_MARGINFI, Some(format!("marginfi API error: HTTP {}", r.status())))
        }
        Ok(r) => r,
    };

    let raw: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return (FALLBACK_MARGINFI, Some(format!("marginfi parse error: {e}"))),
    };

    let banks = if raw.is_array() {
        raw.as_array().cloned().unwrap_or_default()
    } else {
        raw.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default()
    };

    const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
    let sol_bank = banks.iter().find(|b| {
        b.get("tokenSymbol").and_then(|v| v.as_str()) == Some("SOL")
            || b.get("mint").and_then(|v| v.as_str()) == Some(SOL_MINT)
    });

    let Some(bank) = sol_bank else {
        return (FALLBACK_MARGINFI, Some("SOL bank not found in marginfi response".into()));
    };

    let apy_raw = ["lendingRate", "depositRate", "supplyApy"]
        .iter()
        .find_map(|&key| bank.get(key)?.as_f64().filter(|&v| v > 0.0));

    match apy_raw {
        None => (FALLBACK_MARGINFI, Some("Could not find non-zero lending rate in marginfi SOL bank".into())),
        Some(r) => {
            let normalized = if r > 1.0 { r / 100.0 } else { r };
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

    // Fetch both in parallel
    let (marinade, marginfi) = tokio::join!(fetch_marinade_apy(), fetch_marginfi_apy());

    if let Some(ref e) = marinade.1 { warn!(error = %e, "Marinade APY fetch failed, using fallback"); }
    if let Some(ref e) = marginfi.1 { warn!(error = %e, "marginfi APY fetch failed, using fallback"); }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let rates = vec![
        YieldRate {
            id:               "marinade",
            name:             "Marinade Finance",
            apy:              to_percent(marinade.0),
            apy_raw:          marinade.0,
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
            id:               "marginfi",
            name:             "marginfi",
            apy:              to_percent(marginfi.0),
            apy_raw:          marginfi.0,
            output_token:     "marginfi",
            receive_label:    "SOL (marginfi)",
            risk_level:       "medium",
            risk_label:       "Variable lending",
            description:      "Lend SOL on marginfi lending protocol and earn variable interest from borrowers.",
            devnet_supported: false,
            last_updated:     now,
            error:            marginfi.1,
        },
    ];

    *guard = Some(Cache { rates: rates.clone(), fetched_at: Instant::now() });

    ApiSuccess::default().with_data(rates)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

pub fn yield_routes() -> Router<crate::state::AppState> {
    Router::new().route("/rates", get(get_yield_rates))
}
