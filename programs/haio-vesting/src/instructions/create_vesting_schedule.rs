// programs/haio-vesting/src/instructions/create_vesting_schedule.rs

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::ProgramConfig;
use crate::state::VestingSchedule;
use crate::state::SourceCategory;
use crate::errors::VestingError;
use crate::constants::{PROGRAM_CONFIG_SEED, VESTING_SCHEDULE_SEED, VESTING_VAULT_SEED};
use crate::VestingScheduleCreated; // Event

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateVestingScheduleParams {
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
}

#[derive(Accounts)]
#[instruction(schedule_id: u64, params: CreateVestingScheduleParams)]
pub struct CreateVestingSchedule<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        has_one = admin @ VestingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = depositor_token_account.mint == mint.key() @ VestingError::MintMismatch,
        constraint = depositor_token_account.owner == admin.key() @ VestingError::Unauthorized, // Admin must own the source tokens
        constraint = depositor_token_account.amount >= params.total_amount @ VestingError::InvalidAmount,
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [VESTING_SCHEDULE_SEED, &schedule_id.to_le_bytes()],
        bump,
        space = VestingSchedule::LEN
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    #[account(
        init,
        payer = admin,
        seeds = [VESTING_VAULT_SEED, &schedule_id.to_le_bytes()],
        bump,
        token::mint = mint,
        token::authority = vesting_schedule, // VestingSchedule PDA is the authority of its vault
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateVestingSchedule>, schedule_id: u64, params: CreateVestingScheduleParams) -> Result<()> {
    // Validate parameters
    require!(params.total_amount > 0, VestingError::InvalidAmount);
    require!(
        params.cliff_timestamp <= params.vesting_start_timestamp &&
        params.vesting_start_timestamp < params.vesting_end_timestamp, // Vesting start must be strictly before end
        VestingError::InvalidTimestamps
    );

    let program_config = &mut ctx.accounts.program_config;
    let vesting_schedule_account = &mut ctx.accounts.vesting_schedule;
    
    // Verify that the provided schedule_id matches the expected next ID
    require!(schedule_id == program_config.total_schedules, VestingError::ScheduleIdConflict);

    // Initialize vesting schedule state
    vesting_schedule_account.init(
        schedule_id,
        ctx.accounts.mint.key(),
        ctx.accounts.vesting_vault.key(),
        ctx.accounts.admin.key(), // Depositor is the admin creating the schedule
        params.total_amount,
        params.cliff_timestamp,
        params.vesting_start_timestamp,
        params.vesting_end_timestamp,
        params.source_category.clone(),
        ctx.bumps.vesting_schedule,
    );

    // Transfer tokens from depositor's account to the vesting vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vesting_vault.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(), // Admin authorizes transfer from their account
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(CpiContext::new(cpi_program, cpi_accounts), params.total_amount)?;

    // Increment total schedules count in program_config
    program_config.total_schedules = program_config.total_schedules.checked_add(1).ok_or(VestingError::MathOverflow)?;

    emit!(VestingScheduleCreated {
        schedule_id,
        vesting_schedule_pda: vesting_schedule_account.key(),
        mint: ctx.accounts.mint.key(),
        token_vault: ctx.accounts.vesting_vault.key(),
        depositor: ctx.accounts.admin.key(),
        total_amount: params.total_amount,
        cliff_timestamp: params.cliff_timestamp,
        vesting_start_timestamp: params.vesting_start_timestamp,
        vesting_end_timestamp: params.vesting_end_timestamp,
        source_category: params.source_category,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Vesting schedule {} created for {} tokens. Vault: {}. New total schedules: {}",
        schedule_id,
        params.total_amount,
        ctx.accounts.vesting_vault.key(),
        program_config.total_schedules
    );
    Ok(())
}