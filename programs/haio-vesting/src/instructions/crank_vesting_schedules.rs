// programs/haio-vesting/src/instructions/crank_vesting_schedules.rs

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{ProgramConfig, VestingSchedule};
use crate::errors::VestingError;
use crate::constants::{PROGRAM_CONFIG_SEED, MAX_SCHEDULES_PER_CRANK, VESTING_SCHEDULE_SEED};
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
        constraint = distribution_hub_token_account.owner == program_config.distribution_hub @ VestingError::HubAccountOwnerMismatch
    )]
    pub distribution_hub_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CrankVestingSchedules<'info>>, 
    num_schedules_to_process_param: u8
) -> Result<()> {
    let program_config = &ctx.accounts.program_config;
    let distribution_hub_token_account_info = ctx.accounts.distribution_hub_token_account.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();
    
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    require!(program_config.distribution_hub != Pubkey::default(), VestingError::DistributionHubNotSet);
    
    let remaining_accounts_slice = ctx.remaining_accounts;

    let max_possible_from_remaining = remaining_accounts_slice.len() / 2;
    let num_schedules_to_process_actual = num_schedules_to_process_param
        .min(MAX_SCHEDULES_PER_CRANK)
        .min(max_possible_from_remaining as u8);
    
    require!(
        remaining_accounts_slice.len() >= (num_schedules_to_process_actual as usize) * 2,
        VestingError::TooManyAccountsToProcess
    );

    let mut schedules_successfully_processed_count: u32 = 0;

    for i in 0..num_schedules_to_process_actual {
        let schedule_idx = i as usize * 2;
        let vault_idx = schedule_idx + 1;

        let vesting_schedule_info_ref = &remaining_accounts_slice[schedule_idx];
        let vesting_vault_info_ref = &remaining_accounts_slice[vault_idx];

        // --- Read VestingSchedule data (short borrow) ---
        let mut vesting_schedule_account = {
            let data = vesting_schedule_info_ref.try_borrow_data()?;
            VestingSchedule::try_deserialize(&mut &data[..])?
        };
        
        require!(vesting_schedule_account.is_initialized, VestingError::InvalidVestingScheduleData);
        
        // --- Read TokenAccount for vesting_vault_info (short borrow) ---
        let vesting_vault_data = {
            let data = vesting_vault_info_ref.try_borrow_data()?;
            TokenAccount::try_deserialize(&mut &data[..])?
        };

        // --- Security and Consistency Checks ---
        require_keys_eq!(vesting_vault_data.owner, vesting_schedule_info_ref.key(), VestingError::VaultAuthorityMismatch);
        require_keys_eq!(vesting_schedule_account.token_vault, vesting_vault_info_ref.key(), VestingError::VaultMismatch);
        require_keys_eq!(vesting_vault_data.mint, vesting_schedule_account.mint, VestingError::MintMismatch);
        require_keys_eq!(vesting_schedule_account.mint, ctx.accounts.distribution_hub_token_account.mint, VestingError::HubAccountMintMismatch);

        if vesting_schedule_account.amount_transferred >= vesting_schedule_account.total_amount {
            msg!("Schedule {} (ID: {}) already fully processed. Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id);
            continue;
        }

        let transferable_amount = vesting_schedule_account.get_transferable_amount(current_timestamp)?;

        if transferable_amount == 0 {
            msg!("No transferable amount for schedule {} (ID: {}) at timestamp {}. Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id, current_timestamp);
            continue;
        }
        
        let actual_transfer_amount = transferable_amount.min(vesting_vault_data.amount);
        if actual_transfer_amount == 0 {
            msg!("Vault for schedule {} (ID: {}) is empty or calculated transferable amount is zero after min(). Skipping.", vesting_schedule_info_ref.key(), vesting_schedule_account.schedule_id);
            continue;
        }

        let schedule_id_bytes = vesting_schedule_account.schedule_id.to_le_bytes();
        let pda_signer_seeds_group: &[&[u8]] = &[
            VESTING_SCHEDULE_SEED,
            &schedule_id_bytes,
            &[vesting_schedule_account.bump],
        ];
        
        let cpi_accounts = Transfer {
            from: vesting_vault_info_ref.clone(),
            to: distribution_hub_token_account_info.clone(),
            authority: vesting_schedule_info_ref.clone(),
        };
        
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(), 
                cpi_accounts, 
                &[pda_signer_seeds_group]
            ), 
            actual_transfer_amount
        )?;

        // Update schedule amount_transferred
        vesting_schedule_account.amount_transferred = vesting_schedule_account.amount_transferred
            .checked_add(actual_transfer_amount)
            .ok_or(VestingError::MathOverflow)?;
        
        // --- Write back updated schedule data (short borrow) ---
        {
            let mut data = vesting_schedule_info_ref.try_borrow_mut_data()?;
            vesting_schedule_account.try_serialize(&mut &mut data[..])?;
        }

        emit!(TokensReleased {
            schedule_id: vesting_schedule_account.schedule_id,
            vesting_schedule_pda: vesting_schedule_info_ref.key(),
            amount_released: actual_transfer_amount,
            new_amount_transferred_on_schedule: vesting_schedule_account.amount_transferred,
            distribution_hub_recipient_account: distribution_hub_token_account_info.key(),
            timestamp: current_timestamp,
        });

        msg!(
            "Cranked schedule {} (ID: {}): Transferred {} tokens. Total transferred now: {}. Approx vault balance before transfer: {}. Current time: {}",
            vesting_schedule_info_ref.key(),
            vesting_schedule_account.schedule_id,
            actual_transfer_amount,
            vesting_schedule_account.amount_transferred,
            vesting_vault_data.amount,
            current_timestamp
        );
        schedules_successfully_processed_count = schedules_successfully_processed_count.checked_add(1).ok_or(VestingError::MathOverflow)?;
    }

    msg!("Successfully processed {} out of {} attempted vesting schedules in this crank.", schedules_successfully_processed_count, num_schedules_to_process_actual);
    Ok(())
}