import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// ===================================================================================================
// AUTOMATIC VESTING RECIPIENT CONFIGURATION FROM PHASE 1
// ===================================================================================================

// Load multi-sig configuration from 04_initialize_ATA_squads_multisig.ts results
function loadVestingRecipients(tgeConfig: any) {
  if (!tgeConfig.multisigConfig || !tgeConfig.multisigConfig.vaults) {
    throw new Error(
      '❌ Multi-sig configuration not found. Please run 04_initialize_ATA_squads_multisig.ts first.'
    );
  }

  const vaults = tgeConfig.multisigConfig.vaults;

  // Validate all required vaults exist
  const requiredCategories = ['PUBLIC_ROUND', 'ECOSYSTEM', 'TEAM_ADVISORS', 'FOUNDATION'];
  for (const category of requiredCategories) {
    if (!vaults[category]) {
      throw new Error(
        `❌ ${category} vault configuration not found. Please ensure all vaults were created.`
      );
    }
  }

  return {
    // Use the Squads vault addresses and their corresponding ATAs
    // The vault addresses are used as recipients, ATAs are used for token accounts
    vaultAddresses: {
      PUBLIC_VESTING: vaults.PUBLIC_ROUND.vaultAddress,
      ECOSYSTEM_VESTING: vaults.ECOSYSTEM.vaultAddress,
      TEAM_ADVISORS: vaults.TEAM_ADVISORS.vaultAddress,
      FOUNDATION: vaults.FOUNDATION.vaultAddress,
    },
    ataAddresses: {
      PUBLIC_VESTING: vaults.PUBLIC_ROUND.ataAddress,
      ECOSYSTEM_VESTING: vaults.ECOSYSTEM.ataAddress,
      TEAM_ADVISORS: vaults.TEAM_ADVISORS.ataAddress,
      FOUNDATION: vaults.FOUNDATION.ataAddress,
    },
  };
}

// ===================================================================================================
// VESTING SCHEDULE CONFIGURATION
// ===================================================================================================

const VESTING_SCHEDULES = [
  {
    id: 'public',
    category: 'Public Round Vesting',
    recipient: 'PUBLIC_VESTING',
    totalAmount: 64_000_000, // 64M tokens
    cliffMonths: 0, // No cliff
    vestingMonths: 6, // 6 months linear vesting
    sourceCategory: { public: {} },
    vault: 'PUBLIC_ROUND',
  },
  {
    id: 'ecosystem',
    category: 'Ecosystem Vesting',
    recipient: 'ECOSYSTEM_VESTING',
    totalAmount: 390_000_000, // 390M tokens
    cliffMonths: 0, // No cliff
    vestingMonths: 39, // 39 months linear vesting
    sourceCategory: { ecosystem: {} },
    vault: 'ECOSYSTEM',
  },
  {
    id: 'team',
    category: 'Team & Advisors',
    recipient: 'TEAM_ADVISORS',
    totalAmount: 150_000_000, // 150M tokens
    cliffMonths: 6, // 6 months cliff
    vestingMonths: 30, // 30 months linear vesting after cliff
    sourceCategory: { team: {} },
    vault: 'TEAM_ADVISORS',
  },
  {
    id: 'foundation',
    category: 'Foundation',
    recipient: 'FOUNDATION',
    totalAmount: 220_000_000, // 220M tokens
    cliffMonths: 0, // No cliff
    vestingMonths: 12, // 12 months linear vesting
    sourceCategory: { foundation: {} },
    vault: 'FOUNDATION',
  },
];

function monthsToSeconds(months: number): number {
  return months * 30 * 24 * 60 * 60; // Approximate: 30 days per month
}

async function main() {
  console.log('📅 HAiO TGE - Creating Vesting Schedules for Multi-sig Vaults');
  console.log('==============================================================');

  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('TGE config not found. Please run 01_create_token.ts first.');
  }

  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const mint = new PublicKey(tgeConfig.mint);
  const decimals = tgeConfig.decimals;

  console.log('✅ TGE Config loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Cluster:', tgeConfig.cluster);

  // Load vesting recipients from multi-sig configuration
  const vestingConfig = loadVestingRecipients(tgeConfig);
  const VESTING_RECIPIENTS = vestingConfig.vaultAddresses;
  const VESTING_ATAS = vestingConfig.ataAddresses;

  console.log('\n✅ Vesting Recipients loaded from multi-sig configuration:');
  Object.entries(VESTING_RECIPIENTS).forEach(([category, vaultAddress]) => {
    console.log(`   ${category}: ${vaultAddress}`);
  });

  console.log('\n✅ Corresponding ATAs for token operations:');
  Object.entries(VESTING_ATAS).forEach(([category, ataAddress]) => {
    console.log(`   ${category}: ${ataAddress}`);
  });

  // Display vesting mapping for clarity
  console.log('\n📋 Vesting Schedule Mapping:');
  console.log('   64M HAiO → PUBLIC_ROUND vault (6 months linear)');
  console.log('   390M HAiO → ECOSYSTEM vault (39 months linear)');
  console.log('   150M HAiO → TEAM_ADVISORS vault (6 months cliff + 30 months linear)');
  console.log('   220M HAiO → FOUNDATION vault (12 months linear)');

  // Validate recipient addresses
  console.log('\n🔍 Validating vesting recipient addresses...');
  for (const schedule of VESTING_SCHEDULES) {
    const address = VESTING_RECIPIENTS[schedule.recipient as keyof typeof VESTING_RECIPIENTS];
    if (!address) {
      throw new Error(
        `❌ ${schedule.category} recipient address not found in multi-sig configuration`
      );
    }
    try {
      new PublicKey(address);
      console.log(`   ✅ ${schedule.category}: ${address} (${schedule.vault} vault)`);
    } catch (error) {
      throw new Error(`❌ Invalid ${schedule.category} recipient address: ${address}`);
    }
  }

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  if (!provider.wallet.payer) {
    throw new Error('Wallet payer not found. Make sure you have a valid wallet configured.');
  }

  const payer = provider.wallet.payer;
  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;

  console.log('✅ Program loaded:', program.programId.toString());
  console.log('✅ Admin wallet:', provider.wallet.publicKey.toString());

  // Get or initialize program config
  const [programConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  let currentScheduleId = 0;
  try {
    const config = await program.account.programConfig.fetch(programConfigPDA);
    currentScheduleId = Number(config.totalSchedules);
    console.log(`✅ Program config found. Current schedule count: ${currentScheduleId}`);

    // Verify admin authority
    if (!config.admin.equals(provider.wallet.publicKey)) {
      throw new Error(
        `❌ Admin mismatch. Expected: ${provider.wallet.publicKey}, Got: ${config.admin}`
      );
    }
  } catch (error) {
    console.log('⚠️  Program not initialized. Please run initialization first.');
    console.log('   You can initialize with: npm run initialize-program');
    throw error;
  }

  // Get admin token account
  const adminTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    provider.wallet.publicKey
  );

  console.log('✅ Admin token account:', adminTokenAccount.address.toString());

  const currentTimestamp = Math.floor(Date.now() / 1000);
  console.log(`\n⏰ TGE Start Time: ${new Date(currentTimestamp * 1000).toISOString()}`);

  const createdSchedules = [];

  // Create vesting schedules
  for (const scheduleConfig of VESTING_SCHEDULES) {
    console.log(`\n📋 Creating ${scheduleConfig.category} vesting schedule...`);
    console.log(`   Target Vault: ${scheduleConfig.vault}`);

    const recipientAddress =
      VESTING_RECIPIENTS[scheduleConfig.recipient as keyof typeof VESTING_RECIPIENTS];
    const recipientPubkey = new PublicKey(recipientAddress);

    // Calculate timestamps
    const cliffTimestamp = currentTimestamp + monthsToSeconds(scheduleConfig.cliffMonths);
    const vestingStartTimestamp = cliffTimestamp; // Start vesting after cliff
    const vestingEndTimestamp =
      vestingStartTimestamp + monthsToSeconds(scheduleConfig.vestingMonths);

    console.log(`   Amount: ${scheduleConfig.totalAmount.toLocaleString()} HAiO`);
    console.log(`   Recipient: ${recipientAddress}`);
    console.log(
      `   Cliff: ${scheduleConfig.cliffMonths} months (${new Date(cliffTimestamp * 1000).toLocaleDateString()})`
    );
    console.log(`   Vesting Duration: ${scheduleConfig.vestingMonths} months`);
    console.log(`   Vesting End: ${new Date(vestingEndTimestamp * 1000).toLocaleDateString()}`);

    try {
      // Use the existing ATA address (created in Phase 1)
      const ataAddress = VESTING_ATAS[scheduleConfig.recipient as keyof typeof VESTING_ATAS];
      if (!ataAddress) {
        throw new Error(`ATA address not found for ${scheduleConfig.recipient}`);
      }

      const recipientTokenAccountAddress = new PublicKey(ataAddress);
      console.log(`   📋 Using existing ATA: ${recipientTokenAccountAddress.toString()}`);

      // Verify ATA exists
      try {
        const ataInfo = await provider.connection.getAccountInfo(recipientTokenAccountAddress);
        if (!ataInfo) {
          throw new Error(`ATA does not exist: ${ataAddress}`);
        }
        console.log(`   ✅ ATA verified and ready`);
      } catch (error) {
        throw new Error(
          `Failed to verify ATA: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Derive PDAs
      const [vestingSchedulePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('vesting_schedule'),
          new anchor.BN(currentScheduleId).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
      );

      const [vestingVaultPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('vesting_vault'),
          new anchor.BN(currentScheduleId).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
      );

      // Prepare schedule parameters
      const params = {
        recipient: recipientPubkey,
        recipientTokenAccount: recipientTokenAccountAddress,
        totalAmount: new anchor.BN(
          (BigInt(scheduleConfig.totalAmount) * 10n ** BigInt(decimals)).toString()
        ),
        cliffTimestamp: new anchor.BN(cliffTimestamp),
        vestingStartTimestamp: new anchor.BN(vestingStartTimestamp),
        vestingEndTimestamp: new anchor.BN(vestingEndTimestamp),
        sourceCategory: scheduleConfig.sourceCategory,
      };

      // Create vesting schedule
      const tx = await program.methods
        .createVestingSchedule(new anchor.BN(currentScheduleId), params)
        .accountsPartial({
          admin: provider.wallet.publicKey,
          programConfig: programConfigPDA,
          vestingSchedule: vestingSchedulePDA,
          mint: mint,
          depositorTokenAccount: adminTokenAccount.address,
          recipientTokenAccount: recipientTokenAccountAddress,
          vestingVault: vestingVaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log(`   ✅ Schedule created successfully!`);
      console.log(`   Transaction: ${tx}`);
      console.log(`   Schedule ID: ${currentScheduleId}`);
      console.log(`   Schedule PDA: ${vestingSchedulePDA.toString()}`);
      console.log(`   Vault PDA: ${vestingVaultPDA.toString()}`);

      createdSchedules.push({
        id: currentScheduleId,
        category: scheduleConfig.category,
        vault: scheduleConfig.vault,
        recipient: recipientAddress,
        recipientTokenAccount: recipientTokenAccountAddress.toString(),
        schedulePDA: vestingSchedulePDA.toString(),
        vaultPDA: vestingVaultPDA.toString(),
        amount: scheduleConfig.totalAmount,
        cliffMonths: scheduleConfig.cliffMonths,
        vestingMonths: scheduleConfig.vestingMonths,
        transaction: tx,
        success: true,
      });

      currentScheduleId++;
    } catch (error) {
      console.error(`   ❌ Failed to create ${scheduleConfig.category} schedule:`, error);
      createdSchedules.push({
        id: currentScheduleId,
        category: scheduleConfig.category,
        vault: scheduleConfig.vault,
        recipient: recipientAddress,
        amount: scheduleConfig.totalAmount,
        error: error instanceof Error ? error.message : String(error),
        success: false,
      });
    }

    // Wait between transactions
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Save vesting schedule report
  const report = {
    timestamp: new Date().toISOString(),
    cluster: tgeConfig.cluster,
    programId: program.programId.toString(),
    mint: mint.toString(),
    admin: provider.wallet.publicKey.toString(),
    vestingType: 'category_specific_multisig',
    vaultMapping: Object.entries(VESTING_RECIPIENTS).reduce((acc, [key, value]) => {
      const schedule = VESTING_SCHEDULES.find((s) => s.recipient === key);
      const ataAddress = VESTING_ATAS[key as keyof typeof VESTING_ATAS];
      if (schedule) {
        acc[schedule.vault] = {
          category: schedule.category,
          amount: `${schedule.totalAmount.toLocaleString()} HAiO`,
          vaultAddress: value,
          ataAddress: ataAddress,
          cliffMonths: schedule.cliffMonths,
          vestingMonths: schedule.vestingMonths,
        };
      }
      return acc;
    }, {} as any),
    totalSchedulesCreated: createdSchedules.filter((s) => s.success).length,
    schedules: createdSchedules,
  };

  const reportPath = path.join(__dirname, '../.haio-vesting-schedules-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📋 Vesting schedules report saved to: ${reportPath}`);

  // Summary
  const successful = createdSchedules.filter((s) => s.success).length;
  const failed = createdSchedules.filter((s) => !s.success).length;
  const totalVestedAmount = createdSchedules
    .filter((s) => s.success)
    .reduce((sum, s) => sum + s.amount, 0);

  console.log('\n🎉 HAiO TGE Vesting Schedule Creation Complete!');
  console.log(`✅ Successful schedules: ${successful}`);
  console.log(`❌ Failed schedules: ${failed}`);
  console.log(`💰 Total vested amount: ${totalVestedAmount.toLocaleString()} HAiO`);

  if (failed > 0) {
    console.log('\n⚠️  Some schedules failed. Please check the report and retry manually.');
    process.exit(1);
  }

  console.log('\n📋 Vesting Summary:');
  createdSchedules
    .filter((s) => s.success)
    .forEach((s) => {
      console.log(
        `   ✅ ${s.amount.toLocaleString()} HAiO → ${s.vault} vault (${s.cliffMonths}m cliff + ${s.vestingMonths}m vesting)`
      );
    });

  console.log('\n🔗 Resources:');
  console.log('   Squads Dashboard: https://app.squads.so');
  console.log('   Program ID:', program.programId.toString());
  console.log('   Token Mint:', mint.toString());
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
