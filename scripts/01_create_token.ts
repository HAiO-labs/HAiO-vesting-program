import * as anchor from '@coral-xyz/anchor';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens

async function main() {
  console.log('🚀 Starting HAiO token creation...');

  // Load wallet
  const walletPath =
    process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('✅ Wallet loaded:', walletKeypair.publicKey.toString());

  // Connect to cluster
  const cluster = process.env.ANCHOR_PROVIDER_URL || 'http://localhost:8899';
  const connection = new Connection(cluster, 'confirmed');
  console.log('✅ Connected to cluster:', cluster);

  // Create mint
  console.log('\n📝 Creating HAiO token mint...');
  const mint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey, // Mint authority
    null, // No freeze authority
    DECIMALS,
    undefined,
    { commitment: 'confirmed' }
  );
  console.log('✅ Mint created:', mint.toString());
  console.log('   Decimals:', DECIMALS);

  // Create treasury token account
  console.log('\n📝 Creating treasury token account...');
  const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    mint,
    walletKeypair.publicKey
  );
  console.log('✅ Treasury token account:', treasuryTokenAccount.address.toString());

  // Mint total supply
  console.log('\n📝 Minting total supply...');
  const mintAmount = TOTAL_SUPPLY * Math.pow(10, DECIMALS);
  await mintTo(
    connection,
    walletKeypair,
    mint,
    treasuryTokenAccount.address,
    walletKeypair.publicKey,
    mintAmount
  );
  console.log('✅ Minted', TOTAL_SUPPLY.toLocaleString(), '$HAiO tokens');

  // Disable mint authority
  console.log('\n🔒 Disabling mint authority...');
  await setAuthority(
    connection,
    walletKeypair,
    mint,
    walletKeypair.publicKey,
    AuthorityType.MintTokens,
    null
  );
  console.log('✅ Mint authority permanently disabled');

  // Save configuration
  const config = {
    mint: mint.toString(),
    treasuryTokenAccount: treasuryTokenAccount.address.toString(),
    decimals: DECIMALS,
    totalSupply: TOTAL_SUPPLY,
    createdAt: new Date().toISOString(),
  };

  const configPath = path.join(__dirname, '../.haio-token-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('\n✅ Configuration saved to:', configPath);

  console.log('\n🎉 HAiO token creation completed!');
  console.log('\n📊 Summary:');
  console.log('   Token Mint:', mint.toString());
  console.log('   Treasury:', treasuryTokenAccount.address.toString());
  console.log('   Total Supply:', TOTAL_SUPPLY.toLocaleString(), '$HAiO');
  console.log('   Decimals:', DECIMALS);
  console.log('   Mint Authority: DISABLED');
  console.log('   Freeze Authority: NONE');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
