// programs/haio-vesting/src/instructions/update_distribution_hub.rs

use anchor_lang::prelude::*;

use crate::constants::{PROGRAM_CONFIG_SEED, HUB_UPDATE_TIMELOCK};
use crate::state::ProgramConfig;
use crate::errors::VestingError;

use crate::{DistributionHubUpdateProposed, DistributionHubUpdated}; // Events

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

pub fn handler(ctx: Context<UpdateDistributionHub>, new_hub_address: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.program_config;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    // Case 1: Initial setup (current hub is Pubkey::default())
    if config.distribution_hub == Pubkey::default() {
        require!(new_hub_address != Pubkey::default(), VestingError::InvalidAmount); // Cannot set to default again

        config.distribution_hub = new_hub_address;

        emit!(DistributionHubUpdated {
            admin: ctx.accounts.admin.key(),
            old_hub: Pubkey::default(),
            new_hub: new_hub_address,
            timestamp: current_timestamp,
        });

        msg!("Distribution hub initialized to: {}", new_hub_address);
        return Ok(());
    }

    // Case 2: Confirming a pending update
    // Admin calls this instruction again with the same `new_hub_address` that is currently in `pending_hub`.
    if let Some(pending_hub_val) = config.pending_hub {
        if new_hub_address == pending_hub_val {
            let timelock_expiry = config.hub_update_timelock.ok_or(VestingError::TimelockNotExpired)?; // Should exist
            require!(current_timestamp >= timelock_expiry, VestingError::TimelockNotExpired);

            let old_hub = config.distribution_hub;
            config.distribution_hub = new_hub_address;
            config.pending_hub = None;
            config.hub_update_timelock = None;

            emit!(DistributionHubUpdated {
                admin: ctx.accounts.admin.key(),
                old_hub: old_hub,
                new_hub: config.distribution_hub,
                timestamp: current_timestamp,
            });

            msg!("Distribution hub updated from {} to: {}", old_hub, config.distribution_hub);
            return Ok(());
        }
    }

    // Case 3: Proposing a new update (or overwriting an existing unconfirmed pending one)
    require!(new_hub_address != config.distribution_hub, VestingError::HubAddressNotChanged); // Cannot propose the current active hub
    if let Some(pending_hub_val) = config.pending_hub { // If there's an existing pending hub
        require!(new_hub_address != pending_hub_val, VestingError::HubAddressNotChanged); // And it's different from the new proposal
    }

    config.pending_hub = Some(new_hub_address);
    let new_timelock_expiry = current_timestamp.checked_add(HUB_UPDATE_TIMELOCK).ok_or(VestingError::MathOverflow)?;
    config.hub_update_timelock = Some(new_timelock_expiry);

    emit!(DistributionHubUpdateProposed {
        admin: ctx.accounts.admin.key(),
        current_hub: config.distribution_hub,
        proposed_hub: new_hub_address,
        timelock_expiry: new_timelock_expiry,
    });

    msg!(
        "Distribution hub update proposed from {} to {}. Timelock expires at: {}",
        config.distribution_hub,
        new_hub_address,
        new_timelock_expiry
    );

    Ok(())
}