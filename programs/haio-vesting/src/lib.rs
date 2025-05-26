use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, TokenAccount, Token, Mint};
use anchor_lang::solana_program::program_pack::IsInitialized;

pub mod constants;
pub mod errors;
pub mod state;

use state::{ProgramConfig, VestingSchedule, SourceCategory};
use errors::VestingError;
use constants::*;

declare_id!("haioKagCB5SF5AgX8g4iLWp45KPyajyS9fVLJ1xGTvz");

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateVestingScheduleParams {
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

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
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        has_one = admin @ VestingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR_SIZE + VESTING_SCHEDULE_LEN,
        seeds = [VESTING_SCHEDULE_SEED, schedule_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = depositor_token_account.mint == mint.key() @ VestingError::MintMismatch,
        constraint = depositor_token_account.owner == admin.key() @ VestingError::Unauthorized
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

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

#[derive(Accounts)]
pub struct CrankVestingSchedules<'info> {
    #[account(mut)]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(mut)]
    pub distribution_hub_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is the mint account, validated by constraint
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateDistributionHub<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        has_one = admin @ VestingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

#[program]
pub mod haio_vesting {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.program_config;
        config.admin = ctx.accounts.admin.key();
        config.distribution_hub = Pubkey::default();
        config.pending_hub = None;
        config.hub_update_timelock = None;
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

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        schedule_id: u64,
        params: CreateVestingScheduleParams,
    ) -> Result<()> {
        let program_config = &mut ctx.accounts.program_config;
        let vesting_schedule_account = &mut ctx.accounts.vesting_schedule;

        // Validate parameters
        require!(params.total_amount > 0, VestingError::InvalidAmount);
        require!(
            params.cliff_timestamp <= params.vesting_start_timestamp &&
            params.vesting_start_timestamp < params.vesting_end_timestamp,
            VestingError::InvalidTimestamps
        );

        // Verify that the provided schedule_id matches the expected next ID
        require!(schedule_id == program_config.total_schedules, VestingError::ScheduleIdConflict);

        // Additional validation: Ensure hub is set
        require!(program_config.distribution_hub != Pubkey::default(), VestingError::DistributionHubNotSet);

        // Initialize vesting schedule state
        vesting_schedule_account.init(
            schedule_id,
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

        // Transfer tokens from depositor's account to the vesting vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.vesting_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, params.total_amount)?;

        // Increment total schedules count in program_config
        program_config.total_schedules = program_config.total_schedules.checked_add(1).ok_or(VestingError::MathOverflow)?;

        // Emit event
        emit!(VestingScheduleCreated {
            schedule_id,
            mint: ctx.accounts.mint.key(),
            total_amount: params.total_amount,
            cliff_timestamp: params.cliff_timestamp,
            vesting_start_timestamp: params.vesting_start_timestamp,
            vesting_end_timestamp: params.vesting_end_timestamp,
            source_category: params.source_category,
            depositor: ctx.accounts.admin.key(),
        });

        msg!(
            "Created vesting schedule {} with {} tokens, cliff at {}, vesting from {} to {}",
            schedule_id,
            params.total_amount,
            params.cliff_timestamp,
            params.vesting_start_timestamp,
            params.vesting_end_timestamp
        );

        Ok(())
    }

    pub fn crank_vesting_schedules<'info>(
        ctx: Context<'_, '_, '_, 'info, CrankVestingSchedules<'info>>,
        num_schedules_to_process: u8,
    ) -> Result<()> {
        let program_config = &ctx.accounts.program_config;

        // Get current timestamp
        let current_timestamp = Clock::get()?.unix_timestamp;

        // Prepare account infos for transfer
        let distribution_hub_token_account_info = ctx.accounts.distribution_hub_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();

        // Validate that distribution hub is set
        require!(program_config.distribution_hub != Pubkey::default(), VestingError::DistributionHubNotSet);

        require!(
            ctx.accounts.distribution_hub_token_account.owner == program_config.distribution_hub,
            VestingError::HubAccountOwnerMismatch
        );

        // Get remaining accounts (pairs of VestingSchedule and VestingVault)
        let remaining_accounts_slice = ctx.remaining_accounts;

        // Calculate how many schedules we can process
        let max_possible_from_remaining = remaining_accounts_slice.len() / 2;
        let num_schedules_to_process_actual = (num_schedules_to_process as usize)
            .min(MAX_SCHEDULES_PER_CRANK as usize)
            .min(max_possible_from_remaining as u8 as usize);

        // Validate remaining accounts count
        require!(
            remaining_accounts_slice.len() >= num_schedules_to_process_actual * 2,
            VestingError::InvalidRemainingAccount
        );

        // Estimate compute units needed
        let estimated_cu = BASE_CRANK_COMPUTE_UNITS + (num_schedules_to_process_actual as u32 * COMPUTE_UNITS_PER_SCHEDULE);
        msg!("Estimated CU needed: {}", estimated_cu);

        let mut schedules_successfully_processed_count: u8 = 0;

        // Process each vesting schedule
        for i in 0..num_schedules_to_process_actual {
            let vesting_schedule_index = i * 2;
            let vesting_vault_index = i * 2 + 1;

            // Validate account indices
            if vesting_schedule_index >= remaining_accounts_slice.len() || vesting_vault_index >= remaining_accounts_slice.len() {
                msg!("Invalid remaining account indices for schedule {}", i);
                continue;
            }

            let vesting_schedule_info_ref = &remaining_accounts_slice[vesting_schedule_index];
            let vesting_vault_info_ref = &remaining_accounts_slice[vesting_vault_index];

            // --- Read VestingSchedule data (short borrow) ---
            let vesting_schedule_account = {
                let data = vesting_schedule_info_ref.try_borrow_data()?;
                VestingSchedule::try_deserialize(&mut &data[..])?
            };

            // Validate schedule is initialized
            require!(vesting_schedule_account.is_initialized, VestingError::InvalidVestingScheduleData);

            // --- Read TokenAccount for vesting_vault_info (short borrow) ---
            let vesting_vault_data = {
                let data = vesting_vault_info_ref.try_borrow_data()?;
                TokenAccount::try_deserialize(&mut &data[..])?
            };

            // Validate vault state using IsInitialized trait
            require!(vesting_vault_data.is_initialized(), VestingError::InvalidVaultState);

            // --- Security and Consistency Checks ---
            require_keys_eq!(vesting_vault_data.owner, vesting_schedule_info_ref.key(), VestingError::VaultAuthorityMismatch);
            require_keys_eq!(vesting_schedule_account.token_vault, vesting_vault_info_ref.key(), VestingError::VaultMismatch);
            require_keys_eq!(vesting_vault_data.mint, vesting_schedule_account.mint, VestingError::MintMismatch);
            require_keys_eq!(vesting_schedule_account.mint, ctx.accounts.distribution_hub_token_account.mint, VestingError::HubAccountMintMismatch);

            // Check if schedule is already fully processed
            if vesting_schedule_account.amount_transferred >= vesting_schedule_account.total_amount {
                msg!("Schedule {} (ID: {}) already fully processed. Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id);
                continue;
            }

            // Calculate transferable amount
            let transferable_amount = vesting_schedule_account.get_transferable_amount(current_timestamp)?;

            if transferable_amount == 0 {
                msg!("No transferable amount for schedule {} (ID: {}) at timestamp {}. Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id, current_timestamp);
                continue;
            }

            // Ensure we don't exceed vault balance
            let actual_transfer_amount = transferable_amount.min(vesting_vault_data.amount);

            if actual_transfer_amount == 0 {
                msg!("Vault for schedule {} (ID: {}) is empty or calculated transferable amount is zero after min(). Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id);
                continue;
            }

            // --- Concurrent modification check ---
            // Re-read the current amount_transferred to detect concurrent modifications
            let current_amount_transferred = {
                let data = vesting_schedule_info_ref.try_borrow_data()?;
                let current_schedule = VestingSchedule::try_deserialize(&mut &data[..])?;
                current_schedule.amount_transferred
            };

            // If amount_transferred changed since we first read it, another crank might be processing
            if current_amount_transferred != vesting_schedule_account.amount_transferred {
                msg!("Concurrent modification detected for schedule {} (ID: {}). Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id);
                continue;
            }

            // Store values we need later before moving vesting_schedule_account
            let schedule_id = vesting_schedule_account.schedule_id;
            let source_category = vesting_schedule_account.source_category.clone();
            let bump = vesting_schedule_account.bump;
            let mut vesting_schedule_account_updated = vesting_schedule_account;

            // Create PDA signer seeds for the vesting schedule
            let schedule_id_bytes = schedule_id.to_le_bytes();
            let signer_seeds = &[
                b"vesting_schedule".as_ref(),
                schedule_id_bytes.as_ref(),
                &[bump],
            ];
            let signer = &[&signer_seeds[..]];

            // Transfer tokens from vesting vault to distribution hub
            let cpi_accounts = Transfer {
                from: vesting_vault_info_ref.clone(),
                to: distribution_hub_token_account_info.clone(),
                authority: vesting_schedule_info_ref.clone(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                token_program_info.clone(),
                cpi_accounts,
                signer,
            );
            token::transfer(cpi_ctx, actual_transfer_amount)?;

            // Update schedule amount_transferred
            vesting_schedule_account_updated.amount_transferred = vesting_schedule_account_updated.amount_transferred
                .checked_add(actual_transfer_amount)
                .ok_or(VestingError::MathOverflow)?;

            // --- Write back updated schedule data (short borrow) ---
            {
                let mut data = vesting_schedule_info_ref.try_borrow_mut_data()?;
                vesting_schedule_account_updated.try_serialize(&mut &mut data[..])?;
            }

            // Emit event with source category
            emit!(TokensReleased {
                schedule_id,
                mint: vesting_schedule_account_updated.mint,
                amount: actual_transfer_amount,
                source_category,
                timestamp: current_timestamp,
                total_released: vesting_schedule_account_updated.amount_transferred,
            });

            msg!(
                "Released {} tokens from schedule {} (ID: {}) to hub. Total released: {}",
                actual_transfer_amount,
                vesting_schedule_info_ref.key(),
                schedule_id,
                vesting_schedule_account_updated.amount_transferred
            );

            schedules_successfully_processed_count = schedules_successfully_processed_count.checked_add(1).ok_or(VestingError::MathOverflow)?;
        }

        msg!("Successfully processed {} out of {} attempted vesting schedules in this crank.", schedules_successfully_processed_count, num_schedules_to_process_actual);
        Ok(())
    }

    pub fn update_distribution_hub(
        ctx: Context<UpdateDistributionHub>,
        new_hub_address: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.program_config;
        let current_timestamp = Clock::get()?.unix_timestamp;

        // Case 1: Initial setup (current hub is Pubkey::default())
        if config.distribution_hub == Pubkey::default() {
            require!(new_hub_address != Pubkey::default(), VestingError::InvalidAmount);
            config.distribution_hub = new_hub_address;
            
            emit!(DistributionHubUpdated {
                old_hub: Pubkey::default(),
                new_hub: new_hub_address,
            });

            msg!("Distribution hub initialized to: {}", new_hub_address);
            return Ok(());
        }

        // Case 2: Confirming a pending update
        if let Some(pending_hub_val) = config.pending_hub {
            if new_hub_address == pending_hub_val {
                let timelock_expiry = config.hub_update_timelock.ok_or(VestingError::TimelockNotExpired)?;
                require!(current_timestamp >= timelock_expiry, VestingError::TimelockNotExpired);

                let old_hub = config.distribution_hub;
                config.distribution_hub = new_hub_address;
                config.pending_hub = None;
                config.hub_update_timelock = None;

                emit!(DistributionHubUpdated {
                    old_hub,
                    new_hub: config.distribution_hub,
                });

                msg!("Distribution hub updated from {} to: {}", old_hub, config.distribution_hub);
                return Ok(());
            }
        }

        // Case 3: Proposing a new update
        require!(new_hub_address != config.distribution_hub, VestingError::HubAddressNotChanged);
        if let Some(pending_hub_val) = config.pending_hub {
            require!(new_hub_address != pending_hub_val, VestingError::HubAddressNotChanged);
        }

        config.pending_hub = Some(new_hub_address);
        let new_timelock_expiry = current_timestamp.checked_add(HUB_UPDATE_TIMELOCK).ok_or(VestingError::MathOverflow)?;
        config.hub_update_timelock = Some(new_timelock_expiry);

        emit!(DistributionHubUpdateProposed {
            current_hub: config.distribution_hub,
            proposed_hub: new_hub_address,
            timelock_expiry: new_timelock_expiry,
        });

        msg!(
            "Distribution hub update proposed. New hub: {}, will be active after timestamp: {}",
            new_hub_address,
            new_timelock_expiry
        );

        Ok(())
    }
}

#[event]
pub struct ProgramInitialized {
    pub admin: Pubkey,
    pub program_config: Pubkey,
}

#[event]
pub struct VestingScheduleCreated {
    pub schedule_id: u64,
    pub mint: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub source_category: SourceCategory,
    pub depositor: Pubkey,
}

#[event]
pub struct TokensReleased {
    pub schedule_id: u64,
    pub mint: Pubkey,
    pub amount: u64,
    pub source_category: SourceCategory,
    pub timestamp: i64,
    pub total_released: u64,
}

#[event]
pub struct DistributionHubUpdateProposed {
    pub current_hub: Pubkey,
    pub proposed_hub: Pubkey,
    pub timelock_expiry: i64,
}

#[event]
pub struct DistributionHubUpdated {
    pub old_hub: Pubkey,
    pub new_hub: Pubkey,
}