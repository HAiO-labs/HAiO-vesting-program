import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getOrCreateAssociatedTokenAccount, getAccount } from '@solana/spl-token';
import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const BATCH_SIZE = 5; // Process 5 schedules at a time

async function main() {
  console.log('🔄 Starting vesting crank process...');

  // Load configuration
  const configPath = path.join(__dirname, '../.haio-token-config.json');
  const tokenConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const mint = new anchor.web3.PublicKey(tokenConfig.mint);

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Check if payer exists
  if (!provider.wallet.payer) {
    throw new Error('Wallet payer not found. Make sure you have a valid wallet configured.');
  }

  const payer = provider.wallet.payer;
  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;

  // Get program config
  const [programConfig] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  const config = await program.account.programConfig.fetch(programConfig);
  const totalSchedules = config.totalSchedules.toNumber();
  console.log(`📊 Total vesting schedules: ${totalSchedules}`);

  if (config.distributionHub.toString() === anchor.web3.PublicKey.default.toString()) {
    console.error('❌ Distribution hub not set!');
    process.exit(1);
  }

  // Get hub token account
  const hubTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    config.distributionHub
  );

  // Process schedules in batches
  let processedCount = 0;
  let transferredTotal = 0;

  console.log('\n🔍 Checking vesting schedules...');

  for (let i = 0; i < totalSchedules; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, totalSchedules);
    console.log(`\n📦 Processing batch: schedules ${i} to ${batchEnd - 1}`);

    // Collect schedules and vaults for this batch
    const remainingAccounts: Array<{
      pubkey: anchor.web3.PublicKey;
      isWritable: boolean;
      isSigner: boolean;
    }> = [];
    const schedulesToProcess: number[] = [];

    for (let j = i; j < batchEnd; j++) {
      const [vestingSchedulePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('vesting_schedule'), Buffer.from(new anchor.BN(j).toArray('le', 8))],
        program.programId
      );

      const [vestingVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('vesting_vault'), Buffer.from(new anchor.BN(j).toArray('le', 8))],
        program.programId
      );

      try {
        // Fetch schedule to check if it needs processing
        const schedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);
        const currentTime = Math.floor(Date.now() / 1000);

        // Simple check - in real implementation, use the contract's calculation
        if (currentTime >= schedule.cliffTimestamp.toNumber()) {
          const vaultAccount = await getAccount(provider.connection, vestingVaultPda);
          const vaultBalance = Number(vaultAccount.amount);

          if (vaultBalance > 0) {
            console.log(
              `  Schedule #${j}: ${vaultBalance / Math.pow(10, tokenConfig.decimals)} $HAiO available`
            );

            remainingAccounts.push({
              pubkey: vestingSchedulePda,
              isWritable: true,
              isSigner: false,
            });
            remainingAccounts.push({
              pubkey: vestingVaultPda,
              isWritable: true,
              isSigner: false,
            });

            schedulesToProcess.push(j);
          }
        }
      } catch (err) {
        console.log(`  Schedule #${j}: Not initialized or error`);
      }
    }

    if (remainingAccounts.length > 0) {
      try {
        console.log(`\n🚀 Executing crank for ${schedulesToProcess.length} schedules...`);

        // Prepare instructions for compute budget
        const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }); // Request 600k CUs
        const addPriorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }); // Optional: Add priority fee (e.g., 1000 microLamports)

        const tx = await program.methods
          .crankVestingSchedules(schedulesToProcess.length)
          .accounts({
            distributionHub: config.distributionHub,
            hubTokenAccount: hubTokenAccount.address,
          })
          .remainingAccounts(remainingAccounts)
          .preInstructions([setComputeUnitLimitIx, addPriorityFeeIx]) // Add preInstructions here
          .rpc({ skipPreflight: false }); // skipPreflight can be true for faster local tests if

        console.log(`✅ Crank transaction: ${tx}`);
        processedCount += schedulesToProcess.length;

        // Wait for confirmation
        await provider.connection.confirmTransaction(tx, 'confirmed');

        // Check hub token account balance
        const hubAccount = await getAccount(provider.connection, hubTokenAccount.address);
        console.log(
          `💰 Hub token balance: ${Number(hubAccount.amount) / Math.pow(10, tokenConfig.decimals)} $HAiO`
        );
      } catch (err) {
        console.error(`❌ Crank failed for batch:`, err);
      }
    }

    // Add delay between batches
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n📊 Crank Summary:');
  console.log(`  Schedules processed: ${processedCount}`);
  console.log(
    `  Total transferred: ${transferredTotal / Math.pow(10, tokenConfig.decimals)} $HAiO`
  );
  console.log('\n✅ Crank process completed!');
}

// Run crank periodically
async function runPeriodically() {
  const interval = Number(process.env.CRANK_INTERVAL || 3600000); // Default: 1 hour

  console.log(`⏰ Running crank every ${interval / 1000 / 60} minutes...`);

  while (true) {
    try {
      await main();
    } catch (err) {
      console.error('❌ Crank error:', err);
    }

    console.log(`\n💤 Waiting ${interval / 1000 / 60} minutes until next run...`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Check if running in periodic mode
if (process.argv.includes('--periodic')) {
  runPeriodically().catch(console.error);
} else {
  main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}
