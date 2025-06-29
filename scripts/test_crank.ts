import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('🔄 Starting HAiO Vesting Crank Test...');

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

  const crankResults = [];

  // Test crank for each successful schedule
  for (const schedule of schedulesReport.schedules) {
    if (!schedule.success) {
      console.log(`\n⏭️  Skipping failed schedule: ${schedule.category}`);
      continue;
    }

    console.log(`\n🔄 Testing crank for: ${schedule.category}`);
    console.log(`   Schedule ID: ${schedule.id}`);
    console.log(`   Recipient: ${schedule.recipient}`);

    try {
      // Get current vesting schedule state
      const vestingSchedulePDA = new PublicKey(schedule.schedulePDA);
      const vestingVaultPDA = new PublicKey(schedule.vaultPDA);
      const recipientTokenAccount = new PublicKey(schedule.recipientTokenAccount);

      // Fetch schedule data
      const scheduleData = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      console.log(`   Current Time: ${new Date(currentTimestamp * 1000).toISOString()}`);
      console.log(`   Cliff Time: ${new Date(scheduleData.cliffTimestamp.toNumber() * 1000).toISOString()}`);
      console.log(`   Vesting Start: ${new Date(scheduleData.vestingStartTimestamp.toNumber() * 1000).toISOString()}`);
      console.log(`   Vesting End: ${new Date(scheduleData.vestingEndTimestamp.toNumber() * 1000).toISOString()}`);

      // Check vault balance before crank
      const vaultAccountBefore = await getAccount(connection, vestingVaultPDA);
      const vaultBalanceBefore = Number(vaultAccountBefore.amount) / Math.pow(10, decimals);

      // Check recipient balance before crank
      const recipientAccountBefore = await getAccount(connection, recipientTokenAccount);
      const recipientBalanceBefore = Number(recipientAccountBefore.amount) / Math.pow(10, decimals);

      console.log(`   Vault Balance: ${vaultBalanceBefore.toLocaleString()} HAiO`);
      console.log(`   Recipient Balance: ${recipientBalanceBefore.toLocaleString()} HAiO`);
      console.log(`   Amount Transferred: ${Number(scheduleData.amountTransferred) / Math.pow(10, decimals)} HAiO`);

      // Determine if tokens should be available
      const shouldHaveTokens = currentTimestamp >= scheduleData.cliffTimestamp.toNumber();
      console.log(`   Should Have Vested Tokens: ${shouldHaveTokens}`);

      // Execute crank
      console.log('   🚀 Executing crank...');

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

      console.log(`   ✅ Crank transaction: ${tx}`);

      // Check balances after crank
      const vaultAccountAfter = await getAccount(connection, vestingVaultPDA);
      const vaultBalanceAfter = Number(vaultAccountAfter.amount) / Math.pow(10, decimals);

      const recipientAccountAfter = await getAccount(connection, recipientTokenAccount);
      const recipientBalanceAfter = Number(recipientAccountAfter.amount) / Math.pow(10, decimals);

      const tokensTransferred = recipientBalanceAfter - recipientBalanceBefore;
      const vaultDecrease = vaultBalanceBefore - vaultBalanceAfter;

      console.log(`   📊 Crank Results:`);
      console.log(`      Tokens Transferred: ${tokensTransferred.toLocaleString()} HAiO`);
      console.log(`      Vault Decrease: ${vaultDecrease.toLocaleString()} HAiO`);
      console.log(`      New Vault Balance: ${vaultBalanceAfter.toLocaleString()} HAiO`);
      console.log(`      New Recipient Balance: ${recipientBalanceAfter.toLocaleString()} HAiO`);

      // Verify consistency
      const isConsistent = Math.abs(tokensTransferred - vaultDecrease) < 0.000001; // Allow for small floating point differences
      console.log(`      Balance Consistency: ${isConsistent ? '✅' : '❌'}`);

      crankResults.push({
        scheduleId: schedule.id,
        category: schedule.category,
        recipient: schedule.recipient,
        transaction: tx,
        tokensTransferred: tokensTransferred,
        vaultBalanceBefore: vaultBalanceBefore,
        vaultBalanceAfter: vaultBalanceAfter,
        recipientBalanceBefore: recipientBalanceBefore,
        recipientBalanceAfter: recipientBalanceAfter,
        isConsistent: isConsistent,
        shouldHaveTokens: shouldHaveTokens,
        success: true,
      });

    } catch (error) {
      console.error(`   ❌ Crank failed:`, error);
      
      crankResults.push({
        scheduleId: schedule.id,
        category: schedule.category,
        recipient: schedule.recipient,
        error: error instanceof Error ? error.message : String(error),
        success: false,
      });
    }

    // Wait between cranks
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save crank test report
  const report = {
    timestamp: new Date().toISOString(),
    cluster: tgeConfig.cluster,
    programId: program.programId.toString(),
    mint: mint.toString(),
    totalSchedulesTested: crankResults.length,
    results: crankResults,
  };

  const reportPath = path.join(__dirname, '../.haio-crank-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📋 Crank test report saved to: ${reportPath}`);

  // Summary
  const successful = crankResults.filter(r => r.success).length;
  const failed = crankResults.filter(r => !r.success).length;
  const totalTransferred = crankResults
    .filter(r => r.success && typeof r.tokensTransferred === 'number')
    .reduce((sum, r) => sum + (r.tokensTransferred || 0), 0);

  console.log('\n🎉 HAiO Vesting Crank Test Complete!');
  console.log(`✅ Successful cranks: ${successful}`);
  console.log(`❌ Failed cranks: ${failed}`);
  console.log(`💰 Total tokens transferred: ${totalTransferred.toLocaleString()} HAiO`);

  if (failed > 0) {
    console.log('\n⚠️  Some cranks failed. This might be expected if cliff periods haven\'t passed yet.');
  }

  // Additional checks
  console.log('\n🔍 Additional Analysis:');
  const immediateVesting = crankResults.filter(r => r.success && typeof r.tokensTransferred === 'number' && r.tokensTransferred > 0);
  const cliffBlocked = crankResults.filter(r => r.success && typeof r.tokensTransferred === 'number' && r.tokensTransferred === 0 && !r.shouldHaveTokens);
  
  console.log(`   Immediate vesting schedules: ${immediateVesting.length}`);
  console.log(`   Cliff-blocked schedules: ${cliffBlocked.length}`);

  if (immediateVesting.length > 0) {
    console.log('\n📈 Schedules with immediate vesting:');
    immediateVesting.forEach(r => {
      console.log(`   • ${r.category}: ${r.tokensTransferred!.toLocaleString()} HAiO`);
    });
  }

  if (cliffBlocked.length > 0) {
    console.log('\n⏰ Cliff-blocked schedules (expected):');
    cliffBlocked.forEach(r => {
      console.log(`   • ${r.category}: Waiting for cliff period`);
    });
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
}); 