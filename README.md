# HAiO Token Vesting Program

Production-ready Solana program for HAiO token vesting and distribution management.

---

## Overview

The **HAiO Vesting Program** is a secure, decentralised solution for managing token-vesting schedules on Solana.  
It enables time-based token releases with cliff periods, linear vesting, and automated distribution to a central hub for final beneficiary distribution.

---

## Key Features

- ✅ **Multi-schedule Support**&nbsp;— create unlimited vesting schedules with individual parameters
- ✅ **Flexible Vesting**&nbsp;— cliff periods **+** linear vesting with custom timelines
- ✅ **Permissionless Execution**&nbsp;— anyone can trigger releases via a crank mechanism
- ✅ **Security First**&nbsp;— admin controls, timelocks, comprehensive validation
- ✅ **Source Tracking**&nbsp;— categorise schedules by funding source for transparency
- ✅ **Concurrent Safe**&nbsp;— protection against double-spending & race conditions
- ✅ **Gas Optimised**&nbsp;— efficient batch processing with compute-unit estimation

---

## Architecture

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Admin Wallet  │    │  Vesting Vault   │    │ Distribution    │
│                 │───▶│  (Per Schedule)  │───▶│ Hub             │
│ Creates/Manages │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Program Config  │    │ Vesting Schedule │    │ Token Recipients│
│ (Global State)  │    │ (Individual)     │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

---

## Core Components

| Component           | Description                           | PDA Seeds                           |
| ------------------- | ------------------------------------- | ----------------------------------- |
| **ProgramConfig**   | Global program state & admin controls | `["program_config"]`                |
| **VestingSchedule** | Individual vesting-schedule data      | `["vesting_schedule", schedule_id]` |
| **VestingVault**    | Token storage for each schedule       | `["vesting_vault", schedule_id]`    |

---

## Security Model

### Access Control

- **Admin-only** — schedule creation, hub management
- **Permissionless** — vesting execution (crank)

### Timelock Protection

- 48-hour delay for hub-address changes

### Validation Layers

1. **Account Verification** — mint, vault & hub consistency
2. **Math Safety** — overflow checks on all calculations
3. **Concurrency Guards** — double-spend prevention
4. **State Integrity** — strict parameter validation

---

## Installation & Setup

### Prerequisites

```bash
# Required versions
node        >= 18.0.0
rust        >= 1.70.0
solana-cli  >= 1.18.0
anchor-cli  >= 0.31.1
```

### Quick Start

```bash
# Clone repository
git clone <repository-url>
cd haio-vesting

# Install dependencies
yarn install

# Build program
anchor build

# Run tests
anchor test

# Deploy (devnet)
anchor deploy --provider.cluster devnet
```

---

## Deployment Guide

### Pre-deployment Checklist

- **Update Program ID:** replace demo ID in `lib.rs` & `Anchor.toml`
- **Configure Network:** set correct cluster in `Anchor.toml`
- **Prepare Keypairs:** secure admin & upgrade-authority wallets
- **Fund Accounts:** ensure sufficient SOL
- **Review Parameters:** timelock duration & constants

### Production Deployment

```bash
# 1. Generate program keypair
solana-keygen new -o target/deploy/haio_vesting-keypair.json

# 2. Update program ID
# ⟶ edit programs/haio-vesting/src/lib.rs
#    declare_id!("NEW_PROGRAM_ID");

# 3. Build (verifiable)
anchor build --verifiable

# 4. Deploy to mainnet
anchor deploy \
  --provider.cluster mainnet \
  --program-name haio_vesting \
  --program-keypair target/deploy/haio_vesting-keypair.json

# 5. Initialise program
node scripts/initialize.js --cluster mainnet

# 6. Verify
anchor verify --provider.cluster mainnet <PROGRAM_ID>
```

### Post-deployment Security ⚠️

```bash
# Transfer upgrade authority to multisig
solana program set-upgrade-authority <PROGRAM_ID> <MULTISIG_ADDRESS>

# ― or — revoke upgrade authority (irreversible)
solana program set-upgrade-authority <PROGRAM_ID> --final
```

---

## Usage Guide

### 1 · Initialise Program

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from './target/types/haio_vesting';

const program = anchor.workspace.HaioVesting as Program<HaioVesting>;

await program.methods
  .initialize()
  .accounts({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .signers([adminKeypair])
  .rpc();
```

### 2 · Set Distribution Hub

```typescript
await program.methods
  .updateDistributionHub(distributionHub)
  .accounts({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
  })
  .signers([adminKeypair])
  .rpc();
```

### 3 · Create Vesting Schedule

```typescript
const scheduleParams = {
  totalAmount: new BN(1_000_000 * 10 ** 9), // 1 M tokens
  cliffTimestamp: new BN(Date.now() / 1000 + 86400 * 30), // 30 days
  vestingStartTimestamp: new BN(Date.now() / 1000 + 86400 * 30),
  vestingEndTimestamp: new BN(Date.now() / 1000 + 86400 * 365), // 1 year
  sourceCategory: { team: {} },
};

await program.methods
  .createVestingSchedule(scheduleId, scheduleParams)
  .accounts({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
    vestingSchedule: vestingSchedulePDA,
    mint: tokenMint,
    depositorTokenAccount: adminTokenAccount,
    vestingVault: vestingVaultPDA,
    systemProgram: anchor.web3.SystemProgram.programId,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([adminKeypair])
  .rpc();
```

### 4 · Execute Vesting (Crank)

```typescript
await program.methods
  .crankVestingSchedules(5) // up to 5 schedules
  .accounts({
    programConfig: programConfigPDA,
    distributionHubTokenAccount: hubTokenAccount,
    mint: tokenMint,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
  })
  .remainingAccounts([
    // [schedule, vault] pairs
    { pubkey: sched1PDA, isWritable: true, isSigner: false },
    { pubkey: vault1PDA, isWritable: true, isSigner: false },
    { pubkey: sched2PDA, isWritable: true, isSigner: false },
    { pubkey: vault2PDA, isWritable: true, isSigner: false },
    // …
  ])
  .rpc();
```

---

## Operational Scripts

| Task                    | Script                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| Token creation          | `node scripts/01_create_token.js  --cluster mainnet --supply 1000000000`   |
| Batch schedule creation | `node scripts/02_create_vesting_schedules.js --config vesting-config.json` |
| Automated crank runner  | `node scripts/03_run_crank.js --interval 3600000`                          |

---

## Gas Optimisation

### Compute-Unit Guidelines

| Operation        | Base CU | + Per Schedule | Recommended Limit |
| ---------------- | :-----: | :------------: | :---------------: |
| Initialise       |  \~5 k  |       –        |       50 k        |
| Create schedule  | \~25 k  |       –        |       100 k       |
| Crank (1 sched.) | \~50 k  |     + 45 k     |       600 k       |
| Update hub       |  \~5 k  |       –        |       50 k        |

### Example Crank with Budget Ixs

```typescript
import { ComputeBudgetProgram } from '@solana/web3.js';

const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 50_000 + schedules * 45_000,
});

const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1_000, // tweak per congestion
});

await program.methods
  .crankVestingSchedules(schedules)
  .preInstructions([cuLimitIx, cuPriceIx])
  .accounts(/* … */)
  .rpc();
```

---

## Monitoring & Ops

```typescript
// Program health
const cfg = await program.account.programConfig.fetch(configPDA);
console.log(`Schedules: ${cfg.totalSchedules}`);
console.log(`Hub:       ${cfg.distributionHub}`);

// Per schedule
const sch = await program.account.vestingSchedule.fetch(schedulePDA);
console.log(`Progress: ${(sch.amountTransferred / sch.totalAmount) * 100}%`);
```

### Suggested Crank Frequency

| Phase         | Interval         |
| ------------- | ---------------- |
| High activity | every 1 h        |
| Maintenance   | every 6-12 h     |
| Emergency     | manual as needed |

---

## Troubleshooting

| Error                     | Cause                  | Fix                                |
| ------------------------- | ---------------------- | ---------------------------------- |
| `DistributionHubNotSet`   | Hub not configured     | Call `updateDistributionHub` first |
| `TimelockNotExpired`      | Hub update too soon    | Wait 48 h                          |
| `ScheduleIdConflict`      | Duplicate schedule ID  | Use `totalSchedules` counter       |
| `MintMismatch`            | Wrong token mint       | Verify all accounts                |
| `HubAccountOwnerMismatch` | Hub ATA owner mismatch | Ensure ATA owned by hub            |

```bash
# Debug mode
export RUST_LOG=debug
export ANCHOR_LOG=true
anchor test --skip-deploy -- --nocapture
```

---

## Security Considerations

| Status            | Progress     |
| ----------------- | ------------ |
| Static analysis   | ✅ Passed    |
| Unit tests > 95 % | ✅ Passed    |
| Integration tests | ✅ Passed    |
| External audit    | ⏳ Scheduled |

### Best Practices

- Use **multisig** for admin actions
- Gradual roll-out with small allocations
- Continuous monitoring & alerting
- Document emergency procedures
- Community-governed upgrades

---

## Development

### Tests

```bash
anchor test               # full suite
anchor test tests/haio-vesting.ts
anchor test --coverage
```

### Lint & Format

```bash
cargo fmt        && cargo clippy
yarn prettier --write "**/*.{ts,js,json}"
```

---

## API Reference

### Instructions

| Name                    | Purpose                    | Authority |
| ----------------------- | -------------------------- | --------- |
| `initialize`            | Configure program          | Admin     |
| `createVestingSchedule` | Add vesting schedule       | Admin     |
| `crankVestingSchedules` | Execute vested releases    | Anyone    |
| `updateDistributionHub` | Propose/execute hub change | Admin     |

### Account Structures

<details>
<summary>ProgramConfig</summary>

```rust
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub distribution_hub: Pubkey,
    pub pending_hub: Option<Pubkey>,
    pub hub_update_timelock: Option<i64>,
    pub total_schedules: u64,
    pub bump: u8,
}
```

</details>

<details>
<summary>VestingSchedule</summary>

```rust
pub struct VestingSchedule {
    pub schedule_id: u64,
    pub mint: Pubkey,
    pub token_vault: Pubkey,
    pub depositor: Pubkey,
    pub total_amount: u64,
    pub cliff_timestamp: i64,
    pub vesting_start_timestamp: i64,
    pub vesting_end_timestamp: i64,
    pub amount_transferred: u64,
    pub source_category: SourceCategory,
    pub is_initialized: bool,
    pub bump: u8,
}
```

</details>

### Events

- `ProgramInitialized`
- `VestingScheduleCreated`
- `TokensReleased`
- `DistributionHubUpdateProposed`
- `DistributionHubUpdated`

---

## Contributing

1. Fork → `git checkout -b feature/<name>`
2. Commit + tests → `anchor test`
3. PR with clear description

### Standards

- Idiomatic Rust/TS
- Comprehensive tests
- Update docs + conventional commits

---

## License

Apache 2.0 – see `LICENSE` for details.
