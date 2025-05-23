// programs/haio-vesting/src/constants.rs

pub const DISCRIMINATOR_SIZE: usize = 8;

pub const PROGRAM_CONFIG_SEED: &[u8] = b"program_config";
pub const VESTING_SCHEDULE_SEED: &[u8] = b"vesting_schedule";
pub const VESTING_VAULT_SEED: &[u8] = b"vesting_vault";

// Maximum number of vesting schedules to process in one crank instruction
pub const MAX_SCHEDULES_PER_CRANK: u8 = 10; // Example value, can be adjusted

// Minimum time lock for distribution hub updates
#[cfg(not(feature = "test-utils"))]
pub const HUB_UPDATE_TIMELOCK: i64 = 2 * 24 * 60 * 60; // 48 hours in seconds for production

#[cfg(feature = "test-utils")]
pub const HUB_UPDATE_TIMELOCK: i64 = 5; // 5 seconds for testing when test-utils feature is enabled