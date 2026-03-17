use crate::constants::*;
use crate::error::IntentBridgeError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Cancel an intent and refund locked SOL to creator
///
/// # Arguments
/// * `ctx` - CancelIntent context
///
/// # Errors
/// * `AlreadyFulfilled` - If intent is already fulfilled or cancelled
/// * `NotCreator` - If caller is not the intent creator
pub fn cancel_intent(ctx: Context<CancelIntent>) -> Result<()> {
    let intent = &mut ctx.accounts.intent;

    // Check intent is still open
    require!(
        intent.status == STATUS_OPEN,
        IntentBridgeError::AlreadyFulfilled
    );

    // Check caller is creator
    require!(
        intent.creator == ctx.accounts.creator.key(),
        IntentBridgeError::NotCreator
    );

    // Mark as cancelled
    intent.status = STATUS_CANCELLED;

    // Get refund amount
    let amount = intent.amount;

    // Transfer locked SOL back to creator
    // Intent PDA is the holder — transfer lamports directly
    **intent.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx
        .accounts
        .creator
        .to_account_info()
        .try_borrow_mut_lamports()? += amount;

    // Emit event
    let clock = Clock::get()?;
    anchor_lang::emit!(IntentCancelled {
        intent_id: intent.intent_id,
        cancelled_at: clock.unix_timestamp,
    });

    msg!("Intent cancelled");
    msg!("Intent ID: {:?}", intent.intent_id);
    msg!("Refund amount: {} lamports", amount);

    Ok(())
}

#[derive(Accounts)]
pub struct CancelIntent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [INTENT_SEED, &intent.intent_id],
        bump = intent.bump,
        constraint = intent.creator == creator.key()
    )]
    pub intent: Account<'info, Intent>,
}
