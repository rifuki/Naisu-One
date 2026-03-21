use alloy::{
    primitives::{Address, FixedBytes, U256},
    providers::ProviderBuilder,
    sol,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::Deserialize;
use tracing::{info, warn};

use crate::{
    AppState,
    feature::solver::auction,
    infrastructure::{db::intent_repo, web::response::{ApiError, ApiResult, ApiSuccess}},
};

use super::{
    eip712::{self, IntentParams},
    model::{IntentDetails, IntentOrder, IntentStatus, OrderStatus, SupportedChain},
    orderbook,
    price,
};

// ─── On-chain nonce helper ────────────────────────────────────────────────────

sol! {
    #[sol(rpc)]
    interface IIntentBridge {
        function nonces(address user) external view returns (uint256);
    }
}

async fn read_onchain_nonce(state: &AppState, user: Address) -> eyre::Result<u64> {
    let url: alloy::transports::http::reqwest::Url = state.config.chain.rpc_url.parse()?;
    let provider      = ProviderBuilder::new().connect_http(url);
    let contract_addr: Address = state.config.chain.contract_address.parse()?;
    let contract      = IIntentBridge::new(contract_addr, &provider);
    let nonce = contract.nonces(user).call().await?;
    Ok(nonce.to::<u64>())
}

// ─── GET /orders ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OrdersQuery {
    pub user: String,
    pub chain: Option<SupportedChain>,
}

pub async fn get_orders(
    State(state): State<AppState>,
    Query(params): Query<OrdersQuery>,
) -> ApiResult<serde_json::Value> {
    info!(user = %params.user, chain = ?params.chain, "Intent orders requested");

    let orders = orderbook::get_orders_by_user(
        &state.intent_store,
        &params.user,
        params.chain.as_ref(),
    );

    Ok(ApiSuccess::default().with_data(serde_json::to_value(orders).unwrap_or_default()))
}

// ─── GET /nonce ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct NonceQuery {
    pub address: String,
}

pub async fn get_nonce(
    State(state): State<AppState>,
    Query(params): Query<NonceQuery>,
) -> ApiResult<serde_json::Value> {
    // Basic EVM address validation
    if !is_valid_evm_address(&params.address) {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Must be a valid EVM address (0x + 40 hex chars)"));
    }

    info!(address = %params.address, "Nonce requested");

    let addr: Address = params.address.parse().unwrap_or_default();
    let nonce = match read_onchain_nonce(&state, addr).await {
        Ok(n) => {
            info!(address = %params.address, nonce = n, "Got onchain nonce");
            n
        }
        Err(e) => {
            warn!(error = %e, address = %params.address, "Onchain nonce failed, using cache");
            orderbook::get_cached_nonce(&state.intent_store, &params.address).unwrap_or(0)
        }
    };

    let data = serde_json::json!({
        "address": params.address,
        "nonce": nonce,
        "message": "Include this nonce in your next signed intent",
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── PATCH /orders/:intentId/cancel ──────────────────────────────────────────

pub async fn cancel_order(
    State(state): State<AppState>,
    Path(intent_id): Path<String>,
) -> ApiResult<serde_json::Value> {
    info!(intent_id = %intent_id, "Off-chain intent cancel requested");

    let cancelled = orderbook::cancel_intent(&state.intent_store, &intent_id);

    if !cancelled {
        return Err(ApiError::default()
            .with_code(StatusCode::NOT_FOUND)
            .with_message("Intent not found or cannot be cancelled"));
    }

    // Persist cancellation
    {
        let db  = state.db.clone();
        let oid = intent_id.clone();
        tokio::spawn(async move {
            intent_repo::update_order_status(&db, &oid, &super::model::OrderStatus::Cancelled, None).await;
            intent_repo::update_gasless_status(&db, &oid, &IntentStatus::Cancelled, None).await;
        });
    }

    let data = serde_json::json!({
        "intentId": intent_id,
        "status": "cancelled",
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /orderbook/stats ─────────────────────────────────────────────────────

pub async fn get_orderbook_stats(
    State(state): State<AppState>,
) -> ApiResult<serde_json::Value> {
    let gasless = &state.intent_store.gasless;
    let total = gasless.len();

    let mut by_status = std::collections::HashMap::new();
    for entry in gasless.iter() {
        let key = format!("{:?}", entry.status).to_lowercase();
        *by_status.entry(key).or_insert(0usize) += 1;
    }

    let data = serde_json::json!({
        "total": total,
        "byStatus": by_status,
        "ordersInStore": state.intent_store.orders.len(),
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── POST /build-gasless ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildGaslessBody {
    pub sender_address:    String,
    pub recipient_address: String,
    pub destination_chain: String, // "solana" | "sui"
    pub amount:            String, // ETH amount, e.g. "0.1"
    pub duration_seconds:  Option<u64>,
    pub output_token:      Option<String>, // "sol" | "msol"
}

pub async fn build_gasless(
    State(state): State<AppState>,
    Json(body): Json<BuildGaslessBody>,
) -> ApiResult<serde_json::Value> {
    if !is_valid_evm_address(&body.sender_address) {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("senderAddress must be a valid EVM address"));
    }

    let amount_f64: f64 = body.amount.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("amount must be a positive number string")
    })?;
    if amount_f64 <= 0.0 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("amount must be positive"));
    }

    info!(
        sender = %body.sender_address,
        dest   = %body.destination_chain,
        amount = %body.amount,
        "Build gasless intent requested"
    );

    // Convert human ETH → wei string for price computation
    let amount_wei = format!("{}", (amount_f64 * 1e18) as u128);
    let prices = price::compute_eth_to_sol_prices(&amount_wei).await;

    let sender_addr: Address = body.sender_address.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid sender address")
    })?;

    let nonce = match read_onchain_nonce(&state, sender_addr).await {
        Ok(n) => n,
        Err(e) => {
            warn!(error = %e, sender = %body.sender_address, "Failed to read on-chain nonce");
            0
        }
    };

    let duration_secs  = body.duration_seconds.unwrap_or(300);
    let active_solvers = state.solver_registry.active_count();
    let solver_warning = if active_solvers == 0 {
        Some("No solver is currently online. Your intent will be submitted but may not fill before the deadline.")
    } else {
        None
    };

    let mut data = serde_json::json!({
        "type":             "gasless_intent",
        "recipientAddress": body.recipient_address,
        "destinationChain": body.destination_chain,
        "amount":           body.amount,
        "amountWei":        amount_wei,
        "outputToken":      body.output_token.unwrap_or_else(|| "sol".to_string()),
        "startPrice":       prices.start_price,
        "floorPrice":       prices.floor_price,
        "durationSeconds":  duration_secs,
        "nonce":            nonce,
        "fromUsd":          prices.from_usd,
        "toUsd":            prices.to_usd,
    });

    if let Some(warning) = solver_warning {
        data["solverWarning"] = serde_json::json!(warning);
    }

    Ok(ApiSuccess::default().with_data(data))
}

// ─── POST /submit-signature ───────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GaslessIntentPayload {
    pub creator:           String,
    pub recipient:         String, // bytes32 hex, 0x + 64 chars
    pub destination_chain: u16,
    pub amount:            String, // wei
    pub start_price:       String,
    pub floor_price:       String,
    pub deadline:          i64,    // unix seconds
    pub intent_type:       u8,
    pub nonce:             u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitIntentBody {
    pub intent: GaslessIntentPayload,
    pub signature:         String, // 0x + 130 hex chars
}

pub async fn submit_signature(
    State(state): State<AppState>,
    Json(body): Json<SubmitIntentBody>,
) -> ApiResult<serde_json::Value> {
    // ── Basic validation ──────────────────────────────────────────────────────
    if !body.intent.creator.starts_with("0x") || body.intent.creator.len() != 42 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("creator must be a valid EVM address (0x + 40 hex chars)"));
    }
    if !body.intent.recipient.starts_with("0x") || body.intent.recipient.len() != 66 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("recipient must be bytes32 hex (0x + 64 chars)"));
    }
    if !body.signature.starts_with("0x") || body.signature.len() != 132 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("signature must be 0x + 130 hex chars (65 bytes)"));
    }

    let now_secs = Utc::now().timestamp();
    if body.intent.deadline <= now_secs {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Intent deadline has already passed"));
    }

    info!(
        creator          = %body.intent.creator,
        amount           = %body.intent.amount,
        destination_chain = body.intent.destination_chain,
        nonce            = body.intent.nonce,
        "Gasless intent signature submitted"
    );

    // ── Parse address ─────────────────────────────────────────────────────────
    let creator_addr: Address = body.intent.creator.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid creator address")
    })?;

    // ── Verify on-chain nonce ─────────────────────────────────────────────────
    match read_onchain_nonce(&state, creator_addr).await {
        Ok(onchain_nonce) => {
            if body.intent.nonce != onchain_nonce {
                warn!(
                    creator       = %body.intent.creator,
                    intent_nonce  = body.intent.nonce,
                    onchain_nonce = onchain_nonce,
                    "Stale nonce rejected"
                );
                return Err(ApiError::default()
                    .with_code(StatusCode::BAD_REQUEST)
                    .with_message(&format!(
                        "Stale nonce: signed with {} but contract expects {}. Please start a new bridge request.",
                        body.intent.nonce, onchain_nonce
                    )));
            }
        }
        Err(e) => {
            warn!(error = %e, creator = %body.intent.creator, "Nonce check failed — proceeding without on-chain verify");
        }
    }

    // ── Parse recipient bytes32 ───────────────────────────────────────────────
    let recipient_hex = body.intent.recipient.strip_prefix("0x").unwrap_or(&body.intent.recipient);
    let recipient_bytes = hex::decode(recipient_hex).map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("recipient is not valid hex")
    })?;
    let mut recipient_arr = [0u8; 32];
    recipient_arr.copy_from_slice(&recipient_bytes);
    let recipient: FixedBytes<32> = FixedBytes::from(recipient_arr);

    // ── Parse amounts ─────────────────────────────────────────────────────────
    let parse_u256 = |s: &str, field: &str| -> Result<U256, ApiError> {
        s.parse::<U256>().map_err(|_| {
            ApiError::default()
                .with_code(StatusCode::BAD_REQUEST)
                .with_message(&format!("{field} must be a valid uint256 string"))
        })
    };

    let amount      = parse_u256(&body.intent.amount, "amount")?;
    let start_price = parse_u256(&body.intent.start_price, "startPrice")?;
    let floor_price = parse_u256(&body.intent.floor_price, "floorPrice")?;
    let deadline    = U256::from(body.intent.deadline as u64);
    let nonce       = U256::from(body.intent.nonce);

    // ── EIP-712 verify ────────────────────────────────────────────────────────
    let params = IntentParams {
        creator: creator_addr,
        recipient,
        destination_chain: body.intent.destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        intent_type: body.intent.intent_type,
        nonce,
    };

    let valid = eip712::verify_intent_signature(&params, &body.signature, &state.config.chain)
        .map_err(|e| {
            ApiError::default()
                .with_code(StatusCode::BAD_REQUEST)
                .with_message(&format!("Signature verification error: {e}"))
        })?;

    if !valid {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid signature — recovered address does not match creator"));
    }

    // ── Generate intent ID ────────────────────────────────────────────────────
    let raw = format!("{}{}{}", body.intent.creator, body.intent.nonce, Utc::now().timestamp_millis());
    let intent_id = format!(
        "0x{}",
        &hex::encode(raw.as_bytes())[..64]
    );

    // ── Build IntentDetails ───────────────────────────────────────────────────
    let details = IntentDetails {
        creator:           body.intent.creator.clone(),
        recipient:         body.intent.recipient.clone(),
        destination_chain: body.intent.destination_chain,
        amount:            body.intent.amount.clone(),
        start_price:       body.intent.start_price.clone(),
        floor_price:       body.intent.floor_price.clone(),
        deadline:          body.intent.deadline,
        intent_type:       body.intent.intent_type,
        nonce:             body.intent.nonce,
    };

    // ── Build injected IntentOrder (visible in GET /orders immediately) ───────
    let amount_eth = {
        let val: u128 = body.intent.amount.parse().unwrap_or(0);
        let whole = val / 1_000_000_000_000_000_000u128;
        let frac  = (val % 1_000_000_000_000_000_000u128) / 1_000_000_000_000u128;
        format!("{whole}.{frac:06}")
    };
    let deadline_ms  = body.intent.deadline * 1000;
    let now_ms       = Utc::now().timestamp_millis();

    let injected = IntentOrder {
        order_id:          intent_id.clone(),
        chain:             SupportedChain::EvmBase,
        creator:           body.intent.creator.clone(),
        recipient:         hex::encode(&recipient_bytes),
        destination_chain: body.intent.destination_chain,
        amount:            amount_eth,
        amount_raw:        body.intent.amount.clone(),
        start_price:       body.intent.start_price.clone(),
        floor_price:       body.intent.floor_price.clone(),
        current_price:     Some(body.intent.start_price.clone()),
        deadline:          deadline_ms,
        created_at:        now_ms,
        status:            OrderStatus::Open,
        intent_type:       body.intent.intent_type,
        explorer_url:      String::new(),
        fulfill_tx_hash:   None,
        is_gasless:        true,
    };

    // ── Add to orderbook ──────────────────────────────────────────────────────
    let pending = orderbook::add_intent(
        &state.intent_store,
        intent_id.clone(),
        details,
        body.signature.clone(),
        injected.clone(),
    );
    orderbook::update_intent_status(
        &state.intent_store,
        &intent_id,
        IntentStatus::RfqActive,
    );

    // ── Persist to DB (fire-and-forget) ───────────────────────────────────────
    {
        let db  = state.db.clone();
        let ord = injected;
        let mut pnd = pending;
        pnd.status = IntentStatus::RfqActive;
        tokio::spawn(async move {
            intent_repo::upsert_order(&db, &ord).await;
            intent_repo::upsert_gasless(&db, &pnd).await;
        });
    }

    info!(intent_id = %intent_id, creator = %body.intent.creator, "Intent verified, starting RFQ");

    // ── Spawn Initial RFQ async ───────────────────────────────────────────
    {
        let state_rfq    = state.clone();
        let intent_id_rfq = intent_id.clone();
        tokio::spawn(async move {
            auction::broadcast_rfq(&state_rfq, &intent_id_rfq).await;
        });
    }

    Ok(ApiSuccess::default().with_data(serde_json::json!({
        "intentId":          intent_id,
        "status":            "rfq_active",
        "estimatedFillTime": 30_000,
        "message":           "Intent verified and submitted. Solvers are bidding...",
    })))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn is_valid_evm_address(s: &str) -> bool {
    s.starts_with("0x")
        && s.len() == 42
        && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}

// ─── GET /evm-balance ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EvmBalanceQuery {
    pub chain: String,
    pub address: String,
}

pub async fn get_evm_balance(
    State(state): State<AppState>,
    Query(params): Query<EvmBalanceQuery>,
) -> ApiResult<serde_json::Value> {
    if !is_valid_evm_address(&params.address) {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid EVM address"));
    }

    let addr: Address = params.address.parse().unwrap();
    let url: alloy::transports::http::reqwest::Url = state.config.chain.rpc_url.parse().unwrap();
    let provider = ProviderBuilder::new().connect_http(url);
    
    let balance_wei = alloy::providers::Provider::get_balance(&provider, addr).await.unwrap_or_default();
    
    let wei_str = balance_wei.to_string();
    let val: u128 = wei_str.parse().unwrap_or(0);
    let whole = val / 1_000_000_000_000_000_000;
    let frac = (val % 1_000_000_000_000_000_000) / 1_000_000_000_000;
    let balance_eth = format!("{}.{:06}", whole, frac);

    let data = serde_json::json!({
        "balanceEth": balance_eth,
        "balanceWei": wei_str,
        "estimatedGasEth": "0.0005",
        "estimatedGasWei": "500000000000000",
        "symbol": "ETH"
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /solana/balance/:address ─────────────────────────────────────────────

pub async fn get_solana_balance(
    Path(address): Path<String>,
) -> ApiResult<serde_json::Value> {
    let client = reqwest::Client::new();
    let mut lamports = 0u64;
    
    if let Ok(resp) = client.post("https://api.devnet.solana.com")
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBalance",
            "params": [address]
        }))
        .send()
        .await
    {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(val) = json.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_u64()) {
                lamports = val;
            }
        }
    }

    let sol = (lamports as f64) / 1e9;
    
    let data = serde_json::json!({
        "lamports": lamports,
        "sol": sol,
        "symbol": "SOL"
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /quote ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteQuery {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount: String,
}

pub async fn get_quote(
    State(state): State<AppState>,
    Query(params): Query<QuoteQuery>,
) -> ApiResult<serde_json::Value> {
    let amount_f64: f64 = params.amount.parse().unwrap_or(0.0);
    let amount_wei = format!("{:.0}", amount_f64 * 1e18);

    let prices = super::price::compute_eth_to_sol_prices(&amount_wei).await;

    let receive_f64 = (amount_f64 * (prices.from_usd / prices.to_usd)) * 0.97;
    let receive_amount = format!("{:.6}", receive_f64);

    let active_solvers = state.solver_registry.active_count();

    let data = serde_json::json!({
        "fromUsd": prices.from_usd,
        "toUsd": prices.to_usd,
        "startPrice": prices.start_price,
        "floorPrice": prices.floor_price,
        "amount": params.amount,
        "receiveAmount": receive_amount,
        "durationSeconds": 300,
        "activeSolvers": active_solvers,
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /price ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceQuery {
    pub from_chain: String,
    pub to_chain: String,
}

pub async fn get_price(
    Query(_params): Query<PriceQuery>,
) -> ApiResult<serde_json::Value> {
    let prices = super::price::compute_eth_to_sol_prices("1000000000000000000").await;
    let rate = prices.from_usd / prices.to_usd;

    let data = serde_json::json!({
        "rate": rate,
        "fromUsd": prices.from_usd,
        "toUsd": prices.to_usd,
        "timestamp": 0,
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── POST /build-tx ───────────────────────────────────────────────────────────

sol! {
    function createOrder(
        bytes32 recipient,
        uint16 destinationChain,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 durationSeconds,
        uint8 intentType
    ) external payable returns (bytes32);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTxBody {
    pub chain:             String, // "evm-base"
    pub action:            String, // "create_order"
    pub sender_address:    String,
    pub recipient_address: String, // Solana base58 or EVM hex
    pub destination_chain: String, // "solana" | "sui"
    pub amount:            String,
    pub output_token:      Option<String>, // "sol" | "msol" | "marginfi"
    pub start_price:       Option<String>,
    pub floor_price:       Option<String>,
    pub duration_seconds:  Option<u64>,
}

pub async fn build_tx(
    State(state): State<AppState>,
    Json(body): Json<BuildTxBody>,
) -> ApiResult<serde_json::Value> {
    use alloy::primitives::{FixedBytes, U256};
    use alloy::sol_types::SolCall;

    if body.chain != "evm-base" || body.action != "create_order" {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Only chain=evm-base + action=create_order is supported"));
    }

    let amount_f64: f64 = body.amount.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("amount must be a positive number")
    })?;

    let amount_wei = format!("{}", (amount_f64 * 1e18) as u128);

    // Compute prices if not provided
    let (start_price_str, floor_price_str) = if body.start_price.is_some() && body.floor_price.is_some() {
        (body.start_price.unwrap(), body.floor_price.unwrap())
    } else {
        let prices = price::compute_eth_to_sol_prices(&amount_wei).await;
        (prices.start_price, prices.floor_price)
    };

    let start_price: U256 = start_price_str.parse().map_err(|_| {
        ApiError::default().with_code(StatusCode::BAD_REQUEST).with_message("invalid startPrice")
    })?;
    let floor_price: U256 = floor_price_str.parse().map_err(|_| {
        ApiError::default().with_code(StatusCode::BAD_REQUEST).with_message("invalid floorPrice")
    })?;

    // Encode recipient as bytes32
    let recipient_bytes32: FixedBytes<32> = if body.recipient_address.starts_with("0x") {
        let hex_str = body.recipient_address.trim_start_matches("0x");
        let padded = format!("{:0>64}", hex_str);
        let bytes = hex::decode(&padded).map_err(|_| {
            ApiError::default().with_code(StatusCode::BAD_REQUEST).with_message("invalid EVM recipient")
        })?;
        FixedBytes::from_slice(&bytes)
    } else {
        // Solana base58 → 32 bytes
        let decoded = bs58::decode(&body.recipient_address).into_vec().map_err(|_| {
            ApiError::default().with_code(StatusCode::BAD_REQUEST).with_message("invalid Solana recipient address")
        })?;
        if decoded.len() != 32 {
            return Err(ApiError::default()
                .with_code(StatusCode::BAD_REQUEST)
                .with_message("Solana address must decode to exactly 32 bytes"));
        }
        FixedBytes::from_slice(&decoded)
    };

    // Wormhole destination chain ID
    let dest_chain_id: u16 = match body.destination_chain.as_str() {
        "solana" => 1,
        "sui"    => 21,
        other    => return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message(&format!("unsupported destinationChain: {other}"))),
    };

    // Intent type: 0=sol, 1=msol (Marinade), 3=marginfi
    let intent_type: u8 = match body.output_token.as_deref().unwrap_or("sol") {
        "msol"     => 1,
        "marginfi" => 3,
        _          => 0,
    };

    let duration: U256 = U256::from(body.duration_seconds.unwrap_or(300));

    // Encode calldata
    let call = createOrderCall {
        recipient:          recipient_bytes32,
        destinationChain:   dest_chain_id,
        startPrice:         start_price,
        floorPrice:         floor_price,
        durationSeconds:    duration,
        intentType:         intent_type,
    };
    let calldata = hex::encode(call.abi_encode());

    let contract = &state.config.chain.contract_address;
    let chain_id = state.config.chain.chain_id;

    // Check solver availability
    let active_solvers = state.solver_registry.active_count();
    if active_solvers == 0 {
        return Err(ApiError::default()
            .with_code(StatusCode::SERVICE_UNAVAILABLE)
            .with_message("No solver is currently active. Your funds would be locked until the auction deadline with no one to fill the order. Please try again when a solver is online."));
    }

    info!(
        sender = %body.sender_address,
        dest   = %body.destination_chain,
        amount = %body.amount,
        output_token = ?body.output_token,
        "Build-tx createOrder encoded"
    );

    let data = serde_json::json!({
        "chain": "evm",
        "tx": {
            "to":      contract,
            "data":    format!("0x{calldata}"),
            "value":   amount_wei,
            "chainId": chain_id,
            "description": format!("Create order: lock {} ETH → bridge to {}", body.amount, body.destination_chain),
        }
    });

    Ok(ApiSuccess::default().with_data(data))
}
