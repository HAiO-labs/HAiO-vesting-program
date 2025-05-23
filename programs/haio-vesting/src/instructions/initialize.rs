// programs/haio-vesting/src/instructions/initialize.rs

use anchor_lang::prelude::*;

use crate::state::ProgramConfig;
use crate::constants::PROGRAM_CONFIG_SEED;
use crate::ProgramInitialized;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramConfig::LEN,
        seeds = [PROGRAM_CONFIG_SEED],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}

// The handler:
pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.program_config;
    let clock = Clock::get()?;

    config.admin = ctx.accounts.admin.key();
    config.distribution_hub = Pubkey::default(); // Initially unset
    config.pending_hub = None;
    config.hub_update_timelock = None;
    config.total_schedules = 0;
    config.bump = ctx.bumps.program_config;

    emit!(ProgramInitialized {
        admin: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!("Vesting program initialized with admin: {}", config.admin);
    msg!("Program config PDA: {}", config.key());
    Ok(())
}