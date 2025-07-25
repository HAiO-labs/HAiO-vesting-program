use anchor_lang::prelude::*;
use crate::constants::DISCRIMINATOR_SIZE;
use crate::errors::VestingError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SourceCategory {
    Public,      // Public Round: 64M HAiO with 6mo linear vesting (16M immediate)
    Ecosystem,   // Ecosystem: 388.9M HAiO with 36mo linear vesting (11.1M immediate)
    Team,        // Team & Advisors: 150M HAiO with 6mo cliff + 36mo linear vesting
    Liquidity,   // Liquidity Provision (CEX/DEX): 100M HAiO immediate distribution
    Strategic,   // Strategic Partnerships: 50M HAiO immediate distribution
    Foundation,  // Foundation & Treasury Reserve: 220M HAiO immediate distribution
}

#[account]
pub struct VestingSchedule {
    /// Schedule ID, typically an incrementing number from program_config.total_schedules
    pub schedule_id: u64,
    /// The final beneficiary who will receive the vested tokens
    /// Note: Recipient change functionality has been removed for enhanced security
    pub recipient: Pubkey,
    /// The specific token account of the recipient that will receive the vested tokens
    /// Note: Recipient change functionality has been removed for enhanced security
    pub recipient_token_account: Pubkey,
    /// Token mint for this schedule
    pub mint: Pubkey,
    /// Token vault PDA holding tokens for this schedule
    pub token_vault: Pubkey,
    /// The authority that deposited the tokens (usually the admin)
    pub depositor: Pubkey,
    /// Total allocation amount for this schedule
    pub total_amount: u64,
    /// Cliff end timestamp (Unix timestamp)
    pub cliff_timestamp: i64,
    /// Vesting start timestamp (Unix timestamp, usually same as cliff end or later)
    pub vesting_start_timestamp: i64,
    /// Vesting end timestamp (Unix timestamp)
    pub vesting_end_timestamp: i64,
    /// Amount already transferred to the recipient
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
        + 32 // recipient (Pubkey)
        + 32 // recipient_token_account (Pubkey)
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
        recipient: Pubkey,
        recipient_token_account: Pubkey,
        mint: Pubkey,
        token_vault: Pubkey,
        depositor: Pubkey,
        total_amount: u64,
        cliff_timestamp: i64,
        vesting_start_timestamp: i64,
        vesting_end_timestamp: i64,
        source_category: SourceCategory,
        bump: u8,
    ) -> Result<()> {
        self.schedule_id = schedule_id;
        self.recipient = recipient;
        self.recipient_token_account = recipient_token_account;
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
        Ok(())
    }

    /// Calculate unlocked amount at given timestamp
    /// Security: Uses checked arithmetic to prevent overflow
    pub fn calculate_unlocked_amount(&self, current_timestamp: i64) -> Result<u64> {
        // Validate initialized state
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
        if self.vesting_start_timestamp >= self.vesting_end_timestamp || current_timestamp < self.vesting_start_timestamp {
            return Ok(0);
        }

        // Linear vesting calculation
        let elapsed_since_vesting_start = current_timestamp
            .checked_sub(self.vesting_start_timestamp)
            .ok_or(VestingError::MathOverflow)?;

        let vesting_duration = self.vesting_end_timestamp
            .checked_sub(self.vesting_start_timestamp)
            .ok_or(VestingError::MathOverflow)?;

        if vesting_duration == 0 {
            return Ok(self.total_amount);
        }

        // Use u128 for intermediate multiplication to prevent overflow
        let unlocked_amount_u128 = (self.total_amount as u128)
            .checked_mul(elapsed_since_vesting_start as u128)
            .ok_or(VestingError::MathOverflow)?;

        let unlocked_amount_u128 = unlocked_amount_u128
            .checked_div(vesting_duration as u128)
            .ok_or(VestingError::MathOverflow)?;

        // Safely convert back to u64
        let unlocked_amount_u64 = u64::try_from(unlocked_amount_u128)
            .map_err(|_| VestingError::MathOverflow)?;

        Ok(unlocked_amount_u64.min(self.total_amount))
    }

    /// Get amount available to transfer
    /// Returns the difference between unlocked and already transferred amounts
    pub fn get_transferable_amount(&self, current_timestamp: i64) -> Result<u64> {
        let unlocked_amount = self.calculate_unlocked_amount(current_timestamp)?;
        Ok(unlocked_amount.saturating_sub(self.amount_transferred))
    }
}