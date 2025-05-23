// programs/haio-vesting/src/state/vesting_schedule.rs

use anchor_lang::prelude::*;
use crate::errors::VestingError;
use crate::constants::DISCRIMINATOR_SIZE;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum SourceCategory {
    Seed,
    Strategic,
    PublicIdo,
    Team,
    Advisors,
    Ecosystem,
    Marketing,
    Treasury,
    Liquidity,
    Other,
}

#[account]
pub struct VestingSchedule {
    /// Schedule ID, typically an incrementing number from program_config.total_schedules
    pub schedule_id: u64,
    /// Token mint for this schedule
    pub mint: Pubkey,
    /// Token vault PDA holding tokens for this schedule
    pub token_vault: Pubkey,
    /// The authority that deposited the tokens (usually the admin)
    pub depositor: Pubkey, // Should be the admin who creates the schedule
    /// Total allocation amount for this schedule
    pub total_amount: u64,
    /// Cliff end timestamp (Unix timestamp)
    pub cliff_timestamp: i64,
    /// Vesting start timestamp (Unix timestamp, usually same as cliff end or later)
    pub vesting_start_timestamp: i64,
    /// Vesting end timestamp (Unix timestamp)
    pub vesting_end_timestamp: i64,
    /// Amount already transferred to the distribution hub
    pub amount_transferred: u64,
    /// Source category for fund tracking
    pub source_category: SourceCategory,
    /// Flag to indicate if the schedule account is properly initialized
    pub is_initialized: bool,
    /// Bump seed for this PDA
    pub bump: u8,
}

impl VestingSchedule {
    pub const LEN: usize = DISCRIMINATOR_SIZE
        + 8 // schedule_id (u64)
        + 32 // mint (Pubkey)
        + 32 // token_vault (Pubkey)
        + 32 // depositor (Pubkey)
        + 8 // total_amount (u64)
        + 8 // cliff_timestamp (i64)
        + 8 // vesting_start_timestamp (i64)
        + 8 // vesting_end_timestamp (i64)
        + 8 // amount_transferred (u64)
        + 1 // source_category (enum variant index only for simple enum)
        + 1 // is_initialized (bool)
        + 1; // bump (u8)

    pub fn init(
        &mut self,
        schedule_id: u64,
        mint: Pubkey,
        token_vault: Pubkey,
        depositor: Pubkey,
        total_amount: u64,
        cliff_timestamp: i64,
        vesting_start_timestamp: i64,
        vesting_end_timestamp: i64,
        source_category: SourceCategory,
        bump: u8,
    ) {
        self.schedule_id = schedule_id;
        self.mint = mint;
        self.token_vault = token_vault;
        self.depositor = depositor;
        self.total_amount = total_amount;
        self.cliff_timestamp = cliff_timestamp;
        self.vesting_start_timestamp = vesting_start_timestamp;
        self.vesting_end_timestamp = vesting_end_timestamp;
        self.amount_transferred = 0;
        self.source_category = source_category;
        self.is_initialized = true;
        self.bump = bump;
    }

    /// Calculate unlocked amount at given timestamp
    pub fn calculate_unlocked_amount(&self, current_timestamp: i64) -> Result<u64> {
        if !self.is_initialized {
            return Err(VestingError::InvalidVestingScheduleData.into());
        }
        // Before cliff, nothing is unlocked
        if current_timestamp < self.cliff_timestamp {
            return Ok(0);
        }
        // After vesting end, everything is unlocked
        if current_timestamp >= self.vesting_end_timestamp {
            return Ok(self.total_amount);
        }
        // If vesting_start_timestamp is at or after vesting_end_timestamp (invalid state, should be caught at creation)
        // or if current_timestamp is before vesting_start_timestamp (but after cliff)
        // In these cases, if past cliff, only cliff amount might be considered (if cliff release is a feature).
        // Current model: linear vesting begins at `vesting_start_timestamp`. No separate cliff release.
        if self.vesting_start_timestamp >= self.vesting_end_timestamp || current_timestamp < self.vesting_start_timestamp {
             // If past cliff, and (start >= end OR current < start), means 0 from linear vesting.
            return Ok(0);
        }

        // Linear vesting calculation
        let elapsed_since_vesting_start = current_timestamp
            .checked_sub(self.vesting_start_timestamp)
            .ok_or(VestingError::MathOverflow)?; // Should be non-negative due to check above

        let vesting_duration = self.vesting_end_timestamp
            .checked_sub(self.vesting_start_timestamp)
            .ok_or(VestingError::MathOverflow)?; // Should be positive due to creation validation

        if vesting_duration == 0 { // Should not happen if validated at creation (start < end)
            return Ok(self.total_amount); // All vested if duration is zero and past start
        }

        // Use u128 for intermediate multiplication to prevent overflow
        let unlocked_fraction_numerator = (self.total_amount as u128)
            .checked_mul(elapsed_since_vesting_start as u128)
            .ok_or(VestingError::MathOverflow)?;

        let unlocked_amount_u128 = unlocked_fraction_numerator
            .checked_div(vesting_duration as u128)
            .ok_or(VestingError::MathOverflow)?; // Division by zero caught by vesting_duration == 0 check

        // Safely convert back to u64
        let unlocked_amount_u64 = u64::try_from(unlocked_amount_u128)
            .map_err(|_| VestingError::MathOverflow)?;

        Ok(unlocked_amount_u64.min(self.total_amount)) // Cap at total_amount
    }

    /// Get amount available to transfer
    pub fn get_transferable_amount(&self, current_timestamp: i64) -> Result<u64> {
        if !self.is_initialized {
            return Err(VestingError::InvalidVestingScheduleData.into());
        }
        let unlocked_amount = self.calculate_unlocked_amount(current_timestamp)?;
        Ok(unlocked_amount.saturating_sub(self.amount_transferred))
    }
}