use anchor_lang::prelude::*;

declare_id!("Ghy67cDnY1Vu1YncyJSwLYDs48hksH5fieMTS7QFtVDF");

#[program]
pub mod naisu1_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
