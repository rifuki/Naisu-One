use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole;

/// Solve an order from another chain by sending SOL and emitting Wormhole proof
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

    // 2. Build 96-byte payload: [order_id (32) + solver_address (32) + amount (32, big-endian u256)]
    let mut payload = Vec::with_capacity(96);
    payload.extend_from_slice(&order_id);
    payload.extend_from_slice(&solver_address);
    // Pad amount to u256 (24 zero bytes + 8 bytes big-endian u64)
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

    wormhole::post_message(
        cpi_ctx,
        0, // nonce
        payload,
        wormhole::Finality::Confirmed,
    )?;

    msg!("Order solved and proof published");
    msg!("Order ID: {:?}", order_id);
    msg!("Amount sent: {} lamports", amount_lamports);

    Ok(())
}

#[derive(Accounts)]
pub struct SolveAndProve<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    /// CHECK: Recipient wallet
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    // Wormhole accounts
    /// CHECK: Wormhole Core Bridge program
    pub wormhole_program: AccountInfo<'info>,

    /// CHECK: Wormhole Bridge config
    #[account(mut, seeds = [b"Bridge"], bump, seeds::program = wormhole_program)]
    pub wormhole_bridge: AccountInfo<'info>,

    /// CHECK: Unique message account (new keypair per tx)
    #[account(mut)]
    pub wormhole_message: Signer<'info>,

    /// CHECK: Program emitter PDA
    #[account(seeds = [EMITTER_SEED], bump)]
    pub wormhole_emitter: AccountInfo<'info>,

    /// CHECK: Sequence counter
    #[account(mut, seeds = [b"Sequence", wormhole_emitter.key().as_ref()], bump, seeds::program = wormhole_program)]
    pub wormhole_sequence: AccountInfo<'info>,

    /// CHECK: Fee collector
    #[account(mut, seeds = [b"fee_collector"], bump, seeds::program = wormhole_program)]
    pub wormhole_fee_collector: AccountInfo<'info>,

    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

/// Claim locked SOL after receiving VAA from another chain
pub fn claim_with_vaa(ctx: Context<ClaimWithVaa>) -> Result<()> {
    // Get VAA data
    let posted_vaa = &ctx.accounts.posted_vaa;
    let vaa = posted_vaa.data();

    // Verify emitter is registered
    let foreign_emitter = &ctx.accounts.foreign_emitter;
    require!(
        vaa.emitter_chain == foreign_emitter.chain,
        IntentBridgeError::InvalidEmitter
    );
    require!(
        vaa.emitter_address == foreign_emitter.address,
        IntentBridgeError::InvalidEmitter
    );

    // Decode payload
    let payload = &vaa.payload.data;
    require!(payload.len() >= 96, IntentBridgeError::InvalidVaa);

    // Extract intent_id (bytes 0-31)
    let mut intent_id = [0u8; 32];
    intent_id.copy_from_slice(&payload[0..32]);

    // Extract amount (bytes 88-95, big-endian u64)
    let amount_from_vaa = u64::from_be_bytes(payload[88..96].try_into().unwrap());

    // Validate intent
    let intent = &mut ctx.accounts.intent;
    require!(
        intent.intent_id == intent_id,
        IntentBridgeError::IntentIdMismatch
    );
    require!(
        intent.status == STATUS_OPEN,
        IntentBridgeError::AlreadyFulfilled
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= intent.deadline,
        IntentBridgeError::Expired
    );
    require!(
        amount_from_vaa >= intent.floor_price,
        IntentBridgeError::PriceTooLow
    );

    // Mark fulfilled and transfer SOL
    intent.status = STATUS_FULFILLED;
    let locked_amount = intent.amount;
    **intent.to_account_info().try_borrow_mut_lamports()? -= locked_amount;
    **ctx
        .accounts
        .solver
        .to_account_info()
        .try_borrow_mut_lamports()? += locked_amount;

    // Record replay protection
    let received = &mut ctx.accounts.received;
    received.emitter_chain = vaa.emitter_chain;
    received.sequence = vaa.sequence;
    received.bump = ctx.bumps.received;

    // Emit event
    emit!(IntentFulfilled {
        intent_id,
        solver: ctx.accounts.solver.key(),
        fulfilled_at: clock.unix_timestamp,
    });

    msg!("Intent claimed! Amount: {} lamports", locked_amount);
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimWithVaa<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [FOREIGN_EMITTER_SEED, &posted_vaa.data().emitter_chain.to_le_bytes()],
        bump = foreign_emitter.bump,
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    /// CHECK: Posted VAA account (verified by Wormhole)
    pub posted_vaa: Account<'info, wormhole::PostedVaa<wormhole::MessageData>>,

    #[account(
        mut,
        seeds = [INTENT_SEED, &intent.intent_id],
        bump = intent.bump,
    )]
    pub intent: Account<'info, Intent>,

    #[account(
        init,
        payer = solver,
        space = 8 + Received::INIT_SPACE,
        seeds = [
            RECEIVED_SEED,
            &posted_vaa.data().emitter_chain.to_le_bytes(),
            &posted_vaa.data().sequence.to_le_bytes(),
        ],
        bump
    )]
    pub received: Account<'info, Received>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct IntentFulfilled {
    pub intent_id: [u8; 32],
    pub solver: Pubkey,
    pub fulfilled_at: i64,
}
