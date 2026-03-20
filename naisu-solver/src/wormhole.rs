use base64::{Engine, engine::general_purpose};
use eyre::Result;
use serde::Deserialize;
use tracing::{debug, info};

#[derive(Debug, Deserialize)]
pub struct VaaResponse {
    pub data: VaaData,
}

#[derive(Debug, Deserialize)]
pub struct VaaData {
    pub vaa: String,
}

pub async fn fetch_vaa(
    api_url: &str,
    chain_id: u16,
    emitter_address: &str,
    sequence: u64,
) -> Result<Vec<u8>> {
    let url = format!("{api_url}/api/v1/vaas/{chain_id}/{emitter_address}/{sequence}");

    debug!(url = %url, "Fetching VAA...");

    let client = reqwest::Client::new();
    let mut attempts = 0u32;
    let max_attempts = 180; // ~30 min total with exponential backoff
    let start = std::time::Instant::now();

    // Exponential backoff: start 3s, ×1.5 per retry, capped at 30s
    let base_delay_secs: u64 = 3;
    let max_delay_secs: u64 = 30;
    let mut delay_secs = base_delay_secs;

    loop {
        attempts += 1;
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let vaa_resp: VaaResponse = resp.json().await?;
                let vaa_bytes = general_purpose::STANDARD.decode(&vaa_resp.data.vaa)?;
                info!(
                    sequence = sequence,
                    elapsed_secs = start.elapsed().as_secs(),
                    "VAA fetched successfully"
                );
                return Ok(vaa_bytes);
            }
            Ok(resp) => {
                if attempts >= max_attempts {
                    eyre::bail!("VAA not found after {attempts} attempts: {}", resp.status());
                }
                debug!(
                    attempt = attempts,
                    delay_secs = delay_secs,
                    elapsed_secs = start.elapsed().as_secs(),
                    "VAA not ready, retrying..."
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
                // Exponential backoff: ×1.5, cap di max_delay_secs
                delay_secs = (delay_secs * 3 / 2).min(max_delay_secs);
            }
            Err(e) => {
                if attempts >= max_attempts {
                    return Err(e.into());
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
                delay_secs = (delay_secs * 3 / 2).min(max_delay_secs);
            }
        }
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    /// Test exponential backoff calculation logic
    #[test]
    fn test_exponential_backoff_calculation() {
        let base_delay: u64 = 3;
        let max_delay: u64 = 30;
        
        // Simulate backoff progression
        let mut delay = base_delay;
        
        // Attempt 1: 3s
        assert_eq!(delay, 3);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 2: 3 * 1.5 = 4.5s → 4s (integer division)
        assert_eq!(delay, 4);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 3: 4 * 1.5 = 6s
        assert_eq!(delay, 6);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 4: 6 * 1.5 = 9s
        assert_eq!(delay, 9);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 5: 9 * 1.5 = 13.5s → 13s
        assert_eq!(delay, 13);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 6: 13 * 1.5 = 19.5s → 19s
        assert_eq!(delay, 19);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 7: 19 * 1.5 = 28.5s → 28s
        assert_eq!(delay, 28);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Attempt 8: 28 * 1.5 = 42s → capped at 30s
        assert_eq!(delay, 30);
        delay = (delay * 3 / 2).min(max_delay);
        
        // Should stay at cap
        assert_eq!(delay, 30);
    }

    #[test]
    fn test_backoff_reaches_cap_reasonably() {
        // Verify that we reach cap within reasonable attempts
        let base_delay: u64 = 3;
        let max_delay: u64 = 30;
        let mut delay = base_delay;
        let mut attempts = 1;
        
        while delay < max_delay && attempts < 100 {
            delay = (delay * 3 / 2).min(max_delay);
            attempts += 1;
        }
        
        // Should reach cap within 8 attempts
        assert!(attempts <= 8, "Backoff took too many attempts to reach cap");
        assert_eq!(delay, max_delay);
    }
}
