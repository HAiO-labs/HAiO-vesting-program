# HAiO Token Vesting Program

Production-ready Solana program for HAiO token vesting and distribution management.

---

## Overview

The **HAiO Vesting Program** is a secure, decentralised solution for managing token-vesting schedules on Solana.  
It enables time-based token releases with cliff periods, linear vesting, and automated distribution to a designated recipient wallet (e.g., multi-sig vault) for final beneficiary distribution.

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
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐
│   Admin Wallet  │    │  Vesting Vault   │    │ Recipient Wallet       │
│                 │───▶│  (Per Schedule)  │───▶│ (Multi-sig, Category) │
│ Creates/Manages │    │                  │    │                        │
└─────────────────┘    └──────────────────┘    └────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐
│ Program Config  │    │ Vesting Schedule │    │ Token Recipients      │
│ (Global State)  │    │ (Individual)     │    │                        │
└─────────────────┘    └──────────────────┘    └────────────────────────┘
```

---

## Core Components

| Component            | Description                           | PDA Seeds                           |
| -------------------- | ------------------------------------- | ----------------------------------- |
| **ProgramConfig**    | Global program state & admin controls | `["program_config"]`                |
| **VestingSchedule**  | Individual vesting-schedule data      | `["vesting_schedule", schedule_id]` |
| **VestingVault**     | Token storage for each schedule       | `["vesting_vault", schedule_id]`    |
| **Recipient Wallet** | Final recipient (multi-sig vault)     | (Not a PDA, actual wallet address)  |

---

## Security Model

### Access Control

- **Admin-only** — schedule creation, recipient wallet management
- **Permissionless** — vesting execution (crank)

### Timelock Protection

- 48-hour delay for recipient wallet address changes (if applicable)

### Validation Layers

1. **Account Verification** — mint, vault & recipient consistency
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
RUSTFLAGS="--cfg feature=\"test-utils\"" anchor test

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
yarn initialize-program

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

### 1 · Initialize Program

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from './target/types/haio_vesting';

const program = anchor.workspace.HaioVesting as Program<HaioVesting>;

await program.methods
  .initialize()
  .accountsPartial({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

### 2 · Create Vesting Schedule

```typescript
const scheduleParams = {
  recipient: recipientPubkey,
  recipientTokenAccount: recipientTokenAccountAddress,
  totalAmount: new anchor.BN(amount),
  cliffTimestamp: new anchor.BN(cliffTimestamp),
  vestingStartTimestamp: new anchor.BN(vestingStartTimestamp),
  vestingEndTimestamp: new anchor.BN(vestingEndTimestamp),
  sourceCategory: { team: {} }, // or other category
};

await program.methods
  .createVestingSchedule(new anchor.BN(scheduleId), scheduleParams)
  .accountsPartial({
    admin: adminKeypair.publicKey,
    programConfig: programConfigPDA,
    vestingSchedule: vestingSchedulePDA,
    mint: tokenMint,
    depositorTokenAccount: adminTokenAccount,
    recipientTokenAccount: recipientTokenAccountAddress,
    vestingVault: vestingVaultPDA,
    systemProgram: anchor.web3.SystemProgram.programId,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### 3 · Execute Vesting (Crank)

```typescript
await program.methods
  .crankVestingSchedule()
  .accountsPartial({
    programConfig: programConfigPDA,
    vestingSchedule: vestingSchedulePDA,
    vestingVault: vestingVaultPDA,
    recipientTokenAccount: recipientTokenAccount,
    mint: tokenMint,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

## Operational Scripts

| Task                    | Script Command                    |
| ----------------------- | --------------------------------- |
| Token creation          | `yarn create-token`               |
| Batch schedule creation | `yarn create-vesting`             |
| Automated crank runner  | `yarn run-crank`                  |
| Token metadata          | `yarn create-token-metadata`      |
| On-chain metadata       | `yarn create-onchain-metadata`    |
| Finalize mint authority | `yarn finalize-mint-authority`    |
| Initialize multisig ATA | `yarn initialize-multisig-ata`    |
| Immediate distribution  | `yarn immediate-distribution`     |
| Finalize upgrade auth   | `yarn finalize-upgrade-authority` |
| Remove update authority | `yarn remove-update-authority`    |
| Test crank              | `yarn test-crank`                 |

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
console.log(`Recipient Wallet: ${cfg.recipientWallet}`);

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

| Error                        | Cause                     | Fix                                |
| ---------------------------- | ------------------------- | ---------------------------------- |
| `RecipientWalletNotSet`      | Recipient not configured  | Call `updateRecipientWallet` first |
| `TimelockNotExpired`         | Wallet update too soon    | Wait 48 h                          |
| `ScheduleIdConflict`         | Duplicate schedule ID     | Use `totalSchedules` counter       |
| `MintMismatch`               | Wrong token mint          | Verify all accounts                |
| `WalletAccountOwnerMismatch` | Wallet ATA owner mismatch | Ensure ATA owned by wallet         |

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
RUSTFLAGS="--cfg feature=\"test-utils\"" anchor test               # full suite
RUSTFLAGS="--cfg feature=\"test-utils\"" anchor test tests/haio-vesting.ts
RUSTFLAGS="--cfg feature=\"test-utils\"" anchor test --coverage
```

### Lint & Format

```bash
cargo fmt        && cargo clippy
yarn prettier --write "**/*.{ts,js,json}"
```

---

## API Reference

### Instructions

| Name                    | Purpose                       | Authority |
| ----------------------- | ----------------------------- | --------- |
| `initialize`            | Configure program             | Admin     |
| `createVestingSchedule` | Add vesting schedule          | Admin     |
| `crankVestingSchedules` | Execute vested releases       | Anyone    |
| `updateRecipientWallet` | Propose/execute wallet change | Admin     |

### Account Structures

<details>
<summary>ProgramConfig</summary>

```rust
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub recipient_wallet: Pubkey,
    pub pending_wallet: Option<Pubkey>,
    pub wallet_update_timelock: Option<i64>,
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
- `RecipientWalletUpdateProposed`
- `RecipientWalletUpdated`

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
