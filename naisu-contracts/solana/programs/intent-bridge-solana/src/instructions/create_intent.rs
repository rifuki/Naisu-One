use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Create a new intent - user locks SOL
///
/// # Arguments
/// * `ctx` - CreateIntent context
/// * `intent_id` - Unique 32-byte intent ID
/// * `recipient` - Recipient address on destination chain (32 bytes)
/// * `destination_chain` - Wormhole chain ID of destination
/// * `start_price` - Dutch auction start price
/// * `floor_price` - Dutch auction floor price
/// * `duration_seconds` - Intent duration in seconds
///
/// # Errors
/// * `InvalidParams` - If validation fails
/// * `InsufficientFunds` - If no SOL provided
pub fn create_intent(
    ctx: Context<CreateIntent>,
    intent_id: [u8; 32],
    recipient: [u8; 32],
    destination_chain: u16,
    start_price: u64,
    floor_price: u64,
    duration_seconds: u64,
) -> Result<()> {
    // Validate parameters
    require!(start_price >= floor_price, IntentBridgeError::InvalidParams);
    require!(duration_seconds > 0, IntentBridgeError::InvalidParams);

    // Check that SOL was provided
    let amount = ctx.accounts.payment.lamports();
    require!(amount > 0, IntentBridgeError::InsufficientFunds);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let deadline = now
        .checked_add(duration_seconds as i64)
        .ok_or(IntentBridgeError::Overflow)?;

    // Transfer SOL from user to intent PDA (lock)
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.intent.to_account_info(),
            },
        ),
        amount,
    )?;

    // Initialize intent account
    let intent = &mut ctx.accounts.intent;
    intent.intent_id = intent_id;
    intent.creator = ctx.accounts.creator.key();
    intent.recipient = recipient;
    intent.destination_chain = destination_chain;
    intent.amount = amount;
    intent.start_price = start_price;
    intent.floor_price = floor_price;
    intent.deadline = deadline;
    intent.created_at = now;
    intent.status = STATUS_OPEN;
    intent.bump = ctx.bumps.intent;

    // Emit event
    anchor_lang::emit!(IntentCreated {
        intent_id,
        creator: ctx.accounts.creator.key(),
        recipient,
        destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        created_at: now,
    });

    msg!("Intent created");
    msg!("Intent ID: {:?}", intent_id);
    msg!("Amount: {} lamports", amount);
    msg!("Deadline: {}", deadline);

    Ok(())
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32], recipient: [u8; 32], destination_chain: u16)]
pub struct CreateIntent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Payment account - will transfer SOL to intent PDA
    #[account(mut)]
    pub payment: AccountInfo<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Intent::INIT_SPACE,
        seeds = [INTENT_SEED, &intent_id],
        bump
    )]
    pub intent: Account<'info, Intent>,

    pub system_program: Program<'info, System>,
}
