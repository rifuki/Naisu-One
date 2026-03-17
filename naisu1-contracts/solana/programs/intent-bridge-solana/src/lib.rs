use anchor_lang::prelude::*;
use mock_staking;
use wormhole_anchor_sdk::wormhole;

declare_id!("Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN");

// Constants
pub const CONFIG_SEED: &[u8] = b"config";
pub const FOREIGN_EMITTER_SEED: &[u8] = b"foreign_emitter";
pub const EMITTER_SEED: &[u8] = b"emitter";
pub const INTENT_SEED: &[u8] = b"intent";
pub const RECEIVED_SEED: &[u8] = b"received";
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_FULFILLED: u8 = 1;
pub const STATUS_CANCELLED: u8 = 2;

// Target action discriminators (embedded in Wormhole payload for EVM to interpret)
pub const TARGET_ACTION_TRANSFER: u8 = 0;
pub const TARGET_ACTION_AUTO_STAKE: u8 = 1;

// Error codes
#[error_code]
pub enum IntentBridgeError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Already fulfilled")]
    AlreadyFulfilled,
    #[msg("Not creator")]
    NotCreator,
    #[msg("Invalid params")]
    InvalidParams,
    #[msg("Invalid emitter")]
    InvalidEmitter,
    #[msg("Invalid VAA")]
    InvalidVaa,
    #[msg("Intent ID mismatch")]
    IntentIdMismatch,
    #[msg("Expired")]
    Expired,
    #[msg("Price too low")]
    PriceTooLow,
}

// State accounts
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ForeignEmitter {
    pub chain: u16,
    pub address: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Intent {
    pub intent_id: [u8; 32],
    pub creator: Pubkey,
    pub recipient: [u8; 32],
    pub destination_chain: u16,
    pub amount: u64,
    pub start_price: u64,
    pub floor_price: u64,
    pub deadline: i64,
    pub created_at: i64,
    pub status: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Received {
    pub emitter_chain: u16,
    pub sequence: u64,
    pub bump: u8,
}

// Events
#[event]
pub struct IntentCreated {
    pub intent_id: [u8; 32],
    pub creator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct IntentCancelled {
    pub intent_id: [u8; 32],
}

#[event]
pub struct IntentFulfilled {
    pub intent_id: [u8; 32],
    pub solver: Pubkey,
    pub fulfilled_at: i64,
}

#[program]
pub mod intent_bridge_solana {
    use super::*;

    // Initialize program
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();
        config.bump = ctx.bumps.config;
        msg!("Initialized");
        Ok(())
    }

    // Register foreign emitter
    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        chain: u16,
        address: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.owner.key() == ctx.accounts.config.owner,
            IntentBridgeError::Unauthorized
        );
        let emitter = &mut ctx.accounts.foreign_emitter;
        emitter.chain = chain;
        emitter.address = address;
        emitter.bump = ctx.bumps.foreign_emitter;
        msg!("Emitter registered: {}", chain);
        Ok(())
    }

    // Create intent
    pub fn create_intent(
        ctx: Context<CreateIntent>,
        intent_id: [u8; 32],
        recipient: [u8; 32],
        destination_chain: u16,
        start_price: u64,
        floor_price: u64,
        duration_seconds: u64,
    ) -> Result<()> {
        require!(start_price >= floor_price, IntentBridgeError::InvalidParams);
        let amount = ctx.accounts.payment.lamports();
        require!(amount > 0, IntentBridgeError::InvalidParams);

        let clock = Clock::get()?;
        let deadline = clock.unix_timestamp + duration_seconds as i64;

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

        let intent = &mut ctx.accounts.intent;
        intent.intent_id = intent_id;
        intent.creator = ctx.accounts.creator.key();
        intent.recipient = recipient;
        intent.destination_chain = destination_chain;
        intent.amount = amount;
        intent.start_price = start_price;
        intent.floor_price = floor_price;
        intent.deadline = deadline;
        intent.created_at = clock.unix_timestamp;
        intent.status = STATUS_OPEN;
        intent.bump = ctx.bumps.intent;

        emit!(IntentCreated {
            intent_id,
            creator: ctx.accounts.creator.key(),
            amount
        });
        msg!("Intent created");
        Ok(())
    }

    // Cancel intent
    pub fn cancel_intent(ctx: Context<CancelIntent>) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        require!(
            intent.status == STATUS_OPEN,
            IntentBridgeError::AlreadyFulfilled
        );
        require!(
            intent.creator == ctx.accounts.creator.key(),
            IntentBridgeError::NotCreator
        );

        intent.status = STATUS_CANCELLED;
        let amount = intent.amount;
        **intent.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .creator
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;

        emit!(IntentCancelled {
            intent_id: intent.intent_id
        });
        msg!("Intent cancelled");
        Ok(())
    }

    // Solve and prove (Wormhole CPI)
    pub fn solve_and_prove(
        ctx: Context<SolveAndProve>,
        order_id: [u8; 32],
        solver_address: [u8; 32],
        amount_lamports: u64,
    ) -> Result<()> {
        // Transfer SOL
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

        // Pay Wormhole fee to fee_collector.
        // The bridge checks: fee_collector.lamports() - bridge.last_lamports >= bridge.fee
        // Using checked_sub, so if fee_collector < last_lamports it returns InsufficientFees.
        // We pay: bridge.fee + max(0, last_lamports - fee_collector) to guarantee the check passes.
        {
            let bridge_data = wormhole::BridgeData::try_deserialize_unchecked(
                &mut &ctx.accounts.wormhole_bridge.data.borrow()[..],
            )?;
            let fee = bridge_data.fee();
            let last_lamports = bridge_data.last_lamports;
            let current = ctx.accounts.wormhole_fee_collector.lamports();
            let topup = fee.saturating_add(last_lamports.saturating_sub(current));
            if topup > 0 {
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.solver.to_account_info(),
                            to: ctx.accounts.wormhole_fee_collector.to_account_info(),
                        },
                    ),
                    topup,
                )?;
            }
        }

        // Build payload
        let mut payload = Vec::with_capacity(96);
        payload.extend_from_slice(&order_id);
        payload.extend_from_slice(&solver_address);
        payload.extend_from_slice(&[0u8; 24]);
        payload.extend_from_slice(&amount_lamports.to_be_bytes());

        // CPI to Wormhole
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

        wormhole::post_message(cpi_ctx, 0, payload, wormhole::Finality::Confirmed)?;

        msg!("Order solved and proof published");
        Ok(())
    }

    // Solve, stake on behalf of recipient, and prove via Wormhole
    pub fn solve_stake_and_prove(
        ctx: Context<SolveStakeAndProve>,
        order_id: [u8; 32],
        solver_address: [u8; 32],
        amount_lamports: u64,
    ) -> Result<()> {
        // ── CPI: deposit SOL into mock-staking on behalf of recipient ─────────
        // depositor = solver (pays SOL), staker = recipient (receives stake credit)
        let cpi_program = ctx.accounts.staking_program.to_account_info();
        let cpi_accounts = mock_staking::cpi::accounts::Deposit {
            depositor: ctx.accounts.solver.to_account_info(),
            staker: ctx.accounts.recipient.to_account_info(),
            stake_pool: ctx.accounts.stake_pool.to_account_info(),
            stake_account: ctx.accounts.stake_account.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        mock_staking::cpi::deposit(CpiContext::new(cpi_program, cpi_accounts), amount_lamports)?;

        // ── Pay Wormhole fee ─────────────────────────────────────────────────
        {
            let bridge_data = wormhole::BridgeData::try_deserialize_unchecked(
                &mut &ctx.accounts.wormhole_bridge.data.borrow()[..],
            )?;
            let fee = bridge_data.fee();
            let last_lamports = bridge_data.last_lamports;
            let current = ctx.accounts.wormhole_fee_collector.lamports();
            let topup = fee.saturating_add(last_lamports.saturating_sub(current));
            if topup > 0 {
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.solver.to_account_info(),
                            to: ctx.accounts.wormhole_fee_collector.to_account_info(),
                        },
                    ),
                    topup,
                )?;
            }
        }

        // ── Build 96-byte payload (same format as solve_and_prove) ───────────
        let mut payload = Vec::with_capacity(96);
        payload.extend_from_slice(&order_id);
        payload.extend_from_slice(&solver_address);
        payload.extend_from_slice(&[0u8; 23]);
        payload.push(TARGET_ACTION_AUTO_STAKE); // byte 87: action flag
        payload.extend_from_slice(&amount_lamports.to_be_bytes());

        // ── CPI to Wormhole post_message ─────────────────────────────────────
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

        wormhole::post_message(cpi_ctx, 0, payload, wormhole::Finality::Confirmed)?;

        msg!("Order staked and proof published (action=AUTO_STAKE)");
        Ok(())
    }

    // Claim with VAA
    pub fn claim_with_vaa(ctx: Context<ClaimWithVaa>) -> Result<()> {
        let posted_vaa = &ctx.accounts.posted_vaa;

        // Verify emitter
        let foreign_emitter = &ctx.accounts.foreign_emitter;
        require!(
            posted_vaa.emitter_chain() == foreign_emitter.chain,
            IntentBridgeError::InvalidEmitter
        );
        require!(
            *posted_vaa.emitter_address() == foreign_emitter.address,
            IntentBridgeError::InvalidEmitter
        );

        // Decode payload
        let payload = &posted_vaa.payload;
        require!(payload.len() >= 96, IntentBridgeError::InvalidVaa);

        let mut intent_id = [0u8; 32];
        intent_id.copy_from_slice(&payload[0..32]);
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

        // Fulfill
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
        received.emitter_chain = posted_vaa.emitter_chain();
        received.sequence = posted_vaa.sequence();
        received.bump = ctx.bumps.received;

        emit!(IntentFulfilled {
            intent_id,
            solver: ctx.accounts.solver.key(),
            fulfilled_at: clock.unix_timestamp,
        });

        msg!("Intent claimed! Amount: {} lamports", locked_amount);
        Ok(())
    }
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(chain: u16, address: [u8; 32])]
pub struct RegisterEmitter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = owner, space = 8 + ForeignEmitter::INIT_SPACE, seeds = [FOREIGN_EMITTER_SEED, &chain.to_le_bytes()], bump)]
    pub foreign_emitter: Account<'info, ForeignEmitter>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32])]
pub struct CreateIntent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub payment: AccountInfo<'info>,
    #[account(init, payer = creator, space = 8 + Intent::INIT_SPACE, seeds = [INTENT_SEED, &intent_id], bump)]
    pub intent: Account<'info, Intent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelIntent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [INTENT_SEED, &intent.intent_id], bump = intent.bump, constraint = intent.creator == creator.key())]
    pub intent: Account<'info, Intent>,
}

#[derive(Accounts)]
pub struct SolveAndProve<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: Wormhole program
    pub wormhole_program: AccountInfo<'info>,
    #[account(mut, seeds = [b"Bridge"], bump, seeds::program = wormhole_program)]
    pub wormhole_bridge: AccountInfo<'info>,
    #[account(mut)]
    pub wormhole_message: Signer<'info>,
    #[account(seeds = [EMITTER_SEED], bump)]
    pub wormhole_emitter: AccountInfo<'info>,
    #[account(mut, seeds = [b"Sequence", wormhole_emitter.key().as_ref()], bump, seeds::program = wormhole_program)]
    pub wormhole_sequence: AccountInfo<'info>,
    #[account(mut, seeds = [b"fee_collector"], bump, seeds::program = wormhole_program)]
    pub wormhole_fee_collector: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SolveStakeAndProve<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,
    /// CHECK: staker beneficiary — validated by mock-staking via CPI (stake_account PDA seeds)
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    /// CHECK: mock-staking program — validated by CPI call
    pub staking_program: AccountInfo<'info>,
    /// CHECK: StakePool PDA — validated by mock-staking during CPI
    #[account(mut)]
    pub stake_pool: AccountInfo<'info>,
    /// CHECK: StakeAccount PDA — validated by mock-staking during CPI (init_if_needed)
    #[account(mut)]
    pub stake_account: AccountInfo<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: Wormhole program
    pub wormhole_program: AccountInfo<'info>,
    #[account(mut, seeds = [b"Bridge"], bump, seeds::program = wormhole_program)]
    pub wormhole_bridge: AccountInfo<'info>,
    #[account(mut)]
    pub wormhole_message: Signer<'info>,
    #[account(seeds = [EMITTER_SEED], bump)]
    pub wormhole_emitter: AccountInfo<'info>,
    #[account(mut, seeds = [b"Sequence", wormhole_emitter.key().as_ref()], bump, seeds::program = wormhole_program)]
    pub wormhole_sequence: AccountInfo<'info>,
    #[account(mut, seeds = [b"fee_collector"], bump, seeds::program = wormhole_program)]
    pub wormhole_fee_collector: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimWithVaa<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: Posted VAA (verified by Wormhole Core Bridge before this ix)
    pub posted_vaa: Account<'info, wormhole::PostedVaaData>,
    #[account(seeds = [FOREIGN_EMITTER_SEED, &posted_vaa.emitter_chain().to_le_bytes()], bump = foreign_emitter.bump)]
    pub foreign_emitter: Account<'info, ForeignEmitter>,
    #[account(mut, seeds = [INTENT_SEED, &intent.intent_id], bump = intent.bump)]
    pub intent: Account<'info, Intent>,
    #[account(init, payer = solver, space = 8 + Received::INIT_SPACE, seeds = [RECEIVED_SEED, &posted_vaa.emitter_chain().to_le_bytes(), &posted_vaa.sequence().to_le_bytes()], bump)]
    pub received: Account<'info, Received>,
    pub system_program: Program<'info, System>,
}
