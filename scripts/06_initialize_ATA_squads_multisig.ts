import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

// ===================================================================================================
// ⚠️ CONFIGURATION - UPDATE THESE VALUES FOR PRODUCTION
// ===================================================================================================

// Squads Multi-sig Vault Addresses (Create these via Squads UI first)
// Each category should have its own multi-sig vault
interface SquadsVaultConfig {
  PUBLIC_ROUND: string;     // Public Round (80M HAiO)
  ECOSYSTEM: string;        // Ecosystem (400M HAiO)
  TEAM_ADVISORS: string;    // Team & Advisors (150M HAiO)
  STRATEGIC_PARTNERS: string; // Strategic Partners (50M HAiO)
  LIQUIDITY: string;        // Liquidity (100M HAiO)
  FOUNDATION: string;       // Foundation (220M HAiO)
}

// Load vault addresses from environment variables or set them here
const SQUADS_VAULTS: SquadsVaultConfig = {
  PUBLIC_ROUND: process.env.SQUADS_VAULT_PUBLIC_ROUND || '',
  ECOSYSTEM: process.env.SQUADS_VAULT_ECOSYSTEM || '',
  TEAM_ADVISORS: process.env.SQUADS_VAULT_TEAM_ADVISORS || '',
  STRATEGIC_PARTNERS: process.env.SQUADS_VAULT_STRATEGIC_PARTNERS || '',
  LIQUIDITY: process.env.SQUADS_VAULT_LIQUIDITY || '',
  FOUNDATION: process.env.SQUADS_VAULT_FOUNDATION || '',
};

// Allocation information for reference
const ALLOCATION_INFO = {
  PUBLIC_ROUND: { total: '80M', immediate: '16M', vesting: '64M' },
  ECOSYSTEM: { total: '400M', immediate: '11.1M', vesting: '388.9M' },
  TEAM_ADVISORS: { total: '150M', immediate: '0M', vesting: '150M' },
  STRATEGIC_PARTNERS: { total: '50M', immediate: '0M', vesting: '50M' },
  LIQUIDITY: { total: '100M', immediate: '100M', vesting: '0M' },
  FOUNDATION: { total: '220M', immediate: '220M', vesting: '0M' },
};

// Load TGE configuration to get the token mint
function loadTgeConfig() {
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ TGE config not found. Please run Phase 1 scripts first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// Admin wallet path (must be a member of all Squads vaults)
const ADMIN_WALLET_PATH = process.env.ANCHOR_WALLET || path.join(homedir(), '.config/solana/keypairs/haio-deployer.json');

// ===================================================================================================

function validateVaultAddresses(): void {
  const missingVaults: string[] = [];
  
  Object.entries(SQUADS_VAULTS).forEach(([category, address]) => {
    if (!address) {
      missingVaults.push(category);
    }
  });

  if (missingVaults.length > 0) {
    console.log('❌ Missing Squads vault addresses for:', missingVaults.join(', '));
    console.log('\n📋 Setup Required:');
    console.log('   1. Create Multi-sig vaults via Squads UI (https://app.squads.so)');
    console.log('   2. Add your admin wallet as member to each vault');
    console.log('   3. Set appropriate threshold (typically 1 for testing, higher for production)');
    console.log('   4. Set environment variables or update script with vault addresses:');
    console.log('\n   Environment Variables:');
    Object.keys(SQUADS_VAULTS).forEach(category => {
      console.log(`   export SQUADS_VAULT_${category}="YourVaultAddressHere"`);
    });
    console.log('\n   Example:');
    console.log('   export SQUADS_VAULT_PUBLIC_ROUND="ABC123..."');
    console.log('   export SQUADS_VAULT_ECOSYSTEM="DEF456..."');
    console.log('   # ... and so on for all 6 categories');
    console.log('\n   Then run: ts-node scripts/04_initialize_ATA_squads_multisig.ts');
    throw new Error('Missing vault addresses');
  }
}

async function createAtaForVault(
  connection: Connection,
  adminWallet: Keypair,
  tokenMint: PublicKey,
  vaultAddress: PublicKey,
  category: string
): Promise<{ ataAddress: string; transaction?: string; existed: boolean }> {
  
  console.log(`\n🔍 Processing ${category} vault...`);
  console.log(`   Vault: ${vaultAddress.toString()}`);
  
  // Verify vault exists
  const vaultInfo = await connection.getAccountInfo(vaultAddress);
  if (!vaultInfo) {
    throw new Error(`Squads vault not found for ${category}: ${vaultAddress.toString()}`);
  }
  console.log(`   ✅ Vault verified on-chain`);

  // Calculate ATA address for the vault
  const ataAddress = await getAssociatedTokenAddress(
    tokenMint,
    vaultAddress,
    true // allowOwnerOffCurve - Allow PDA as owner
  );
  
  console.log(`   Target ATA: ${ataAddress.toString()}`);

  // Check if ATA already exists
  let ataExists = false;
  try {
    const ataInfo = await getAccount(connection, ataAddress);
    ataExists = true;
    console.log(`   ✅ ATA already exists (Balance: ${Number(ataInfo.amount)} tokens)`);
  } catch (error) {
    console.log(`   ℹ️  ATA does not exist - will create it`);
  }

  let transactionSignature: string | undefined;

  if (!ataExists) {
    console.log(`   📤 Creating ATA for ${category}...`);
    
    // Create ATA instruction
    const createAtaInstruction = createAssociatedTokenAccountInstruction(
      adminWallet.publicKey, // Payer (admin pays the rent)
      ataAddress,            // ATA to be created  
      vaultAddress,          // Owner (Squads vault PDA)
      tokenMint,             // Token Mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Create and send transaction
    const transaction = new Transaction().add(createAtaInstruction);
    
    console.log(`   📡 Sending transaction...`);
    transactionSignature = await connection.sendTransaction(transaction, [adminWallet]);
    await connection.confirmTransaction(transactionSignature, 'confirmed');
    
    console.log(`   ✅ ATA created successfully!`);
    console.log(`   Transaction: ${transactionSignature}`);
  }

  // Final verification
  const finalAtaInfo = await getAccount(connection, ataAddress);
  console.log(`   ✅ Final verification passed`);
  console.log(`   Owner: ${finalAtaInfo.owner.toString()}`);
  console.log(`   Balance: ${Number(finalAtaInfo.amount)} tokens`);

  return {
    ataAddress: ataAddress.toString(),
    transaction: transactionSignature,
    existed: ataExists
  };
}

async function main() {
  console.log('🏛️  HAiO TGE - Creating Multi-sig ATAs for All Categories');
  console.log('=========================================================');
  
  // Validation
  try {
    validateVaultAddresses();
  } catch (error) {
    process.exit(1);
  }

  // Load TGE configuration
  const tgeConfig = loadTgeConfig();
  const TOKEN_MINT = new PublicKey(tgeConfig.mint);
  console.log('✅ Token Mint loaded:', TOKEN_MINT.toString());
  console.log('✅ Cluster:', tgeConfig.cluster);

  // Parse and validate all vault addresses
  const parsedVaults: Record<string, PublicKey> = {};
  
  try {
    Object.entries(SQUADS_VAULTS).forEach(([category, address]) => {
      parsedVaults[category] = new PublicKey(address);
      console.log(`✅ ${category} Vault: ${address}`);
    });
  } catch (error) {
    throw new Error(`❌ Invalid vault address format: ${error}`);
  }

  // Setup connection and wallet
  const connection = new Connection(tgeConfig.cluster, 'confirmed');
  const adminWallet = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(ADMIN_WALLET_PATH, 'utf-8')))
  );
  
  console.log('✅ Admin wallet loaded:', adminWallet.publicKey.toString());

  // Check wallet balance
  const balance = await connection.getBalance(adminWallet.publicKey);
  console.log(`💰 Wallet balance: ${(balance / 1e9).toFixed(4)} SOL`);
  
  // Estimate required SOL (0.002 SOL per ATA creation + some buffer)
  const estimatedCost = 0.002 * 6 + 0.01; // 6 ATAs + buffer
  if (balance < estimatedCost * 1e9) {
    const isDevnet = tgeConfig.cluster.includes('devnet');
    console.log(`⚠️  Low SOL balance for transaction fees (need ~${estimatedCost} SOL)`);
    if (isDevnet) {
      console.log('   Get devnet SOL: https://faucet.solana.com');
    }
  }

  console.log('\n📊 TGE Allocation Overview:');
  Object.entries(ALLOCATION_INFO).forEach(([category, info]) => {
    console.log(`   ${category}: ${info.total} (${info.immediate} immediate + ${info.vesting} vesting)`);
  });

  try {
    const results: Record<string, any> = {};
    let totalCreated = 0;
    let totalExisted = 0;

    // Process each vault
    for (const [category, vaultAddress] of Object.entries(parsedVaults)) {
      const result = await createAtaForVault(
        connection,
        adminWallet,
        TOKEN_MINT,
        vaultAddress,
        category
      );

      results[category] = {
        vaultAddress: vaultAddress.toString(),
        ataAddress: result.ataAddress,
        allocation: ALLOCATION_INFO[category as keyof typeof ALLOCATION_INFO],
        transaction: result.transaction,
        existed: result.existed,
        createdAt: new Date().toISOString()
      };

      if (result.existed) {
        totalExisted++;
      } else {
        totalCreated++;
      }
    }

    // Update TGE configuration with all multi-sig info
    tgeConfig.multisigConfig = {
      vaults: results,
      tokenMint: TOKEN_MINT.toString(),
      adminWallet: adminWallet.publicKey.toString(),
      totalVaults: Object.keys(parsedVaults).length,
      createdAt: new Date().toISOString(),
      network: tgeConfig.cluster.includes('devnet') ? 'devnet' : 
               tgeConfig.cluster.includes('mainnet') ? 'mainnet' : 'custom',
      phase: 'phase1_multisig_complete'
    };

    // Save updated configuration
    const configPath = path.join(__dirname, '../.haio-tge-config.json');
    fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));
    console.log('\n✅ TGE configuration updated with all multi-sig info');

    // Save detailed ATA report
    const reportPath = path.join(__dirname, '../.haio-multisig-ata-report.json');
    const report = {
      summary: {
        totalVaults: Object.keys(parsedVaults).length,
        atasCreated: totalCreated,
        atasExisted: totalExisted,
        executedAt: new Date().toISOString(),
        network: tgeConfig.cluster
      },
      vaults: results
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('\n🎉 Multi-sig ATA Setup Complete for All Categories!');
    console.log('\n📋 Summary:');
    console.log(`   ✅ Total vaults processed: ${Object.keys(parsedVaults).length}`);
    console.log(`   ✅ ATAs created: ${totalCreated}`);
    console.log(`   ✅ ATAs already existed: ${totalExisted}`);
    console.log(`   ✅ Configuration updated`);
    console.log(`   ✅ Report saved: .haio-multisig-ata-report.json`);
    
    console.log('\n📋 Created ATAs:');
    Object.entries(results).forEach(([category, result]) => {
      console.log(`   ${category}:`);
      console.log(`     Vault: ${result.vaultAddress}`);
      console.log(`     ATA: ${result.ataAddress}`);
      console.log(`     Allocation: ${result.allocation.total} HAiO`);
    });
    
    
    console.log('\n🔗 Resources:');
    console.log(`   Squads Dashboard: https://app.squads.so`);
    console.log(`   Token Mint: ${TOKEN_MINT.toString()}`);
    console.log(`   Network: ${tgeConfig.cluster}`);

  } catch (error) {
    console.error('\n❌ Failed to create multi-sig ATAs:', error);
    
    if (error instanceof Error) {
      if (error.message?.includes('insufficient funds')) {
        console.log('\n💡 Troubleshooting:');
        console.log('   • Ensure wallet has sufficient SOL for transaction fees');
        console.log('   • Current balance:', (balance / 1e9).toFixed(4), 'SOL');
        console.log('   • Estimated need:', estimatedCost, 'SOL');
      }
      
      if (error.message?.includes('not found')) {
        console.log('\n💡 Troubleshooting:');
        console.log('   • Verify all SQUADS_VAULT addresses are correct');
        console.log('   • Ensure vaults exist on the current network');
        console.log('   • Check vaults were created on same cluster as token');
      }
    }
    
    throw error;
  }
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});