// PDA seeds
pub const PROGRAM_CONFIG_SEED: &[u8] = b"program_config";
pub const VESTING_SCHEDULE_SEED: &[u8] = b"vesting_schedule";
pub const VESTING_VAULT_SEED: &[u8] = b"vesting_vault";

// Account discriminator size (8 bytes for Anchor accounts)
pub const DISCRIMINATOR_SIZE: usize = 8;

// Account size constants for rent calculation
pub const PROGRAM_CONFIG_LEN: usize = crate::state::ProgramConfig::LEN;
pub const VESTING_SCHEDULE_LEN: usize = crate::state::VestingSchedule::LEN;