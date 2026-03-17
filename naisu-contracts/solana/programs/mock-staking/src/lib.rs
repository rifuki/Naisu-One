use anchor_lang::prelude::*;

declare_id!("9W1HN3QiTTUjBgr6ACPQT6jR6SQwgBdi2mFbb44aiWvJ");

// ── State accounts ────────────────────────────────────────────────────────────

/// Global staking pool — PDA: [b"stake_pool"]
/// Size: 8 (disc) + 32 (authority) + 8 (total_shares) + 1 (bump) = 49
#[account]
pub struct StakePool {
    pub authority: Pubkey,
    pub total_shares: u64,
    pub bump: u8,
}

/// Per-staker account — PDA: [b"stake_account", staker_pubkey]
/// Size: 8 (disc) + 32 (staker) + 8 (shares) + 1 (bump) = 49
#[account]
pub struct StakeAccount {
    pub staker: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

// ── Error codes ───────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient pool balance")]
    InsufficientPoolBalance,
    #[msg("Zero amount")]
    ZeroAmount,
}

// ── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod mock_staking {
    use super::*;

    /// Initialize the global staking pool. Called once by authority.
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.stake_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.total_shares = 0;
        pool.bump = ctx.bumps.stake_pool;
        msg!("StakePool initialized");
        Ok(())
    }

    /// Deposit SOL from `depositor` into the pool on behalf of `staker`.
    /// Mints shares 1:1 (1 lamport = 1 share, no yield math — mock only).
    /// The depositor pays; the staker receives credit in their StakeAccount.
    pub fn deposit(ctx: Context<Deposit>, lamports_in: u64) -> Result<()> {
        require!(lamports_in > 0, StakingError::ZeroAmount);

        // Transfer SOL: depositor → stake_pool
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.stake_pool.to_account_info(),
                },
            ),
            lamports_in,
        )?;

        // Mint shares 1:1
        let pool = &mut ctx.accounts.stake_pool;
        pool.total_shares = pool.total_shares.saturating_add(lamports_in);

        let stake_account = &mut ctx.accounts.stake_account;
        stake_account.staker = ctx.accounts.staker.key();
        stake_account.shares = stake_account.shares.saturating_add(lamports_in);
        stake_account.bump = ctx.bumps.stake_account;

        msg!(
            "Deposited {} lamports for staker {}; shares now {}",
            lamports_in,
            ctx.accounts.staker.key(),
            stake_account.shares
        );
        Ok(())
    }

    /// Withdraw SOL by burning shares. 1 share = 1 lamport (mock).
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        require!(shares_to_burn > 0, StakingError::ZeroAmount);

        let stake_account = &mut ctx.accounts.stake_account;
        require!(
            stake_account.shares >= shares_to_burn,
            StakingError::InsufficientShares
        );

        let pool = &mut ctx.accounts.stake_pool;
        let lamports_out = shares_to_burn; // 1:1 ratio

        // Ensure the pool PDA has enough lamports (rent-exempt minimum stays)
        let pool_info = pool.to_account_info();
        let pool_lamports = pool_info.lamports();
        require!(
            pool_lamports >= lamports_out,
            StakingError::InsufficientPoolBalance
        );

        // Burn shares
        stake_account.shares -= shares_to_burn;
        pool.total_shares = pool.total_shares.saturating_sub(shares_to_burn);

        // Transfer SOL: stake_pool → staker via direct lamport manipulation.
        // This is safe because stake_pool is a PDA owned by this program.
        **ctx
            .accounts
            .stake_pool
            .to_account_info()
            .try_borrow_mut_lamports()? -= lamports_out;
        **ctx
            .accounts
            .staker
            .to_account_info()
            .try_borrow_mut_lamports()? += lamports_out;

        msg!(
            "Withdrew {} lamports for staker {}; shares remaining {}",
            lamports_out,
            ctx.accounts.staker.key(),
            stake_account.shares
        );
        Ok(())
    }
}

// ── Account structs ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1, // disc + authority + total_shares + bump
        seeds = [b"stake_pool"],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The account paying SOL (e.g. solver, bridge program via CPI)
    #[account(mut)]
    pub depositor: Signer<'info>,
    /// The account receiving staking credit (does not need to sign)
    /// CHECK: validated only by the seeds of stake_account
    #[account(mut)]
    pub staker: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"stake_pool"],
        bump = stake_pool.bump
    )]
    pub stake_pool: Account<'info, StakePool>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + 32 + 8 + 1, // disc + staker + shares + bump
        seeds = [b"stake_account", staker.key().as_ref()],
        bump
    )]
    pub stake_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"stake_pool"],
        bump = stake_pool.bump
    )]
    pub stake_pool: Account<'info, StakePool>,
    #[account(
        mut,
        seeds = [b"stake_account", staker.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.staker == staker.key()
    )]
    pub stake_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>,
}
