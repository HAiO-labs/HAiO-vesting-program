import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('⚙️ Initializing HAiO Vesting Program...');

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  if (!provider.wallet.payer) {
    throw new Error('Wallet payer not found. Make sure you have a valid wallet configured.');
  }

  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;
  console.log('✅ Program ID:', program.programId.toString());
  console.log('✅ Admin wallet:', provider.wallet.publicKey.toString());

  // Derive program config PDA
  const [programConfigPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  console.log('✅ Program Config PDA:', programConfigPDA.toString());

  // Check if already initialized
  try {
    const existingConfig = await program.account.programConfig.fetch(programConfigPDA);
    console.log('⚠️  Program already initialized!');
    console.log('   Current Admin:', existingConfig.admin.toString());
    console.log('   Total Schedules:', existingConfig.totalSchedules.toString());
    console.log('   PDA Bump:', existingConfig.bump);

    if (existingConfig.admin.equals(provider.wallet.publicKey)) {
      console.log('✅ Current wallet is the admin');
    } else {
      console.log('❌ Current wallet is NOT the admin');
      console.log('   Expected:', provider.wallet.publicKey.toString());
      console.log('   Actual:', existingConfig.admin.toString());
    }

    return;
  } catch (error) {
    console.log('✅ Program not initialized yet, proceeding with initialization...');
  }

  try {
    // Initialize the program
    console.log('\n🚀 Executing program initialization...');
    
    const tx = await program.methods
      .initialize()
      .accountsPartial({
        admin: provider.wallet.publicKey,
        programConfig: programConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✅ Program initialized successfully!');
    console.log('   Transaction:', tx);

    // Verify initialization
    const config = await program.account.programConfig.fetch(programConfigPDA);
    console.log('\n📊 Program Configuration:');
    console.log('   Admin:', config.admin.toString());
    console.log('   Total Schedules:', config.totalSchedules.toString());
    console.log('   PDA Bump:', config.bump);
    console.log('   ⚠️  Admin authority is IMMUTABLE after initialization');

    // Save initialization info
    const initInfo = {
      timestamp: new Date().toISOString(),
      cluster: provider.connection.rpcEndpoint,
      programId: program.programId.toString(),
      programConfigPDA: programConfigPDA.toString(),
      admin: provider.wallet.publicKey.toString(),
      initTransaction: tx,
      bump: config.bump,
    };

    const initPath = path.join(__dirname, '../.haio-program-init.json');
    fs.writeFileSync(initPath, JSON.stringify(initInfo, null, 2));
    console.log(`\n📋 Initialization info saved to: ${initPath}`);

    console.log('\n🎉 HAiO Vesting Program Initialization Complete!');
    console.log('✅ Program is ready for TGE operations');

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    
    // Check if it's a specific error we can handle
    if (error instanceof Error) {
      if (error.message.includes('already in use')) {
        console.log('⚠️  Program config account already exists. Fetching existing configuration...');
        try {
          const config = await program.account.programConfig.fetch(programConfigPDA);
          console.log('✅ Existing configuration found:');
          console.log('   Admin:', config.admin.toString());
          console.log('   Total Schedules:', config.totalSchedules.toString());
        } catch (fetchError) {
          console.error('❌ Failed to fetch existing configuration:', fetchError);
        }
      }
    }
    
    throw error;
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
}); 