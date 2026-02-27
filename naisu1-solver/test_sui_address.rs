use sui_types::base_types::SuiAddress;

fn main() {
    let bytes = [1u8; 32];
    let addr = SuiAddress::from_bytes(bytes).unwrap();
    println!("SuiAddress to_string: {}", addr.to_string());
}
