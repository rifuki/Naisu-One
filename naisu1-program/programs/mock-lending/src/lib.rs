use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("9DGDU4hhYBbdLzhU8wSZDJiuGekJZZ3AZGkUotZRUXZs");

/// Mock Lending/Yield — simulates a Kamino/Save-style lending protocol.
///
/// Flow:
///   1. Admin calls `initialize_market` to create a lending market for a token.
///   2. Users call `deposit` → lock tokens → receive yield-bearing receipt tokens (yTokens).
///   3. Yield accrues per slot based on configured APY.
///   4. Users call `withdraw` → burn yTokens → receive original tokens + accrued yield.
///   5. Users can `borrow` against their deposit (collateral factor applies).
///   6. Users `repay` borrowed amount with interest.
///
/// Exchange rate between yToken and underlying starts at 1:1 and grows as yield accrues.
#[program]
pub mod mock_lending {
    use super::*;

    /// Initialize a lending market for a specific token.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        supply_apy_bps: u16,        // Supply APY in bps (e.g. 500 = 5%)
        borrow_apy_bps: u16,        // Borrow APY in bps (e.g. 800 = 8%)
        collateral_factor_bps: u16, // Max LTV in bps (e.g. 7500 = 75%)
    ) -> Result<()> {
        require!(supply_apy_bps <= 10000, LendingError::InvalidParam);
        require!(borrow_apy_bps <= 20000, LendingError::InvalidParam);
        require!(collateral_factor_bps <= 9500, LendingError::InvalidParam);
        require!(borrow_apy_bps >= supply_apy_bps, LendingError::InvalidParam);

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.underlying_mint = ctx.accounts.underlying_mint.key();
        market.y_token_mint = ctx.accounts.y_token_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.total_deposited = 0;
        market.total_borrowed = 0;
        market.total_y_supply = 0;
        market.exchange_rate = RATE_SCALE; // starts 1:1
        market.supply_apy_bps = supply_apy_bps;
        market.borrow_apy_bps = borrow_apy_bps;
        market.collateral_factor_bps = collateral_factor_bps;
        market.last_accrual_slot = Clock::get()?.slot;
        market.bump = ctx.bumps.market;

        msg!(
            "Market initialized: supply_apy={}bps, borrow_apy={}bps, ltv={}bps",
            supply_apy_bps,
            borrow_apy_bps,
            collateral_factor_bps
        );
        Ok(())
    }

    /// Deposit tokens → receive yTokens.
    /// yToken amount = deposit_amount * RATE_SCALE / exchange_rate
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, LendingError::ZeroAmount);

        // Accrue yield before calculating exchange rate
        accrue_yield_internal(&mut ctx.accounts.market)?;

        let market = &ctx.accounts.market;
        let y_amount = (amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(market.exchange_rate as u128)
            .ok_or(LendingError::MathOverflow)? as u64;

        require!(y_amount > 0, LendingError::ZeroAmount);

        // Transfer underlying from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let market_key = ctx.accounts.market.key();
        let market_seeds = &[
            b"market".as_ref(),
            market_key.as_ref(),
            &[ctx.accounts.market.bump],
        ];

        // Mint yTokens to user
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.y_token_mint.to_account_info(),
                    to: ctx.accounts.user_y_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[market_seeds],
            ),
            y_amount,
        )?;

        // Update user position
        let position = &mut ctx.accounts.user_position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.user.key();
            position.market = ctx.accounts.market.key();
            position.bump = ctx.bumps.user_position;
        }
        position.y_token_balance = position
            .y_token_balance
            .checked_add(y_amount)
            .ok_or(LendingError::MathOverflow)?;
        position.deposit_slot = Clock::get()?.slot;

        let market = &mut ctx.accounts.market;
        market.total_deposited = market
            .total_deposited
            .checked_add(amount)
            .ok_or(LendingError::MathOverflow)?;
        market.total_y_supply = market
            .total_y_supply
            .checked_add(y_amount)
            .ok_or(LendingError::MathOverflow)?;

        msg!(
            "Deposited: amount={}, y_minted={}, rate={}",
            amount,
            y_amount,
            market.exchange_rate
        );
        Ok(())
    }

    /// Withdraw by burning yTokens → receive underlying + yield.
    pub fn withdraw(ctx: Context<Withdraw>, y_amount: u64) -> Result<()> {
        require!(y_amount > 0, LendingError::ZeroAmount);

        // Accrue yield first
        accrue_yield_internal(&mut ctx.accounts.market)?;

        let market = &ctx.accounts.market;
        let position = &ctx.accounts.user_position;

        require!(
            position.y_token_balance >= y_amount,
            LendingError::InsufficientBalance
        );

        // Check not over-borrowed
        let remaining_y = position
            .y_token_balance
            .checked_sub(y_amount)
            .ok_or(LendingError::MathOverflow)?;
        let remaining_collateral = (remaining_y as u128)
            .checked_mul(market.exchange_rate as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(RATE_SCALE as u128)
            .ok_or(LendingError::MathOverflow)? as u64;
        let max_borrow = (remaining_collateral as u128)
            .checked_mul(market.collateral_factor_bps as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LendingError::MathOverflow)? as u64;
        require!(
            position.borrowed_amount <= max_borrow,
            LendingError::BorrowLimitExceeded
        );

        // Calculate underlying to return
        let underlying_amount = (y_amount as u128)
            .checked_mul(market.exchange_rate as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(RATE_SCALE as u128)
            .ok_or(LendingError::MathOverflow)? as u64;

        require!(
            underlying_amount <= market.total_deposited - market.total_borrowed,
            LendingError::InsufficientLiquidity
        );

        let market_key = ctx.accounts.market.key();
        let market_seeds = &[
            b"market".as_ref(),
            market_key.as_ref(),
            &[ctx.accounts.market.bump],
        ];

        // Burn yTokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.y_token_mint.to_account_info(),
                    from: ctx.accounts.user_y_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            y_amount,
        )?;

        // Transfer underlying back to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[market_seeds],
            ),
            underlying_amount,
        )?;

        let position = &mut ctx.accounts.user_position;
        position.y_token_balance = position
            .y_token_balance
            .checked_sub(y_amount)
            .ok_or(LendingError::MathOverflow)?;

        let market = &mut ctx.accounts.market;
        market.total_deposited = market
            .total_deposited
            .checked_sub(underlying_amount)
            .ok_or(LendingError::MathOverflow)?;
        market.total_y_supply = market
            .total_y_supply
            .checked_sub(y_amount)
            .ok_or(LendingError::MathOverflow)?;

        msg!(
            "Withdrawn: y_burned={}, underlying={}, rate={}",
            y_amount,
            underlying_amount,
            market.exchange_rate
        );
        Ok(())
    }

    /// Borrow tokens against deposited collateral.
    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        require!(amount > 0, LendingError::ZeroAmount);

        accrue_yield_internal(&mut ctx.accounts.market)?;

        let market = &ctx.accounts.market;
        let position = &ctx.accounts.user_position;

        // Calculate collateral value in underlying
        let collateral_value = (position.y_token_balance as u128)
            .checked_mul(market.exchange_rate as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(RATE_SCALE as u128)
            .ok_or(LendingError::MathOverflow)? as u64;

        let max_borrow = (collateral_value as u128)
            .checked_mul(market.collateral_factor_bps as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LendingError::MathOverflow)? as u64;

        let new_borrowed = position
            .borrowed_amount
            .checked_add(amount)
            .ok_or(LendingError::MathOverflow)?;
        require!(
            new_borrowed <= max_borrow,
            LendingError::BorrowLimitExceeded
        );
        require!(
            amount <= market.total_deposited - market.total_borrowed,
            LendingError::InsufficientLiquidity
        );

        let market_key = ctx.accounts.market.key();
        let market_seeds = &[
            b"market".as_ref(),
            market_key.as_ref(),
            &[ctx.accounts.market.bump],
        ];

        // Transfer tokens from vault to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[market_seeds],
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.user_position;
        position.borrowed_amount = new_borrowed;
        position.borrow_slot = Clock::get()?.slot;

        let market = &mut ctx.accounts.market;
        market.total_borrowed = market
            .total_borrowed
            .checked_add(amount)
            .ok_or(LendingError::MathOverflow)?;

        msg!(
            "Borrowed: amount={}, total_borrowed={}",
            amount,
            market.total_borrowed
        );
        Ok(())
    }

    /// Repay borrowed tokens.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        require!(amount > 0, LendingError::ZeroAmount);

        let position = &ctx.accounts.user_position;
        let repay_amount = amount.min(position.borrowed_amount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            repay_amount,
        )?;

        let position = &mut ctx.accounts.user_position;
        position.borrowed_amount = position
            .borrowed_amount
            .checked_sub(repay_amount)
            .ok_or(LendingError::MathOverflow)?;

        let market = &mut ctx.accounts.market;
        market.total_borrowed = market
            .total_borrowed
            .checked_sub(repay_amount)
            .ok_or(LendingError::MathOverflow)?;

        msg!(
            "Repaid: amount={}, remaining_borrow={}",
            repay_amount,
            position.borrowed_amount
        );
        Ok(())
    }

    /// Get deposit quote: how many yTokens for given deposit.
    pub fn get_deposit_quote(ctx: Context<GetQuote>, amount: u64) -> Result<u64> {
        let market = &ctx.accounts.market;
        let y_amount = (amount as u128)
            .checked_mul(RATE_SCALE as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(market.exchange_rate as u128)
            .ok_or(LendingError::MathOverflow)? as u64;

        msg!(
            "DepositQuote: amount={}, y_tokens={}, rate={}",
            amount,
            y_amount,
            market.exchange_rate
        );
        Ok(y_amount)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

pub const RATE_SCALE: u64 = 1_000_000_000;
/// Slots per year approximation (Solana ~2 slots/sec, 31.5M seconds/year)
const SLOTS_PER_YEAR: u64 = 63_000_000;

fn accrue_yield_internal(market: &mut LendingMarket) -> Result<()> {
    let current_slot = Clock::get()?.slot;
    let slots_elapsed = current_slot.saturating_sub(market.last_accrual_slot);
    if slots_elapsed == 0 {
        return Ok(());
    }

    // rate_increase_per_slot = supply_apy_bps / 10000 / SLOTS_PER_YEAR
    // new_rate = old_rate * (1 + rate_per_slot)^slots_elapsed
    // Approximation for small values: new_rate = old_rate + old_rate * slots_elapsed * apy_bps / (10000 * SLOTS_PER_YEAR)
    let yield_numerator = (market.exchange_rate as u128)
        .checked_mul(slots_elapsed as u128)
        .ok_or(LendingError::MathOverflow)?
        .checked_mul(market.supply_apy_bps as u128)
        .ok_or(LendingError::MathOverflow)?;
    let yield_denominator = 10000u128 * SLOTS_PER_YEAR as u128;
    let yield_delta = yield_numerator / yield_denominator;

    market.exchange_rate = (market.exchange_rate as u128 + yield_delta) as u64;
    market.last_accrual_slot = current_slot;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Structs
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct LendingMarket {
    pub authority: Pubkey,          // 32
    pub underlying_mint: Pubkey,    // 32
    pub y_token_mint: Pubkey,       // 32
    pub vault: Pubkey,              // 32
    pub total_deposited: u64,       // 8
    pub total_borrowed: u64,        // 8
    pub total_y_supply: u64,        // 8
    pub exchange_rate: u64,         // 8
    pub supply_apy_bps: u16,        // 2
    pub borrow_apy_bps: u16,        // 2
    pub collateral_factor_bps: u16, // 2
    pub last_accrual_slot: u64,     // 8
    pub bump: u8,                   // 1
}

impl LendingMarket {
    pub const LEN: usize = 8 + 32 * 4 + 8 * 5 + 2 * 3 + 1;
}

#[account]
#[derive(Default)]
pub struct UserPosition {
    pub owner: Pubkey,        // 32
    pub market: Pubkey,       // 32
    pub y_token_balance: u64, // 8
    pub borrowed_amount: u64, // 8
    pub deposit_slot: u64,    // 8
    pub borrow_slot: u64,     // 8
    pub bump: u8,             // 1
}

impl UserPosition {
    pub const LEN: usize = 8 + 32 * 2 + 8 * 4 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub underlying_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = LendingMarket::LEN,
        seeds = [b"market", underlying_mint.key().as_ref()],
        bump,
    )]
    pub market: Account<'info, LendingMarket>,

    #[account(
        init,
        payer = authority,
        mint::decimals = underlying_mint.decimals,
        mint::authority = market,
        seeds = [b"y_mint", market.key().as_ref()],
        bump,
    )]
    pub y_token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = underlying_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.underlying_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, LendingMarket>,

    #[account(mut, constraint = y_token_mint.key() == market.y_token_mint)]
    pub y_token_mint: Account<'info, Mint>,

    #[account(mut, constraint = vault.key() == market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = market.underlying_mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = y_token_mint,
        associated_token::authority = user,
    )]
    pub user_y_token: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserPosition::LEN,
        seeds = [b"position", user.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.underlying_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, LendingMarket>,

    #[account(mut, constraint = y_token_mint.key() == market.y_token_mint)]
    pub y_token_mint: Account<'info, Mint>,

    #[account(mut, constraint = vault.key() == market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = market.underlying_mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,

    #[account(mut, token::mint = y_token_mint, token::authority = user)]
    pub user_y_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), market.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key(),
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.underlying_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, LendingMarket>,

    #[account(mut, constraint = vault.key() == market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        token::mint = market.underlying_mint,
        token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), market.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key(),
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.underlying_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, LendingMarket>,

    #[account(mut, constraint = vault.key() == market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = market.underlying_mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), market.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key(),
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetQuote<'info> {
    pub market: Account<'info, LendingMarket>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum LendingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Borrow limit exceeded")]
    BorrowLimitExceeded,
    #[msg("Insufficient liquidity in market")]
    InsufficientLiquidity,
    #[msg("Invalid parameter")]
    InvalidParam,
    #[msg("Math overflow")]
    MathOverflow,
}
