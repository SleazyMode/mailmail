import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";

import { config } from "./config.js";
import type { AnchorBatch } from "./types.js";

const memoInstructionData = (payload: string): Buffer => Buffer.from(payload, "utf8");

const loadKeypair = (): Keypair => {
  if (!config.solanaKeypairPath) {
    throw new Error("SOLANA_KEYPAIR_PATH is not configured");
  }

  const secretKey = JSON.parse(readFileSync(config.solanaKeypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
};

export const buildAnchorMemo = (batch: AnchorBatch): string =>
  JSON.stringify({
    v: batch.version,
    tenant: batch.tenantId,
    batch: batch.batchId,
    root: batch.root,
    count: batch.count,
    previousRoot: batch.previousRoot
  });

export const anchorBatchToSolana = async (batch: AnchorBatch): Promise<string> => {
  const signer = loadKeypair();
  const connection = new Connection(config.solanaRpcUrl, config.solanaCommitment);
  const memoProgramId = new PublicKey(config.solanaMemoProgramId);

  const transaction = new Transaction().add({
    keys: [],
    programId: memoProgramId,
    data: memoInstructionData(buildAnchorMemo(batch))
  });

  transaction.feePayer = signer.publicKey;
  const signature = await sendAndConfirmTransaction(connection, transaction, [signer]);
  return signature;
};

export const estimateLamportsPerAnchor = async (): Promise<number> => {
  const signer = loadKeypair();
  const connection = new Connection(config.solanaRpcUrl, config.solanaCommitment);
  const latestBlockhash = await connection.getLatestBlockhash();

  const probe = new Transaction({
    feePayer: signer.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }).add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: signer.publicKey,
      lamports: 1
    })
  );

  return connection.getFeeForMessage(probe.compileMessage()).then((result) => result.value ?? 0);
};
