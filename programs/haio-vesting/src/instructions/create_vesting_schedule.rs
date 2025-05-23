// programs/haio-vesting/src/instructions/create_vesting_schedule.rs

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{PROGRAM_CONFIG_SEED, VESTING_SCHEDULE_SEED, VESTING_VAULT_SEED};
use crate::state::ProgramConfig;
use crate::state::VestingSchedule;
use crate::state::SourceCategory;
use crate::errors::VestingError;

use crate::VestingScheduleCreated; // Event

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateVestingScheduleParams {
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
}

#[derive(Accounts)]
#[instruction(schedule_id: u64)]
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

    #[account(
        init,
        payer = admin,
        space = VestingSchedule::LEN,
        seeds = [VESTING_SCHEDULE_SEED, schedule_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = depositor_token_account.owner == admin.key() @ VestingError::Unauthorized, // Admin must own the source tokens
        constraint = depositor_token_account.mint == mint.key() @ VestingError::MintMismatch // Ensure mint matches
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = vesting_schedule, // VestingSchedule PDA is the authority of its vault
        seeds = [VESTING_VAULT_SEED, schedule_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
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

    // Additional validation: Ensure hub is set and hub token account is valid
    require!(program_config.distribution_hub != Pubkey::default(), VestingError::DistributionHubNotSet);

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
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, params.total_amount)?;

    // Increment total schedules count in program_config
    program_config.total_schedules = program_config.total_schedules.checked_add(1).ok_or(VestingError::MathOverflow)?;

    // Emit event
    emit!(VestingScheduleCreated {
        schedule_id,
        depositor: ctx.accounts.admin.key(),
        total_amount: params.total_amount,
        cliff_timestamp: params.cliff_timestamp,
        vesting_start_timestamp: params.vesting_start_timestamp,
        vesting_end_timestamp: params.vesting_end_timestamp,
        source_category: params.source_category,
    });

    msg!(
        "Vesting schedule {} created with {} tokens, vesting from {} to {}",
        schedule_id,
        params.total_amount,
        params.vesting_start_timestamp,
        params.vesting_end_timestamp
    );

    Ok(())
}