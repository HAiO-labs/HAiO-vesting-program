// programs/haio-vesting/src/lib.rs

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// TODO: CRITICAL - Replace with actual program ID before mainnet deployment
// Current ID is a demo/test ID and must be changed for production
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
        max_schedules: u8,
    ) -> Result<()> {
        instructions::crank_vesting_schedules::handler(ctx, max_schedules)
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
    pub timestamp: i64,
}

#[event]
pub struct VestingScheduleCreated {
    pub schedule_id: u64,
    pub depositor: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: state::SourceCategory,
}

#[event]
pub struct TokensReleased {
    pub schedule_id: u64,
    pub amount: u64,
    pub recipient: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DistributionHubUpdateProposed {
    pub admin: Pubkey,
    pub current_hub: Pubkey,
    pub proposed_hub: Pubkey,
    pub timelock_expiry: i64,
}

#[event]
pub struct DistributionHubUpdated {
    pub admin: Pubkey,
    pub old_hub: Pubkey,
    pub new_hub: Pubkey,
    pub timestamp: i64,
}