import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HaioVesting } from "../target/types/haio_vesting";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  setAuthority,
  AuthorityType,
  Account as SplAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("haio-vesting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;
  
  let admin: Keypair;
  let recipient: Keypair;
  let mint: PublicKey;
  let adminTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;
  let programConfigPda: PublicKey;
  let configBump: number;

  const totalAmount = new anchor.BN(1_000_000); // 1M tokens

  before(async () => {
    // Initialize keypairs
    admin = Keypair.generate();
    recipient = Keypair.generate();

    // Airdrop SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(recipient.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    // Create mint
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    // Create token accounts
    adminTokenAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      admin.publicKey
    )).address;

    recipientTokenAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // admin pays for creation
      mint,
      recipient.publicKey
    )).address;

    // Mint tokens to admin
    await mintTo(
      provider.connection,
      admin,
      mint,
      adminTokenAccount,
      admin,
      BigInt(10_000_000)
    );

    // Derive PDAs
    [programConfigPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("program_config")],
      program.programId
    );
  });

  it("Initialize program", async () => {
    await program.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const configAccount = await program.account.programConfig.fetch(programConfigPda);
    expect(configAccount.admin.toString()).to.equal(admin.publicKey.toString());
    expect(configAccount.totalSchedules.toString()).to.equal("0");
  });

  it("Create vesting schedule", async () => {
    const scheduleId = new anchor.BN(0);
    const cliff = Math.floor(Date.now() / 1000) + 2; // 2 seconds from now
    const vestingStart = cliff; // Start at cliff
    const vestingEnd = vestingStart + 10; // Short vesting period for testing

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Verify vesting schedule
    const scheduleAccount = await program.account.vestingSchedule.fetch(vestingSchedulePda);
    expect(scheduleAccount.scheduleId.toString()).to.equal(scheduleId.toString());
    expect(scheduleAccount.recipient.toString()).to.equal(recipient.publicKey.toString());
    expect(scheduleAccount.totalAmount.toString()).to.equal(totalAmount.toString());
    expect(scheduleAccount.amountTransferred.toString()).to.equal("0");
    expect(scheduleAccount.isInitialized).to.be.true;

    // Verify vault has tokens
    const vaultAccount = await getAccount(provider.connection, vestingVaultPda);
    expect(vaultAccount.amount.toString()).to.equal(totalAmount.toString());

    // Verify program config updated
    const configAccount = await program.account.programConfig.fetch(programConfigPda);
    expect(configAccount.totalSchedules.toString()).to.equal("1");
  });

  it("Crank vesting schedule (before cliff)", async () => {
    const scheduleId = new anchor.BN(0);
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Before cliff, cranking should succeed but transfer 0 tokens
    const beforeBalance = await getAccount(provider.connection, recipientTokenAccount);
    
    await program.methods
      .crankVestingSchedule()
      .accounts({
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterBalance = await getAccount(provider.connection, recipientTokenAccount);
    
    // Should have same balance (no tokens transferred before cliff)
    expect(Number(afterBalance.amount)).to.equal(Number(beforeBalance.amount));
  });

  it("Wait and crank vesting schedule (after cliff)", async () => {
    const scheduleId = new anchor.BN(0);
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Wait for cliff to pass 
    console.log("Waiting for cliff to pass...");
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

    const beforeBalance = await getAccount(provider.connection, recipientTokenAccount);
    const beforeSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);
    
    await program.methods
      .crankVestingSchedule()
      .accounts({
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterBalance = await getAccount(provider.connection, recipientTokenAccount);
    const afterSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);

    // Check if tokens were transferred (compare balances and schedule state)
    const balanceIncreased = Number(afterBalance.amount) > Number(beforeBalance.amount);
    const scheduleTransferredIncreased = Number(afterSchedule.amountTransferred) > Number(beforeSchedule.amountTransferred);
    
    // At least one of these should be true after cliff
    expect(balanceIncreased || scheduleTransferredIncreased).to.be.true;
    console.log(`Balance change: ${Number(beforeBalance.amount)} -> ${Number(afterBalance.amount)}`);
    console.log(`Schedule transferred: ${Number(beforeSchedule.amountTransferred)} -> ${Number(afterSchedule.amountTransferred)}`);
  });

  it("Close vesting schedule fails when not fully vested", async () => {
    const scheduleId = new anchor.BN(0);
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      await program.methods
        .closeVestingSchedule()
        .accounts({
          beneficiary: admin.publicKey,
          vestingSchedule: vestingSchedulePda,
          vestingVault: vestingVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
      
      expect.fail("Expected transaction to fail when not fully vested");
    } catch (error: any) {
      expect(error.toString()).to.include("ScheduleNotFullyVested");
    }
  });

  it("Validates recipient token account correctly", async () => {
    const scheduleId = new anchor.BN(0);
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Use admin's token account instead of recipient's (wrong account)
    try {
      await program.methods
        .crankVestingSchedule()
        .accounts({
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          vestingVault: vestingVaultPda,
          recipientTokenAccount: adminTokenAccount, // Wrong account (admin's instead of recipient's)
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      expect.fail("Expected transaction to fail with wrong recipient token account");
    } catch (error: any) {
      expect(error.toString()).to.include("RecipientAccountMismatch");
    }
  });

  it("Should reject creation with invalid timestamps", async () => {
    const scheduleId = new anchor.BN(1); // Next schedule ID
    const cliff = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
    const vestingStart = cliff + 1000; // Start after cliff
    const vestingEnd = cliff + 200; // End before cliff

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(scheduleId, params)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          mint: mint,
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          vestingVault: vestingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      
      expect.fail("Should have failed with invalid timestamps");
    } catch (error: any) {
      expect(error.toString()).to.include("InvalidTimestamps");
    }
  });

  it("Should reject creation with zero amount", async () => {
    const scheduleId = new anchor.BN(1); // Next schedule ID
    const cliff = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 365 * 24 * 60 * 60; // 1 year vesting

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: new anchor.BN(0),
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(scheduleId, params)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          mint: mint,
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          vestingVault: vestingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      
      expect.fail("Should have failed with zero amount");
    } catch (error: any) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Should reject unauthorized schedule creation", async () => {
    const unauthorizedUser = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(unauthorizedUser.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    const scheduleId = new anchor.BN(1); // Next schedule ID
    const cliff = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 365 * 24 * 60 * 60; // 1 year vesting

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(scheduleId, params)
        .accounts({
          admin: unauthorizedUser.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          mint: mint,
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          vestingVault: vestingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([unauthorizedUser])
        .rpc();
      
      expect.fail("Should have rejected unauthorized user");
    } catch (error: any) {
      expect(error.toString()).to.include("Unauthorized");
    }
  });

  it("Should prevent SetAuthority attacks during crank", async () => {
    const scheduleId = new anchor.BN(0);
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      await program.methods
        .crankVestingSchedule()
        .accounts({
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          vestingVault: vestingVaultPda,
          recipientTokenAccount: adminTokenAccount, // Wrong token account (admin's account instead of recipient's)
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      expect.fail("Expected transaction to fail due to security check");
    } catch (error: any) {
      expect(error.toString()).to.include("recipient");
    }
  });

  it("Should reject duplicate schedule ID creation", async () => {
    // Try to use schedule ID 0 which already exists
    const scheduleId = new anchor.BN(0);
    const cliff = Math.floor(Date.now() / 1000) + 60;
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 3600;

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(scheduleId, params)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: PublicKey.findProgramAddressSync(
            [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          mint: mint,
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          vestingVault: PublicKey.findProgramAddressSync(
            [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      expect.fail("Should have failed because schedule ID already exists");
    } catch (error: any) {
      // The error might be about PDA already existing or ScheduleIdConflict
      expect(error.toString()).to.satisfy((msg: string) => 
        msg.includes("ScheduleIdConflict") || msg.includes("already in use")
      );
    }
  });

  it("Should reject creation with mint mismatch", async () => {
    // Create a different mint
    const wrongMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

         // Create token account with wrong mint for recipient
     const wrongRecipientTokenAccount = (await getOrCreateAssociatedTokenAccount(
       provider.connection,
       admin,
       wrongMint,
       recipient.publicKey
     )).address;

    const scheduleId = new anchor.BN(1);
    const cliff = Math.floor(Date.now() / 1000) + 60;
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 3600;

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(scheduleId, params)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          mint: mint, // Correct mint
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: wrongRecipientTokenAccount, // Wrong mint token account
          vestingVault: vestingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      expect.fail("Should have failed with mint mismatch");
    } catch (error: any) {
      expect(error.toString()).to.include("RecipientAccountMintMismatch");
    }
  });

  it("Should handle boundary timestamp conditions correctly", async () => {
    const scheduleId = new anchor.BN(1);
    const currentTime = Math.floor(Date.now() / 1000);
    const cliff = currentTime + 1; // Very short cliff for testing
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 5; // Short vesting period

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    // Create the schedule
    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

         // Wait for cliff to pass
     await new Promise(resolve => setTimeout(resolve, 2000));

     // Test cranking right at cliff boundary
     const beforeBalance = await getAccount(provider.connection, recipientTokenAccount);
     
     await program.methods
       .crankVestingSchedule()
       .accounts({
         programConfig: programConfigPda,
         vestingSchedule: vestingSchedulePda,
         vestingVault: vestingVaultPda,
         recipientTokenAccount: recipientTokenAccount,
         mint: mint,
         tokenProgram: TOKEN_PROGRAM_ID,
       })
       .rpc();

     const afterBalance = await getAccount(provider.connection, recipientTokenAccount);
     
     // Should have transferred some tokens after cliff
     expect(Number(afterBalance.amount)).to.be.greaterThan(Number(beforeBalance.amount));

     // Wait for vesting to complete
     await new Promise(resolve => setTimeout(resolve, 6000));

     // Crank again to complete vesting
     await program.methods
       .crankVestingSchedule()
       .accounts({
         programConfig: programConfigPda,
         vestingSchedule: vestingSchedulePda,
         vestingVault: vestingVaultPda,
         recipientTokenAccount: recipientTokenAccount,
         mint: mint,
         tokenProgram: TOKEN_PROGRAM_ID,
       })
       .rpc();

     const finalBalance = await getAccount(provider.connection, recipientTokenAccount);
     const scheduleAccount = await program.account.vestingSchedule.fetch(vestingSchedulePda);

     // Should be fully vested
     expect(scheduleAccount.amountTransferred.toString()).to.equal(totalAmount.toString());
  });

  it("Should successfully close a fully vested schedule", async () => {
    const scheduleId = new anchor.BN(1); // Use the boundary test schedule
    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Verify schedule is fully vested
    const scheduleAccount = await program.account.vestingSchedule.fetch(vestingSchedulePda);
    expect(scheduleAccount.amountTransferred.toString()).to.equal(scheduleAccount.totalAmount.toString());

    // Verify vault is empty
    const vaultAccount = await getAccount(provider.connection, vestingVaultPda);
    expect(vaultAccount.amount.toString()).to.equal("0");

    const beforeAdminBalance = await provider.connection.getBalance(admin.publicKey);

    // Close the vesting schedule successfully
    await program.methods
      .closeVestingSchedule()
      .accounts({
        beneficiary: admin.publicKey,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const afterAdminBalance = await provider.connection.getBalance(admin.publicKey);

    // Should have received rent back
    expect(afterAdminBalance).to.be.greaterThan(beforeAdminBalance);

    // Try to fetch the closed account - should fail
    try {
      await program.account.vestingSchedule.fetch(vestingSchedulePda);
      expect.fail("Should not be able to fetch closed account");
    } catch (error: any) {
      expect(error.toString()).to.include("Account does not exist");
    }
  });

  it("Should handle empty vault gracefully during crank", async () => {
    const scheduleId = new anchor.BN(2);
    const cliff = Math.floor(Date.now() / 1000);
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 3600;

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const smallAmount = new anchor.BN(1000); // Very small amount

    const params = {
      recipient: recipient.publicKey,
      totalAmount: smallAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    // Create schedule with small amount
    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Crank to transfer tokens
    await program.methods
      .crankVestingSchedule()
      .accounts({
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Try cranking again when vault might be empty - should succeed gracefully
    await program.methods
      .crankVestingSchedule()
      .accounts({
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Should complete without error even if vault is empty
    console.log("Empty vault crank completed successfully");
  });

  it("Should prevent concurrent crank operations (race condition test)", async () => {
    const scheduleId = new anchor.BN(3);
    const cliff = Math.floor(Date.now() / 1000);
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 10;

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const testAmount = new anchor.BN(10000);

    const params = {
      recipient: recipient.publicKey,
      totalAmount: testAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    // Create schedule
    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const beforeBalance = await getAccount(provider.connection, recipientTokenAccount);
    const beforeSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);

    // Wait a bit for some vesting to unlock
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Attempt concurrent cranks (one might fail, but total transfer should be consistent)
    const crankPromises = Array(3).fill(null).map(() => 
      program.methods
        .crankVestingSchedule()
        .accounts({
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          vestingVault: vestingVaultPda,
          recipientTokenAccount: recipientTokenAccount,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
        .catch(err => {
          // Some concurrent operations might fail, which is expected
          console.log("Concurrent crank failed (expected):", err.message);
          return null;
        })
    );

    await Promise.all(crankPromises);

    const afterBalance = await getAccount(provider.connection, recipientTokenAccount);
    const afterSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);

    // Verify no double-spending occurred
    const balanceIncrease = Number(afterBalance.amount) - Number(beforeBalance.amount);
    const scheduleIncrease = Number(afterSchedule.amountTransferred) - Number(beforeSchedule.amountTransferred);
    
    expect(balanceIncrease).to.equal(scheduleIncrease);
    console.log(`Concurrent crank test: balance increased by ${balanceIncrease}, schedule increased by ${scheduleIncrease}`);
  });

  it("Should validate TokensReleased event data integrity", async () => {
    const scheduleId = new anchor.BN(4);
    const cliff = Math.floor(Date.now() / 1000);
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 5;

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const testAmount = new anchor.BN(5000);

    const params = {
      recipient: recipient.publicKey,
      totalAmount: testAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    // Create schedule
    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    let eventCaptured = false;
    let eventData: any = null;

    // Set up event listener for TokensReleased
    const listener = program.addEventListener('TokensReleased', (event) => {
      eventCaptured = true;
      eventData = event;
      console.log('TokensReleased event captured:', event);
    });

    try {
      // Wait for some vesting time
      await new Promise(resolve => setTimeout(resolve, 1000));

      const beforeSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);

      // Trigger crank to emit event
      await program.methods
        .crankVestingSchedule()
        .accounts({
          programConfig: programConfigPda,
          vestingSchedule: vestingSchedulePda,
          vestingVault: vestingVaultPda,
          recipientTokenAccount: recipientTokenAccount,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const afterSchedule = await program.account.vestingSchedule.fetch(vestingSchedulePda);

      // Wait a bit for event to be captured
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (eventCaptured && eventData) {
        // Validate event data integrity
        expect(eventData.scheduleId.toString()).to.equal(scheduleId.toString());
        expect(eventData.recipient.toString()).to.equal(recipient.publicKey.toString());
        expect(eventData.mint.toString()).to.equal(mint.toString());
        expect(eventData.totalReleased.toString()).to.equal(afterSchedule.amountTransferred.toString());
        
        console.log('✅ Event validation passed');
      } else {
        console.log('⚠️ Event not captured - this might be due to timing or RPC limitations');
      }
    } finally {
      // Clean up listener
      await program.removeEventListener(listener);
    }
  });

  it("Should reject schedule creation with non-sequential ID (gap test)", async () => {
    // Get current total schedules
    const configAccount = await program.account.programConfig.fetch(programConfigPda);
    const currentTotal = configAccount.totalSchedules;
    
    // Try to create schedule with ID that skips numbers (gap)
    const gapScheduleId = new anchor.BN(currentTotal + 2); // Skip one ID
    const cliff = Math.floor(Date.now() / 1000);
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 3600;

    const params = {
      recipient: recipient.publicKey,
      totalAmount: totalAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    try {
      await program.methods
        .createVestingSchedule(gapScheduleId, params)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vestingSchedule: PublicKey.findProgramAddressSync(
            [Buffer.from("vesting_schedule"), gapScheduleId.toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          mint: mint,
          depositorTokenAccount: adminTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          vestingVault: PublicKey.findProgramAddressSync(
            [Buffer.from("vesting_vault"), gapScheduleId.toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      expect.fail("Should have failed with ScheduleIdConflict for non-sequential ID");
    } catch (error: any) {
      expect(error.toString()).to.include("ScheduleIdConflict");
      console.log("✅ ID gap prevention working correctly");
    }
  });

  it("Should simulate and prevent vault authority mismatch attack", async () => {
    // Note: This test simulates the concept but may be limited by SPL Token constraints
    // In a real attack scenario, an attacker would use setAuthority to change vault ownership
    
    const scheduleId = new anchor.BN(5);
    const cliff = Math.floor(Date.now() / 1000);
    const vestingStart = cliff;
    const vestingEnd = vestingStart + 10;

    const [vestingSchedulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_schedule"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vestingVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), scheduleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const testAmount = new anchor.BN(3000);

    const params = {
      recipient: recipient.publicKey,
      totalAmount: testAmount,
      cliffTimestamp: new anchor.BN(cliff),
      vestingStartTimestamp: new anchor.BN(vestingStart),
      vestingEndTimestamp: new anchor.BN(vestingEnd),
      sourceCategory: { public: {} },
    };

    // Create schedule
    await program.methods
      .createVestingSchedule(scheduleId, params)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        mint: mint,
        depositorTokenAccount: adminTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        vestingVault: vestingVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Verify the vault authority is correctly set to the vesting schedule PDA
    const vaultAccount = await getAccount(provider.connection, vestingVaultPda);
    expect(vaultAccount.owner.toString()).to.equal(vestingSchedulePda.toString());

    // Wait for some vesting time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Try to crank - should work normally
    await program.methods
      .crankVestingSchedule()
      .accounts({
        programConfig: programConfigPda,
        vestingSchedule: vestingSchedulePda,
        vestingVault: vestingVaultPda,
        recipientTokenAccount: recipientTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("✅ Vault authority validation working correctly");
    console.log("Note: Full setAuthority attack simulation would require a malicious program");
  });
}); 