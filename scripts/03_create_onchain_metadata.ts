import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplTokenMetadata,
  createMetadataAccountV3,
  CreateMetadataAccountV3InstructionAccounts,
  CreateMetadataAccountV3InstructionArgs,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  publicKey,
  signerIdentity,
  createSignerFromKeypair,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import * as fs from 'fs';
import * as path from 'path';

async function checkMetaplexAvailability(rpcUrl: string): Promise<boolean> {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Check if Metaplex Token Metadata program exists
    const METAPLEX_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const accountInfo = await connection.getAccountInfo(METAPLEX_PROGRAM_ID);
    
    return accountInfo !== null;
  } catch (error) {
    console.warn('⚠️  Could not verify Metaplex availability:', error);
    return false;
  }
}

async function main() {
  console.log('🏷️  Creating HAiO On-Chain Token Metadata...');

  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ TGE config not found. Please run 01_create_token.ts first.');
  }

  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  if (!tgeConfig.tokenMetadata) {
    throw new Error('❌ Token metadata config not found. Please run 01b_create_token_metadata.ts first.');
  }

  const mint = new PublicKey(tgeConfig.mint);
  const metadataUri = tgeConfig.tokenMetadata.metadataUri;
  const clusterUrl = tgeConfig.cluster;

  console.log('✅ TGE Configuration loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Metadata URI:', metadataUri);
  console.log('   Cluster:', clusterUrl);

  // Environment detection
  const isLocalnet = clusterUrl.includes('localhost') || clusterUrl.includes('127.0.0.1');
  const isDevnet = clusterUrl.includes('devnet');
  const isMainnet = clusterUrl.includes('mainnet');

  console.log('\n🌐 Environment Detection:');
  if (isLocalnet) {
    console.log('   Environment: Localnet 🏠');
  } else if (isDevnet) {
    console.log('   Environment: Devnet 🧪');
  } else if (isMainnet) {
    console.log('   Environment: Mainnet 🚀');
  } else {
    console.log('   Environment: Custom RPC 🔧');
  }

  // Check Metaplex availability
  console.log('\n🔍 Checking Metaplex Token Metadata Program...');
  const metaplexAvailable = await checkMetaplexAvailability(clusterUrl);
  
  if (!metaplexAvailable) {
    console.log('❌ Metaplex Token Metadata program not found on this network');
    
    if (isLocalnet) {
      console.log('\n💡 Localnet Setup Required:');
      console.log('   Metaplex programs are not available on localnet by default.');
      console.log('   To use on-chain metadata on localnet:');
      console.log('   1. Clone Metaplex programs to localnet');
      console.log('   2. Or deploy to devnet/mainnet for full metadata support');
      console.log('\n   For now, you can skip on-chain metadata creation.');
      console.log('   The token will work perfectly without it.');
      
      // Mark as skipped but don't fail
      tgeConfig.tokenMetadata.metadataCreated = false;
      tgeConfig.tokenMetadata.status = 'skipped_localnet';
      fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));
      
      console.log('\n✅ Metadata status updated (skipped for localnet)');
      console.log('📋 Next: Proceed with 02_immediate_distribution.ts');
      return;
    } else {
      throw new Error('Metaplex Token Metadata program not found on this network');
    }
  }

  console.log('✅ Metaplex Token Metadata program found');

  // Load admin wallet
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/keypairs/haio-deployer.json');
  
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('✅ Admin Wallet loaded:', walletKeypair.publicKey.toString());

  // Initialize UMI with Metaplex
  console.log('\n🔧 Initializing Metaplex UMI...');
  const umi = createUmi(clusterUrl).use(mplTokenMetadata());

  const signer = createSignerFromKeypair(umi, {
    publicKey: publicKey(walletKeypair.publicKey.toString()),
    secretKey: walletKeypair.secretKey,
  });
  umi.use(signerIdentity(signer));

  console.log('✅ UMI instance configured with Token Metadata program');

  // Prepare metadata account creation parameters
  const accounts: CreateMetadataAccountV3InstructionAccounts = {
    mint: publicKey(mint.toString()),
    mintAuthority: signer,
  };

  const data: CreateMetadataAccountV3InstructionArgs = {
    data: {
      name: tgeConfig.tokenMetadata.name,
      symbol: tgeConfig.tokenMetadata.symbol,
      uri: metadataUri,
      sellerFeeBasisPoints: 0,
      creators: null, // Important: Set to null for Solscan compatibility
      collection: null, // Important: Set to null if no collection
      uses: null, // Important: Set to null if no usage restrictions
    },
    isMutable: tgeConfig.tokenMetadata.isMutable,
    collectionDetails: null,
  };

  console.log('\n🏗️  Creating on-chain metadata transaction...');
  console.log('   Name:', data.data.name);
  console.log('   Symbol:', data.data.symbol);
  console.log('   URI:', data.data.uri);
  console.log('   Mutable:', data.isMutable);

  try {
    // Create and send transaction
    const tx = createMetadataAccountV3(umi, { ...accounts, ...data });
    
    console.log('📡 Sending transaction...');
    const result = await tx.sendAndConfirm(umi, {
      confirm: { commitment: 'confirmed' },
    });

    const signature = base58.deserialize(result.signature)[0];
    console.log('✅ Transaction confirmed!');
    console.log('   Signature:', signature);

    // Calculate metadata PDA
    const metadataPda = findMetadataPda(umi, {
      mint: publicKey(mint.toString()),
    });
    const metadataAddress = metadataPda[0].toString();

    console.log('✅ On-chain metadata created successfully!');
    console.log('   Metadata Account:', metadataAddress);

    // Update TGE configuration
    tgeConfig.tokenMetadata.metadataAccount = metadataAddress;
    tgeConfig.tokenMetadata.metadataCreated = true;
    tgeConfig.tokenMetadata.transactionSignature = signature;
    tgeConfig.tokenMetadata.status = 'on_chain_complete';
    tgeConfig.tokenMetadata.createdAt = new Date().toISOString();
    
    fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));
    console.log('✅ TGE configuration updated with on-chain metadata info');

    console.log('\n🎉 On-Chain Metadata Creation Complete!');
    console.log('\n📋 Metadata Summary:');
    console.log('   • Token Name:', data.data.name);
    console.log('   • Token Symbol:', data.data.symbol);
    console.log('   • Metadata URI:', data.data.uri);
    console.log('   • Metadata Account:', metadataAddress);
    console.log('   • Update Authority:', walletKeypair.publicKey.toString());
    console.log('   • Mutable:', data.isMutable ? 'Yes' : 'No');

    console.log('\n💡 Your token now has rich metadata visible in wallets and explorers!');

  } catch (error) {
    console.error('❌ Failed to create on-chain metadata:', error);
    
    // Provide helpful error information
    if (error instanceof Error && error.message?.includes('0x0')) {
      console.log('\n💡 Troubleshooting Tips:');
      console.log('   • Ensure wallet has sufficient SOL for transaction fees');
      console.log('   • Verify metadata URI is accessible');
      console.log('   • Check if metadata account already exists');
    }
    
    throw error;
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});