# HAiO TGE Vesting Program

Solana-based vesting program for HAiO token distribution.

## Overview

This program manages the vesting schedules for HAiO token, allowing time-based token releases according to predefined schedules. Released tokens are automatically transferred to a central distribution hub for final distribution to beneficiaries.

## Features

- Multiple vesting schedules with cliff and linear release periods
- Source category tracking for transparent fund management
- Permissionless crank mechanism for token releases
- Integration with distribution hub program
- Admin controls with timelock for critical operations

## Development Setup

### Prerequisites

- Rust 1.87.0
- Solana CLI 2.1.22
- Anchor 0.31.1
- Node.js 23

### Installation

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Run tests
anchor test
Program Structure
Copyprograms/haio-vesting/
├── src/
│   ├── lib.rs              # Program entry point
│   ├── constants.rs        # Program constants
│   ├── errors.rs           # Custom error definitions
│   ├── state/              # Account structures
│   │   ├── mod.rs
│   │   ├── program_config.rs
│   │   └── vesting_schedule.rs
│   └── instructions/       # Program instructions
│       ├── mod.rs
│       ├── initialize.rs
│       ├── create_vesting_schedule.rs
│       ├── crank_vesting_schedules.rs
│       └── update_distribution_hub.rs
Key Accounts
AccountDescriptionSeedsProgramConfigGlobal program configuration[b"program_config"]VestingScheduleIndividual vesting schedule[b"vesting_schedule", schedule_id.to_le_bytes()]VestingVaultToken vault for each schedule[b"vesting_vault", schedule_id.to_le_bytes()]
Usage
Initialize Program
typescriptCopyawait program.methods
  .initialize()
  .accounts({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
    systemProgram: SystemProgram.programId,
  })
  .signers([adminKeypair])
  .rpc();
Create Vesting Schedule
typescriptCopyawait program.methods
  .createVestingSchedule({
    totalAmount: new BN(1_000_000 * 10**9),
    cliffTimestamp: new BN(cliffTime),
    vestingStartTimestamp: new BN(vestingStart),
    vestingEndTimestamp: new BN(vestingEnd),
    sourceCategory: { seed: {} }, // or strategic, publicIDO, team, etc.
  })
  .accounts({
    admin: adminKeypair.publicKey,
    // ... other accounts
  })
  .signers([adminKeypair])
  .rpc();
Crank Vesting Schedules
typescriptCopy// Anyone can call this
await program.methods
  .crankVestingSchedules(5) // Process up to 5 schedules
  .accounts({
    // ... required accounts
  })
  .rpc();
Security Considerations

Admin functions are restricted to program admin only
Distribution hub updates have a 48-hour timelock
All calculations use checked math to prevent overflows
Vesting schedules are immutable once created

License
Apache 2.0
```
