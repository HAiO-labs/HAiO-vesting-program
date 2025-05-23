// programs/haio-vesting/src/state/program_config.rs

use anchor_lang::prelude::*;
use crate::constants::DISCRIMINATOR_SIZE;

#[account]
pub struct ProgramConfig {
    /// Admin authority for the program
    pub admin: Pubkey,
    /// Distribution hub program address (or wallet address) where tokens are sent
    pub distribution_hub: Pubkey,
    /// Pending distribution hub address (for timelock mechanism)
    pub pending_hub: Option<Pubkey>,
    /// Timelock expiry timestamp for the pending hub update
    pub hub_update_timelock: Option<i64>,
    /// Total number of vesting schedules created. Also used as the next schedule_id.
    pub total_schedules: u64,
    /// Bump seed for this PDA
    pub bump: u8,
}

impl ProgramConfig {
    // Option<Pubkey> is 1 (for Some/None) + 32 (for Pubkey if Some) = 33 bytes
    // Option<i64> is 1 (for Some/None) + 8 (for i64 if Some) = 9 bytes
    pub const LEN: usize = DISCRIMINATOR_SIZE
        + 32 // admin
        + 32 // distribution_hub
        + (1 + 32) // pending_hub (Option<Pubkey>)
        + (1 + 8)  // hub_update_timelock (Option<i64>)
        + 8  // total_schedules (u64)
        + 1; // bump (u8)
}