import type { Commitment } from "@solana/web3.js";

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return parsed;
};

export const config = {
  port: integer("PORT", 3000),
  databaseUrl: required("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/mail_anchor"),
  sendgridWebhookPublicKey: required("SENDGRID_WEBHOOK_PUBLIC_KEY"),
  sendgridApiKey: required("SENDGRID_API_KEY"),
  sendgridFromAddress: required("SENDGRID_FROM_ADDRESS"),
  receiptSigningSecret: required("RECEIPT_SIGNING_SECRET"),
  enableAnchorWorker: (process.env.ENABLE_ANCHOR_WORKER ?? "false") === "true",
  anchorPollIntervalMs: integer("ANCHOR_POLL_INTERVAL_MS", 15000),
  solanaRpcUrl: required("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
  solanaCommitment: (process.env.SOLANA_COMMITMENT ?? "confirmed") as Commitment,
  solanaKeypairPath: process.env.SOLANA_KEYPAIR_PATH ?? "",
  solanaMemoProgramId:
    process.env.SOLANA_MEMO_PROGRAM_ID ??
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  anchorBatchSize: integer("ANCHOR_BATCH_SIZE", 100)
} as const;
