import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IntentBridgeSolana } from "../target/types/intent_bridge_solana";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("intent-bridge-solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .IntentBridgeSolana as Program<IntentBridgeSolana>;

  // Helper: random bytes32 intent_id
  function randomIntentId(): number[] {
    return Array.from(crypto.randomBytes(32));
  }

  // Helper: derive PDA
  function findConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  }

  function findIntentPda(intentId: number[]): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("intent"), Buffer.from(intentId)],
      program.programId
    );
  }

  function findReceivedPda(emitterChain: number, sequence: bigint): [PublicKey, number] {
    const chainBuf = Buffer.alloc(2);
    chainBuf.writeUInt16LE(emitterChain);
    const seqBuf = Buffer.alloc(8);
    seqBuf.writeBigUInt64LE(sequence);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("received"), chainBuf, seqBuf],
      program.programId
    );
  }

  // ─── Test 1: Initialize ───────────────────────────────────────────────────
  it("initializes config PDA with correct owner", async () => {
    const [configPda] = findConfigPda();

    try {
      await program.methods
        .initialize()
        .accounts({
          owner: provider.wallet.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      // Sudah diinit sebelumnya — OK
      if (!e.message.includes("already in use")) throw e;
    }

    const config = await program.account.config.fetch(configPda);
    expect(config.owner.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
  });

  // ─── Test 2: Register Emitter ─────────────────────────────────────────────
  it("registers foreign emitter", async () => {
    const [configPda] = findConfigPda();
    const chain = 2; // Ethereum/EVM
    const address = Array.from(crypto.randomBytes(32));

    const [emitterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("foreign_emitter"), Buffer.from(new Uint16Array([chain]).buffer)],
      program.programId
    );

    await program.methods
      .registerEmitter(chain, address)
      .accounts({
        owner: provider.wallet.publicKey,
        config: configPda,
        foreignEmitter: emitterPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const emitter = await program.account.foreignEmitter.fetch(emitterPda);
    expect(emitter.chain).to.equal(chain);
    expect(Array.from(emitter.address)).to.deep.equal(address);
  });

  // ─── Test 3: Create Intent ────────────────────────────────────────────────
  it("creates intent and locks SOL", async () => {
    const intentId = randomIntentId();
    const [intentPda] = findIntentPda(intentId);
    const recipient = Array.from(crypto.randomBytes(32));
    const startPrice = new anchor.BN(1_000_000); // 0.001 SOL
    const floorPrice = new anchor.BN(500_000);   // 0.0005 SOL
    const durationSeconds = new anchor.BN(3600); // 1 jam

    const payment = Keypair.generate();
    // Airdrop lamports ke payment account
    const sig = await provider.connection.requestAirdrop(
      payment.publicKey,
      0.01 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    await program.methods
      .createIntent(
        intentId,
        recipient,
        2, // destination_chain = EVM
        startPrice,
        floorPrice,
        durationSeconds
      )
      .accounts({
        creator: provider.wallet.publicKey,
        payment: payment.publicKey,
        intent: intentPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const intent = await program.account.intent.fetch(intentPda);
    expect(intent.status).to.equal(0); // STATUS_OPEN
    expect(intent.destinationChain).to.equal(2);
    expect(Array.from(intent.recipient)).to.deep.equal(recipient);
    expect(intent.startPrice.toNumber()).to.equal(startPrice.toNumber());
    expect(intent.floorPrice.toNumber()).to.equal(floorPrice.toNumber());
  });

  // ─── Test 4: Cancel Intent ────────────────────────────────────────────────
  it("cancels intent and returns SOL to creator", async () => {
    const intentId = randomIntentId();
    const [intentPda] = findIntentPda(intentId);

    // Create intent first
    const payment = Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(
      payment.publicKey,
      0.01 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    await program.methods
      .createIntent(
        intentId,
        Array.from(crypto.randomBytes(32)),
        2,
        new anchor.BN(500_000),
        new anchor.BN(100_000),
        new anchor.BN(3600)
      )
      .accounts({
        creator: provider.wallet.publicKey,
        payment: payment.publicKey,
        intent: intentPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const balanceBefore = await provider.connection.getBalance(
      provider.wallet.publicKey
    );

    await program.methods
      .cancelIntent()
      .accounts({
        creator: provider.wallet.publicKey,
        intent: intentPda,
      })
      .rpc();

    const intent = await program.account.intent.fetch(intentPda);
    expect(intent.status).to.equal(2); // STATUS_CANCELLED

    const balanceAfter = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
  });

  // ─── Test 5: Cancel oleh non-creator harus gagal ─────────────────────────
  it("rejects cancel from non-creator", async () => {
    const intentId = randomIntentId();
    const [intentPda] = findIntentPda(intentId);

    const payment = Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(
      payment.publicKey,
      0.01 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    await program.methods
      .createIntent(
        intentId,
        Array.from(crypto.randomBytes(32)),
        2,
        new anchor.BN(500_000),
        new anchor.BN(100_000),
        new anchor.BN(3600)
      )
      .accounts({
        creator: provider.wallet.publicKey,
        payment: payment.publicKey,
        intent: intentPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stranger = Keypair.generate();
    const strangerAirdrop = await provider.connection.requestAirdrop(
      stranger.publicKey,
      0.01 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(strangerAirdrop);

    try {
      await program.methods
        .cancelIntent()
        .accounts({
          creator: stranger.publicKey,
          intent: intentPda,
        })
        .signers([stranger])
        .rpc();
      expect.fail("Seharusnya gagal — non-creator tidak boleh cancel");
    } catch (e: any) {
      expect(e.message).to.include("NotCreator");
    }
  });

  // ─── Test 6: Replay protection claim_with_vaa ─────────────────────────────
  // NOTE: Test ini memerlukan mock Wormhole atau solana-test-validator dengan
  // mock posted VAA account. Untuk saat ini didokumentasikan sebagai stub.
  //
  // Opsi implementasi:
  // A. LiteSVM dengan mock Wormhole .so (seperti solana-intent-staking)
  // B. solana-test-validator + script setup posted_vaa account manual
  // C. Buat mock program yang meng-expose posted_vaa account langsung
  //
  it.skip("rejects replay attack on claim_with_vaa (requires mock Wormhole)", async () => {
    // TODO: implement setelah mock Wormhole setup tersedia
    // Flow:
    // 1. Create intent
    // 2. Build mock posted_vaa account dengan sequence tertentu
    // 3. claim_with_vaa sukses → Received PDA terbentuk
    // 4. claim_with_vaa lagi dengan VAA sama → harus gagal ("already in use")
  });

  // ─── Test 7: Intent expired harus ditolak ────────────────────────────────
  it.skip("rejects claim on expired intent (requires time manipulation)", async () => {
    // TODO: implement dengan clock override di LiteSVM atau bankrun
    // Flow:
    // 1. Create intent dengan duration_seconds = 1
    // 2. Tunggu 2 detik
    // 3. claim_with_vaa → harus gagal dengan error "Expired"
  });
});
