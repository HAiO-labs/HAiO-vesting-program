// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from '@coral-xyz/anchor';
import { Program, PublicKey, SystemProgram } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting'; // Adjust path as needed
// import { BpfLoaderUpgradeable, Transaction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js'; // For upgrade authority

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;
  const adminWallet = provider.wallet as anchor.Wallet;

  console.log(`Deploying program with admin: ${adminWallet.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // --- 1. Initialize ProgramConfig if not already done ---
  const [programConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('program_config')],
    program.programId
  );

  console.log(`ProgramConfig PDA: ${programConfigPDA.toBase58()}`);

  try {
    const configAccount = await program.account.programConfig.fetch(programConfigPDA);
    console.log('ProgramConfig already initialized.');
    console.log(`Current admin: ${configAccount.admin.toBase58()}`);
    console.log(`Current distribution hub: ${configAccount.distributionHub.toBase58()}`);
  } catch (error) {
    // Assuming error means account not found, so initialize.
    if (
      error.message.includes('Account does not exist') ||
      error.message.includes('could not find account')
    ) {
      console.log('ProgramConfig not found. Initializing...');
      try {
        await program.methods
          .initialize()
          .accounts({
            admin: adminWallet.publicKey,
            programConfig: programConfigPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([adminWallet.payer]) // provider.wallet is the payer by default if signers not specified for admin
          .rpc();
        console.log('ProgramConfig initialized successfully.');
        const newConfig = await program.account.programConfig.fetch(programConfigPDA);
        console.log(`Initialized admin: ${newConfig.admin.toBase58()}`);
      } catch (initError) {
        console.error('Failed to initialize ProgramConfig:', initError);
        throw initError;
      }
    } else {
      console.error("Error fetching ProgramConfig (not an 'Account does not exist' error):", error);
      // If it's a different error, rethrow or handle appropriately
      // For example, if it's a deserialization error, the account might exist but be malformed.
    }
  }

  // --- 2. (Optional) Set initial Distribution Hub if needed ---
  // This should typically be done as a separate operational step after deployment and initialization.
  // const initialHubAddress = new PublicKey("YOUR_INITIAL_DISTRIBUTION_HUB_PUBKEY");
  // const currentConfig = await program.account.programConfig.fetch(programConfigPDA);
  // if (currentConfig.distributionHub.equals(new PublicKey(Buffer.alloc(32)))) { // Check if unset (all zeros)
  //   console.log(`Setting initial distribution hub to: ${initialHubAddress.toBase58()}`);
  //   await program.methods
  //     .updateDistributionHub(initialHubAddress)
  //     .accounts({
  //       admin: adminWallet.publicKey,
  //       programConfig: programConfigPDA,
  //     })
  //     .rpc();
  //   console.log("Initial distribution hub set.");
  // }

  // --- 3. TODO: Program Upgrade Authority Management ---
  // After deployment and thorough testing, the upgrade authority should be managed.
  // This usually means revoking it (setting to 'None') or transferring to a secure multi-sig.
  // This step is CRITICAL for production deployments.
  console.log('--------------------------------------------------------------------');
  console.log('IMPORTANT: Program Upgrade Authority Management');
  console.log('--------------------------------------------------------------------');
  console.log(
    "After deployment and stabilization, the program's upgrade authority MUST be managed."
  );
  console.log('This typically involves revoking it or transferring it to a secure multi-sig.');
  console.log(
    'This script does NOT automate this step. It must be done manually or via a separate secure script.'
  );
  console.log(
    'Example Solana CLI command to set authority to none (replace <PROGRAM_ID> and <CURRENT_AUTHORITY_KEYPAIR>):'
  );
  console.log(
    '  solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority None --authority <CURRENT_AUTHORITY_KEYPAIR>'
  );
  console.log('Ensure you understand the implications before executing this command.');
  console.log('--------------------------------------------------------------------');

  // Example using web3.js (conceptual - requires BpfLoaderUpgradeable program interaction)
  // This is a complex operation and should be handled with extreme care.
  /*
  async function revokeUpgradeAuthority(
    connection: anchor.web3.Connection,
    programId: PublicKey,
    currentUpgradeAuthorityKeypair: anchor.web3.Keypair // The keypair that currently holds upgrade authority
  ) {
    const tx = new Transaction().add(
      BpfLoaderUpgradeable.setAuthority({
        programAddress: programId, // Address of the program to change authority for
        currentAuthority: currentUpgradeAuthorityKeypair.publicKey,
        newAuthority: null, // Set to null to make it immutable (no more upgrades)
      })
    );
    try {
      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [currentUpgradeAuthorityKeypair] // Sign with the current authority
      );
      console.log(`Program upgrade authority revoked. Transaction: ${signature}`);
    } catch (err) {
      console.error("Failed to revoke program upgrade authority:", err);
      console.error("This is a critical step. Ensure it's completed if intended.");
    }
  }
  // To call this, you would need the programId and the keypair for the current upgrade authority.
  // By default, after `anchor deploy`, the upgrade authority is often the wallet used for deployment.
  // await revokeUpgradeAuthority(program.provider.connection, program.programId, adminWallet.payer);
  */

  console.log('Migration script finished.');
};
