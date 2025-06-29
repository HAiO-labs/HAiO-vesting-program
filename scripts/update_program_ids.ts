import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('🔄 Updating Program IDs with vanity addresses...');

  // Vanity config 로드
  const vanityConfigPath = path.join(__dirname, '../.haio-vanity-config.json');
  if (!fs.existsSync(vanityConfigPath)) {
    console.log('❌ Vanity config not found. Please run "npm run generate-vanity" first.');
    return;
  }

  const vanityConfig = JSON.parse(fs.readFileSync(vanityConfigPath, 'utf-8'));
  const { programId, tokenMint } = vanityConfig;

  console.log('✅ Vanity configuration loaded:');
  console.log(`   Program ID: ${programId}`);
  console.log(`   Token Mint: ${tokenMint}`);

  // 1. Update Anchor.toml
  console.log('\n📝 Updating Anchor.toml...');
  const anchorTomlPath = path.join(__dirname, '../Anchor.toml');
  let anchorTomlContent = fs.readFileSync(anchorTomlPath, 'utf-8');

  // Update localnet program ID
  anchorTomlContent = anchorTomlContent.replace(
    /\[programs\.localnet\]\s*\nhaio_vesting\s*=\s*"[^"]*"/,
    `[programs.localnet]\nhaio_vesting = "${programId}"`
  );

  // Update devnet program ID
  anchorTomlContent = anchorTomlContent.replace(
    /\[programs\.devnet\]\s*\nhaio_vesting\s*=\s*"[^"]*"/,
    `[programs.devnet]\nhaio_vesting = "${programId}"`
  );

  fs.writeFileSync(anchorTomlPath, anchorTomlContent);
  console.log('✅ Anchor.toml updated');

  // 2. Update lib.rs
  console.log('📝 Updating lib.rs...');
  const libRsPath = path.join(__dirname, '../programs/haio-vesting/src/lib.rs');
  let libRsContent = fs.readFileSync(libRsPath, 'utf-8');

  // Update declare_id!
  libRsContent = libRsContent.replace(
    /declare_id!\("([^"]*)"\);/,
    `declare_id!("${programId}");`
  );

  fs.writeFileSync(libRsPath, libRsContent);
  console.log('✅ lib.rs updated');

  // 3. Update security.txt source_code URL
  console.log('📝 Updating security.txt source_code...');
  libRsContent = libRsContent.replace(
    /source_code:\s*"[^"]*"/,
    `source_code: "https://github.com/HAiO-Official/haio-vesting"`
  );

  fs.writeFileSync(libRsPath, libRsContent);
  console.log('✅ Security.txt source_code updated');

  // 4. Create deployment summary
  const deploymentSummary = {
    timestamp: new Date().toISOString(),
    programId: programId,
    tokenMint: tokenMint,
    vanityGenerated: true,
    filesUpdated: [
      'Anchor.toml',
      'programs/haio-vesting/src/lib.rs',
    ],
    nextSteps: [
      'anchor build',
      'anchor deploy',
      'npm run initialize',
      'npm run create-token',
    ],
  };

  const summaryPath = path.join(__dirname, '../.haio-deployment-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(deploymentSummary, null, 2));
  console.log(`📄 Deployment summary saved to: ${summaryPath}`);

  console.log('\n🎉 Program ID update complete!');
  console.log('\n📋 Next Steps:');
  console.log('1. anchor build          # Rebuild with new program ID');
  console.log('2. anchor deploy         # Deploy program with vanity address');
  console.log('3. npm run initialize    # Initialize the program');
  console.log('4. npm run create-token  # Create token with vanity mint address');

  console.log('\n⚠️  Important Notes:');
  console.log('• The program will use the vanity address after rebuild and deploy');
  console.log('• The token mint will use the vanity address when created');
  console.log('• Make sure to rebuild before deploying');

  // 5. Backup original addresses (if first time)
  const backupPath = path.join(__dirname, '../.haio-original-addresses.json');
  if (!fs.existsSync(backupPath)) {
    const originalAddresses = {
      timestamp: new Date().toISOString(),
      note: 'Original addresses before vanity update',
      originalProgramId: '7XoKqYQvriPHuHJdRr22dbUVDEBv2zpQ4ZtB84XV7mfv', // Current from lib.rs before update
      vanityProgramId: programId,
      vanityTokenMint: tokenMint,
    };

    fs.writeFileSync(backupPath, JSON.stringify(originalAddresses, null, 2));
    console.log(`💾 Original addresses backed up to: ${backupPath}`);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
}); 