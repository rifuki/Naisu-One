/// Calculates Dutch auction price at a given time.
/// Returns None if inputs are invalid (floor > start, or deadline <= created_at).
/// All time values must use the same unit (ms for Sui, seconds for EVM).
pub fn calculate_price(
    start_price: u64,
    floor_price: u64,
    created_at: u64,
    deadline: u64,
    current_time: u64,
) -> Option<u64> {
    if start_price < floor_price {
        return None;
    }
    if deadline <= created_at {
        return None;
    }

    if current_time >= deadline {
        return Some(floor_price);
    }
    if current_time <= created_at {
        return Some(start_price);
    }

    let elapsed = current_time - created_at;
    let duration = deadline - created_at;
    let price_range = start_price - floor_price; // safe: checked above

    let decay = (price_range as u128 * elapsed as u128 / duration as u128) as u64;

    Some(start_price - decay) // safe: decay <= price_range <= start_price
}

#[cfg(test)]
mod tests {
    use super::calculate_price;

    #[test]
    fn test_price_at_start() {
        assert_eq!(calculate_price(1000, 500, 0, 100, 0), Some(1000));
    }

    #[test]
    fn test_price_at_midpoint() {
        assert_eq!(calculate_price(1000, 500, 0, 100, 50), Some(750));
    }

    #[test]
    fn test_price_at_deadline() {
        assert_eq!(calculate_price(1000, 500, 0, 100, 100), Some(500));
    }

    #[test]
    fn test_price_after_deadline() {
        assert_eq!(calculate_price(1000, 500, 0, 100, 150), Some(500));
    }

    #[test]
    fn test_invalid_floor_greater_than_start() {
        assert_eq!(calculate_price(500, 1000, 0, 100, 50), None);
    }

    #[test]
    fn test_invalid_deadline_before_created_at() {
        assert_eq!(calculate_price(1000, 500, 100, 50, 75), None);
    }
}
