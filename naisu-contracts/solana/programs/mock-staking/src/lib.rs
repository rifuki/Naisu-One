use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Burn, Mint, MintTo, SetAuthority, TokenAccount, TokenInterface},
};

declare_id!("9W1HN3QiTTUjBgr6ACPQT6jR6SQwgBdi2mFbb44aiWvJ");

// ── State ─────────────────────────────────────────────────────────────────────

/// Per-mint vault state — PDA: [b"vault", mint.key()]
/// Size: 8 (disc) + 32 (authority) + 32 (mint) + 8 (exchange_rate) + 8 (total_deposited) + 1 (bump) = 89
#[account]
pub struct VaultState {
    pub authority: Pubkey,    // admin who can update rate
    pub mint: Pubkey,         // the token mint this vault controls
    pub exchange_rate: u64,   // tokens per SOL * 1_000_000 (e.g. 1_000_000 = 1.0)
    pub total_deposited: u64, // cumulative SOL deposited (informational)
    pub bump: u8,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod mock_staking {
    use super::*;

    /// Initialize a new vault for a given mint.
    /// Transfers mint authority from the caller (current authority) to the vault PDA.
    pub fn initialize_vault(ctx: Context<InitializeVault>, exchange_rate: u64) -> Result<()> {
        require!(exchange_rate > 0, VaultError::ZeroAmount);

        let vault = &mut ctx.accounts.vault_state;
        vault.authority = ctx.accounts.authority.key();
        vault.mint = ctx.accounts.mint.key();
        vault.exchange_rate = exchange_rate;
        vault.total_deposited = 0;
        vault.bump = ctx.bumps.vault_state;

        // Transfer mint authority from caller to vault PDA
        token_interface::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType::MintTokens,
            Some(ctx.accounts.vault_state.key()),
        )?;

        msg!(
            "VaultState initialized for mint {}, rate {}",
            ctx.accounts.mint.key(),
            exchange_rate
        );
        Ok(())
    }

    /// Deposit SOL into the vault, receive staking tokens.
    /// shares = lamports * 1_000_000 / exchange_rate
    pub fn deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
        require!(lamports > 0, VaultError::ZeroAmount);

        let exchange_rate = ctx.accounts.vault_state.exchange_rate;
        let vault_bump = ctx.accounts.vault_state.bump;
        let mint_key = ctx.accounts.mint.key();

        let shares = (lamports as u128)
            .checked_mul(1_000_000)
            .ok_or(VaultError::Overflow)?
            .checked_div(exchange_rate as u128)
            .ok_or(VaultError::Overflow)? as u64;

        // Transfer SOL: depositor → vault PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault_state.to_account_info(),
                },
            ),
            lamports,
        )?;

        ctx.accounts.vault_state.total_deposited = ctx.accounts
            .vault_state
            .total_deposited
            .saturating_add(lamports);

        // Mint shares to recipient ATA — vault PDA signs as mint authority
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_ata.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                &[&[b"vault", mint_key.as_ref(), &[vault_bump]]],
            ),
            shares,
        )?;

        msg!(
            "Deposited {} lamports, minted {} shares to {}",
            lamports,
            shares,
            ctx.accounts.recipient.key()
        );
        Ok(())
    }

    /// Redeem staking tokens for SOL. Only user signature needed.
    /// sol_out = token_amount * exchange_rate / 1_000_000
    pub fn redeem(ctx: Context<Redeem>, token_amount: u64) -> Result<()> {
        require!(token_amount > 0, VaultError::ZeroAmount);

        let exchange_rate = ctx.accounts.vault_state.exchange_rate;

        let sol_out = (token_amount as u128)
            .checked_mul(exchange_rate as u128)
            .ok_or(VaultError::Overflow)?
            .checked_div(1_000_000)
            .ok_or(VaultError::Overflow)? as u64;

        require!(sol_out > 0, VaultError::ZeroAmount);

        let vault_lamports = ctx.accounts.vault_state.to_account_info().lamports();
        require!(vault_lamports >= sol_out, VaultError::InsufficientVaultBalance);

        // Burn tokens from user ATA
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // Transfer SOL: vault PDA → user via direct lamport manipulation
        **ctx
            .accounts
            .vault_state
            .to_account_info()
            .try_borrow_mut_lamports()? -= sol_out;
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? += sol_out;

        msg!(
            "Redeemed {} tokens for {} lamports for {}",
            token_amount,
            sol_out,
            ctx.accounts.user.key()
        );
        Ok(())
    }

    /// Update exchange rate — only authority can call.
    /// e.g. set to 1_059_000 for 5.9% yield accrued.
    pub fn update_rate(ctx: Context<UpdateRate>, new_rate: u64) -> Result<()> {
        require!(new_rate > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.vault_state.authority == ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        ctx.accounts.vault_state.exchange_rate = new_rate;
        msg!("Exchange rate updated to {}", new_rate);
        Ok(())
    }
}

// ── Account structs ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 8 + 1,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    /// CHECK: recipient is the ATA owner — validated via associated_token constraint on recipient_ata
    pub recipient: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault_state.bump
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault_state.bump
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UpdateRate<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault_state.mint.as_ref()],
        bump = vault_state.bump
    )]
    pub vault_state: Account<'info, VaultState>,
}
