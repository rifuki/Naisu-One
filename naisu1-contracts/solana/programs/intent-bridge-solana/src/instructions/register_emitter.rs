use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Register a foreign emitter for a specific Wormhole chain
///
/// # Arguments
/// * `ctx` - RegisterEmitter context
/// * `chain` - Wormhole chain ID (e.g., 6 = Fuji, 10004 = Base Sepolia, 21 = Sui)
/// * `address` - 32-byte emitter address
///
/// # Errors
/// * `Unauthorized` - If caller is not the owner
pub fn register_emitter(
    ctx: Context<RegisterEmitter>,
    chain: u16,
    address: [u8; 32],
) -> Result<()> {
    // Verify caller is owner
    require!(
        ctx.accounts.owner.key() == ctx.accounts.config.owner,
        IntentBridgeError::Unauthorized
    );

    let emitter = &mut ctx.accounts.foreign_emitter;
    emitter.chain = chain;
    emitter.address = address;
    emitter.bump = ctx.bumps.foreign_emitter;

    msg!("Foreign emitter registered");
    msg!("Chain: {}", chain);
    msg!("Address: {:?}", address);

    // Emit event
    anchor_lang::emit!(EmitterRegistered { chain, address });

    Ok(())
}

#[derive(Accounts)]
#[instruction(chain: u16, address: [u8; 32])]
pub struct RegisterEmitter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + ForeignEmitter::INIT_SPACE,
        seeds = [FOREIGN_EMITTER_SEED, &chain.to_le_bytes()],
        bump
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    pub system_program: Program<'info, System>,
}
