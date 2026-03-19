import { buildMerkleProof, computeMerkleRoot } from "./merkle.js";
import { pool } from "./db.js";
import type {
  AnchorBatch,
  AnchorBatchRecord,
  CanonicalMessage,
  DashboardMessage,
  EvidenceReceipt,
  SendGridEvent
} from "./types.js";

export interface Repository {
  saveMessage(message: CanonicalMessage): Promise<void>;
  setProviderMessageId(internalMessageId: string, providerMessageId: string | undefined): Promise<void>;
  getMessage(internalMessageId: string): Promise<CanonicalMessage | undefined>;
  saveWebhookEvents(
    internalMessageId: string,
    events: SendGridEvent[],
    rawPayload: string,
    signatureVerified: boolean,
    headers: Record<string, string | string[] | undefined>,
    webhookTimestamp: string | undefined
  ): Promise<void>;
  getEvents(internalMessageId: string): Promise<SendGridEvent[]>;
  getLatestReceiptHash(tenantId: string): Promise<string | undefined>;
  saveReceipt(receipt: EvidenceReceipt): Promise<void>;
  getReceiptByHash(receiptHash: string): Promise<EvidenceReceipt | undefined>;
  createBatch(tenantId: string, batchSize: number): Promise<AnchorBatch | undefined>;
  setBatchSignature(batchId: string, signature: string): Promise<void>;
  markBatchFailed(batchId: string, errorMessage: string): Promise<void>;
  retryFailedBatch(batchId: string): Promise<void>;
  getOpenBatchForTenant(tenantId: string): Promise<AnchorBatch | undefined>;
  listTenantsWithUnbatchedReceipts(): Promise<string[]>;
  claimNextPendingBatch(): Promise<(AnchorBatch & { attempts: number; lastError?: string }) | undefined>;
  listBatches(): Promise<AnchorBatchRecord[]>;
  getReceiptByMessageId(internalMessageId: string): Promise<EvidenceReceipt | undefined>;
  findBatchForReceipt(receiptHash: string): Promise<
    | {
        batch: AnchorBatch;
        proof: string[];
        leafIndex: number;
        solanaSignature?: string;
      }
    | undefined
  >;
  getBatch(batchId: string): Promise<AnchorBatchRecord | undefined>;
  listRecentMessages(limit?: number): Promise<DashboardMessage[]>;
}

type StoredAttachment = {
  filename: string;
  base64: string;
};

const mapMessage = (row: {
  tenant_id: string;
  internal_message_id: string;
  sender_address: string;
  recipient_addresses: string[];
  subject: string;
  mime_base64: string;
  attachments: StoredAttachment[];
}): CanonicalMessage => ({
  tenantId: row.tenant_id,
  internalMessageId: row.internal_message_id,
  senderAddress: row.sender_address,
  recipientAddresses: row.recipient_addresses,
  subject: row.subject,
  mimeBytes: Buffer.from(row.mime_base64, "base64"),
  attachments: row.attachments.map((attachment) => ({
    filename: attachment.filename,
    bytes: Buffer.from(attachment.base64, "base64")
  }))
});

export class PgRepository {
  private mapBatch(row: {
    batch_id: string;
    tenant_id: string;
    root: string;
    receipt_hashes: string[];
    count: number;
    status: "pending" | "anchoring" | "anchored" | "failed";
    previous_root?: string | null;
  }): AnchorBatch {
    return {
      version: 1,
      tenantId: row.tenant_id,
      batchId: row.batch_id,
      root: row.root,
      receiptHashes: row.receipt_hashes,
      count: row.count,
      status: row.status,
      previousRoot: row.previous_root ?? undefined
    };
  }

  async saveMessage(message: CanonicalMessage): Promise<void> {
    await pool.query(
      `
        INSERT INTO messages (
          internal_message_id,
          tenant_id,
          sender_address,
          recipient_addresses,
          subject,
          mime_base64,
          attachments
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
        ON CONFLICT (internal_message_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          sender_address = EXCLUDED.sender_address,
          recipient_addresses = EXCLUDED.recipient_addresses,
          subject = EXCLUDED.subject,
          mime_base64 = EXCLUDED.mime_base64,
          attachments = EXCLUDED.attachments
      `,
      [
        message.internalMessageId,
        message.tenantId,
        message.senderAddress,
        JSON.stringify(message.recipientAddresses),
        message.subject,
        message.mimeBytes.toString("base64"),
        JSON.stringify(
          message.attachments.map((attachment) => ({
            filename: attachment.filename,
            base64: attachment.bytes.toString("base64")
          }))
        )
      ]
    );
  }

  async setProviderMessageId(
    internalMessageId: string,
    providerMessageId: string | undefined
  ): Promise<void> {
    await pool.query(
      `UPDATE messages SET provider_message_id = $2 WHERE internal_message_id = $1`,
      [internalMessageId, providerMessageId ?? null]
    );
  }

  async getMessage(internalMessageId: string): Promise<CanonicalMessage | undefined> {
    const result = await pool.query(
      `
        SELECT
          tenant_id,
          internal_message_id,
          sender_address,
          recipient_addresses,
          subject,
          mime_base64,
          attachments
        FROM messages
        WHERE internal_message_id = $1
      `,
      [internalMessageId]
    );

    const row = result.rows[0];
    return row ? mapMessage(row) : undefined;
  }

  async saveWebhookEvents(
    internalMessageId: string,
    events: SendGridEvent[],
    rawPayload: string,
    signatureVerified: boolean,
    headers: Record<string, string | string[] | undefined>,
    webhookTimestamp: string | undefined
  ): Promise<void> {
    for (const event of events) {
      await pool.query(
        `
          INSERT INTO webhook_events (
            internal_message_id,
            sg_event_id,
            event_type,
            payload,
            raw_payload,
            headers,
            webhook_timestamp,
            signature_verified
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8)
          ON CONFLICT (sg_event_id) DO NOTHING
        `,
        [
          internalMessageId,
          event.sg_event_id ?? null,
          event.event,
          JSON.stringify(event),
          rawPayload,
          JSON.stringify(headers),
          webhookTimestamp ?? null,
          signatureVerified
        ]
      );
    }
  }

  async getEvents(internalMessageId: string): Promise<SendGridEvent[]> {
    const result = await pool.query(
      `
        SELECT payload
        FROM webhook_events
        WHERE internal_message_id = $1
        ORDER BY received_at ASC, id ASC
      `,
      [internalMessageId]
    );

    return result.rows.map((row) => row.payload as SendGridEvent);
  }

  async getLatestReceiptHash(tenantId: string): Promise<string | undefined> {
    const result = await pool.query(
      `
        SELECT receipt_hash
        FROM receipts
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId]
    );

    return result.rows[0]?.receipt_hash as string | undefined;
  }

  async saveReceipt(receipt: EvidenceReceipt): Promise<void> {
    await pool.query(
      `
        INSERT INTO receipts (internal_message_id, tenant_id, receipt_hash, payload)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (internal_message_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          receipt_hash = EXCLUDED.receipt_hash,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `,
      [
        receipt.internalMessageId,
        receipt.tenantId,
        receipt.receiptHash,
        JSON.stringify(receipt)
      ]
    );
  }

  async getReceiptByHash(receiptHash: string): Promise<EvidenceReceipt | undefined> {
    const result = await pool.query(`SELECT payload FROM receipts WHERE receipt_hash = $1`, [receiptHash]);
    return result.rows[0]?.payload as EvidenceReceipt | undefined;
  }

  async createBatch(tenantId: string, batchSize: number): Promise<AnchorBatch | undefined> {
    const openBatch = await this.getOpenBatchForTenant(tenantId);
    if (openBatch) {
      return openBatch;
    }

    const result = await pool.query(
      `
        SELECT receipt_hash
        FROM receipts
        WHERE tenant_id = $1
          AND anchored_batch_id IS NULL
        ORDER BY created_at ASC
        LIMIT $2
      `,
      [tenantId, batchSize]
    );

    const receiptHashes = result.rows.map((row) => row.receipt_hash as string).reverse();
    if (receiptHashes.length === 0) {
      return undefined;
    }

    const previousBatch = await pool.query(
      `
        SELECT root
        FROM anchor_batches
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId]
    );

    const batch: AnchorBatch = {
      version: 1,
      tenantId,
      batchId: `${tenantId}-${Date.now()}`,
      root: computeMerkleRoot(receiptHashes),
      count: receiptHashes.length,
      status: "pending",
      previousRoot: previousBatch.rows[0]?.root as string | undefined,
      receiptHashes
    };

    await pool.query(
      `
        INSERT INTO anchor_batches (
          batch_id,
          tenant_id,
          root,
          receipt_hashes,
          count,
          previous_root
          ,
          status
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
      `,
      [
        batch.batchId,
        batch.tenantId,
        batch.root,
        JSON.stringify(batch.receiptHashes),
        batch.count,
        batch.previousRoot ?? null,
        batch.status
      ]
    );

    await pool.query(
      `
        UPDATE receipts
        SET anchored_batch_id = $2, updated_at = NOW()
        WHERE tenant_id = $1
          AND receipt_hash = ANY($3::text[])
      `,
      [tenantId, batch.batchId, batch.receiptHashes]
    );

    return batch;
  }

  async setBatchSignature(batchId: string, signature: string): Promise<void> {
    await pool.query(
      `
        UPDATE anchor_batches
        SET solana_signature = $2, status = 'anchored', last_error = NULL
        WHERE batch_id = $1
      `,
      [batchId, signature]
    );
  }

  async markBatchFailed(batchId: string, errorMessage: string): Promise<void> {
    await pool.query(
      `
        UPDATE anchor_batches
        SET status = 'failed', last_error = $2
        WHERE batch_id = $1
      `,
      [batchId, errorMessage]
    );
  }

  async retryFailedBatch(batchId: string): Promise<void> {
    await pool.query(
      `
        UPDATE anchor_batches
        SET status = 'pending', last_error = NULL
        WHERE batch_id = $1 AND status = 'failed'
      `,
      [batchId]
    );
  }

  async getOpenBatchForTenant(tenantId: string): Promise<AnchorBatch | undefined> {
    const result = await pool.query(
      `
        SELECT batch_id, tenant_id, root, receipt_hashes, count, previous_root, status
        FROM anchor_batches
        WHERE tenant_id = $1
          AND status IN ('pending', 'anchoring')
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [tenantId]
    );

    const row = result.rows[0];
    return row ? this.mapBatch(row) : undefined;
  }

  async listTenantsWithUnbatchedReceipts(): Promise<string[]> {
    const result = await pool.query(
      `
        SELECT DISTINCT tenant_id
        FROM receipts
        WHERE anchored_batch_id IS NULL
        ORDER BY tenant_id ASC
      `
    );

    return result.rows.map((row) => row.tenant_id as string);
  }

  async claimNextPendingBatch():
    Promise<(AnchorBatch & { attempts: number; lastError?: string }) | undefined> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selection = await client.query(
        `
          SELECT batch_id, tenant_id, root, receipt_hashes, count, previous_root, status, attempts, last_error
          FROM anchor_batches
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `
      );

      const row = selection.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }

      await client.query(
        `
          UPDATE anchor_batches
          SET status = 'anchoring', attempts = attempts + 1
          WHERE batch_id = $1
        `,
        [row.batch_id]
      );
      await client.query("COMMIT");

      return {
        ...this.mapBatch({
          batch_id: row.batch_id as string,
          tenant_id: row.tenant_id as string,
          root: row.root as string,
          receipt_hashes: row.receipt_hashes as string[],
          count: row.count as number,
          previous_root: row.previous_root as string | null,
          status: "anchoring"
        }),
        attempts: (row.attempts as number) + 1,
        lastError: row.last_error as string | undefined
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBatches(): Promise<AnchorBatchRecord[]> {
    const result = await pool.query(
      `
        SELECT batch_id, tenant_id, root, receipt_hashes, count, previous_root, status, solana_signature, last_error
        FROM anchor_batches
        ORDER BY created_at DESC
      `
    );

    return result.rows.map((row) => ({
      ...this.mapBatch({
        batch_id: row.batch_id as string,
        tenant_id: row.tenant_id as string,
        root: row.root as string,
        receipt_hashes: row.receipt_hashes as string[],
        count: row.count as number,
        status: row.status as "pending" | "anchoring" | "anchored" | "failed",
        previous_root: row.previous_root as string | null
      }),
      solanaSignature: row.solana_signature as string | undefined,
      lastError: row.last_error as string | undefined
    }));
  }

  async getReceiptByMessageId(internalMessageId: string): Promise<EvidenceReceipt | undefined> {
    const result = await pool.query(
      `SELECT payload FROM receipts WHERE internal_message_id = $1`,
      [internalMessageId]
    );

    return result.rows[0]?.payload as EvidenceReceipt | undefined;
  }

  async findBatchForReceipt(receiptHash: string):
    Promise<
      | {
          batch: AnchorBatch;
          proof: string[];
          leafIndex: number;
          solanaSignature?: string;
        }
      | undefined
    > {
    const result = await pool.query(
      `
        SELECT batch_id, tenant_id, root, receipt_hashes, count, previous_root
             , status, solana_signature
        FROM anchor_batches
        ORDER BY created_at DESC
      `
    );

    for (const row of result.rows) {
      const receiptHashes = row.receipt_hashes as string[];
      const leafIndex = receiptHashes.indexOf(receiptHash);
      if (leafIndex === -1) {
        continue;
      }

      const batch: AnchorBatch = {
        ...this.mapBatch({
          batch_id: row.batch_id as string,
          tenant_id: row.tenant_id as string,
          root: row.root as string,
          receipt_hashes: receiptHashes,
          count: row.count as number,
          status: row.status as "pending" | "anchoring" | "anchored" | "failed",
          previous_root: row.previous_root as string | null
        })
      };

      return {
        batch,
        proof: buildMerkleProof(receiptHashes, leafIndex),
        leafIndex,
        solanaSignature: row.solana_signature as string | undefined
      };
    }

    return undefined;
  }

  async getBatch(batchId: string): Promise<AnchorBatchRecord | undefined> {
    const result = await pool.query(
      `
        SELECT batch_id, tenant_id, root, receipt_hashes, count, previous_root, status, solana_signature, attempts, last_error
        FROM anchor_batches
        WHERE batch_id = $1
      `,
      [batchId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      ...this.mapBatch({
        batch_id: row.batch_id as string,
        tenant_id: row.tenant_id as string,
        root: row.root as string,
        receipt_hashes: row.receipt_hashes as string[],
        count: row.count as number,
        status: row.status as "pending" | "anchoring" | "anchored" | "failed",
        previous_root: row.previous_root as string | null
      }),
      solanaSignature: row.solana_signature as string | undefined,
      attempts: row.attempts as number,
      lastError: row.last_error as string | undefined
    };
  }

  async listRecentMessages(limit = 25): Promise<DashboardMessage[]> {
    const result = await pool.query(
      `
        SELECT
          m.internal_message_id,
          m.tenant_id,
          m.subject,
          m.recipient_addresses,
          m.provider_message_id,
          m.created_at,
          r.receipt_hash IS NOT NULL AS has_receipt,
          ab.status AS batch_status,
          (
            SELECT we.event_type
            FROM webhook_events we
            WHERE we.internal_message_id = m.internal_message_id
            ORDER BY we.received_at DESC, we.id DESC
            LIMIT 1
          ) AS latest_event
        FROM messages m
        LEFT JOIN receipts r
          ON r.internal_message_id = m.internal_message_id
        LEFT JOIN anchor_batches ab
          ON ab.batch_id = r.anchored_batch_id
        ORDER BY m.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      internalMessageId: row.internal_message_id as string,
      tenantId: row.tenant_id as string,
      subject: row.subject as string,
      recipientAddresses: row.recipient_addresses as string[],
      providerMessageId: row.provider_message_id as string | undefined,
      createdAt: new Date(row.created_at as string).toISOString(),
      latestEvent: row.latest_event as string | undefined,
      hasReceipt: row.has_receipt as boolean,
      batchStatus: row.batch_status as DashboardMessage["batchStatus"]
    }));
  }
}
