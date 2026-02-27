use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("BK8wLw9FSw1n3SvQP8XDYoxWtcvaodSbgemtjVk96jkX");

/// Mock Liquid Staking — simulates a Jito/Marinade-style LST protocol.
///
/// Simplified design: uses a wSOL token vault instead of a raw SOL PDA.
/// Flow:
///   1. Admin calls `initialize` to create a staking pool and LST mint.
///   2. Users call `stake` with wSOL → receive LST tokens at current exchange rate.
///   3. Users call `request_unstake` → burn LST → lock an UnstakeTicket.
///   4. After cooldown, call `claim_unstake` → receive wSOL back.
///   5. Admin calls `accrue_yield` to simulate yield growth.
#[program]
pub mod mock_liquid_staking {
    use super::*;

    /// Initialize the staking pool.
    pub fn initialize(
        ctx: Context<Initialize>,
        cooldown_slots: u64,
        yield_bps_per_epoch: u16,
    ) -> Result<()> {
        require!(cooldown_slots > 0, StakingError::InvalidCooldown);
        require!(yield_bps_per_epoch <= 5000, StakingError::YieldTooHigh);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.lst_mint = ctx.accounts.lst_mint.key();
        pool.wsol_vault = ctx.accounts.wsol_vault.key();
        pool.underlying_mint = ctx.accounts.underlying_mint.key();
        pool.total_staked = 0;
        pool.total_lst_supply = 0;
        pool.exchange_rate = RATE_SCALE;
        pool.cooldown_slots = cooldown_slots;
        pool.yield_bps_per_epoch = yield_bps_per_epoch;
        pool.last_yield_slot = Clock::get()?.slot;
        pool.bump = ctx.bumps.pool;

        msg!(
            "Staking pool initialized: cooldown_slots={}, yield_bps={}",
            cooldown_slots,
            yield_bps_per_epoch
        );
        Ok(())
    }

    /// Stake underlying tokens → receive LST.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let exchange_rate = pool.exchange_rate;

        let lst_amount = (amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        require!(lst_amount > 0, StakingError::ZeroLstAmount);

        // Transfer underlying from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_underlying.to_account_info(),
                    to: ctx.accounts.wsol_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let authority_key = ctx.accounts.pool.authority;
        let bump = ctx.accounts.pool.bump;
        let pool_seeds = &[b"pool".as_ref(), authority_key.as_ref(), &[bump]];

        // Mint LST to user
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lst_mint.to_account_info(),
                    to: ctx.accounts.user_lst.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            lst_amount,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;
        pool.total_lst_supply = pool
            .total_lst_supply
            .checked_add(lst_amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "Staked: amount={}, lst_minted={}, rate={}",
            amount,
            lst_amount,
            exchange_rate
        );
        Ok(())
    }

    /// Request unstake: burn LST → create UnstakeTicket.
    pub fn request_unstake(ctx: Context<RequestUnstake>, lst_amount: u64) -> Result<()> {
        require!(lst_amount > 0, StakingError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let exchange_rate = pool.exchange_rate;

        let underlying_amount = (lst_amount as u128)
            .checked_mul(exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        require!(underlying_amount > 0, StakingError::ZeroAmount);
        require!(
            underlying_amount <= pool.total_staked,
            StakingError::InsufficientStake
        );

        // Burn LST
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.lst_mint.to_account_info(),
                    from: ctx.accounts.user_lst.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lst_amount,
        )?;

        let ticket = &mut ctx.accounts.unstake_ticket;
        ticket.owner = ctx.accounts.user.key();
        ticket.underlying_amount = underlying_amount;
        ticket.claimable_slot = Clock::get()?.slot + pool.cooldown_slots;
        ticket.claimed = false;
        ticket.bump = ctx.bumps.unstake_ticket;

        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool
            .total_staked
            .checked_sub(underlying_amount)
            .ok_or(StakingError::MathOverflow)?;
        pool.total_lst_supply = pool
            .total_lst_supply
            .checked_sub(lst_amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "UnstakeRequested: lst_burned={}, underlying_claimable={}",
            lst_amount,
            underlying_amount
        );
        Ok(())
    }

    /// Claim underlying tokens after cooldown.
    pub fn claim_unstake(ctx: Context<ClaimUnstake>) -> Result<()> {
        let ticket = &ctx.accounts.unstake_ticket;
        require!(!ticket.claimed, StakingError::AlreadyClaimed);

        let current_slot = Clock::get()?.slot;
        require!(
            current_slot >= ticket.claimable_slot,
            StakingError::CooldownNotExpired
        );

        let underlying_amount = ticket.underlying_amount;
        require!(underlying_amount > 0, StakingError::ZeroAmount);

        let authority_key = ctx.accounts.pool.authority;
        let bump = ctx.accounts.pool.bump;
        let pool_seeds = &[b"pool".as_ref(), authority_key.as_ref(), &[bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.wsol_vault.to_account_info(),
                    to: ctx.accounts.user_underlying.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            underlying_amount,
        )?;

        let ticket = &mut ctx.accounts.unstake_ticket;
        ticket.claimed = true;

        msg!("UnstakeClaimed: underlying={}", underlying_amount);
        Ok(())
    }

    /// Admin: simulate yield accrual.
    pub fn accrue_yield(ctx: Context<AccrueYield>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            ctx.accounts.authority.key() == pool.authority,
            StakingError::Unauthorized
        );

        let yield_bps = pool.yield_bps_per_epoch as u128;
        let current_rate = pool.exchange_rate as u128;
        let new_rate = current_rate + current_rate * yield_bps / 10000;

        pool.exchange_rate = new_rate as u64;
        pool.last_yield_slot = Clock::get()?.slot;

        msg!("YieldAccrued: new_rate={}", pool.exchange_rate);
        Ok(())
    }

    /// Get quote: how many LST for given underlying amount.
    pub fn get_stake_quote(ctx: Context<GetStakeQuote>, amount: u64) -> Result<u64> {
        let pool = &ctx.accounts.pool;
        let lst_amount = (amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(pool.exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        msg!(
            "StakeQuote: amount={}, lst={}, rate={}",
            amount,
            lst_amount,
            pool.exchange_rate
        );
        Ok(lst_amount)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

pub const RATE_SCALE: u64 = 1_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// Account Structs
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct StakingPool {
    pub authority: Pubkey,        // 32
    pub lst_mint: Pubkey,         // 32
    pub wsol_vault: Pubkey,       // 32
    pub underlying_mint: Pubkey,  // 32
    pub total_staked: u64,        // 8
    pub total_lst_supply: u64,    // 8
    pub exchange_rate: u64,       // 8
    pub cooldown_slots: u64,      // 8
    pub yield_bps_per_epoch: u16, // 2
    pub last_yield_slot: u64,     // 8
    pub bump: u8,                 // 1
}

impl StakingPool {
    pub const LEN: usize = 8 + 32 * 4 + 8 * 5 + 2 + 1;
}

#[account]
pub struct UnstakeTicket {
    pub owner: Pubkey,          // 32
    pub underlying_amount: u64, // 8
    pub claimable_slot: u64,    // 8
    pub claimed: bool,          // 1
    pub bump: u8,               // 1
}

impl UnstakeTicket {
    pub const LEN: usize = 8 + 32 + 8 * 2 + 1 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub underlying_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = StakingPool::LEN,
        seeds = [b"pool", authority.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, StakingPool>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = pool,
        seeds = [b"lst_mint", pool.key().as_ref()],
        bump,
    )]
    pub lst_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = underlying_mint,
        token::authority = pool,
        seeds = [b"wsol_vault", pool.key().as_ref()],
        bump,
    )]
    pub wsol_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, StakingPool>,

    #[account(mut, constraint = lst_mint.key() == pool.lst_mint)]
    pub lst_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = wsol_vault.key() == pool.wsol_vault,
    )]
    pub wsol_vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = pool.underlying_mint, token::authority = user)]
    pub user_underlying: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lst_mint,
        associated_token::authority = user,
    )]
    pub user_lst: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lst_amount: u64)]
pub struct RequestUnstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, StakingPool>,

    #[account(mut, constraint = lst_mint.key() == pool.lst_mint)]
    pub lst_mint: Account<'info, Mint>,

    #[account(mut, token::mint = lst_mint, token::authority = user)]
    pub user_lst: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = UnstakeTicket::LEN,
        seeds = [b"ticket", user.key().as_ref(), &lst_amount.to_le_bytes()],
        bump,
    )]
    pub unstake_ticket: Account<'info, UnstakeTicket>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimUnstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, StakingPool>,

    #[account(
        mut,
        constraint = wsol_vault.key() == pool.wsol_vault,
    )]
    pub wsol_vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = pool.underlying_mint, token::authority = user)]
    pub user_underlying: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = unstake_ticket.owner == user.key(),
        close = user,
    )]
    pub unstake_ticket: Account<'info, UnstakeTicket>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AccrueYield<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, StakingPool>,
}

#[derive(Accounts)]
pub struct GetStakeQuote<'info> {
    pub pool: Account<'info, StakingPool>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("LST amount computed is zero")]
    ZeroLstAmount,
    #[msg("Insufficient staked balance")]
    InsufficientStake,
    #[msg("Cooldown period has not expired yet")]
    CooldownNotExpired,
    #[msg("Unstake ticket already claimed")]
    AlreadyClaimed,
    #[msg("Invalid cooldown slots")]
    InvalidCooldown,
    #[msg("Yield too high (max 5000 bps = 50%)")]
    YieldTooHigh,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
}
