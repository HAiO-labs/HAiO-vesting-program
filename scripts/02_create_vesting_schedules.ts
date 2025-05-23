import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Vesting schedule configurations
const VESTING_SCHEDULES = [
  {
    category: 'seed' as const,
    totalAmount: 30_000_000, // 30M tokens
    cliffMonths: 12,
    vestingMonths: 24,
    recipients: [
      { address: '11111111111111111111111111111111', percentage: 40 },
      { address: '22222222222222222222222222222222', percentage: 30 },
      { address: '33333333333333333333333333333333', percentage: 30 },
    ],
  },
  {
    category: 'strategic' as const,
    totalAmount: 40_000_000, // 40M tokens
    cliffMonths: 8,
    vestingMonths: 18,
    recipients: [
      { address: '44444444444444444444444444444444', percentage: 50 },
      { address: '55555555555555555555555555555555', percentage: 50 },
    ],
  },
  {
    category: 'team' as const,
    totalAmount: 150_000_000, // 150M tokens
    cliffMonths: 12,
    vestingMonths: 36,
    recipients: [
      { address: '66666666666666666666666666666666', percentage: 20 },
      { address: '77777777777777777777777777777777', percentage: 15 },
      { address: '88888888888888888888888888888888', percentage: 15 },
      // Add more team members...
    ],
  },
  // Add more categories...
];

async function main() {
  console.log('🚀 Starting vesting schedule creation...');

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

  // Get current config to know the schedule count
  let currentScheduleId = 0;
  try {
    const config = await program.account.programConfig.fetch(programConfig);
    currentScheduleId = config.totalSchedules.toNumber();
  } catch (e) {
    console.log('Program not initialized yet');
  }

  // Process each category
  for (const schedule of VESTING_SCHEDULES) {
    console.log(`\n📋 Processing ${schedule.category} vesting...`);

    const currentTime = Math.floor(Date.now() / 1000);
    const cliffTime = currentTime + schedule.cliffMonths * 30 * 24 * 60 * 60;
    const vestingStart = cliffTime;
    const vestingEnd = vestingStart + schedule.vestingMonths * 30 * 24 * 60 * 60;

    // Process each recipient
    for (const recipient of schedule.recipients) {
      if (!recipient.address || recipient.address.includes('1111')) {
        console.log(`⚠️  Skipping placeholder address: ${recipient.address}`);
        continue;
      }

      const amount = Math.floor(
        ((schedule.totalAmount * recipient.percentage) / 100) * Math.pow(10, tokenConfig.decimals)
      );

      // Derive PDAs
      const [vestingSchedulePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from('vesting_schedule'),
          Buffer.from(new anchor.BN(currentScheduleId).toArray('le', 8)),
        ],
        program.programId
      );

      const [vestingVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from('vesting_vault'),
          Buffer.from(new anchor.BN(currentScheduleId).toArray('le', 8)),
        ],
        program.programId
      );

      // Get depositor token account
      const depositorTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mint,
        provider.wallet.publicKey
      );

      console.log(`  Creating schedule #${currentScheduleId}:`);
      console.log(`    Recipient: ${recipient.address}`);
      console.log(`    Amount: ${amount / Math.pow(10, tokenConfig.decimals)} $HAiO`);
      console.log(`    Cliff: ${new Date(cliffTime * 1000).toLocaleDateString()}`);
      console.log(`    Vesting End: ${new Date(vestingEnd * 1000).toLocaleDateString()}`);

      try {
        // Create sourceCategory enum value based on the category
        let sourceCategory: any;
        switch (schedule.category) {
          case 'seed':
            sourceCategory = { seed: {} };
            break;
          case 'strategic':
            sourceCategory = { strategic: {} };
            break;
          case 'team':
            sourceCategory = { team: {} };
            break;
          // case 'ecosystem':
          //   sourceCategory = { ecosystem: {} };
          //   break;
          // case 'marketing':
          //   sourceCategory = { marketing: {} };
          //   break;
          default:
            throw new Error(`Unknown category: ${schedule}`);
        }

        // Create the params object
        const params = {
          totalAmount: new anchor.BN(amount),
          cliffTimestamp: new anchor.BN(cliffTime),
          vestingStartTimestamp: new anchor.BN(vestingStart),
          vestingEndTimestamp: new anchor.BN(vestingEnd),
          sourceCategory: sourceCategory,
        };

        await program.methods
          .createVestingSchedule(params)
          .accounts({
            admin: provider.wallet.publicKey,
            mint: mint,
            depositorTokenAccount: depositorTokenAccount.address,
          })
          .rpc();

        console.log(`  ✅ Schedule created successfully`);
        currentScheduleId++;
      } catch (err) {
        console.error(`  ❌ Failed to create schedule:`, err);
      }

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log('\n🎉 Vesting schedule creation completed!');
  console.log(`Total schedules created: ${currentScheduleId}`);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
