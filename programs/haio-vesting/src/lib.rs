use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, TokenAccount, Token, Mint};
use anchor_lang::solana_program::program_pack::IsInitialized;

pub mod constants;
pub mod errors;
pub mod state;

use state::{ProgramConfig, VestingSchedule, SourceCategory};
use errors::VestingError;
use constants::*;

declare_id!("Haio3oNYt8MtL9traoQNJ9RXK1XEVaQBBrZZKXt2VXjz");

/// Security.txt information for on-chain security contact details
#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "HAiO Vesting Program",
    project_url: "https://haio.fun",
    contacts: "email:cto@haio.fun",
    policy: "We do not pay a bug bounty.",
    preferred_languages: "en"
}

// ================================================================================================
// TYPE DEFINITIONS
// ================================================================================================

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateVestingScheduleParams {
    pub recipient: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
}

// ================================================================================================
// ACCOUNT VALIDATION STRUCTURES
// ================================================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Program configuration PDA
    /// Security: Establishes admin authority for the entire program
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR_SIZE + PROGRAM_CONFIG_LEN,
        seeds = [PROGRAM_CONFIG_SEED],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(schedule_id: u64)]
pub struct CreateVestingSchedule<'info> {
    /// Admin signer - only admin can create vesting schedules
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Program configuration account
    /// Security: Validates admin authority
    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        has_one = admin @ VestingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// Vesting schedule PDA - deterministic address based on schedule_id
    /// Security: Schedule ID must follow sequential order to prevent gaps
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR_SIZE + VESTING_SCHEDULE_LEN,
        seeds = [VESTING_SCHEDULE_SEED, schedule_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    /// Token mint account
    pub mint: Account<'info, Mint>,

    /// Source token account from which tokens are deposited
    /// Security: Must be owned by admin and have correct mint
    #[account(
        mut,
        constraint = depositor_token_account.mint == mint.key() @ VestingError::MintMismatch,
        constraint = depositor_token_account.owner == admin.key() @ VestingError::Unauthorized
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    /// Recipient token account that will receive the vested tokens
    /// Security: Must have correct mint (owner validation done in instruction)
    #[account(
        constraint = recipient_token_account.mint == mint.key() @ VestingError::RecipientAccountMintMismatch
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// Vesting vault PDA that holds the tokens
    /// Security: Authority is set to vesting_schedule PDA, preventing unauthorized access
    #[account(
        init,
        payer = admin,
        seeds = [VESTING_VAULT_SEED, schedule_id.to_le_bytes().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vesting_schedule
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Individual recipient crank context for direct token transfers
/// Replaces batch processing with single-schedule processing for enhanced security
#[derive(Accounts)]
pub struct CrankVestingSchedules<'info> {
    /// Program configuration - contains admin authority info
    #[account(
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// Vesting schedule that defines the recipient and vesting parameters
    #[account(
        mut,
        seeds = [VESTING_SCHEDULE_SEED, vesting_schedule.schedule_id.to_le_bytes().as_ref()],
        bump = vesting_schedule.bump
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    /// Vesting vault that holds the tokens for this specific schedule
    /// Security: Authority must be the vesting_schedule PDA
    #[account(
        mut,
        seeds = [VESTING_VAULT_SEED, vesting_schedule.schedule_id.to_le_bytes().as_ref()],
        bump,
        constraint = vesting_vault.owner == vesting_schedule.key() @ VestingError::VaultAuthorityMismatch,
        constraint = vesting_vault.mint == vesting_schedule.mint @ VestingError::MintMismatch
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    /// Recipient token account that receives the vested tokens
    /// Security: Must match the specific account stored in vesting_schedule
    /// Security: Must have the same mint as the vesting schedule
    /// Security: Must be owned by the original recipient (prevents SetAuthority attacks)
    #[account(
        mut,
        constraint = recipient_token_account.key() == vesting_schedule.recipient_token_account @ VestingError::RecipientAccountMismatch,
        constraint = recipient_token_account.mint == vesting_schedule.mint @ VestingError::RecipientAccountMintMismatch,
        constraint = recipient_token_account.owner == vesting_schedule.recipient @ VestingError::RecipientAccountOwnerMismatch
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// Token mint - validated against vesting schedule
    #[account(
        constraint = mint.key() == vesting_schedule.mint @ VestingError::MintMismatch
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

/// Context for closing a fully vested and empty schedule
/// Security: Strict validation ensures only completed schedules can be closed
#[derive(Accounts)]
pub struct CloseVestingSchedule<'info> {
    /// The account that will receive the rent back, typically the original admin or the recipient.
    /// Must be the signer of the transaction.
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    /// The vesting schedule to be closed.
    /// Security: Must be fully vested to be closed.
    #[account(
        mut,
        seeds = [VESTING_SCHEDULE_SEED, vesting_schedule.schedule_id.to_le_bytes().as_ref()],
        bump = vesting_schedule.bump,
        constraint = vesting_schedule.amount_transferred >= vesting_schedule.total_amount @ VestingError::ScheduleNotFullyVested,
        close = beneficiary
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    /// The vesting vault to be closed.
    /// Security: Must be empty and belong to the vesting schedule.
    #[account(
        mut,
        seeds = [VESTING_VAULT_SEED, vesting_schedule.schedule_id.to_le_bytes().as_ref()],
        bump,
        constraint = vesting_vault.amount == 0 @ VestingError::VaultNotEmpty,
        constraint = vesting_vault.owner == vesting_schedule.key() @ VestingError::VaultAuthorityMismatch
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ================================================================================================
// PROGRAM INSTRUCTIONS
// ================================================================================================

#[program]
pub mod haio_vesting {
    use super::*;

    /// Initialize the vesting program
    /// Security: Can only be called once, establishes admin control
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.program_config;
        
        // Initialize program state
        config.admin = ctx.accounts.admin.key();
        config.total_schedules = 0;
        config.bump = ctx.bumps.program_config;

        emit!(ProgramInitialized {
            admin: config.admin,
            program_config: config.key(),
        });

        msg!("Vesting program initialized with admin: {}", config.admin);
        msg!("Program config PDA: {}", config.key());
        Ok(())
    }

    /// Create a new vesting schedule with token deposit
    /// Security: Admin-only, validates timing parameters, enforces sequential schedule IDs
    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        schedule_id: u64,
        params: CreateVestingScheduleParams,
    ) -> Result<()> {
        let program_config = &mut ctx.accounts.program_config;
        let vesting_schedule_account = &mut ctx.accounts.vesting_schedule;

        // ================================================================================================
        // CRITICAL PARAMETER VALIDATIONS
        // ================================================================================================
        
        // Amount validation
        require!(params.total_amount > 0, VestingError::InvalidAmount);
        
        // Recipient validation
        require!(params.recipient != Pubkey::default(), VestingError::InvalidRecipient);
        
        // ================================================================================================
        // CRITICAL SECURITY: RECIPIENT TOKEN ACCOUNT VALIDATION
        // ================================================================================================
        
        // Critical Security Check: Ensure recipient token account is owned by the recipient
        require!(
            ctx.accounts.recipient_token_account.owner == params.recipient,
            VestingError::RecipientAccountOwnerMismatch
        );
        
        // Timing validation - cliff <= start < end
        require!(
            params.cliff_timestamp <= params.vesting_start_timestamp &&
            params.vesting_start_timestamp < params.vesting_end_timestamp,
            VestingError::InvalidTimestamps
        );

        // Sequential ID enforcement - prevents gaps in schedule numbering
        require!(schedule_id == program_config.total_schedules, VestingError::ScheduleIdConflict);

        // ================================================================================================
        // VESTING SCHEDULE INITIALIZATION
        // ================================================================================================
        
        // Initialize vesting schedule state with recipient
        vesting_schedule_account.init(
            schedule_id,
            params.recipient,
            ctx.accounts.recipient_token_account.key(),
            ctx.accounts.mint.key(),
            ctx.accounts.vesting_vault.key(),
            ctx.accounts.admin.key(),
            params.total_amount,
            params.cliff_timestamp,
            params.vesting_start_timestamp,
            params.vesting_end_timestamp,
            params.source_category.clone(),
            ctx.bumps.vesting_schedule,
        )?;

        // ================================================================================================
        // TOKEN DEPOSIT EXECUTION
        // ================================================================================================
        
        // Transfer tokens from admin's account to vesting vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.vesting_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, params.total_amount)?;

        // ================================================================================================
        // STATE UPDATE AND EVENT EMISSION
        // ================================================================================================
        
        // Update program state atomically
        program_config.increment_total_schedules()?;

        // Emit event for tracking
        emit!(VestingScheduleCreated {
            schedule_id,
            recipient: params.recipient,
            mint: ctx.accounts.mint.key(),
            total_amount: params.total_amount,
            cliff_timestamp: params.cliff_timestamp,
            vesting_start_timestamp: params.vesting_start_timestamp,
            vesting_end_timestamp: params.vesting_end_timestamp,
            source_category: params.source_category,
            depositor: ctx.accounts.admin.key(),
        });

        msg!(
            "Created vesting schedule {} with {} tokens for recipient {}, cliff at {}, vesting from {} to {}",
            schedule_id, params.total_amount, params.recipient, params.cliff_timestamp,
            params.vesting_start_timestamp, params.vesting_end_timestamp
        );

        Ok(())
    }

    /// Process individual vesting schedule with direct-to-recipient transfer
    /// Replaces batch processing with single-schedule processing for enhanced security
    /// Security: Validates recipient account ownership, prevents unauthorized transfers
    pub fn crank_vesting_schedule(
        ctx: Context<CrankVestingSchedules>,
    ) -> Result<()> {
        let current_timestamp = Clock::get()?.unix_timestamp;

        // Extract values early to avoid borrow conflicts
        let schedule_id;
        let recipient;
        let mint;
        let source_category;
        let schedule_bump;
        let transferable_amount;
        
        {
            let vesting_schedule = &ctx.accounts.vesting_schedule;
            let vesting_vault = &ctx.accounts.vesting_vault;

            // ================================================================================================
            // PRE-FLIGHT SECURITY VALIDATIONS
            // ================================================================================================
            
            // Validate schedule is properly initialized
            require!(vesting_schedule.is_initialized, VestingError::InvalidVestingScheduleData);

            // Validate vault state using IsInitialized trait
            require!(vesting_vault.is_initialized(), VestingError::InvalidVaultState);

            // ================================================================================================
            // VESTING LOGIC AND TRANSFER AMOUNT CALCULATION
            // ================================================================================================
            
            // Skip if schedule is already fully processed
            if vesting_schedule.amount_transferred >= vesting_schedule.total_amount {
                msg!("Schedule {} already fully processed (transferred: {}, total: {}). Skipping.", 
                     vesting_schedule.schedule_id, vesting_schedule.amount_transferred, vesting_schedule.total_amount);
                return Ok(());
            }

            // Calculate how much can be transferred at current timestamp
            transferable_amount = vesting_schedule.get_transferable_amount(current_timestamp)?;

            if transferable_amount == 0 {
                msg!("No transferable amount for schedule {} at timestamp {}. Current cliff: {}, vesting start: {}.", 
                     vesting_schedule.schedule_id, current_timestamp, 
                     vesting_schedule.cliff_timestamp, vesting_schedule.vesting_start_timestamp);
                
                // Emit event for monitoring consistency even when amount is 0
                emit!(TokensReleased {
                    schedule_id: vesting_schedule.schedule_id,
                    recipient: vesting_schedule.recipient,
                    mint: vesting_schedule.mint,
                    amount: 0,
                    source_category: vesting_schedule.source_category.clone(),
                    timestamp: current_timestamp,
                    total_released: vesting_schedule.amount_transferred,
                });
                
                return Ok(());
            }

            // Extract values for later use
            schedule_id = vesting_schedule.schedule_id;
            recipient = vesting_schedule.recipient;
            mint = vesting_schedule.mint;
            source_category = vesting_schedule.source_category.clone();
            schedule_bump = vesting_schedule.bump;
        }

        // Ensure we don't exceed available vault balance
        let actual_transfer_amount = transferable_amount.min(ctx.accounts.vesting_vault.amount);

        if actual_transfer_amount == 0 {
            msg!("Vault for schedule {} is empty (vault balance: {}, calculated transferable: {}). Skipping.", 
                 schedule_id, ctx.accounts.vesting_vault.amount, transferable_amount);
            
            // Emit event for monitoring consistency even when vault is empty
            emit!(TokensReleased {
                schedule_id,
                recipient,
                mint,
                amount: 0,
                source_category,
                timestamp: current_timestamp,
                total_released: ctx.accounts.vesting_schedule.amount_transferred,
            });
            
            return Ok(());
        }

        // ================================================================================================
        // TOKEN TRANSFER EXECUTION
        // ================================================================================================
        
        // Create PDA signer seeds for the vesting schedule authority
        let schedule_id_bytes = schedule_id.to_le_bytes();
        let signer_seeds = &[
            VESTING_SCHEDULE_SEED,
            schedule_id_bytes.as_ref(),
            &[schedule_bump],
        ];
        let signer = &[&signer_seeds[..]];

        // Execute token transfer from vault to recipient's token account
        let cpi_accounts = Transfer {
            from: ctx.accounts.vesting_vault.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.vesting_schedule.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, actual_transfer_amount)?;

        // ================================================================================================
        // STATE UPDATE AND EVENT EMISSION
        // ================================================================================================
        
        // Update schedule amount_transferred atomically
        let vesting_schedule = &mut ctx.accounts.vesting_schedule;
        vesting_schedule.amount_transferred = vesting_schedule.amount_transferred
            .checked_add(actual_transfer_amount)
            .ok_or(VestingError::MathOverflow)?;

        // Emit event for tracking and monitoring
        emit!(TokensReleased {
            schedule_id,
            recipient,
            mint,
            amount: actual_transfer_amount,
            source_category,
            timestamp: current_timestamp,
            total_released: vesting_schedule.amount_transferred,
        });

        msg!(
            "Released {} tokens from schedule {} directly to recipient {}. Total released: {}",
            actual_transfer_amount, schedule_id, recipient,
            vesting_schedule.amount_transferred
        );

        Ok(())
    }

    /// Close a vesting schedule and its vault after completion
    /// This allows reclaiming the rent from the accounts
    /// Security: Can only be called when the schedule is fully vested and the vault is empty
    pub fn close_vesting_schedule(ctx: Context<CloseVestingSchedule>) -> Result<()> {
        let schedule_id = ctx.accounts.vesting_schedule.schedule_id;
        let _schedule_key = ctx.accounts.vesting_schedule.key();
        let schedule_bump = ctx.accounts.vesting_schedule.bump;

        // Create PDA signer seeds for the vesting schedule authority
        let schedule_id_bytes = schedule_id.to_le_bytes();
        let signer_seeds = &[
            VESTING_SCHEDULE_SEED,
            schedule_id_bytes.as_ref(),
            &[schedule_bump],
        ];
        let signer = &[&signer_seeds[..]];

        // Close the token vault account via CPI
        let cpi_accounts = token::CloseAccount {
            account: ctx.accounts.vesting_vault.to_account_info(),
            destination: ctx.accounts.beneficiary.to_account_info(),
            authority: ctx.accounts.vesting_schedule.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::close_account(cpi_ctx)?;

        // The vesting_schedule account is closed automatically by Anchor via the `close` constraint

        msg!(
            "Successfully closed vesting schedule {} and its vault. Rent returned to {}.",
            schedule_id,
            ctx.accounts.beneficiary.key()
        );

        Ok(())
    }
}

// ================================================================================================
// EVENTS
// ================================================================================================

#[event]
pub struct ProgramInitialized {
    pub admin: Pubkey,
    pub program_config: Pubkey,
}

#[event]
pub struct VestingScheduleCreated {
    pub schedule_id: u64,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
    pub depositor: Pubkey,
}

/// Token release event with recipient field for complete audit trail
#[event]
pub struct TokensReleased {
    pub schedule_id: u64,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub source_category: SourceCategory,
    pub timestamp: i64,
    pub total_released: u64,
}