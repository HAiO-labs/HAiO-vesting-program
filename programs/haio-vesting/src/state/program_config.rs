use anchor_lang::prelude::*;

/// Global configuration for the vesting program
/// 
/// This account stores program-wide settings and admin control mechanisms.
/// It uses a PDA with seed "program_config" for deterministic addressing.
/// 
/// Security Features:
/// - Immutable admin authority (transfer capability removed for enhanced security)
/// - Atomic updates with proper validation
/// - Event emission for transparency
#[account]
pub struct ProgramConfig {
    /// Current admin with full program control authority
    /// Can create vesting schedules and manage program state
    /// Note: Admin transfer functionality has been removed for enhanced security
    pub admin: Pubkey,

    /// Total number of vesting schedules created
    /// Used for sequential ID validation and program statistics
    pub total_schedules: u64,

    /// PDA bump seed for secure account derivation
    pub bump: u8,
}

impl ProgramConfig {
    /// Calculate the space needed for this account
    /// Used in account initialization to determine rent requirements
    pub const LEN: usize = 
        32 +      // admin: Pubkey
        8 +       // total_schedules: u64
        1;        // bump: u8

    /// Initialize program configuration with admin
    /// 
    /// # Arguments
    /// * `admin` - Initial admin public key
    /// * `bump` - PDA bump for account derivation
    /// 
    /// # Security
    /// - Only called during program initialization
    /// - Sets up admin authority and clean state
    pub fn init(&mut self, admin: Pubkey, bump: u8) -> Result<()> {
        self.admin = admin;
        self.total_schedules = 0;
        self.bump = bump;
        Ok(())
    }

    /// Increment total schedules counter atomically
    /// 
    /// # Returns
    /// * `Result<()>` - Success or overflow error
    /// 
    /// # Security
    /// - Uses checked arithmetic to prevent overflow
    /// - Maintains schedule count integrity
    pub fn increment_total_schedules(&mut self) -> Result<()> {
        self.total_schedules = self.total_schedules
            .checked_add(1)
            .ok_or(anchor_lang::error::ErrorCode::AccountDidNotSerialize)?;
        Ok(())
    }

    /// Validate admin authority
    /// 
    /// # Arguments
    /// * `signer` - Public key attempting admin operation
    /// 
    /// # Returns
    /// * `true` if signer is current admin
    /// * `false` otherwise
    pub fn is_admin(&self, signer: &Pubkey) -> bool {
        self.admin == *signer
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    #[test]
    fn test_program_config_len() {
        // Verify our LEN calculation matches the actual struct size
        let expected_len = 
            32 +      // admin
            8 +       // total_schedules
            1;        // bump
        
        assert_eq!(ProgramConfig::LEN, expected_len);
        assert_eq!(ProgramConfig::LEN, 41);
    }

    #[test]
    fn test_schedule_counter() {
        let admin = Pubkey::new_unique();
        let mut config = ProgramConfig {
            admin,
            total_schedules: 0,
            bump: 255,
        };

        assert_eq!(config.total_schedules, 0);
        
        config.increment_total_schedules().unwrap();
        assert_eq!(config.total_schedules, 1);
        
        config.increment_total_schedules().unwrap();
        assert_eq!(config.total_schedules, 2);
    }

    #[test]
    fn test_admin_validation() {
        let admin = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let config = ProgramConfig {
            admin,
            total_schedules: 0,
            bump: 255,
        };

        assert!(config.is_admin(&admin));
        assert!(!config.is_admin(&other));
    }
}