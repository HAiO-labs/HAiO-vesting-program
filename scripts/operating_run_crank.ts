import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Crank execution configuration
const CRANK_CONFIG = {
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  batchDelay: 2000, // 2 seconds between schedules
};

async function crankSingleSchedule(
  program: Program<HaioVesting>,
  programConfigPDA: PublicKey,
  scheduleId: number,
  vestingSchedulePDA: PublicKey,
  vestingVaultPDA: PublicKey,
  recipientTokenAccount: PublicKey,
  mint: PublicKey,
  decimals: number,
  retryCount = 0
): Promise<{
  success: boolean;
  tokensTransferred?: number;
  transaction?: string;
  error?: string;
}> {
  try {
    // Check vault balance before crank
    const vaultAccountBefore = await getAccount(program.provider.connection, vestingVaultPDA);
    const vaultBalanceBefore = Number(vaultAccountBefore.amount) / Math.pow(10, decimals);

    // Check recipient balance before crank
    const recipientAccountBefore = await getAccount(program.provider.connection, recipientTokenAccount);
    const recipientBalanceBefore = Number(recipientAccountBefore.amount) / Math.pow(10, decimals);

    // Execute crank
    const tx = await program.methods
      .crankVestingSchedule()
      .accountsPartial({
        programConfig: programConfigPDA,
        vestingSchedule: vestingSchedulePDA,
        vestingVault: vestingVaultPDA,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Check balances after crank
    const recipientAccountAfter = await getAccount(program.provider.connection, recipientTokenAccount);
    const recipientBalanceAfter = Number(recipientAccountAfter.amount) / Math.pow(10, decimals);

    const tokensTransferred = recipientBalanceAfter - recipientBalanceBefore;

    return {
      success: true,
      tokensTransferred: tokensTransferred,
      transaction: tx,
    };

  } catch (error) {
    if (retryCount < CRANK_CONFIG.maxRetries) {
      console.log(`      ⏳ Retry ${retryCount + 1}/${CRANK_CONFIG.maxRetries} in ${CRANK_CONFIG.retryDelay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, CRANK_CONFIG.retryDelay));
      return crankSingleSchedule(
        program,
        programConfigPDA,
        scheduleId,
        vestingSchedulePDA,
        vestingVaultPDA,
        recipientTokenAccount,
        mint,
        decimals,
        retryCount + 1
      );
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log('🔄 Starting HAiO Vesting Crank Execution...');

  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('TGE config not found. Please run 01_create_token.ts first.');
  }

  // Load vesting schedules report
  const schedulesPath = path.join(__dirname, '../.haio-vesting-schedules-report.json');
  if (!fs.existsSync(schedulesPath)) {
    throw new Error('Vesting schedules report not found. Please run 03_create_vesting_schedules.ts first.');
  }

  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const schedulesReport = JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
  const mint = new PublicKey(tgeConfig.mint);
  const decimals = tgeConfig.decimals;

  console.log('✅ Configuration loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Available Schedules:', schedulesReport.schedules.length);

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;
  const connection = provider.connection;

  console.log('✅ Program loaded:', program.programId.toString());

  // Get program config
  const [programConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  const currentTimestamp = Math.floor(Date.now() / 1000);
  console.log(`⏰ Current Time: ${new Date(currentTimestamp * 1000).toISOString()}`);

  const crankResults = [];
  let totalTransferred = 0;
  let successfulCranks = 0;

  // Process each successful schedule
  for (const schedule of schedulesReport.schedules) {
    if (!schedule.success) {
      console.log(`\n⏭️  Skipping failed schedule: ${schedule.category}`);
      continue;
    }

    console.log(`\n🔄 Cranking: ${schedule.category}`);
    console.log(`   Schedule ID: ${schedule.id}`);
    console.log(`   Amount: ${schedule.amount.toLocaleString()} HAiO`);

    try {
      const vestingSchedulePDA = new PublicKey(schedule.schedulePDA);
      const vestingVaultPDA = new PublicKey(schedule.vaultPDA);
      const recipientTokenAccount = new PublicKey(schedule.recipientTokenAccount);

      // Fetch current schedule state for timing info
      const scheduleData = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      
      console.log(`   Cliff: ${new Date(scheduleData.cliffTimestamp.toNumber() * 1000).toLocaleDateString()}`);
      console.log(`   Vesting End: ${new Date(scheduleData.vestingEndTimestamp.toNumber() * 1000).toLocaleDateString()}`);

      // Check if tokens should be available
      const isPastCliff = currentTimestamp >= scheduleData.cliffTimestamp.toNumber();
      console.log(`   Past Cliff: ${isPastCliff ? '✅' : '❌'}`);

      // Execute crank
      const result = await crankSingleSchedule(
        program,
        programConfigPDA,
        schedule.id,
        vestingSchedulePDA,
        vestingVaultPDA,
        recipientTokenAccount,
        mint,
        decimals
      );

      if (result.success) {
        console.log(`   ✅ Success: ${result.tokensTransferred!.toLocaleString()} HAiO transferred`);
        console.log(`   Transaction: ${result.transaction}`);
        
        totalTransferred += result.tokensTransferred!;
        successfulCranks++;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }

      crankResults.push({
        scheduleId: schedule.id,
        category: schedule.category,
        recipient: schedule.recipient,
        cliffTimestamp: scheduleData.cliffTimestamp.toNumber(),
        isPastCliff: isPastCliff,
        ...result,
      });

    } catch (error) {
      console.error(`   ❌ Error processing schedule:`, error);
      crankResults.push({
        scheduleId: schedule.id,
        category: schedule.category,
        recipient: schedule.recipient,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Wait between cranks
    await new Promise(resolve => setTimeout(resolve, CRANK_CONFIG.batchDelay));
  }

  // Save crank execution report
  const report = {
    timestamp: new Date().toISOString(),
    cluster: tgeConfig.cluster,
    programId: program.programId.toString(),
    mint: mint.toString(),
    totalSchedulesProcessed: crankResults.length,
    successfulCranks: successfulCranks,
    totalTokensTransferred: totalTransferred,
    results: crankResults,
  };

  const reportPath = path.join(__dirname, '../.haio-crank-execution-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📋 Crank execution report saved to: ${reportPath}`);

  // Summary
  const failed = crankResults.filter(r => !r.success).length;

  console.log('\n🎉 HAiO Vesting Crank Execution Complete!');
  console.log(`✅ Successful cranks: ${successfulCranks}`);
  console.log(`❌ Failed cranks: ${failed}`);
  console.log(`💰 Total tokens transferred: ${totalTransferred.toLocaleString()} HAiO`);

  // Categorize results (using type assertion for successful results)
  const successfulResults = crankResults.filter(r => r.success && 'tokensTransferred' in r && 'isPastCliff' in r) as any[];
  const immediateVesting = successfulResults.filter(r => r.tokensTransferred && r.tokensTransferred > 0);
  const cliffBlocked = successfulResults.filter(r => (!r.tokensTransferred || r.tokensTransferred === 0) && !r.isPastCliff);
  const noTokensAvailable = successfulResults.filter(r => (!r.tokensTransferred || r.tokensTransferred === 0) && r.isPastCliff);

  if (immediateVesting.length > 0) {
    console.log('\n📈 Active vesting schedules:');
    immediateVesting.forEach(r => {
      console.log(`   • ${r.category}: ${r.tokensTransferred!.toLocaleString()} HAiO`);
    });
  }

  if (cliffBlocked.length > 0) {
    console.log('\n⏰ Cliff-blocked schedules:');
    cliffBlocked.forEach(r => {
      const cliffDate = new Date((r as any).cliffTimestamp * 1000).toLocaleDateString();
      console.log(`   • ${r.category}: Cliff until ${cliffDate}`);
    });
  }

  if (noTokensAvailable.length > 0) {
    console.log('\n✅ Fully vested schedules:');
    noTokensAvailable.forEach(r => {
      console.log(`   • ${r.category}: All tokens transferred`);
    });
  }

  if (failed > 0) {
    console.log('\n❌ Failed schedules:');
    crankResults.filter(r => !r.success).forEach(r => {
      console.log(`   • ${r.category}: ${r.error}`);
    });
  }

  console.log('\n📋 Next Steps:');
  if (totalTransferred > 0) {
    console.log('   1. Verify recipient balances');
    console.log('   2. Monitor for vesting events');
  }
  if (cliffBlocked.length > 0) {
    console.log('   3. Schedule next crank after cliff periods end');
  }
  console.log('   4. Set up automated crank execution');
}

// Run crank periodically if specified
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
    await new Promise(resolve => setTimeout(resolve, interval));
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
