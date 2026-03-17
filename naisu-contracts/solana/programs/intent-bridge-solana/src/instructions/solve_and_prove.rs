use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole;

/// Solve an EVM order by sending SOL to recipient and publishing Wormhole proof
pub fn solve_and_prove(
    ctx: Context<SolveAndProve>,
    order_id: [u8; 32],
    solver_address: [u8; 32],
    amount_lamports: u64,
) -> Result<()> {
    // 1. Transfer SOL to recipient
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.solver.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        ),
        amount_lamports,
    )?;

    // 2. Build 96-byte payload
    let mut payload = Vec::with_capacity(PAYLOAD_SIZE);
    payload.extend_from_slice(&order_id);
    payload.extend_from_slice(&solver_address);
    payload.extend_from_slice(&[0u8; 24]);
    payload.extend_from_slice(&amount_lamports.to_be_bytes());

    // 3. CPI to Wormhole post_message
    let bump = ctx.bumps.wormhole_emitter;
    let signer_seeds: &[&[&[u8]]; 1] = &[&[EMITTER_SEED, &[bump]]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.wormhole_program.to_account_info(),
        wormhole::PostMessage {
            config: ctx.accounts.wormhole_bridge.to_account_info(),
            message: ctx.accounts.wormhole_message.to_account_info(),
            emitter: ctx.accounts.wormhole_emitter.to_account_info(),
            sequence: ctx.accounts.wormhole_sequence.to_account_info(),
            payer: ctx.accounts.solver.to_account_info(),
            fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
            clock: ctx.accounts.clock.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        signer_seeds,
    );

    wormhole::post_message(cpi_ctx, 0, payload, wormhole::Finality::Confirmed)?;

    msg!("Order solved and proof published");
    msg!("Order ID: {:?}", order_id);
    msg!("Amount sent: {} lamports", amount_lamports);
    msg!("Recipient: {}", ctx.accounts.recipient.key());

    Ok(())
}

#[derive(Accounts)]
pub struct SolveAndProve<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(address = Pubkey::from_str(WORMHOLE_CORE_BRIDGE_PROGRAM_ID).unwrap())]
    pub wormhole_program: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"Bridge"],
        bump,
        seeds::program = wormhole_program
    )]
    pub wormhole_bridge: AccountInfo<'info>,

    #[account(mut)]
    pub wormhole_message: Signer<'info>,

    #[account(
        seeds = [EMITTER_SEED],
        bump,
    )]
    pub wormhole_emitter: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"Sequence", wormhole_emitter.key().as_ref()],
        bump,
        seeds::program = wormhole_program
    )]
    pub wormhole_sequence: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"fee_collector"],
        bump,
        seeds::program = wormhole_program
    )]
    pub wormhole_fee_collector: AccountInfo<'info>,

    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

use std::str::FromStr;
