use std::str::FromStr;

fn main() {
    let s = sui_types::base_types::SuiAddress::from_str("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef").unwrap();
    println!("to_string: {}", s.to_string());
}
