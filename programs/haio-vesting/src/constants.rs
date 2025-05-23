// programs/haio-vesting/src/constants.rs

// PDA seeds
pub const PROGRAM_CONFIG_SEED: &[u8] = b"program_config";
pub const VESTING_SCHEDULE_SEED: &[u8] = b"vesting_schedule";
pub const VESTING_VAULT_SEED: &[u8] = b"vesting_vault";

// Account discriminator size (8 bytes for Anchor accounts)
pub const DISCRIMINATOR_SIZE: usize = 8;

// Maximum number of vesting schedules to process in one crank instruction
pub const MAX_SCHEDULES_PER_CRANK: u8 = 10; // Example value, can be adjusted

// Base compute units for crank operation
pub const BASE_CRANK_CU: u32 = 50_000;
// Estimated compute units per schedule processing
pub const CU_PER_SCHEDULE: u32 = 45_000;

// Minimum time lock for distribution hub updates
#[cfg(not(feature = "test-utils"))]
pub const HUB_UPDATE_TIMELOCK: i64 = 2 * 24 * 60 * 60; // 48 hours in seconds for production

#[cfg(feature = "test-utils")]
pub const HUB_UPDATE_TIMELOCK: i64 = 5; // 5 seconds for testing when test-utils feature is enabled