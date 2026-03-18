CREATE TABLE IF NOT EXISTS messages (
  internal_message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  recipient_addresses JSONB NOT NULL,
  subject TEXT NOT NULL,
  mime_base64 TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'sendgrid',
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  internal_message_id TEXT NOT NULL REFERENCES messages(internal_message_id) ON DELETE CASCADE,
  sg_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  raw_payload TEXT NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_timestamp TEXT,
  signature_verified BOOLEAN NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_sg_event_id_idx
  ON webhook_events (sg_event_id)
  WHERE sg_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS receipts (
  internal_message_id TEXT PRIMARY KEY REFERENCES messages(internal_message_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  anchored_batch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS receipts_tenant_created_idx
  ON receipts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS anchor_batches (
  batch_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  root TEXT NOT NULL,
  receipt_hashes JSONB NOT NULL,
  count INTEGER NOT NULL,
  previous_root TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  solana_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
