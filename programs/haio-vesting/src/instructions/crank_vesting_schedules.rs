// programs/haio-vesting/src/instructions/crank_vesting_schedules.rs

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_lang::solana_program::program_pack::IsInitialized;

use crate::constants::{PROGRAM_CONFIG_SEED, MAX_SCHEDULES_PER_CRANK, BASE_CRANK_CU, CU_PER_SCHEDULE};
use crate::state::{ProgramConfig, VestingSchedule};
use crate::errors::VestingError;

use crate::TokensReleased;

#[derive(Accounts)]
pub struct CrankVestingSchedules<'info> {
    #[account(
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        constraint = distribution_hub_token_account.mint == mint.key() @ VestingError::HubAccountMintMismatch,
        constraint = distribution_hub_token_account.owner == program_config.distribution_hub @ VestingError::HubAccountOwnerMismatch
    )]
    pub distribution_hub_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is the mint account, validated by constraint
    pub mint: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CrankVestingSchedules<'info>>,
    max_schedules: u8,
) -> Result<()> {
    let program_config = &ctx.accounts.program_config;

    // Get current timestamp
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    // Prepare account infos for transfer
    let distribution_hub_token_account_info = ctx.accounts.distribution_hub_token_account.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

    // Validate that distribution hub is set
    require!(program_config.distribution_hub != Pubkey::default(), VestingError::DistributionHubNotSet);

    // Get remaining accounts (pairs of VestingSchedule and VestingVault)
    let remaining_accounts_slice = ctx.remaining_accounts;

    // Calculate how many schedules we can process
    let max_possible_from_remaining = remaining_accounts_slice.len() / 2;
    let num_schedules_to_process_actual = (max_schedules as usize)
        .min(MAX_SCHEDULES_PER_CRANK as usize)
        .min(max_possible_from_remaining as u8 as usize);

    // Validate remaining accounts count
    require!(
        remaining_accounts_slice.len() >= num_schedules_to_process_actual * 2,
        VestingError::TooManyAccountsToProcess
    );

    // Estimate compute units needed
    let estimated_cu = BASE_CRANK_CU + (num_schedules_to_process_actual as u32 * CU_PER_SCHEDULE);
    msg!("Estimated CU needed: {}", estimated_cu);

    let mut schedules_successfully_processed_count = 0u8;

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
        let schedule_bump = vesting_schedule_account.bump;
        let total_amount = vesting_schedule_account.total_amount;
        let current_transferred = vesting_schedule_account.amount_transferred;

        // Create PDA signer seeds for the vesting schedule
        let schedule_id_bytes = schedule_id.to_le_bytes();
        let signer_seeds = &[
            b"vesting_schedule".as_ref(),
            schedule_id_bytes.as_ref(),
            &[schedule_bump],
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
        let new_amount_transferred = current_transferred
            .checked_add(actual_transfer_amount)
            .ok_or(VestingError::MathOverflow)?;

        // --- Write back updated schedule data (short borrow) ---
        let mut vesting_schedule_account_updated = vesting_schedule_account;
        vesting_schedule_account_updated.amount_transferred = new_amount_transferred;

        {
            let mut data = vesting_schedule_info_ref.try_borrow_mut_data()?;
            vesting_schedule_account_updated.try_serialize(&mut &mut data[..])?;
        }

        // Emit event
        emit!(TokensReleased {
            schedule_id,
            amount: actual_transfer_amount,
            recipient: program_config.distribution_hub,
            timestamp: current_timestamp,
        });

        msg!(
            "Released {} tokens from schedule {} (ID: {}) to distribution hub. Total transferred: {} / {}",
            actual_transfer_amount,
            vesting_schedule_info_ref.key(),
            schedule_id,
            new_amount_transferred,
            total_amount
        );

        schedules_successfully_processed_count = schedules_successfully_processed_count.checked_add(1).ok_or(VestingError::MathOverflow)?;
    }

    msg!("Successfully processed {} out of {} attempted vesting schedules in this crank.", schedules_successfully_processed_count, num_schedules_to_process_actual);
    Ok(())
}