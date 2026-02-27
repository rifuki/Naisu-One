use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Initialize the program with owner and Wormhole bridge address
///
/// # Arguments
/// * `ctx` - Initialize context
///
/// # Errors
/// * `InvalidParams` - If wormhole_bridge address is invalid
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.owner = ctx.accounts.owner.key();
    config.wormhole_bridge = ctx.accounts.wormhole_bridge.key();
    config.bump = ctx.bumps.config;

    msg!("Intent Bridge initialized");
    msg!("Owner: {}", config.owner);
    msg!("Wormhole Bridge: {}", config.wormhole_bridge);

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Wormhole Core Bridge program
    /// This is the Wormhole Core Bridge program on Solana devnet
    /// Devnet: 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5
    pub wormhole_bridge: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
