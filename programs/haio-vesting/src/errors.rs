use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Unauthorized access.")]
    Unauthorized, // 6000

    #[msg("Math operation overflow.")]
    MathOverflow, // 6001

    #[msg("Timelock has not expired yet.")]
    TimelockNotExpired, // 6002

    #[msg("Invalid timestamp configuration.")]
    InvalidTimestamps, // 6003

    #[msg("Invalid amount specified.")]
    InvalidAmount, // 6004

    #[msg("Vesting schedule is already fully processed.")]
    ScheduleFullyProcessed, // 6005

    #[msg("No transferable amount available.")]
    NoTransferableAmount, // 6006

    #[msg("Distribution hub is not set.")]
    DistributionHubNotSet, // 6007

    #[msg("Invalid vesting schedule data.")]
    InvalidVestingScheduleData, // 6008

    #[msg("Too many accounts to process in a single transaction.")]
    TooManyAccountsToProcess, // 6009

    #[msg("Invalid remaining account provided.")]
    InvalidRemainingAccount, // 6010

    #[msg("Token mint mismatch.")]
    MintMismatch, // 6011

    #[msg("Vault account mismatch.")]
    VaultMismatch, // 6012

    #[msg("Hub account mint mismatch.")]
    HubAccountMintMismatch, // 6013

    #[msg("Hub account owner mismatch.")]
    HubAccountOwnerMismatch, // 6014

    #[msg("Hub address has not changed.")]
    HubAddressNotChanged, // 6015

    #[msg("Vault authority mismatch.")]
    VaultAuthorityMismatch, // 6016

    #[msg("Schedule ID conflict.")]
    ScheduleIdConflict, // 6017

    #[msg("Concurrent modification detected.")]
    ConcurrentModification, // 6018

    #[msg("Invalid vault state.")]
    InvalidVaultState, // 6019
}