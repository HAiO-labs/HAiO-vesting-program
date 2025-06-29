import * as anchor from '@coral-xyz/anchor';
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
  getAccount,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// ===================================================================================================
// AUTOMATIC MULTI-SIG CONFIGURATION FROM PHASE 1
// ===================================================================================================

// Load multi-sig configuration from 04_initialize_ATA_squads_multisig.ts results
function loadMultisigConfig(tgeConfig: any) {
  if (!tgeConfig.multisigConfig || !tgeConfig.multisigConfig.vaults) {
    throw new Error('❌ Multi-sig configuration not found. Please run 04_initialize_ATA_squads_multisig.ts first.');
  }
  
  const vaults = tgeConfig.multisigConfig.vaults;
  
  // Validate all required vaults exist
  const requiredCategories = ['PUBLIC_ROUND', 'ECOSYSTEM', 'LIQUIDITY', 'FOUNDATION'];
  for (const category of requiredCategories) {
    if (!vaults[category]) {
      throw new Error(`❌ ${category} vault configuration not found. Please ensure all vaults were created.`);
    }
  }
  
  return {
    PUBLIC_IMMEDIATE: vaults.PUBLIC_ROUND.ataAddress,
    ECOSYSTEM_IMMEDIATE: vaults.ECOSYSTEM.ataAddress,
    LIQUIDITY: vaults.LIQUIDITY.ataAddress,
    FOUNDATION: vaults.FOUNDATION.ataAddress,
  };
}

// ===================================================================================================
// IMMEDIATE DISTRIBUTION AMOUNTS (in tokens with 9 decimals)
// ===================================================================================================

const IMMEDIATE_ALLOCATIONS = {
  PUBLIC_IMMEDIATE: 16_000_000,    // 16M tokens → PUBLIC_ROUND vault
  ECOSYSTEM_IMMEDIATE: 11_100_000, // 11.1M tokens → ECOSYSTEM vault
  LIQUIDITY: 100_000_000,          // 100M tokens → LIQUIDITY vault
  FOUNDATION: 220_000_000,         // 220M tokens → FOUNDATION vault
};

// All recipients use their respective multi-sig ATA addresses
const MULTISIG_RECIPIENTS: Record<string, boolean> = {
  'Public Round Immediate': true,     // → PUBLIC_ROUND vault ATA
  'Ecosystem Immediate': true,        // → ECOSYSTEM vault ATA
  'Liquidity Provision': true,        // → LIQUIDITY vault ATA
  'Foundation & Treasury': true,      // → FOUNDATION vault ATA
};

async function main() {
  console.log('💰 HAiO TGE - Immediate Distribution to Category-Specific Multi-sig Vaults');
  console.log('===========================================================================');
  
  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ TGE config not found. Please run Phase 1 scripts first.');
  }
  
  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const mint = new PublicKey(tgeConfig.mint);
  const decimals = tgeConfig.decimals;

  console.log('✅ TGE Configuration loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Cluster:', tgeConfig.cluster);

  // Load multi-sig configuration automatically
  const RECIPIENTS = loadMultisigConfig(tgeConfig);

  console.log('\n✅ Multi-sig Configuration loaded:');
  Object.entries(RECIPIENTS).forEach(([category, ataAddress]) => {
    console.log(`   ${category}: ${ataAddress}`);
  });

  // Display vault mapping for clarity
  console.log('\n📋 Distribution Mapping:');
  console.log('   16M HAiO → PUBLIC_ROUND vault (Public Round Immediate)');
  console.log('   11.1M HAiO → ECOSYSTEM vault (Ecosystem Immediate)');
  console.log('   100M HAiO → LIQUIDITY vault (Liquidity Provision)');
  console.log('   220M HAiO → FOUNDATION vault (Foundation & Treasury)');

  // Setup connection and wallet
  const connection = new Connection(tgeConfig.cluster, 'confirmed');
  
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/keypairs/haio-deployer.json');
  
  const treasuryKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  
  console.log('✅ Treasury wallet loaded:', treasuryKeypair.publicKey.toString());

  // Get treasury token account
  const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasuryKeypair,
    mint,
    treasuryKeypair.publicKey
  );

  // Check treasury balance
  const treasuryBalance = await getAccount(connection, treasuryTokenAccount.address);
  const balanceInTokens = Number(treasuryBalance.amount) / Math.pow(10, decimals);
  console.log(`💰 Treasury balance: ${balanceInTokens.toLocaleString()} HAiO`);

  // Calculate total immediate distribution
  const totalImmediate = Object.values(IMMEDIATE_ALLOCATIONS).reduce((sum, amount) => sum + amount, 0);
  console.log(`📊 Total immediate distribution: ${totalImmediate.toLocaleString()} HAiO`);

  if (balanceInTokens < totalImmediate) {
    throw new Error(`❌ Insufficient treasury balance. Need: ${totalImmediate.toLocaleString()}, Have: ${balanceInTokens.toLocaleString()}`);
  }

  console.log('\n🚀 Executing immediate distributions to category-specific vaults...');

  // Execute distributions
  const distributions = [
    {
      category: 'Public Round Immediate',
      recipient: RECIPIENTS.PUBLIC_IMMEDIATE,
      amount: IMMEDIATE_ALLOCATIONS.PUBLIC_IMMEDIATE,
      vault: 'PUBLIC_ROUND'
    },
    {
      category: 'Ecosystem Immediate',
      recipient: RECIPIENTS.ECOSYSTEM_IMMEDIATE,
      amount: IMMEDIATE_ALLOCATIONS.ECOSYSTEM_IMMEDIATE,
      vault: 'ECOSYSTEM'
    },
    {
      category: 'Liquidity Provision',
      recipient: RECIPIENTS.LIQUIDITY,
      amount: IMMEDIATE_ALLOCATIONS.LIQUIDITY,
      vault: 'LIQUIDITY'
    },
    {
      category: 'Foundation & Treasury',
      recipient: RECIPIENTS.FOUNDATION,
      amount: IMMEDIATE_ALLOCATIONS.FOUNDATION,
      vault: 'FOUNDATION'
    },
  ];

  const distributionResults = [];

  for (const dist of distributions) {
    console.log(`\n📤 Distributing ${dist.category}...`);
    console.log(`   Amount: ${dist.amount.toLocaleString()} HAiO`);
    console.log(`   Target Vault: ${dist.vault}`);
    console.log(`   ATA Address: ${dist.recipient}`);

    try {
      // All recipients are multi-sig ATA addresses
      const isMultiSigRecipient = MULTISIG_RECIPIENTS[dist.category] || false;

      let recipientTokenAccountAddress;

      if (isMultiSigRecipient) {
        // Use the provided ATA address directly for multi-sig wallets
        recipientTokenAccountAddress = new PublicKey(dist.recipient);
        console.log(`   🏛️  Using ${dist.vault} vault ATA directly`);
        
        // Verify that the ATA exists
        try {
          const ataInfo = await getAccount(connection, recipientTokenAccountAddress);
          console.log(`   ✅ Multi-sig ATA verified and ready`);
          console.log(`   📊 Current balance: ${Number(ataInfo.amount) / Math.pow(10, decimals)} HAiO`);
        } catch (error) {
          throw new Error(`Multi-sig ATA does not exist: ${dist.recipient}. Please run 04_initialize_ATA_squads_multisig.ts first.`);
        }
      } else {
        // Regular wallet: Find or create ATA (fallback, shouldn't be used in production)
        console.log(`   👤 Regular wallet: Creating/finding ATA`);
        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          treasuryKeypair,
          mint,
          new PublicKey(dist.recipient)
        );
        recipientTokenAccountAddress = recipientTokenAccount.address;
      }

      // Transfer tokens - Using BigInt for precision
      const transferAmount = BigInt(dist.amount) * (10n ** BigInt(decimals));
      console.log(`   📡 Sending ${dist.amount.toLocaleString()} HAiO to ${dist.vault} vault...`);
      
      const signature = await transfer(
        connection,
        treasuryKeypair,
        treasuryTokenAccount.address,
        recipientTokenAccountAddress,
        treasuryKeypair.publicKey,
        transferAmount
      );

      console.log(`   ✅ Transfer completed: ${signature}`);
      
      // Verify transfer
      const recipientBalance = await getAccount(connection, recipientTokenAccountAddress);
      const receivedTokens = Number(recipientBalance.amount) / Math.pow(10, decimals);
      console.log(`   ✅ ${dist.vault} vault balance: ${receivedTokens.toLocaleString()} HAiO`);

      distributionResults.push({
        category: dist.category,
        vault: dist.vault,
        recipient: dist.recipient,
        recipientTokenAccount: recipientTokenAccountAddress.toString(),
        amount: dist.amount,
        signature: signature,
        isMultiSig: isMultiSigRecipient,
        success: true,
      });

    } catch (error) {
      console.error(`   ❌ Failed to distribute ${dist.category}:`, error);
      distributionResults.push({
        category: dist.category,
        vault: dist.vault,
        recipient: dist.recipient,
        amount: dist.amount,
        error: error instanceof Error ? error.message : String(error),
        isMultiSig: MULTISIG_RECIPIENTS[dist.category] || false,
        success: false,
      });
    }

    // Wait between transfers
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Check final treasury balance
  const finalTreasuryBalance = await getAccount(connection, treasuryTokenAccount.address);
  const finalBalanceInTokens = Number(finalTreasuryBalance.amount) / Math.pow(10, decimals);
  console.log(`\n💰 Final treasury balance: ${finalBalanceInTokens.toLocaleString()} HAiO`);

  // Save distribution report
  const report = {
    timestamp: new Date().toISOString(),
    cluster: tgeConfig.cluster,
    mint: mint.toString(),
    treasury: treasuryKeypair.publicKey.toString(),
    distributionType: 'category_specific_multisig',
    vaultMapping: {
      PUBLIC_ROUND: { category: 'Public Round Immediate', amount: '16M HAiO', ata: RECIPIENTS.PUBLIC_IMMEDIATE },
      ECOSYSTEM: { category: 'Ecosystem Immediate', amount: '11.1M HAiO', ata: RECIPIENTS.ECOSYSTEM_IMMEDIATE },
      LIQUIDITY: { category: 'Liquidity Provision', amount: '100M HAiO', ata: RECIPIENTS.LIQUIDITY },
      FOUNDATION: { category: 'Foundation & Treasury', amount: '220M HAiO', ata: RECIPIENTS.FOUNDATION }
    },
    totalDistributed: totalImmediate,
    finalTreasuryBalance: finalBalanceInTokens,
    multiSigConfiguration: MULTISIG_RECIPIENTS,
    distributions: distributionResults,
    phase: 'phase2_immediate_distribution_complete'
  };

  const reportPath = path.join(__dirname, '../.haio-immediate-distribution-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📋 Distribution report saved: ${reportPath}`);

  // Update TGE config
  tgeConfig.immediateDistribution = {
    completed: true,
    totalDistributed: totalImmediate,
    finalTreasuryBalance: finalBalanceInTokens,
    distributionType: 'category_specific_multisig',
    completedAt: new Date().toISOString(),
    reportPath: reportPath
  };
  fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));

  // Summary
  const successful = distributionResults.filter(d => d.success).length;
  const failed = distributionResults.filter(d => !d.success).length;

  console.log('\n🎉 HAiO Immediate Distribution Complete!');
  console.log(`✅ Successful distributions: ${successful}`);
  console.log(`❌ Failed distributions: ${failed}`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some distributions failed. Please check the report and retry manually.');
    console.log('💡 Ensure all multi-sig ATAs are created via 04_initialize_ATA_squads_multisig.ts');
    process.exit(1);
  }
  
  console.log('\n📋 Distribution Summary:');
  distributionResults.filter(d => d.success).forEach(d => {
    console.log(`   ✅ ${d.amount.toLocaleString()} HAiO → ${d.vault} vault`);
  });
  
  console.log('\n🔗 Resources:');
  console.log('   Squads Dashboard: https://app.squads.so');
  console.log('   Token Mint:', mint.toString());
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
}); 