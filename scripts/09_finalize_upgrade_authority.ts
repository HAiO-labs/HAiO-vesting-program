// scripts/09_set_upgrade_authority.ts
//
// HAiO Vesting Program - Permanent Upgrade Authority Removal
//
// This script permanently removes the upgrade authority from the vesting program.
// The vesting program should be immutable for security reasons, and this removal
// does not affect any vesting functionality (crank, token releases, etc.).
//
// Usage:
//   npm run finalize-upgrade-authority

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('🔒 HAiO Vesting Program - Upgrade Authority Removal');
  console.log('====================================================');

  // Setup provider to get cluster info
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const clusterUrl = provider.connection.rpcEndpoint;
  const isMainnet = clusterUrl.includes('mainnet');

  console.log(`📡 Cluster: ${clusterUrl}`);
  console.log(`🌐 Network: ${isMainnet ? 'Mainnet' : 'Devnet/Testnet'}`);

  // Load program initialization configuration
  const programInitPath = path.join(__dirname, '../.haio-program-init.json');
  if (!fs.existsSync(programInitPath)) {
    throw new Error('❌ Program initialization file not found. Run 06_initialize_program.ts first.');
  }

  const programInit = JSON.parse(fs.readFileSync(programInitPath, 'utf-8'));
  const programId = programInit.programId;
  
  if (!programId) {
    throw new Error('❌ Vesting program ID not found in program initialization file.');
  }

  console.log(`🏗️  Program ID: ${programId}`);

  // Check if upgrade authority was already removed
  if (programInit.upgradeAuthorityRemoved) {
    console.log('✅ Upgrade authority was already removed on:', programInit.upgradeAuthorityRemovedAt);
    console.log('✅ Removed on cluster:', programInit.upgradeAuthorityRemovedCluster);
    return;
  }

  // Check current upgrade authority
  console.log('\n🔍 Checking current upgrade authority...');
  try {
    const showResult = execSync(
      `solana program show ${programId} --url ${clusterUrl} --output json`,
      { encoding: 'utf-8' }
    );
    
    const programInfo = JSON.parse(showResult);
    const currentAuthority = programInfo.authority;
    
    console.log(`✅ Current upgrade authority: ${currentAuthority}`);
    
    if (currentAuthority === 'none') {
      console.log('✅ Upgrade authority is already removed.');
      
      // Update config to reflect current state
      programInit.upgradeAuthorityRemoved = true;
      programInit.upgradeAuthorityRemovedAt = new Date().toISOString();
      programInit.upgradeAuthorityRemovedCluster = isMainnet ? 'mainnet' : 'devnet';
      
      fs.writeFileSync(programInitPath, JSON.stringify(programInit, null, 2));
      console.log('✅ Program configuration updated.');
      return;
    }
  } catch (error) {
    throw new Error(`❌ Failed to query program info: ${error}`);
  }

  // Important notices
  console.log('\n⚠️  Important Information:');
  console.log('• Upgrade authority removal is IRREVERSIBLE');
  console.log('• After removal, the program can NEVER be upgraded');
  console.log('• Vesting functionality (crank, token releases) will continue to work normally');
  console.log('• This enhances the security of the vesting program');

  if (isMainnet) {
    console.log('\n🚨 MAINNET DEPLOYMENT - Proceed carefully!');
    console.log('🔒 This will make the program permanently immutable on Mainnet.');
  }

  console.log('\n🔒 Removing upgrade authority permanently...');
  
  try {
    const removeCommand = `solana program set-upgrade-authority ${programId} --final --url ${clusterUrl}`;
    console.log(`Executing: ${removeCommand}`);
    
    const result = execSync(removeCommand, { encoding: 'utf-8' });
    console.log('\n✅ Upgrade authority successfully removed!');
    console.log(result);

    // Verify removal
    console.log('\n🔍 Verifying authority removal...');
    const verifyResult = execSync(
      `solana program show ${programId} --url ${clusterUrl} --output json`,
      { encoding: 'utf-8' }
    );
    
    const verifiedInfo = JSON.parse(verifyResult);
    if (verifiedInfo.authority === 'none') {
      console.log('✅ Verified: Upgrade authority completely removed.');
    } else {
      throw new Error('❌ Authority removal verification failed');
    }

    // Update program init config
    programInit.upgradeAuthorityRemoved = true;
    programInit.upgradeAuthorityRemovedAt = new Date().toISOString();
    programInit.upgradeAuthorityRemovedCluster = isMainnet ? 'mainnet' : 'devnet';
    
    fs.writeFileSync(programInitPath, JSON.stringify(programInit, null, 2));
    console.log('✅ Program configuration updated.');

  } catch (error) {
    throw new Error(`❌ Failed to remove upgrade authority: ${error}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 HAiO Vesting Program Upgrade Authority Removal Complete!');
  console.log('🔒 The program is now completely immutable.');
  console.log('🚀 Vesting functionality continues to work normally.');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('💥 Error:', e.message);
  process.exit(1);
});
