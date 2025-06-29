import * as anchor from '@coral-xyz/anchor';
import {
  setAuthority,
  AuthorityType,
  getAccount,
  getMint,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('🔒 Starting HAiO SPL Token Authority Finalization...');
  console.log('⚠️  This will PERMANENTLY disable SPL Token authorities!');
  console.log('   - Mint Authority (토큰 발행 권한)');
  console.log('   - Freeze Authority (계정 동결 권한)');
  console.log('ℹ️  Update Authority (메타데이터) will be handled separately in script 10');

  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('TGE config not found. Please run 01_create_token.ts first.');
  }

  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  if (tgeConfig.splTokenAuthoritiesDisabled) {
    console.log('✅ SPL Token authorities already disabled. Token authorities are already finalized.');
    return;
  }

  const mint = new PublicKey(tgeConfig.mint);
  const decimals = tgeConfig.decimals;
  const expectedTotalSupply = tgeConfig.totalSupply;

  console.log('✅ TGE Configuration loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Expected Total Supply:', expectedTotalSupply.toLocaleString(), 'HAiO');

  // Setup connection and wallet
  const cluster = tgeConfig.cluster || 'http://localhost:8899';
  const connection = new Connection(cluster, 'confirmed');
  
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/keypairs/haio-deployer.json');
  const treasuryKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  
  console.log('✅ Treasury wallet loaded:', treasuryKeypair.publicKey.toString());

  // Check current SPL Token authorities
  console.log('\n🔍 Checking current SPL Token authorities...');
  
  const mintInfo = await getMint(connection, mint);
  console.log('   Current Mint Authority:', mintInfo.mintAuthority?.toString() || 'None');
  console.log('   Current Freeze Authority:', mintInfo.freezeAuthority?.toString() || 'None');

  // Verification: Check total token supply distribution
  console.log('\n🔍 Verifying TGE distribution...');

  // Load distribution reports
  const immediateReportPath = path.join(__dirname, '../.haio-immediate-distribution-report.json');
  const vestingReportPath = path.join(__dirname, '../.haio-vesting-schedules-report.json');
  const crankReportPath = path.join(__dirname, '../.haio-crank-test-report.json');

  let totalDistributed = 0;
  let totalVested = 0;
  let totalCranked = 0;

  // Check immediate distribution
  if (fs.existsSync(immediateReportPath)) {
    const immediateReport = JSON.parse(fs.readFileSync(immediateReportPath, 'utf-8'));
    totalDistributed = immediateReport.totalDistributed || 0;
    console.log(`   ✅ Immediate distribution: ${totalDistributed.toLocaleString()} HAiO`);
  } else {
    console.log('   ⚠️  Immediate distribution report not found');
  }

  // Check vesting schedules
  if (fs.existsSync(vestingReportPath)) {
    const vestingReport = JSON.parse(fs.readFileSync(vestingReportPath, 'utf-8'));
    totalVested = vestingReport.schedules
      .filter((s: any) => s.success)
      .reduce((sum: number, s: any) => sum + s.amount, 0);
    console.log(`   ✅ Vesting schedules: ${totalVested.toLocaleString()} HAiO`);
  } else {
    console.log('   ⚠️  Vesting schedules report not found');
  }

  // Check crank results
  if (fs.existsSync(crankReportPath)) {
    const crankReport = JSON.parse(fs.readFileSync(crankReportPath, 'utf-8'));
    totalCranked = crankReport.results
      .filter((r: any) => r.success && typeof r.tokensTransferred === 'number')
      .reduce((sum: number, r: any) => sum + r.tokensTransferred, 0);
    console.log(`   ✅ Cranked tokens: ${totalCranked.toLocaleString()} HAiO`);
  } else {
    console.log('   ⚠️  Crank test report not found');
  }

  // Check treasury balance
  const treasuryTokenAccount = new PublicKey(tgeConfig.treasuryTokenAccount);
  const treasuryBalance = await getAccount(connection, treasuryTokenAccount);
  const remainingInTreasury = Number(treasuryBalance.amount) / Math.pow(10, decimals);

  console.log(`   💰 Remaining in treasury: ${remainingInTreasury.toLocaleString()} HAiO`);

  // Calculate totals using BigInt for precision
  const totalAccountedForBig = BigInt(totalDistributed) * 10n ** BigInt(decimals) + BigInt(totalVested) * 10n ** BigInt(decimals);
  const expectedTotalSupplyBig = BigInt(expectedTotalSupply) * 10n ** BigInt(decimals);
  const totalAccountedFor = Number(totalAccountedForBig) / 1e9;
  const distributionComplete = totalAccountedForBig === expectedTotalSupplyBig; // Exact match with BigInt

  console.log('\n📊 TGE Distribution Summary:');
  console.log(`   Expected Total Supply: ${expectedTotalSupply.toLocaleString()} HAiO`);
  console.log(`   Immediate Distribution: ${totalDistributed.toLocaleString()} HAiO`);
  console.log(`   Vesting Allocation: ${totalVested.toLocaleString()} HAiO`);
  console.log(`   Total Allocated: ${totalAccountedFor.toLocaleString()} HAiO`);
  console.log(`   Treasury Remaining: ${remainingInTreasury.toLocaleString()} HAiO`);
  console.log(`   Distribution Complete: ${distributionComplete ? '✅' : '❌'}`);
  
  // Final confirmation
  console.log('\n⚠️  FINAL WARNING: These SPL Token actions are IRREVERSIBLE!');
  console.log('    🚫 Mint Authority: No more tokens can ever be minted');
  console.log('    🚫 Freeze Authority: No accounts can be frozen/unfrozen');
  console.log('    Total token supply will be permanently fixed at', expectedTotalSupply.toLocaleString(), 'HAiO');
  console.log('    This provides significant decentralization and user protection.');
  console.log('ℹ️  Note: Update Authority for metadata will remain for now (use script 10 to remove later)');

  console.log('\n🔒 Proceeding with SPL Token authority removal...');

  const removedAuthorities: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
  } = {
    mintAuthority: null,
    freezeAuthority: null,
  };

  try {
    // 1. Disable Mint Authority
    console.log('\n🔒 Removing Mint Authority...');
    if (mintInfo.mintAuthority) {
      const mintTx = await setAuthority(
        connection,
        treasuryKeypair,
        mint,
        treasuryKeypair.publicKey,
        AuthorityType.MintTokens,
        null // Set to null to permanently disable
      );
      removedAuthorities.mintAuthority = mintTx;
      console.log('   ✅ Mint Authority permanently disabled!');
      console.log('   📋 Transaction:', mintTx);
    } else {
      console.log('   ℹ️  Mint Authority already disabled');
    }

    // 2. Disable Freeze Authority
    console.log('\n❄️  Removing Freeze Authority...');
    if (mintInfo.freezeAuthority) {
      const freezeTx = await setAuthority(
        connection,
        treasuryKeypair,
        mint,
        treasuryKeypair.publicKey,
        AuthorityType.FreezeAccount,
        null // Set to null to permanently disable
      );
      removedAuthorities.freezeAuthority = freezeTx;
      console.log('   ✅ Freeze Authority permanently disabled!');
      console.log('   📋 Transaction:', freezeTx);
    } else {
      console.log('   ℹ️  Freeze Authority already disabled');
    }

    console.log('\n🎉 SPL TOKEN AUTHORITIES SUCCESSFULLY REMOVED!');
    console.log('   🚫 No Mint Authority - Fixed supply forever');
    console.log('   🚫 No Freeze Authority - Accounts cannot be frozen');
    console.log('   ℹ️  Update Authority still active (remove with script 10 when ready)');

    // Update configuration
    tgeConfig.mintAuthorityDisabled = true;
    tgeConfig.freezeAuthorityDisabled = true;
    tgeConfig.splTokenAuthoritiesDisabled = true;
    tgeConfig.finalizedAt = new Date().toISOString();
    tgeConfig.splTokenAuthorityRemovalTransactions = removedAuthorities;

    fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));
    console.log('✅ TGE configuration updated');

    // Create SPL Token finalization report
    const finalizationReport = {
      timestamp: new Date().toISOString(),
      cluster: cluster,
      mint: mint.toString(),
      treasury: treasuryKeypair.publicKey.toString(),
      totalSupply: expectedTotalSupply,
      immediateDistribution: totalDistributed,
      vestingAllocation: totalVested,
      crankedTokens: totalCranked,
      treasuryRemaining: remainingInTreasury,
      
      // SPL Token Authority status
      splTokenAuthoritiesRemoved: {
        mintAuthority: !!removedAuthorities.mintAuthority,
        freezeAuthority: !!removedAuthorities.freezeAuthority,
      },
      
      // Transactions
      transactions: removedAuthorities,
      
      // Status
      distributionComplete: distributionComplete,
      splTokenDecentralized: true,
      securityLevel: 'HIGH',
      notes: 'Update Authority for metadata still remains. Use script 10 to remove when ready.',
    };

    const reportPath = path.join(__dirname, '../.haio-spl-token-finalization-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(finalizationReport, null, 2));
    console.log(`📋 SPL Token finalization report saved to: ${reportPath}`);

    console.log('\n🔐 HAiO Token SPL Authorities are now DISABLED:');
    console.log('   ✅ Fixed supply at', expectedTotalSupply.toLocaleString(), 'HAiO');
    console.log('   ✅ No minting control possible');
    console.log('   ✅ No freeze control possible');
    console.log('   ⏳ Update Authority remains (remove with script 10 when ready)');
    
  } catch (error) {
    console.error('❌ Failed to remove SPL Token authorities:', error);
    throw error;
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
}); 