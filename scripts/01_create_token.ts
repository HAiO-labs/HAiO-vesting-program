import * as anchor from '@coral-xyz/anchor';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, clusterApiUrl, Transaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// TGE Configuration
const DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens

// Token Metadata
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
  ],
};

// TGE Allocation (in millions)
const TGE_ALLOCATION = {
  PUBLIC_ROUND: 80,        // 16M immediate + 64M vesting
  ECOSYSTEM: 400,          // 11.1M immediate + 388.9M vesting
  TEAM_ADVISORS: 150,      // All vesting (6mo cliff + 36mo)
  PARTNERS: 50,            // All vesting (12mo)
  LIQUIDITY: 100,          // All immediate
  FOUNDATION: 220,         // All immediate
};

function loadTokenMintKeypair(): Keypair | null {
  const vanityKeypairPath = path.join(__dirname, '../keys/haio_token_mint.json');
  
  if (fs.existsSync(vanityKeypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(vanityKeypairPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  }
  
  return null;
}

async function main() {
  console.log('🚀 Starting HAiO Token Generation Event (TGE)...');
  console.log('📊 Token Metadata:');
  console.log(`   • Name: ${TOKEN_METADATA.name}`);
  console.log(`   • Symbol: ${TOKEN_METADATA.symbol}`);
  console.log(`   • Description: ${TOKEN_METADATA.description}`);
  console.log('📊 Total Supply: 1,000,000,000 HAiO tokens');
  console.log('📊 Allocation Breakdown:');
  console.log(`   • Public Round: ${TGE_ALLOCATION.PUBLIC_ROUND}M (8%)`);
  console.log(`   • Ecosystem: ${TGE_ALLOCATION.ECOSYSTEM}M (40%)`);
  console.log(`   • Team & Advisors: ${TGE_ALLOCATION.TEAM_ADVISORS}M (15%)`);
  console.log(`   • Partners: ${TGE_ALLOCATION.PARTNERS}M (5%)`);
  console.log(`   • Liquidity: ${TGE_ALLOCATION.LIQUIDITY}M (10%)`);
  console.log(`   • Foundation: ${TGE_ALLOCATION.FOUNDATION}M (22%)`);

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/keypairs/haio-deployer.json');
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('✅ Treasury Wallet loaded:', walletKeypair.publicKey.toString());

  // Connect to cluster
  const cluster = process.env.ANCHOR_PROVIDER_URL || 'http://localhost:8899';
  const connection = new Connection(cluster, 'confirmed');
  console.log('✅ Connected to cluster:', cluster);

  // Load or create token mint keypair
  let mintKeypair = loadTokenMintKeypair();
  let usingVanityAddress = false;
  
  if (mintKeypair) {
    console.log('✅ Using vanity token mint keypair');
    console.log('   Mint Address:', mintKeypair.publicKey.toString());
    usingVanityAddress = true;
  } else {
    console.log('⚠️  No vanity keypair found, generating random mint');
    console.log('   💡 Run "npm run generate-vanity" to create vanity addresses');
    mintKeypair = Keypair.generate();
  }

  // Create mint
  console.log('\n📝 Creating HAiO token mint...');
  const mint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey, // Mint authority (will be removed later)
    null, // No freeze authority for maximum decentralization
    DECIMALS,
    mintKeypair,
    { commitment: 'confirmed' }
  );
  console.log('✅ HAiO Token Mint created:', mint.toString());
  console.log('   Decimals:', DECIMALS);
  console.log('   Vanity Address:', usingVanityAddress ? '✅' : '❌');

  // Create treasury token account
  console.log('\n📝 Creating treasury token account...');
  const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    mint,
    walletKeypair.publicKey
  );
  console.log('✅ Treasury token account:', treasuryTokenAccount.address.toString());

  // Mint total supply to treasury
  console.log('\n📝 Minting total supply to treasury...');
  const mintAmount = BigInt(TOTAL_SUPPLY) * (10n ** BigInt(DECIMALS));
  await mintTo(
    connection,
    walletKeypair,
    mint,
    treasuryTokenAccount.address,
    walletKeypair.publicKey,
    mintAmount
  );
  console.log('✅ Minted', TOTAL_SUPPLY.toLocaleString(), '$HAiO tokens to treasury');

  // ⚠️ IMPORTANT: Do NOT disable mint authority yet
  // We'll disable it in the final step after all distributions
  console.log('\n⚠️  Mint authority retained for TGE distribution');
  console.log('   ⚠️  Will be permanently disabled after all TGE activities complete');

  // Save configuration
  const config = {
    mint: mint.toString(),
    treasuryWallet: walletKeypair.publicKey.toString(),
    treasuryTokenAccount: treasuryTokenAccount.address.toString(),
    decimals: DECIMALS,
    totalSupply: TOTAL_SUPPLY,
    tgeAllocation: TGE_ALLOCATION,
    createdAt: new Date().toISOString(),
    cluster: cluster,
    mintAuthorityDisabled: false, // Will be set to true after final step
  };

  const configPath = path.join(__dirname, '../.haio-tge-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('\n✅ TGE Configuration saved to:', configPath);

  console.log('\n🎉 HAiO Token TGE Setup Complete!');
  console.log('\n📊 Summary:');
  console.log('   Token Mint:', mint.toString());
  console.log('   Treasury:', treasuryTokenAccount.address.toString());
  console.log('   Total Supply:', TOTAL_SUPPLY.toLocaleString(), '$HAiO');
  console.log('   Decimals:', DECIMALS);
  console.log('   Mint Authority: ACTIVE (will be disabled after TGE)');
  console.log('   Freeze Authority: NONE (permanent)');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
