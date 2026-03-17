use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole;

/// Claim locked SOL after VAA has been posted by relayer (solver)
pub fn claim_with_vaa(ctx: Context<ClaimWithVaa>) -> Result<()> {
    // 1. Validate emitter chain and address
    let posted_vaa = &ctx.accounts.posted_vaa;
    let vaa_data = posted_vaa.data();
    let emitter_chain = vaa_data.emitter_chain;
    let emitter_address = vaa_data.emitter_address;

    let foreign_emitter = &ctx.accounts.foreign_emitter;
    require!(
        emitter_chain == foreign_emitter.chain,
        IntentBridgeError::InvalidEmitter
    );
    require!(
        emitter_address == foreign_emitter.address,
        IntentBridgeError::InvalidEmitter
    );

    // 2. Decode payload
    let payload = &vaa_data.payload;
    require!(payload.len() >= PAYLOAD_SIZE, IntentBridgeError::InvalidVaa);

    // Extract intent_id (bytes 0..32)
    let mut intent_id = [0u8; 32];
    intent_id.copy_from_slice(&payload[INTENT_ID_OFFSET..SOLVER_OFFSET]);

    // Extract amount from VAA (bytes 88..96)
    let amount_from_vaa = u64::from_be_bytes(
        payload[AMOUNT_OFFSET..PAYLOAD_SIZE]
            .try_into()
            .map_err(|_| IntentBridgeError::PayloadDecodeFailed)?,
    );

    // 3. Validate intent
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

    // 4. Mark as fulfilled and transfer SOL
    intent.status = STATUS_FULFILLED;

    let locked_amount = intent.amount;
    **intent.to_account_info().try_borrow_mut_lamports()? -= locked_amount;
    **ctx
        .accounts
        .solver
        .to_account_info()
        .try_borrow_mut_lamports()? += locked_amount;

    // 5. Save replay protection
    let received = &mut ctx.accounts.received;
    received.emitter_chain = emitter_chain;
    received.sequence = vaa_data.sequence;
    received.bump = ctx.bumps.received;

    // Emit event
    anchor_lang::emit!(IntentFulfilled {
        intent_id,
        solver: ctx.accounts.solver.key(),
        fulfilled_at: clock.unix_timestamp,
    });

    msg!("Intent claimed with VAA");
    msg!("Intent ID: {:?}", intent_id);
    msg!("Amount claimed: {} lamports", locked_amount);

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimWithVaa<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [FOREIGN_EMITTER_SEED, &posted_vaa.data().emitter_chain.to_le_bytes()],
        bump = foreign_emitter.bump,
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    #[account(
        constraint = posted_vaa.data().emitter_chain == foreign_emitter.chain @ IntentBridgeError::InvalidEmitter,
        constraint = posted_vaa.data().emitter_address == foreign_emitter.address @ IntentBridgeError::InvalidEmitter,
    )]
    pub posted_vaa: Account<'info, wormhole::PostedVaa<Vec<u8>>>,

    #[account(
        mut,
        seeds = [INTENT_SEED, &intent.intent_id],
        bump = intent.bump,
        constraint = intent.status == STATUS_OPEN @ IntentBridgeError::AlreadyFulfilled,
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
