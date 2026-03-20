use std::time::Duration;

use tracing::{info, warn};

use crate::{
    AppState,
    feature::intent::events::{SolverProgressEvent, SseEventType},
};

use super::model::{RawQuote, RfqResult, ScoredQuote};

const RFQ_TIMEOUT: Duration = Duration::from_secs(3);
const EXCLUSIVITY_WINDOW_MS: i64 = 30_000;

// ─── Public entry point ───────────────────────────────────────────────────────

/// Broadcast an RFQ for a gasless intent, collect quotes, score, pick winner,
/// send execute message to winner, and emit SSE events.
///
/// Returns None if no eligible solvers are available.
pub async fn broadcast_rfq(state: &AppState, intent_id: &str) -> Option<RfqResult> {
    // Get pending intent (needs signature + intent fields for execute message)
    let pending = state.intent_store.gasless.get(intent_id)?.clone();
    let rfq_sent_at = chrono::Utc::now().timestamp_millis();

    // Find eligible solvers for this route
    let eligible = state.solver_registry.eligible_for_route("evm-base→solana");

    if eligible.is_empty() {
        warn!(intent_id = %intent_id, "No eligible solvers for RFQ broadcast");
        return None;
    }

    info!(
        intent_id = %intent_id,
        solver_count = eligible.len(),
        "Broadcasting RFQ to solvers"
    );

    // Emit rfq_broadcast SSE immediately (frontend shows "Broadcasting RFQ...")
    let _ = state.event_tx.send(SolverProgressEvent {
        event_type: SseEventType::RfqBroadcast,
        order_id: intent_id.to_string(),
        user_addr: None,
        data: serde_json::json!({
            "solverCount": eligible.len(),
            "solverNames": eligible.iter().map(|(_, name)| name).collect::<Vec<_>>(),
        }),
    });

    // Create collector and get early-completion notify receiver
    let notify_rx = state.solver_registry.create_collector(
        intent_id.to_string(),
        eligible.len(),
    );

    // Send RFQ message to each eligible solver
    let rfq_msg = serde_json::json!({
        "type": "rfq",
        "orderId": intent_id,
        "startPrice": pending.intent.start_price,
        "floorPrice": pending.intent.floor_price,
        "deadline": pending.intent.deadline,
        "amount": pending.intent.amount,
    });

    for (solver_id, _) in &eligible {
        state.solver_registry.send(solver_id, &rfq_msg).await;
    }

    // Wait for all quotes or 3s timeout
    tokio::select! {
        _ = notify_rx => {
            info!(intent_id = %intent_id, "All quotes received early — proceeding to auction");
        }
        _ = tokio::time::sleep(RFQ_TIMEOUT) => {
            info!(intent_id = %intent_id, "RFQ timeout — resolving with partial quotes");
        }
    }

    // Collect quotes and remove collector
    let raw_quotes = state.solver_registry.take_quotes(intent_id);

    // Score all received quotes
    let scored = score_quotes(&raw_quotes, state);

    // Select winner
    let (winner_quote, reasoning) = select_winner(&scored, state);

    let mut winner_name: Option<String> = None;
    let mut winner_id: Option<String> = None;
    let mut winner_address: Option<String> = None;
    let mut exclusivity_deadline: Option<i64> = None;

    if let Some(ref wq) = winner_quote {
        winner_name = Some(wq.solver_name.clone());
        winner_id = Some(wq.solver_id.clone());

        // Look up winner EVM address
        winner_address = state.solver_registry.sessions
            .get(&wq.solver_id)
            .map(|s| s.info.evm_address.clone());

        // Increment totalRFQAccepted
        if let Some(mut session) = state.solver_registry.sessions.get_mut(&wq.solver_id) {
            session.info.total_rfq_accepted += 1;
        }

        // Track exclusive window for fade detection
        let deadline = chrono::Utc::now().timestamp_millis() + EXCLUSIVITY_WINDOW_MS;
        exclusivity_deadline = Some(deadline);
        state.solver_registry.set_exclusive(
            intent_id.to_string(),
            wq.solver_id.clone(),
            deadline,
        );

        // Emit rfq_winner SSE
        let _ = state.event_tx.send(SolverProgressEvent {
            event_type: SseEventType::RfqWinner,
            order_id: intent_id.to_string(),
            user_addr: None,
            data: serde_json::json!({
                "winner": wq.solver_name,
                "winnerId": wq.solver_id,
                "score": wq.score,
                "reasoning": reasoning,
                "quotedPrice": wq.quoted_price,
                "estimatedETA": wq.estimated_eta,
                "exclusivityDeadline": deadline,
            }),
        });

        // Send execute message to winner
        let execute_msg = serde_json::json!({
            "type": "execute",
            "intentId": intent_id,
            "intent": {
                "creator":          pending.intent.creator,
                "recipient":        pending.intent.recipient,
                "destinationChain": pending.intent.destination_chain,
                "amount":           pending.intent.amount,
                "startPrice":       pending.intent.start_price,
                "floorPrice":       pending.intent.floor_price,
                "deadline":         pending.intent.deadline,
                "intentType":       pending.intent.intent_type,
                "nonce":            pending.intent.nonce,
            },
            "signature":       pending.signature,
            "contractAddress": state.config.chain.contract_address,
            "chainId":         state.config.chain.chain_id,
            "rpcUrl":          state.config.chain.rpc_url,
        });

        state.solver_registry.send(&wq.solver_id, &execute_msg).await;
        info!(
            intent_id = %intent_id,
            winner = %wq.solver_name,
            score = wq.score,
            "Execute message sent to winner"
        );
    } else {
        warn!(intent_id = %intent_id, "No quotes received — RFQ failed");
    }

    let result = RfqResult {
        order_id: intent_id.to_string(),
        rfq_sent_at,
        quotes: scored,
        winner: winner_name,
        winner_id,
        winner_address,
        reasoning,
        exclusivity_deadline,
    };

    state.solver_registry.rfq_results.insert(intent_id.to_string(), result.clone());

    Some(result)
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

fn score_quotes(quotes: &[RawQuote], state: &AppState) -> Vec<ScoredQuote> {
    if quotes.is_empty() {
        return Vec::new();
    }

    let prices: Vec<f64> = quotes
        .iter()
        .map(|q| q.quoted_price.parse::<f64>().unwrap_or(0.0))
        .collect();
    let etas: Vec<f64> = quotes.iter().map(|q| q.estimated_eta as f64).collect();

    let best_price = prices.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let fastest_eta = etas.iter().cloned().fold(f64::INFINITY, f64::min);

    let mut scored: Vec<ScoredQuote> = quotes
        .iter()
        .zip(prices.iter())
        .zip(etas.iter())
        .map(|((q, &price), &eta)| {
            let session = state.solver_registry.sessions.get(&q.solver_id);

            let price_score = if best_price > 0.0 {
                (price / best_price) * 50.0
            } else {
                50.0
            };

            let rel_score = session
                .as_ref()
                .map(|s| (s.info.reliability_score / 100.0) * 25.0)
                .unwrap_or(0.0);

            let speed_score = if eta > 0.0 && fastest_eta > 0.0 {
                (fastest_eta / eta) * 15.0
            } else {
                15.0
            };

            let liquidity_score = session
                .as_ref()
                .map(|s| {
                    if s.info.solana_balance.parse::<f64>().unwrap_or(0.0) > 0.0 {
                        10.0
                    } else {
                        0.0
                    }
                })
                .unwrap_or(0.0);

            let raw_score = price_score + rel_score + speed_score + liquidity_score;
            let score = (raw_score * 10.0).round() / 10.0;

            ScoredQuote {
                solver_id: q.solver_id.clone(),
                solver_name: q.solver_name.clone(),
                quoted_price: q.quoted_price.clone(),
                estimated_eta: q.estimated_eta,
                expires_at: q.expires_at,
                score,
                winner: false,
            }
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

// ─── Winner selection ─────────────────────────────────────────────────────────

fn select_winner(
    scored: &[ScoredQuote],
    state: &AppState,
) -> (Option<ScoredQuote>, String) {
    if scored.is_empty() {
        return (None, "No quotes received".to_string());
    }

    let is_veteran = |solver_id: &str| -> bool {
        state.solver_registry.sessions
            .get(solver_id)
            .map(|s| s.info.total_fills >= 10)
            .unwrap_or(false)
    };

    let veterans: Vec<&ScoredQuote> = scored.iter().filter(|q| is_veteran(&q.solver_id)).collect();
    let newbies: Vec<&ScoredQuote> = scored.iter().filter(|q| !is_veteran(&q.solver_id)).collect();

    // 20% chance to give the slot to the best newbie when veterans exist
    let (winner_q, reasoning) = if !newbies.is_empty()
        && !veterans.is_empty()
        && rand_bool(0.20)
    {
        let wq = newbies[0];
        (wq, format!("New solver opportunity: {} selected (20% slot)", wq.solver_name))
    } else {
        let wq = &scored[0];
        let reason = if scored.len() > 1 {
            format!(
                "Best overall score: {:.1} vs {:.1} — {} wins",
                wq.score, scored[1].score, wq.solver_name
            )
        } else {
            format!("Only quote received — {} wins", wq.solver_name)
        };
        (wq, reason)
    };

    let mut winner = winner_q.clone();
    winner.winner = true;
    (Some(winner), reasoning)
}

/// Simple pseudo-random bool with given probability (no external RNG dep).
fn rand_bool(prob: f64) -> bool {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0) as f64;
    (ns % 1_000_000.0) / 1_000_000.0 < prob
}
