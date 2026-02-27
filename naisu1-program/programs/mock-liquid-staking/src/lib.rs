use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("BK8wLw9FSw1n3SvQP8XDYoxWtcvaodSbgemtjVk96jkX");

/// Mock Liquid Staking — simulates a Jito/Marinade-style LST protocol.
///
/// Flow:
///   1. Admin calls `initialize` to create a staking pool and mint the LST token.
///   2. Users call `stake` → deposit SOL → receive LST tokens at current exchange rate.
///   3. Users call `request_unstake` → burn LST → create an UnstakeTicket with cooldown.
///   4. After cooldown_slots have passed, users call `claim_unstake` → receive SOL back.
///
/// Exchange rate starts at 1 SOL = 1 LST and increases as yield accumulates (via `accrue_yield`).
#[program]
pub mod mock_liquid_staking {
    use super::*;

    /// Initialize the staking pool with an exchange rate of 1.0 (scaled by RATE_SCALE).
    pub fn initialize(
        ctx: Context<Initialize>,
        cooldown_slots: u64,
        yield_bps_per_epoch: u16, // Simulated APY in bps per epoch (e.g. 700 = 7%)
    ) -> Result<()> {
        require!(cooldown_slots > 0, StakingError::InvalidCooldown);
        require!(yield_bps_per_epoch <= 5000, StakingError::YieldTooHigh);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.lst_mint = ctx.accounts.lst_mint.key();
        pool.sol_vault = ctx.accounts.sol_vault.key();
        pool.total_staked_sol = 0;
        pool.total_lst_supply = 0;
        // Exchange rate: 1 SOL = 1 LST initially, stored as (rate * RATE_SCALE)
        pool.exchange_rate = RATE_SCALE;
        pool.cooldown_slots = cooldown_slots;
        pool.yield_bps_per_epoch = yield_bps_per_epoch;
        pool.last_yield_slot = Clock::get()?.slot;
        pool.bump = ctx.bumps.pool;
        pool.sol_vault_bump = ctx.bumps.sol_vault;

        msg!(
            "Staking pool initialized: cooldown_slots={}, yield_bps_per_epoch={}",
            cooldown_slots,
            yield_bps_per_epoch
        );
        Ok(())
    }

    /// Stake SOL → receive LST tokens.
    /// LST amount = sol_amount * RATE_SCALE / exchange_rate
    pub fn stake(ctx: Context<Stake>, sol_amount: u64) -> Result<()> {
        require!(sol_amount > 0, StakingError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let exchange_rate = pool.exchange_rate;

        // LST to mint = sol_amount * RATE_SCALE / exchange_rate
        let lst_amount = (sol_amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        require!(lst_amount > 0, StakingError::ZeroLstAmount);

        // Transfer SOL from user to sol_vault
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.sol_vault.key(),
            sol_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let pool_key = ctx.accounts.pool.key();
        let pool_seeds = &[
            b"pool".as_ref(),
            pool_key.as_ref(),
            &[ctx.accounts.pool.bump],
        ];

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
        pool.total_staked_sol = pool
            .total_staked_sol
            .checked_add(sol_amount)
            .ok_or(StakingError::MathOverflow)?;
        pool.total_lst_supply = pool
            .total_lst_supply
            .checked_add(lst_amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "Staked: sol={}, lst_minted={}, exchange_rate={}",
            sol_amount,
            lst_amount,
            exchange_rate
        );
        Ok(())
    }

    /// Request unstake: burn LST → create ticket with cooldown.
    pub fn request_unstake(ctx: Context<RequestUnstake>, lst_amount: u64) -> Result<()> {
        require!(lst_amount > 0, StakingError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let exchange_rate = pool.exchange_rate;

        // SOL to receive = lst_amount * exchange_rate / RATE_SCALE
        let sol_amount = (lst_amount as u128)
            .checked_mul(exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        require!(sol_amount > 0, StakingError::ZeroAmount);
        require!(
            sol_amount <= pool.total_staked_sol,
            StakingError::InsufficientStake
        );

        // Burn LST from user
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

        // Create unstake ticket
        let ticket = &mut ctx.accounts.unstake_ticket;
        ticket.owner = ctx.accounts.user.key();
        ticket.sol_amount = sol_amount;
        ticket.claimable_slot = Clock::get()?.slot + pool.cooldown_slots;
        ticket.claimed = false;
        ticket.bump = ctx.bumps.unstake_ticket;

        let pool = &mut ctx.accounts.pool;
        pool.total_staked_sol = pool
            .total_staked_sol
            .checked_sub(sol_amount)
            .ok_or(StakingError::MathOverflow)?;
        pool.total_lst_supply = pool
            .total_lst_supply
            .checked_sub(lst_amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "UnstakeRequested: lst_burned={}, sol_claimable={}, claimable_at_slot={}",
            lst_amount,
            sol_amount,
            ticket.claimable_slot
        );
        Ok(())
    }

    /// Claim SOL after cooldown.
    pub fn claim_unstake(ctx: Context<ClaimUnstake>) -> Result<()> {
        let ticket = &ctx.accounts.unstake_ticket;
        require!(!ticket.claimed, StakingError::AlreadyClaimed);

        let current_slot = Clock::get()?.slot;
        require!(
            current_slot >= ticket.claimable_slot,
            StakingError::CooldownNotExpired
        );

        let sol_amount = ticket.sol_amount;
        require!(sol_amount > 0, StakingError::ZeroAmount);

        let pool_key = ctx.accounts.pool.key();
        let vault_seeds = &[
            b"sol_vault".as_ref(),
            pool_key.as_ref(),
            &[ctx.accounts.pool.sol_vault_bump],
        ];

        // Transfer SOL from vault back to user
        **ctx
            .accounts
            .sol_vault
            .to_account_info()
            .try_borrow_mut_lamports()? -= sol_amount;
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? += sol_amount;

        let ticket = &mut ctx.accounts.unstake_ticket;
        ticket.claimed = true;

        msg!("UnstakeClaimed: sol={}", sol_amount);
        Ok(())
    }

    /// Admin: simulate yield accrual — increases exchange rate.
    /// exchange_rate += exchange_rate * yield_bps_per_epoch / 10000
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

        msg!("YieldAccrued: new_exchange_rate={}", pool.exchange_rate);
        Ok(())
    }

    /// Get current quote: how many LST for given SOL (or vice versa).
    pub fn get_stake_quote(ctx: Context<GetStakeQuote>, sol_amount: u64) -> Result<u64> {
        let pool = &ctx.accounts.pool;
        let lst_amount = (sol_amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(pool.exchange_rate as u128)
            .ok_or(StakingError::MathOverflow)? as u64;

        msg!(
            "StakeQuote: sol={}, lst={}, rate={}",
            sol_amount,
            lst_amount,
            pool.exchange_rate
        );
        Ok(lst_amount)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Exchange rate scaling factor (1e9 for SOL precision)
pub const RATE_SCALE: u64 = 1_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// Account Structs
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct StakingPool {
    pub authority: Pubkey,        // 32
    pub lst_mint: Pubkey,         // 32
    pub sol_vault: Pubkey,        // 32
    pub total_staked_sol: u64,    // 8
    pub total_lst_supply: u64,    // 8
    pub exchange_rate: u64,       // 8  (rate * RATE_SCALE, starts at RATE_SCALE)
    pub cooldown_slots: u64,      // 8
    pub yield_bps_per_epoch: u16, // 2
    pub last_yield_slot: u64,     // 8
    pub bump: u8,                 // 1
    pub sol_vault_bump: u8,       // 1
}

impl StakingPool {
    pub const LEN: usize = 8 + 32 * 3 + 8 * 5 + 2 + 1 * 2;
}

#[account]
pub struct UnstakeTicket {
    pub owner: Pubkey,       // 32
    pub sol_amount: u64,     // 8
    pub claimable_slot: u64, // 8
    pub claimed: bool,       // 1
    pub bump: u8,            // 1
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

    /// CHECK: SOL vault is a system account PDA owned by this program.
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump,
    )]
    pub sol_vault: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
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

    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump = pool.sol_vault_bump,
    )]
    pub sol_vault: AccountInfo<'info>,

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

    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump = pool.sol_vault_bump,
    )]
    pub sol_vault: AccountInfo<'info>,

    #[account(
        mut,
        constraint = unstake_ticket.owner == user.key(),
        close = user,
    )]
    pub unstake_ticket: Account<'info, UnstakeTicket>,

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
