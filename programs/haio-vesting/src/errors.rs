use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Unauthorized access.")]
    Unauthorized, // 6000

    #[msg("Math operation overflow.")]
    MathOverflow, // 6001

    #[msg("Invalid timestamp configuration.")]
    InvalidTimestamps, // 6003

    #[msg("Invalid amount specified.")]
    InvalidAmount, // 6004

    #[msg("Vesting schedule is already fully processed.")]
    ScheduleFullyProcessed, // 6005

    #[msg("No transferable amount available.")]
    NoTransferableAmount, // 6006

    #[msg("Invalid vesting schedule data.")]
    InvalidVestingScheduleData, // 6008

    #[msg("Token mint mismatch.")]
    MintMismatch, // 6011

    #[msg("Vault authority mismatch.")]
    VaultAuthorityMismatch, // 6016

    #[msg("Schedule ID conflict.")]
    ScheduleIdConflict, // 6017

    #[msg("Invalid vault state.")]
    InvalidVaultState, // 6019

    #[msg("Invalid recipient specified.")]
    InvalidRecipient, // 6022
    
    #[msg("Recipient account owner mismatch.")]
    RecipientAccountOwnerMismatch, // 6023
    
    #[msg("Recipient account mint mismatch.")]
    RecipientAccountMintMismatch, // 6024

    #[msg("Recipient token account does not match the one specified in the schedule.")]
    RecipientAccountMismatch, // 6025

    #[msg("Vesting schedule is not yet fully vested and cannot be closed.")]
    ScheduleNotFullyVested, // 6026
    
    #[msg("Vesting vault is not empty and cannot be closed.")]
    VaultNotEmpty, // 6027
}