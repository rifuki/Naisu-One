use anchor_lang::prelude::*;

#[error_code]
pub enum IntentBridgeError {
    #[msg("Invalid parameters")]
    InvalidParams,

    #[msg("Not the intent creator")]
    NotCreator,

    #[msg("Intent already fulfilled or cancelled")]
    AlreadyFulfilled,

    #[msg("Intent expired")]
    Expired,

    #[msg("Invalid emitter chain or address")]
    InvalidEmitter,

    #[msg("VAA already processed")]
    AlreadyProcessed,

    #[msg("Amount below floor price")]
    PriceTooLow,

    #[msg("Insufficient SOL sent")]
    InsufficientFunds,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid Wormhole VAA")]
    InvalidVaa,

    #[msg("Intent ID mismatch")]
    IntentIdMismatch,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid destination chain")]
    InvalidDestinationChain,

    #[msg("Solver address invalid")]
    InvalidSolverAddress,

    #[msg("Payload decoding failed")]
    PayloadDecodeFailed,
}
