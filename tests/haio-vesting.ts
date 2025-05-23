// tests/haio-vesting.ts

import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { HaioVesting } from '../target/types/haio_vesting'; // Adjust path if needed
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  Account as SplAccount,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { expect } from 'chai';

const UNSET_PUBKEY = new PublicKey(Buffer.alloc(32));
const TEST_HUB_UPDATE_TIMELOCK_SECONDS = 5;

function findErrorCodeInLogs(
  logs: string[] | undefined,
  defaultCode: string = 'UnknownError'
): string {
  if (!logs) {
    return defaultCode;
  }
  for (const log of logs) {
    let match = log.match(/Program log: Error: AnchorError occurred. Error Code: (\w+)\./);
    if (match && match[1]) {
      return match[1];
    }
    match = log.match(/Program log: AnchorError caused by account: \w+. Error Code: (\w+)\./);
    if (match && match[1]) {
      return match[1];
    }
    match = log.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (match && match[1]) {
      const rawErrorCode = parseInt(match[1], 16);
      // VestingError enum from errors.rs (0-indexed in Rust, add 6000 for program error)
      // Unauthorized = 6000 (0x1770)
      // MathOverflow = 6001 (0x1771)
      // TimelockNotExpired = 6002 (0x1772)
      // InvalidTimestamps = 6003 (0x1773)
      // InvalidAmount = 6004 (0x1774)
      // ... and so on
      if (rawErrorCode === 0x1772) return 'TimelockNotExpired'; // 6002
      if (rawErrorCode === 0x1773) return 'InvalidTimestamps'; // 6003
      // Add other specific mappings if needed for other tests
      return `CustomError_0x${match[1]}`;
    }
  }
  // Fallback message matching
  for (const log of logs) {
    if (log.includes('Timelock for hub update has not expired')) return 'TimelockNotExpired';
    if (log.includes('Invalid timestamp: Cliff must be before or at vesting start'))
      return 'InvalidTimestamps';
    if (log.includes('Account `admin` not provided')) return 'AccountNotProvided_admin'; // Example for specific message
  }
  return defaultCode;
}

describe('haio-vesting', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.HaioVesting as Program<HaioVesting>;
  // `admin` is the wallet associated with the provider.
  // For signing transactions where `admin` is a signer, Anchor handles it automatically
  // if `admin.publicKey` is passed in `accounts` and no explicit `signers` array is given,
  // or if `admin.payer` (if `admin` is a `NodeWallet`) or `admin` itself (if `admin` is `Keypair`) is in `signers`.
  // Here, `provider.wallet` is an object that can sign, so Anchor uses it if `admin.publicKey` is the signer.
  const adminWallet = provider.wallet as anchor.Wallet; // Explicitly using adminWallet for clarity

  let mintPubkey: PublicKey;
  let adminAssociatedTokenAccount: PublicKey;
  let programConfigPDA: PublicKey;
  let fetchedProgramConfig: any;
  let distributionHubSigner: Keypair;

  const MINT_DECIMALS = 9;
  const MINT_DECIMALS_MULTIPLIER = Math.pow(10, MINT_DECIMALS);
  const INITIAL_MINT_SUPPLY = new BN(1_000_000_000).mul(new BN(MINT_DECIMALS_MULTIPLIER));

  before(async () => {
    mintPubkey = await createMint(
      provider.connection,
      adminWallet.payer, // Payer for mint creation
      adminWallet.publicKey, // Mint authority
      null,
      MINT_DECIMALS
    );
    console.log(`Test mint created: ${mintPubkey.toBase58()}`);

    const adminAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      adminWallet.payer,
      mintPubkey,
      adminWallet.publicKey
    );
    adminAssociatedTokenAccount = adminAta.address;
    console.log(`Admin ATA created: ${adminAssociatedTokenAccount.toBase58()}`);

    await mintTo(
      provider.connection,
      adminWallet.payer,
      mintPubkey,
      adminAssociatedTokenAccount,
      adminWallet.publicKey, // Mint authority
      BigInt(INITIAL_MINT_SUPPLY.toString())
    );
    const adminAtaBalance = (await getAccount(provider.connection, adminAssociatedTokenAccount))
      .amount;
    console.log(
      `Minted ${INITIAL_MINT_SUPPLY.toString()} tokens to admin ATA. Balance: ${adminAtaBalance}`
    );

    [programConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('program_config')],
      program.programId
    );
    console.log(`ProgramConfig PDA: ${programConfigPDA.toBase58()}`);

    distributionHubSigner = Keypair.generate();
    console.log(`Test Distribution Hub Signer: ${distributionHubSigner.publicKey.toBase58()}`);
  });

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Helper to get PDAs for a schedule
  async function getSchedulePDAs(scheduleIdInput: number | BN) {
    const scheduleId =
      typeof scheduleIdInput === 'number' ? new BN(scheduleIdInput) : scheduleIdInput;
    const [vestingSchedulePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('vesting_schedule'), scheduleId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    const [vestingVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('vesting_vault'), scheduleId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    return { vestingSchedulePDA, vestingVaultPDA };
  }

  // Helper to create a dummy schedule for testing
  async function createDummySchedule(
    currentScheduleId: number | BN,
    amount: number | BN,
    cliffOffsetSeconds: number = 0,
    startOffsetSeconds: number = 0,
    vestingDurationSeconds: number = 1
  ) {
    const scheduleIdBN =
      typeof currentScheduleId === 'number' ? new BN(currentScheduleId) : currentScheduleId;
    const { vestingSchedulePDA, vestingVaultPDA } = await getSchedulePDAs(scheduleIdBN);

    const currentTime = Math.floor(Date.now() / 1000);
    const cliffTime = new BN(currentTime + cliffOffsetSeconds);
    const vestingStart = new BN(currentTime + startOffsetSeconds);
    const vestingEnd = new BN(vestingStart.toNumber() + vestingDurationSeconds);
    const totalAmountBn = typeof amount === 'number' ? new BN(amount) : amount;

    // --- Fixed function call with schedule_id parameter ---
    await program.methods
      .createVestingSchedule(
        scheduleIdBN, // Add the schedule_id parameter
        {
          totalAmount: totalAmountBn,
          cliffTimestamp: cliffTime,
          vestingStartTimestamp: vestingStart,
          vestingEndTimestamp: vestingEnd,
          sourceCategory: { team: {} },
        }
      )
      .accounts({
        admin: adminWallet.publicKey, // Pass the public key of the admin
        programConfig: programConfigPDA,
        mint: mintPubkey,
        depositorTokenAccount: adminAssociatedTokenAccount,
        vestingSchedule: vestingSchedulePDA,
        vestingVault: vestingVaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
    return { vestingSchedulePDA, vestingVaultPDA, scheduleId: scheduleIdBN };
  }

  it('Initializes the program', async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          admin: adminWallet.publicKey,
          programConfig: programConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc(); // Anchor uses provider.wallet to sign if admin.publicKey matches
    } catch (e) {
      if (!e.toString().includes('already in use')) {
        // Log the actual error for debugging if it's not "already in use"
        console.error('Initialization failed with unexpected error:', JSON.stringify(e, null, 2));
        console.error('Error logs for unexpected init failure:', e.logs);
        throw e;
      }
      console.log('Program already initialized, proceeding with tests.');
    }

    fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
    expect(fetchedProgramConfig.admin.equals(adminWallet.publicKey)).to.be.true;
    expect(fetchedProgramConfig.distributionHub.equals(UNSET_PUBKEY)).to.be.true;
  });

  describe('Distribution Hub Management', () => {
    beforeEach(async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
    });

    it('Updates distribution hub - initial set (no timelock)', async () => {
      // For this test to be truly "initial set", the hub should be UNSET_PUBKEY
      // If a previous test run set it, this test might behave as an update proposal.
      // A robust setup might involve deploying a fresh ProgramConfig for this specific test block.
      const currentHubState = await program.account.programConfig.fetch(programConfigPDA);
      if (
        !currentHubState.distributionHub.equals(UNSET_PUBKEY) &&
        !currentHubState.distributionHub.equals(distributionHubSigner.publicKey)
      ) {
        console.warn(
          `Hub is already set to ${currentHubState.distributionHub.toBase58()}. This test might propose an update instead of initial set.`
        );
        // To ensure it's an initial set for testing, you might need to reset state or use a new programConfigPDA
        // For now, we proceed. If it's already set to distributionHubSigner.publicKey, it should be a no-op or specific error.
      }

      await program.methods
        .updateDistributionHub(distributionHubSigner.publicKey)
        .accounts({
          admin: adminWallet.publicKey,
          programConfig: programConfigPDA,
        })
        .rpc();

      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      expect(fetchedProgramConfig.distributionHub.equals(distributionHubSigner.publicKey)).to.be
        .true;
      expect(fetchedProgramConfig.pendingHub).to.be.null;
      expect(fetchedProgramConfig.hubUpdateTimelock).to.be.null;
    });

    it('Proposes a new distribution hub (timelock activated)', async () => {
      // Ensure current hub is distributionHubSigner.publicKey before proposing a new one
      let currentConfig = await program.account.programConfig.fetch(programConfigPDA);
      if (!currentConfig.distributionHub.equals(distributionHubSigner.publicKey)) {
        // If not, set it first (assuming it's an initial set or can be directly updated)
        await program.methods
          .updateDistributionHub(distributionHubSigner.publicKey)
          .accounts({ admin: adminWallet.publicKey, programConfig: programConfigPDA })
          .rpc();
        currentConfig = await program.account.programConfig.fetch(programConfigPDA); // refresh
        if (
          currentConfig.pendingHub &&
          currentConfig.pendingHub.equals(distributionHubSigner.publicKey)
        ) {
          // if it was proposed
          const timeToWait =
            currentConfig.hubUpdateTimelock.toNumber() - Math.floor(Date.now() / 1000) + 1;
          if (timeToWait > 0) await sleep(timeToWait * 1000);
          await program.methods
            .updateDistributionHub(distributionHubSigner.publicKey)
            .accounts({ admin: adminWallet.publicKey, programConfig: programConfigPDA })
            .rpc();
        }
      }

      const newProposedHub = Keypair.generate();
      await program.methods
        .updateDistributionHub(newProposedHub.publicKey)
        .accounts({
          admin: adminWallet.publicKey,
          programConfig: programConfigPDA,
        })
        .rpc();

      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      expect(fetchedProgramConfig.pendingHub.equals(newProposedHub.publicKey)).to.be.true;
      expect(fetchedProgramConfig.hubUpdateTimelock).to.not.be.null;
      const currentTime = Math.floor(Date.now() / 1000);
      const expectedTimelock = currentTime + TEST_HUB_UPDATE_TIMELOCK_SECONDS;
      expect(fetchedProgramConfig.hubUpdateTimelock.toNumber()).to.be.closeTo(expectedTimelock, 5); // Increased delta for CI timing
    });

    it('Fails to apply pending hub update before timelock expiry', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      if (!fetchedProgramConfig.pendingHub) {
        expect.fail('Pending hub not set for this test. Ensure "Proposes a new hub" runs first.');
      }
      try {
        await program.methods
          .updateDistributionHub(fetchedProgramConfig.pendingHub)
          .accounts({
            admin: adminWallet.publicKey,
            programConfig: programConfigPDA,
          })
          .rpc();
        expect.fail('Hub update should have failed due to timelock');
      } catch (error) {
        console.log(
          "Logs for 'Fails to apply pending hub update':",
          JSON.stringify(error.logs, null, 2)
        );
        const errorCode = findErrorCodeInLogs(error.logs);
        expect(errorCode).to.equal('TimelockNotExpired');
      }
    });

    it('Applies pending hub update after timelock expiry (simulated with sleep)', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      if (!fetchedProgramConfig.pendingHub || !fetchedProgramConfig.hubUpdateTimelock) {
        expect.fail('Pending hub or timelock not set. Ensure "Proposes a new hub" runs first.');
      }

      const hubToConfirm = fetchedProgramConfig.pendingHub;
      const timelockExpiryTimestamp = fetchedProgramConfig.hubUpdateTimelock.toNumber();
      const currentTimeSeconds = Math.floor(Date.now() / 1000);

      const expectedMaxTestTimelockDuration = TEST_HUB_UPDATE_TIMELOCK_SECONDS + 60;
      if (timelockExpiryTimestamp > currentTimeSeconds + expectedMaxTestTimelockDuration) {
        console.warn(
          `WARNING: Program's hubUpdateTimelock (${new Date(timelockExpiryTimestamp * 1000).toISOString()}) seems too long.`
        );
      }

      let timeToWaitSeconds = timelockExpiryTimestamp - currentTimeSeconds;
      if (timeToWaitSeconds < 0) timeToWaitSeconds = 0;
      else timeToWaitSeconds += 1;

      if (timeToWaitSeconds > 0) {
        console.log(
          `Waiting for ${timeToWaitSeconds} seconds for timelock to expire (Program timelock expiry: ${new Date(timelockExpiryTimestamp * 1000).toISOString()}).`
        );
        await sleep(timeToWaitSeconds * 1000);
      } else {
        console.log('Timelock already expired or very close. Proceeding to apply update.');
      }

      await program.methods
        .updateDistributionHub(hubToConfirm)
        .accounts({
          admin: adminWallet.publicKey,
          programConfig: programConfigPDA,
        })
        .rpc();

      const updatedConfig = await program.account.programConfig.fetch(programConfigPDA);
      expect(updatedConfig.distributionHub.equals(hubToConfirm)).to.be.true;
      expect(updatedConfig.pendingHub).to.be.null;
      expect(updatedConfig.hubUpdateTimelock).to.be.null;
    });
  });

  describe('Vesting Schedules & Cranking', () => {
    let hubAssociatedTokenAccount: PublicKey;

    before(async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      if (!fetchedProgramConfig.distributionHub.equals(distributionHubSigner.publicKey)) {
        console.log('Setting up main test distribution hub for vesting/cranking tests...');
        // This sequence attempts to set or confirm the hub.
        // It assumes that if a pending hub exists, it's the one we want or we can overwrite.
        // This might need more robust handling if tests are run in arbitrary order or state persists unexpectedly.
        try {
          await program.methods
            .updateDistributionHub(distributionHubSigner.publicKey)
            .accounts({ admin: adminWallet.publicKey, programConfig: programConfigPDA })
            .rpc();
        } catch (e) {
          /* ignore if it fails, e.g. trying to set same active hub */
        }

        fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
        if (
          fetchedProgramConfig.pendingHub &&
          fetchedProgramConfig.pendingHub.equals(distributionHubSigner.publicKey)
        ) {
          const timeToWait =
            fetchedProgramConfig.hubUpdateTimelock.toNumber() - Math.floor(Date.now() / 1000) + 1;
          if (timeToWait > 0) {
            console.log(`Waiting ${timeToWait}s to confirm main test hub...`);
            await sleep(timeToWait * 1000);
          }
          await program.methods
            .updateDistributionHub(distributionHubSigner.publicKey)
            .accounts({ admin: adminWallet.publicKey, programConfig: programConfigPDA })
            .rpc();
        } else if (!fetchedProgramConfig.distributionHub.equals(distributionHubSigner.publicKey)) {
          // If after all attempts, it's still not set, then fail the setup.
          expect.fail(
            `Failed to set distributionHub to ${distributionHubSigner.publicKey} for tests. Current: ${fetchedProgramConfig.distributionHub.toBase58()}`
          );
        }
      }
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      expect(
        fetchedProgramConfig.distributionHub.equals(distributionHubSigner.publicKey),
        'Main test hub not active for vesting tests'
      ).to.be.true;

      const hubAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        adminWallet.payer,
        mintPubkey,
        distributionHubSigner.publicKey
      );
      hubAssociatedTokenAccount = hubAta.address;
    });

    it('Fails to create schedule with invalid timestamps', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      const nextScheduleId = fetchedProgramConfig.totalSchedules; // This is a BN
      const { vestingSchedulePDA, vestingVaultPDA } = await getSchedulePDAs(nextScheduleId);
      const currentTime = Math.floor(Date.now() / 1000);
      try {
        await program.methods
          .createVestingSchedule(
            nextScheduleId, // Add the schedule_id parameter
            {
              totalAmount: new BN(100 * MINT_DECIMALS_MULTIPLIER),
              cliffTimestamp: new BN(currentTime + 120),
              vestingStartTimestamp: new BN(currentTime + 60), // Start before cliff
              vestingEndTimestamp: new BN(currentTime + 180),
              sourceCategory: { seed: {} },
            }
          )
          .accounts({
            admin: adminWallet.publicKey,
            programConfig: programConfigPDA,
            mint: mintPubkey,
            depositorTokenAccount: adminAssociatedTokenAccount,
            vestingSchedule: vestingSchedulePDA,
            vestingVault: vestingVaultPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail('Schedule creation should have failed due to invalid timestamps');
      } catch (error) {
        console.log(
          "Logs for 'Fails to create schedule with invalid timestamps':",
          JSON.stringify(error.logs, null, 2)
        );
        const errorCode = findErrorCodeInLogs(error.logs);
        expect(errorCode).to.equal('InvalidTimestamps');
      }
    });

    it('Creates a vesting schedule successfully', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      const initialTotalSchedules = fetchedProgramConfig.totalSchedules; // This is a BN
      const scheduleAmount = new BN(500 * MINT_DECIMALS_MULTIPLIER);

      const { vestingSchedulePDA, vestingVaultPDA } = await createDummySchedule(
        initialTotalSchedules, // Pass BN directly
        scheduleAmount,
        60,
        60,
        3600
      );

      // fetchedProgramConfig is updated inside createDummySchedule
      const newTotalSchedules = fetchedProgramConfig.totalSchedules;
      expect(newTotalSchedules.eq(initialTotalSchedules.add(new BN(1)))).to.be.true;

      const scheduleData = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      expect(scheduleData.scheduleId.eq(initialTotalSchedules)).to.be.true;
      expect(scheduleData.totalAmount.eq(scheduleAmount)).to.be.true;
      // ... other assertions
    });

    it('Cranks a fully vested schedule, ensuring vault empty and schedule updated', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      const scheduleIdToCrank = fetchedProgramConfig.totalSchedules; // BN
      const totalVestingAmount = new BN(1000 * MINT_DECIMALS_MULTIPLIER);

      const { vestingSchedulePDA, vestingVaultPDA } = await createDummySchedule(
        scheduleIdToCrank,
        totalVestingAmount,
        0,
        0,
        1 // Vests very quickly
      );
      await sleep(2000);

      const initialHubBalance = (await getAccount(provider.connection, hubAssociatedTokenAccount))
        .amount;
      // ... rest of the crank test ...
      const setComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

      await program.methods
        .crankVestingSchedules(1)
        .accounts({
          programConfig: programConfigPDA,
          distributionHubTokenAccount: hubAssociatedTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: vestingSchedulePDA, isWritable: true, isSigner: false },
          { pubkey: vestingVaultPDA, isWritable: true, isSigner: false },
        ])
        .preInstructions([setComputeUnits, addPriorityFee])
        .rpc();

      const finalScheduleState = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      const finalVaultBalance = (await getAccount(provider.connection, vestingVaultPDA)).amount;
      const finalHubBalance = (await getAccount(provider.connection, hubAssociatedTokenAccount))
        .amount;

      expect(finalScheduleState.amountTransferred.eq(totalVestingAmount)).to.be.true;
      expect(finalVaultBalance.toString()).to.equal('0');
      expect((finalHubBalance - initialHubBalance).toString()).to.equal(
        totalVestingAmount.toString()
      );
    });

    it('Fails to crank if hub token account owner mismatches program_config.distribution_hub', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      const scheduleId = fetchedProgramConfig.totalSchedules; // BN
      const { vestingSchedulePDA, vestingVaultPDA } = await createDummySchedule(
        scheduleId,
        new BN(100 * MINT_DECIMALS_MULTIPLIER),
        0,
        0,
        1
      );
      await sleep(2000);

      const otherUser = Keypair.generate();
      const wrongOwnerHubAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        adminWallet.payer,
        mintPubkey,
        otherUser.publicKey // ATA owned by someone else
      );

      try {
        await program.methods
          .crankVestingSchedules(1)
          .accounts({
            programConfig: programConfigPDA,
            distributionHubTokenAccount: wrongOwnerHubAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([
            { pubkey: vestingSchedulePDA, isWritable: true, isSigner: false },
            { pubkey: vestingVaultPDA, isWritable: true, isSigner: false },
          ])
          .rpc();
        expect.fail('Crank should have failed due to hub ATA owner mismatch');
      } catch (error) {
        console.log(
          "Logs for 'Fails to crank if hub owner mismatches':",
          JSON.stringify(error.logs, null, 2)
        );
        const errorCode = findErrorCodeInLogs(error.logs);
        expect(errorCode).to.equal('HubAccountOwnerMismatch');
      }
    });

    it('Handles two separate crank transactions for the same schedule gracefully', async () => {
      fetchedProgramConfig = await program.account.programConfig.fetch(programConfigPDA);
      const scheduleId = fetchedProgramConfig.totalSchedules; // BN
      const amount = new BN(150 * MINT_DECIMALS_MULTIPLIER);
      const { vestingSchedulePDA, vestingVaultPDA } = await createDummySchedule(
        scheduleId,
        amount,
        0,
        0,
        1
      );
      await sleep(2000);

      const hubAtaAddr = hubAssociatedTokenAccount;
      const initialHubBalance = (await getAccount(provider.connection, hubAtaAddr)).amount;

      // First crank
      await program.methods
        .crankVestingSchedules(1)
        .accounts({
          programConfig: programConfigPDA,
          distributionHubTokenAccount: hubAtaAddr,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: vestingSchedulePDA, isWritable: true, isSigner: false },
          { pubkey: vestingVaultPDA, isWritable: true, isSigner: false },
        ])
        .rpc();

      let scheduleState = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
      expect(scheduleState.amountTransferred.eq(amount)).to.be.true;
      let currentHubBalance = (await getAccount(provider.connection, hubAtaAddr)).amount;
      expect((currentHubBalance - initialHubBalance).toString()).to.equal(amount.toString());

      // Second crank
      try {
        await program.methods
          .crankVestingSchedules(1)
          .accounts({
            programConfig: programConfigPDA,
            distributionHubTokenAccount: hubAtaAddr,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([
            { pubkey: vestingSchedulePDA, isWritable: true, isSigner: false },
            { pubkey: vestingVaultPDA, isWritable: true, isSigner: false },
          ])
          .rpc();

        const finalScheduleState = await program.account.vestingSchedule.fetch(vestingSchedulePDA);
        expect(finalScheduleState.amountTransferred.eq(amount)).to.be.true;
        const finalHubBalance = (await getAccount(provider.connection, hubAtaAddr)).amount;
        expect(finalHubBalance.toString()).to.equal(currentHubBalance.toString());
      } catch (error) {
        console.log(
          "Logs for 'Handles two separate crank transactions':",
          JSON.stringify(error.logs, null, 2)
        );
        const errorCode = findErrorCodeInLogs(error.logs);
        expect(errorCode).to.be.oneOf(['NoTransferableAmount', 'ScheduleFullyProcessed']);
      }
    });
  });
});
