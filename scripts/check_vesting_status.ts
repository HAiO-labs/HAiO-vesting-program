// scripts/check_vesting_status.ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getAccount } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('📊 HAiO Vesting Program - Status Check');
  console.log('=====================================');
  
  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ TGE config not found.');
  }
  
  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const mint = new PublicKey(tgeConfig.mint);
  const decimals = tgeConfig.decimals;

  console.log('✅ Token Mint:', mint.toString());
  console.log('✅ Cluster:', tgeConfig.cluster);

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;

  // Get program config
  const [programConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  const config = await program.account.programConfig.fetch(programConfigPDA);
  const totalSchedules = Number(config.totalSchedules);
  
  console.log(`\n📋 Program Overview:`);
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Total Schedules: ${totalSchedules}`);
  console.log(`   Admin: ${config.admin.toString()}`);

  let totalLocked = 0;
  let totalReleased = 0;
  let totalAvailable = 0;

  console.log(`\n📊 Vesting Schedule Details:`);
  console.log('─'.repeat(80));

  for (let i = 0; i < totalSchedules; i++) {
    try {
      // Get vesting schedule
      const [vestingSchedulePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vesting_schedule'), new anchor.BN(i).toArrayLike(Buffer, 'le', 8)],
        program.programId
      );

      const [vestingVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vesting_vault'), new anchor.BN(i).toArrayLike(Buffer, 'le', 8)],
        program.programId
      );

      const schedule = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      const vaultBalance = await getAccount(provider.connection, vestingVaultPDA);

      const totalAmount = Number(schedule.totalAmount) / Math.pow(10, decimals);
      const releasedAmount = Number(schedule.amountTransferred) / Math.pow(10, decimals);
      const vaultTokens = Number(vaultBalance.amount) / Math.pow(10, decimals);
      
      // Calculate available to release
      const currentTime = Math.floor(Date.now() / 1000);
      let availableAmount = 0;
      
      if (currentTime >= Number(schedule.cliffTimestamp)) {
        if (currentTime >= Number(schedule.vestingEndTimestamp)) {
          availableAmount = totalAmount - releasedAmount;
        } else {
          const vestingDuration = Number(schedule.vestingEndTimestamp) - Number(schedule.vestingStartTimestamp);
          const timeElapsed = currentTime - Number(schedule.vestingStartTimestamp);
          const vestedAmount = (totalAmount * timeElapsed) / vestingDuration;
          availableAmount = Math.max(0, vestedAmount - releasedAmount);
        }
      }

      console.log(`\n🔒 Schedule ${i}:`);
      console.log(`   Recipient: ${schedule.recipient.toString()}`);
      console.log(`   Total Amount: ${totalAmount.toLocaleString()} HAiO`);
      console.log(`   Released: ${releasedAmount.toLocaleString()} HAiO`);
      console.log(`   Vault Balance: ${vaultTokens.toLocaleString()} HAiO`);
      console.log(`   Available to Release: ${availableAmount.toLocaleString()} HAiO`);
      console.log(`   Cliff: ${new Date(Number(schedule.cliffTimestamp) * 1000).toLocaleDateString()}`);
      console.log(`   Vesting End: ${new Date(Number(schedule.vestingEndTimestamp) * 1000).toLocaleDateString()}`);

      totalLocked += vaultTokens;
      totalReleased += releasedAmount;
      totalAvailable += availableAmount;

    } catch (error) {
      console.log(`   ❌ Schedule ${i}: Error fetching data`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY:');
  console.log('='.repeat(80));
  console.log(`💰 Total Locked in Vesting: ${totalLocked.toLocaleString()} HAiO`);
  console.log(`✅ Total Released: ${totalReleased.toLocaleString()} HAiO`);
  console.log(`🚀 Available to Release: ${totalAvailable.toLocaleString()} HAiO`);
  console.log(`📊 Total Managed: ${(totalLocked + totalReleased).toLocaleString()} HAiO`);

  // Calculate percentages
  const totalManaged = totalLocked + totalReleased;
  if (totalManaged > 0) {
    console.log(`\n📊 Breakdown:`);
    console.log(`   Locked: ${((totalLocked / totalManaged) * 100).toFixed(1)}%`);
    console.log(`   Released: ${((totalReleased / totalManaged) * 100).toFixed(1)}%`);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});