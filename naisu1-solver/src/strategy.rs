use tracing::info;

/// Checks whether filling an intent/order is profitable enough.
///
/// All amounts must use the same unit:
/// - For Sui→EVM: locked_amount in MIST, required_output in Wei, estimated_gas in Wei
///   (caller must convert to a common unit before calling)
/// - For EVM→Sui: all values in MIST
///
/// Uses u128 arithmetic throughout to prevent overflow.
pub fn is_profitable(
    locked_amount: u64,
    required_output: u64,
    estimated_gas: u64,
    min_profit_bps: u64,
) -> bool {
    let total_cost = (required_output as u128).saturating_add(estimated_gas as u128);
    let locked = locked_amount as u128;

    if total_cost >= locked {
        info!(
            locked = locked_amount,
            required = required_output,
            gas = estimated_gas,
            "Not profitable; cost >= reward"
        );
        return false;
    }

    let profit = locked - total_cost;
    let profit_bps = (profit * 10_000) / locked;
    let profitable = profit_bps >= min_profit_bps as u128;

    info!(
        locked = locked_amount,
        required = required_output,
        gas = estimated_gas,
        profit = profit,
        profit_bps = profit_bps,
        min_profit_bps = min_profit_bps,
        profitable = profitable,
        "Profitability check"
    );

    profitable
}

#[cfg(test)]
mod tests {
    use super::is_profitable;

    #[test]
    fn test_profitable() {
        // 1000 locked, 900 required, 10 gas = 90 profit = 9% = 900 bps > 50
        assert!(is_profitable(1000, 900, 10, 50));
    }

    #[test]
    fn test_below_threshold() {
        // 1000 locked, 996 required, 2 gas = 2 profit = 0.2% = 20 bps < 50
        assert!(!is_profitable(1000, 996, 2, 50));
    }

    #[test]
    fn test_negative_profit() {
        assert!(!is_profitable(100, 200, 10, 50));
    }

    #[test]
    fn test_overflow_safe() {
        // required_output + estimated_gas would overflow u64, but should still be caught
        assert!(!is_profitable(1000, u64::MAX, u64::MAX, 50));
    }
}
