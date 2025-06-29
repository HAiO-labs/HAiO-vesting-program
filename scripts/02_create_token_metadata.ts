import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Production Token Metadata Configuration
const TOKEN_METADATA = {
  name: 'HAiO',
  symbol: 'HAIO',
  description: 'HAiO is the utility token for our AI-powered Web3 music platform.',
  image: 'https://arweave.net/koOF2ZgKQewfaz_Mf2NWqBCxQnwigc2Az_Z-wxJ8h_g',
  external_url: 'https://haio.fun',
  attributes: [
    { trait_type: 'Token Type', value: 'Utility' },
    { trait_type: 'Blockchain', value: 'Solana' },
    { trait_type: 'Total Supply', value: '1,000,000,000' },
    { trait_type: 'Decimals', value: '9' },
  ],
  properties: {
    files: [
      {
        uri: 'https://arweave.net/koOF2ZgKQewfaz_Mf2NWqBCxQnwigc2Az_Z-wxJ8h_g',
        type: 'image/png',
      },
    ],
    category: 'image',
  },
};

// Arweave URI for metadata
const METADATA_URI = 'https://arweave.net/vTqOTVVScsazlN5ROwygZCPIFB2olJYmWixVIXeXtgk';

async function main() {
  console.log('🏷️  Creating HAiO Token Metadata JSON...');
  
  // Load TGE configuration
  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ TGE config not found. Please run 01_create_token.ts first.');
  }

  const tgeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const mint = new PublicKey(tgeConfig.mint);
  
  console.log('✅ TGE Configuration loaded');
  console.log('   Token Mint:', mint.toString());
  console.log('   Cluster:', tgeConfig.cluster);

  // Load admin wallet
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/keypairs/haio-deployer.json');
  
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('✅ Admin Wallet loaded:', walletKeypair.publicKey.toString());

  // Connect to cluster
  const connection = new Connection(tgeConfig.cluster, 'confirmed');
  console.log('✅ Connected to cluster:', tgeConfig.cluster);

  console.log('\n📊 Token Metadata Configuration:');
  console.log(`   • Name: ${TOKEN_METADATA.name}`);
  console.log(`   • Symbol: ${TOKEN_METADATA.symbol}`);
  console.log(`   • Description: ${TOKEN_METADATA.description}`);
  console.log(`   • Image URI: ${TOKEN_METADATA.image}`);
  console.log(`   • External URL: ${TOKEN_METADATA.external_url}`);
  console.log(`   • Metadata URI: ${METADATA_URI}`);

  try {
    // Create metadata JSON file for Arweave/IPFS upload
    const metadataJson = {
      name: TOKEN_METADATA.name,
      symbol: TOKEN_METADATA.symbol,
      description: TOKEN_METADATA.description,
      image: TOKEN_METADATA.image,
      external_url: TOKEN_METADATA.external_url,
      attributes: TOKEN_METADATA.attributes,
      properties: TOKEN_METADATA.properties,
    };

    // Save metadata JSON
    const metadataPath = path.join(__dirname, '../.haio-token-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadataJson, null, 2));
    console.log('\n📄 Token metadata JSON created:');
    console.log(`   File: ${metadataPath}`);
    console.log('   Status: Ready for Arweave/IPFS upload ✅');

    // Update TGE configuration with metadata info
    tgeConfig.tokenMetadata = {
      name: TOKEN_METADATA.name,
      symbol: TOKEN_METADATA.symbol,
      description: TOKEN_METADATA.description,
      image: TOKEN_METADATA.image,
      external_url: TOKEN_METADATA.external_url,
      attributes: TOKEN_METADATA.attributes,
      metadataUri: METADATA_URI,
      metadataJsonPath: metadataPath,
      updateAuthority: walletKeypair.publicKey.toString(),
      isMutable: true,
      metadataCreated: false, // Will be set to true in 01c script
      status: 'json_prepared',
    };

    fs.writeFileSync(configPath, JSON.stringify(tgeConfig, null, 2));
    console.log('✅ TGE configuration updated with metadata info');

    console.log('\n🎉 Token Metadata JSON Preparation Complete!');
    console.log('\n📋 Metadata Details:');
    console.log('   • JSON File Created: ✅');
    console.log('   • Arweave URI Configured: ✅');
    console.log('   • Production Ready: ✅');
    
    console.log('\n💡 Note: On-chain metadata enhances token display in wallets and explorers');

  } catch (error) {
    console.error('❌ Token metadata preparation failed:', error);
    throw error;
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
}); 