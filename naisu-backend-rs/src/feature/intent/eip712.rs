use alloy::{
    primitives::{Address, FixedBytes, U256},
    sol,
    sol_types::{SolStruct, eip712_domain},
};
use eyre::{Result, bail};
use tracing::warn;

use crate::infrastructure::ChainConfig;

// ─── EIP-712 Typed Struct ─────────────────────────────────────────────────────

sol! {
    struct Intent {
        address creator;
        bytes32 recipient;
        uint16 destinationChain;
        uint256 amount;
        uint256 startPrice;
        uint256 floorPrice;
        uint256 deadline;
        uint8 intentType;
        uint256 nonce;
    }
}

// ─── Public Types ─────────────────────────────────────────────────────────────

pub struct IntentParams {
    pub creator:           Address,
    pub recipient:         FixedBytes<32>,
    pub destination_chain: u16,
    pub amount:            U256,
    pub start_price:       U256,
    pub floor_price:       U256,
    pub deadline:          U256,
    pub intent_type:       u8,
    pub nonce:             U256,
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/// Verify an EIP-712 signed intent.
/// Returns Ok(true) if the recovered signer matches `creator`, Ok(false) otherwise.
pub fn verify_intent_signature(
    params: &IntentParams,
    sig_hex: &str,
    chain: &ChainConfig,
) -> Result<bool> {
    let contract: Address = chain.contract_address.parse()?;

    let domain = eip712_domain! {
        name: "NaisuIntentBridge",
        version: "1",
        chain_id: chain.chain_id,
        verifying_contract: contract,
    };

    let intent = Intent {
        creator:          params.creator,
        recipient:        params.recipient,
        destinationChain: params.destination_chain,
        amount:           params.amount,
        startPrice:       params.start_price,
        floorPrice:       params.floor_price,
        deadline:         params.deadline,
        intentType:       params.intent_type,
        nonce:            params.nonce,
    };

    let signing_hash = intent.eip712_signing_hash(&domain);

    let sig_str  = sig_hex.strip_prefix("0x").unwrap_or(sig_hex);
    let sig_bytes = hex::decode(sig_str)?;
    if sig_bytes.len() != 65 {
        bail!("Signature must be 65 bytes, got {}", sig_bytes.len());
    }

    let sig = alloy::primitives::Signature::try_from(sig_bytes.as_slice())?;

    match sig.recover_address_from_prehash(&signing_hash) {
        Ok(recovered) => {
            let valid = recovered == params.creator;
            if !valid {
                warn!(
                    creator = %params.creator,
                    recovered = %recovered,
                    "EIP-712 signature mismatch"
                );
            }
            Ok(valid)
        }
        Err(e) => {
            warn!(error = %e, "Signature recovery failed");
            Ok(false)
        }
    }
}
