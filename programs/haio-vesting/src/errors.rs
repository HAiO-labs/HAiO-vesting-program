// programs/haio-vesting/src/errors.rs

use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Unauthorized: Admin privilege required.")]
    Unauthorized, // 6000
    #[msg("Math operation overflow.")]
    MathOverflow, // 6001
    #[msg("Timelock for hub update has not expired.")]
    TimelockNotExpired, // 6002
    #[msg("Invalid timestamp: Cliff must be before or at vesting start, and vesting start must be before vesting end.")]
    InvalidTimestamps, // 6003
    #[msg("Invalid amount: Total amount must be greater than zero.")]
    InvalidAmount, // 6004
    #[msg("Schedule is already fully processed and all tokens transferred.")]
    ScheduleFullyProcessed, // 6005
    #[msg("No transferable amount at current time for this schedule.")]
    NoTransferableAmount, // 6006
    #[msg("Distribution hub address is not set.")]
    DistributionHubNotSet, // 6007
    #[msg("Vesting schedule data is invalid or not initialized.")]
    InvalidVestingScheduleData, // 6008
    // #[msg("It's too early to apply the pending hub update.")] // Covered by TimelockNotExpired
    // TooEarlyForHubUpdate,
    #[msg("The number of accounts to process exceeds the maximum allowed or remaining_accounts mismatch.")]
    TooManyAccountsToProcess, // 6009
    #[msg("Invalid account passed for vesting schedule processing.")]
    InvalidRemainingAccount, // 6010
    #[msg("The provided mint does not match the schedule's mint or hub's mint.")]
    MintMismatch, // 6011
    #[msg("The provided vault does not match the schedule's vault field.")]
    VaultMismatch, // 6012
    #[msg("The distribution hub token account is not for the correct mint.")]
    HubAccountMintMismatch, // 6013
    #[msg("The distribution hub token account is not owned by the distribution hub address.")]
    HubAccountOwnerMismatch, // 6014
    #[msg("Cannot propose the same hub address that is already active or pending.")]
    HubAddressNotChanged, // 6015
    #[msg("Vault authority does not match vesting schedule PDA.")]
    VaultAuthorityMismatch, // 6016
    #[msg("Schedule ID already exists or total_schedules counter issue.")]
    ScheduleIdConflict, // 6017
}