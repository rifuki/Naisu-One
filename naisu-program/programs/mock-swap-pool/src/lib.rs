use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("C8mdHSpvcb5MjtxZVT5Tp1dft2Kr1mxEo2aRkp6APs8Z");

/// Mock AMM swap pool using constant-product formula (x * y = k).
/// Designed for AI agent demo on Solana devnet.
#[program]
pub mod mock_swap_pool {
    use super::*;

    /// Initialize a new swap pool with two token mints.
    /// Sets initial reserves via liquidity deposit from initializer.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        fee_bps: u16, // Fee in basis points (e.g. 30 = 0.3%)
        initial_amount_a: u64,
        initial_amount_b: u64,
    ) -> Result<()> {
        require!(fee_bps <= 1000, SwapError::FeeTooHigh);
        require!(
            initial_amount_a > 0 && initial_amount_b > 0,
            SwapError::ZeroAmount
        );

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint_a = ctx.accounts.mint_a.key();
        pool.mint_b = ctx.accounts.mint_b.key();
        pool.vault_a = ctx.accounts.vault_a.key();
        pool.vault_b = ctx.accounts.vault_b.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.fee_bps = fee_bps;
        pool.reserve_a = initial_amount_a;
        pool.reserve_b = initial_amount_b;
        pool.total_lp_supply = 0;
        pool.bump = ctx.bumps.pool;

        // Transfer initial token A from authority to vault A
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            initial_amount_a,
        )?;

        // Transfer initial token B from authority to vault B
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            initial_amount_b,
        )?;

        // Mint initial LP tokens (sqrt of product as initial supply)
        let lp_amount = integer_sqrt(initial_amount_a as u128 * initial_amount_b as u128) as u64;
        require!(lp_amount > 0, SwapError::ZeroLpAmount);

        // Store keys and bump before dropping mutable borrow of pool
        let mint_a_key = ctx.accounts.mint_a.key();
        let mint_b_key = ctx.accounts.mint_b.key();
        let pool_bump = pool.bump;

        // Drop mutable borrow so we can use ctx.accounts.pool immutably below
        drop(pool);

        let pool_seeds = &[
            b"pool".as_ref(),
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[pool_bump],
        ];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.authority_lp.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            lp_amount,
        )?;

        ctx.accounts.pool.total_lp_supply = lp_amount;

        msg!(
            "Pool initialized: reserve_a={}, reserve_b={}, lp_minted={}",
            initial_amount_a,
            initial_amount_b,
            lp_amount
        );
        Ok(())
    }

    /// Swap token A for token B (or B for A based on a_to_b flag).
    /// Uses constant-product formula with fee deduction.
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        require!(amount_in > 0, SwapError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let (reserve_in, reserve_out) = if a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        // Calculate amount out with fee: amount_in_after_fee = amount_in * (10000 - fee_bps) / 10000
        let fee_bps = pool.fee_bps as u128;
        let amount_in_u128 = amount_in as u128;
        let amount_in_after_fee = amount_in_u128 * (10000 - fee_bps) / 10000;

        // Constant product formula: amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
        let reserve_in_u128 = reserve_in as u128;
        let reserve_out_u128 = reserve_out as u128;
        let amount_out =
            reserve_out_u128 * amount_in_after_fee / (reserve_in_u128 + amount_in_after_fee);
        let amount_out = amount_out as u64;

        require!(amount_out >= min_amount_out, SwapError::SlippageExceeded);
        require!(amount_out < reserve_out, SwapError::InsufficientLiquidity);

        let pool_bump = pool.bump;
        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let pool_seeds = &[
            b"pool".as_ref(),
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[pool_bump],
        ];

        if a_to_b {
            // Transfer token A from user to vault A
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_token_in.to_account_info(),
                        to: ctx.accounts.vault_in.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            // Transfer token B from vault B to user
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_out.to_account_info(),
                        to: ctx.accounts.user_token_out.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[pool_seeds],
                ),
                amount_out,
            )?;
        } else {
            // Transfer token B from user to vault B
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_token_in.to_account_info(),
                        to: ctx.accounts.vault_in.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            // Transfer token A from vault A to user
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_out.to_account_info(),
                        to: ctx.accounts.user_token_out.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[pool_seeds],
                ),
                amount_out,
            )?;
        }

        // Update reserves
        let pool = &mut ctx.accounts.pool;
        if a_to_b {
            pool.reserve_a = pool
                .reserve_a
                .checked_add(amount_in)
                .ok_or(SwapError::MathOverflow)?;
            pool.reserve_b = pool
                .reserve_b
                .checked_sub(amount_out)
                .ok_or(SwapError::MathOverflow)?;
        } else {
            pool.reserve_b = pool
                .reserve_b
                .checked_add(amount_in)
                .ok_or(SwapError::MathOverflow)?;
            pool.reserve_a = pool
                .reserve_a
                .checked_sub(amount_out)
                .ok_or(SwapError::MathOverflow)?;
        }

        msg!(
            "Swap: amount_in={}, amount_out={}, a_to_b={}, new_reserve_a={}, new_reserve_b={}",
            amount_in,
            amount_out,
            a_to_b,
            pool.reserve_a,
            pool.reserve_b
        );
        Ok(())
    }

    /// Get a quote for a swap without executing it.
    /// Returns expected output amount.
    pub fn get_quote(ctx: Context<GetQuote>, amount_in: u64, a_to_b: bool) -> Result<u64> {
        require!(amount_in > 0, SwapError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let (reserve_in, reserve_out) = if a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let fee_bps = pool.fee_bps as u128;
        let amount_in_u128 = amount_in as u128;
        let amount_in_after_fee = amount_in_u128 * (10000 - fee_bps) / 10000;
        let reserve_in_u128 = reserve_in as u128;
        let reserve_out_u128 = reserve_out as u128;
        let amount_out = (reserve_out_u128 * amount_in_after_fee
            / (reserve_in_u128 + amount_in_after_fee)) as u64;

        msg!(
            "Quote: amount_in={}, amount_out={}, a_to_b={}",
            amount_in,
            amount_out,
            a_to_b
        );
        Ok(amount_out)
    }

    /// Add liquidity to the pool proportionally.
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a_desired: u64,
        amount_b_desired: u64,
        min_lp: u64,
    ) -> Result<()> {
        require!(
            amount_a_desired > 0 && amount_b_desired > 0,
            SwapError::ZeroAmount
        );

        let pool = &ctx.accounts.pool;
        let reserve_a = pool.reserve_a;
        let reserve_b = pool.reserve_b;
        let total_lp = pool.total_lp_supply;

        // Calculate optimal amounts maintaining ratio
        let amount_a: u64;
        let amount_b: u64;
        let lp_to_mint: u64;

        if reserve_a == 0 && reserve_b == 0 {
            amount_a = amount_a_desired;
            amount_b = amount_b_desired;
            lp_to_mint = integer_sqrt(amount_a as u128 * amount_b as u128) as u64;
        } else {
            // Calculate optimal B for given A
            let optimal_b =
                (amount_a_desired as u128 * reserve_b as u128 / reserve_a as u128) as u64;
            if optimal_b <= amount_b_desired {
                amount_a = amount_a_desired;
                amount_b = optimal_b;
            } else {
                let optimal_a =
                    (amount_b_desired as u128 * reserve_a as u128 / reserve_b as u128) as u64;
                amount_a = optimal_a;
                amount_b = amount_b_desired;
            }
            // LP = min(amount_a/reserve_a, amount_b/reserve_b) * total_lp
            let lp_a = (amount_a as u128 * total_lp as u128 / reserve_a as u128) as u64;
            let lp_b = (amount_b as u128 * total_lp as u128 / reserve_b as u128) as u64;
            lp_to_mint = lp_a.min(lp_b);
        }

        require!(lp_to_mint >= min_lp, SwapError::SlippageExceeded);

        let pool_bump = pool.bump;
        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let pool_seeds = &[
            b"pool".as_ref(),
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[pool_bump],
        ];

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_a,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_b,
        )?;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.user_lp.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            lp_to_mint,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.reserve_a = pool
            .reserve_a
            .checked_add(amount_a)
            .ok_or(SwapError::MathOverflow)?;
        pool.reserve_b = pool
            .reserve_b
            .checked_add(amount_b)
            .ok_or(SwapError::MathOverflow)?;
        pool.total_lp_supply = pool
            .total_lp_supply
            .checked_add(lp_to_mint)
            .ok_or(SwapError::MathOverflow)?;

        msg!(
            "AddLiquidity: a={}, b={}, lp_minted={}",
            amount_a,
            amount_b,
            lp_to_mint
        );
        Ok(())
    }

    /// Remove liquidity by burning LP tokens.
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_amount_a: u64,
        min_amount_b: u64,
    ) -> Result<()> {
        require!(lp_amount > 0, SwapError::ZeroAmount);

        let pool = &ctx.accounts.pool;
        let reserve_a = pool.reserve_a;
        let reserve_b = pool.reserve_b;
        let total_lp = pool.total_lp_supply;

        require!(total_lp > 0, SwapError::InsufficientLiquidity);

        let amount_a = (reserve_a as u128 * lp_amount as u128 / total_lp as u128) as u64;
        let amount_b = (reserve_b as u128 * lp_amount as u128 / total_lp as u128) as u64;

        require!(amount_a >= min_amount_a, SwapError::SlippageExceeded);
        require!(amount_b >= min_amount_b, SwapError::SlippageExceeded);

        let pool_bump = pool.bump;
        let mint_a_key = pool.mint_a;
        let mint_b_key = pool.mint_b;
        let pool_seeds = &[
            b"pool".as_ref(),
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[pool_bump],
        ];

        // Burn LP tokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.user_lp.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_amount,
        )?;

        // Transfer token A back to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_a.to_account_info(),
                    to: ctx.accounts.user_token_a.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            amount_a,
        )?;

        // Transfer token B back to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_b.to_account_info(),
                    to: ctx.accounts.user_token_b.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            amount_b,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.reserve_a = pool
            .reserve_a
            .checked_sub(amount_a)
            .ok_or(SwapError::MathOverflow)?;
        pool.reserve_b = pool
            .reserve_b
            .checked_sub(amount_b)
            .ok_or(SwapError::MathOverflow)?;
        pool.total_lp_supply = pool
            .total_lp_supply
            .checked_sub(lp_amount)
            .ok_or(SwapError::MathOverflow)?;

        msg!(
            "RemoveLiquidity: a={}, b={}, lp_burned={}",
            amount_a,
            amount_b,
            lp_amount
        );
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Structs
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct Pool {
    pub authority: Pubkey,    // 32
    pub mint_a: Pubkey,       // 32
    pub mint_b: Pubkey,       // 32
    pub vault_a: Pubkey,      // 32
    pub vault_b: Pubkey,      // 32
    pub lp_mint: Pubkey,      // 32
    pub fee_bps: u16,         // 2
    pub reserve_a: u64,       // 8
    pub reserve_b: u64,       // 8
    pub total_lp_supply: u64, // 8
    pub bump: u8,             // 1
}

impl Pool {
    pub const LEN: usize = 8 + 32 * 6 + 2 + 8 * 3 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = Pool::LEN,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = authority,
        token::mint = mint_a,
        token::authority = pool,
        seeds = [b"vault_a", pool.key().as_ref()],
        bump,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = mint_b,
        token::authority = pool,
        seeds = [b"vault_b", pool.key().as_ref()],
        bump,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 6,
        mint::authority = pool,
        seeds = [b"lp_mint", pool.key().as_ref()],
        bump,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint_a, token::authority = authority)]
    pub authority_token_a: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint_b, token::authority = authority)]
    pub authority_token_b: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = lp_mint,
        associated_token::authority = authority,
    )]
    pub authority_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, constraint = vault_in.key() == pool.vault_a || vault_in.key() == pool.vault_b)]
    pub vault_in: Account<'info, TokenAccount>,

    #[account(mut, constraint = vault_out.key() == pool.vault_a || vault_out.key() == pool.vault_b)]
    pub vault_out: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct GetQuote<'info> {
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, constraint = vault_a.key() == pool.vault_a)]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(mut, constraint = vault_b.key() == pool.vault_b)]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut, constraint = lp_mint.key() == pool.lp_mint)]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut, token::mint = pool.mint_a, token::authority = user)]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(mut, token::mint = pool.mint_b, token::authority = user)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_mint,
        associated_token::authority = user,
    )]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, constraint = vault_a.key() == pool.vault_a)]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(mut, constraint = vault_b.key() == pool.vault_b)]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut, constraint = lp_mint.key() == pool.lp_mint)]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut, token::mint = pool.mint_a, token::authority = user)]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(mut, token::mint = pool.mint_b, token::authority = user)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum SwapError {
    #[msg("Fee too high (max 1000 bps = 10%)")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("LP amount is zero")]
    ZeroLpAmount,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Insufficient liquidity in pool")]
    InsufficientLiquidity,
    #[msg("Math overflow")]
    MathOverflow,
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
