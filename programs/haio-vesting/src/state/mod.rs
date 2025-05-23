// programs/haio-vesting/src/state/mod.rs

pub mod program_config;
pub mod vesting_schedule;

// Correctly re-export items from the state modules if needed elsewhere directly via `state::`
pub use program_config::ProgramConfig;
pub use vesting_schedule::{VestingSchedule, SourceCategory};