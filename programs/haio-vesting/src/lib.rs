// programs/haio-vesting/src/lib.rs

use anchor_lang::prelude::*;
use instructions::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod haio_vesting {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        schedule_id: u64,
        params: CreateVestingScheduleParams,
    ) -> Result<()> {
        instructions::create_vesting_schedule::handler(ctx, schedule_id, params)
    }

    pub fn crank_vesting_schedules<'info>(
        ctx: Context<'_, '_, '_, 'info, CrankVestingSchedules<'info>>,
        num_schedules_to_process: u8,
    ) -> Result<()> {
        instructions::crank_vesting_schedules::handler(ctx, num_schedules_to_process)
    }

    pub fn update_distribution_hub(
        ctx: Context<UpdateDistributionHub>,
        new_hub_address: Pubkey,
    ) -> Result<()> {
        instructions::update_distribution_hub::handler(ctx, new_hub_address)
    }
}

// --- Events ---
#[event]
pub struct ProgramInitialized {
    pub admin: Pubkey,
    pub program_config: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VestingScheduleCreated {
    pub schedule_id: u64,
    pub vesting_schedule_pda: Pubkey,
    pub mint: Pubkey,
    pub token_vault: Pubkey,
    pub depositor: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: state::SourceCategory,
    pub timestamp: i64,
}

#[event]
pub struct TokensReleased {
    pub schedule_id: u64,
    pub vesting_schedule_pda: Pubkey,
    pub amount_released: u64,
    pub new_amount_transferred_on_schedule: u64,
    pub distribution_hub_recipient_account: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DistributionHubUpdateProposed {
    pub proposed_by: Pubkey,
    pub new_pending_hub: Pubkey,
    pub timelock_expiry: i64,
    pub timestamp: i64,
}

#[event]
pub struct DistributionHubUpdated {
    pub updated_by: Pubkey,
    pub old_hub: Pubkey,
    pub new_hub: Pubkey,
    pub timestamp: i64,
}