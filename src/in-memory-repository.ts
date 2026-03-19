import { buildMerkleProof, computeMerkleRoot } from "./merkle.js";
import type {
  AnchorBatch,
  AnchorBatchRecord,
  CanonicalMessage,
  DashboardMessage,
  EvidenceReceipt,
  SendGridEvent
} from "./types.js";
import type { Repository } from "./repository.js";

type MessageRow = {
  message: CanonicalMessage;
  providerMessageId?: string;
  createdAt: string;
};

type StoredWebhookEvent = {
  internalMessageId: string;
  event: SendGridEvent;
};

export class InMemoryRepository implements Repository {
  private readonly messages = new Map<string, MessageRow>();
  private readonly webhookEvents: StoredWebhookEvent[] = [];
  private readonly receipts = new Map<string, EvidenceReceipt>();
  private readonly receiptBatchIds = new Map<string, string>();
  private readonly batches = new Map<string, AnchorBatchRecord>();

  async saveMessage(message: CanonicalMessage): Promise<void> {
    const current = this.messages.get(message.internalMessageId);
    this.messages.set(message.internalMessageId, {
      message,
      providerMessageId: current?.providerMessageId,
      createdAt: current?.createdAt ?? new Date().toISOString()
    });
  }

  async setProviderMessageId(
    internalMessageId: string,
    providerMessageId: string | undefined
  ): Promise<void> {
    const current = this.messages.get(internalMessageId);
    if (!current) {
      return;
    }

    this.messages.set(internalMessageId, {
      ...current,
      providerMessageId
    });
  }

  async getMessage(internalMessageId: string): Promise<CanonicalMessage | undefined> {
    return this.messages.get(internalMessageId)?.message;
  }

  async saveWebhookEvents(
    internalMessageId: string,
    events: SendGridEvent[]
  ): Promise<void> {
    for (const event of events) {
      if (event.sg_event_id) {
        const exists = this.webhookEvents.some((item) => item.event.sg_event_id === event.sg_event_id);
        if (exists) {
          continue;
        }
      }
      this.webhookEvents.push({ internalMessageId, event });
    }
  }

  async getEvents(internalMessageId: string): Promise<SendGridEvent[]> {
    return this.webhookEvents
      .filter((item) => item.internalMessageId === internalMessageId)
      .map((item) => item.event)
      .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  }

  async getLatestReceiptHash(tenantId: string): Promise<string | undefined> {
    const receipts = [...this.receipts.values()].filter((receipt) => receipt.tenantId === tenantId);
    return receipts.at(-1)?.receiptHash;
  }

  async saveReceipt(receipt: EvidenceReceipt): Promise<void> {
    this.receipts.set(receipt.internalMessageId, receipt);
  }

  async getReceiptByHash(receiptHash: string): Promise<EvidenceReceipt | undefined> {
    return [...this.receipts.values()].find((receipt) => receipt.receiptHash === receiptHash);
  }

  async createBatch(tenantId: string, batchSize: number): Promise<AnchorBatch | undefined> {
    const open = await this.getOpenBatchForTenant(tenantId);
    if (open) {
      return open;
    }

    const candidates = [...this.receipts.values()]
      .filter((receipt) => receipt.tenantId === tenantId && !this.receiptBatchIds.has(receipt.receiptHash))
      .slice(0, batchSize);

    if (candidates.length === 0) {
      return undefined;
    }

    const receiptHashes = candidates.map((receipt) => receipt.receiptHash);
    const previousRoot = [...this.batches.values()]
      .filter((batch) => batch.tenantId === tenantId)
      .at(-1)?.root;

    const batch: AnchorBatchRecord = {
      version: 1,
      tenantId,
      batchId: `${tenantId}-${Date.now()}`,
      root: computeMerkleRoot(receiptHashes),
      count: receiptHashes.length,
      status: "pending",
      previousRoot,
      receiptHashes,
      attempts: 0
    };

    this.batches.set(batch.batchId, batch);
    for (const receiptHash of receiptHashes) {
      this.receiptBatchIds.set(receiptHash, batch.batchId);
    }

    return batch;
  }

  async setBatchSignature(batchId: string, signature: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return;
    }
    this.batches.set(batchId, { ...batch, solanaSignature: signature, status: "anchored", lastError: undefined });
  }

  async markBatchFailed(batchId: string, errorMessage: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return;
    }
    this.batches.set(batchId, { ...batch, status: "failed", lastError: errorMessage });
  }

  async retryFailedBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== "failed") {
      return;
    }
    this.batches.set(batchId, { ...batch, status: "pending", lastError: undefined });
  }

  async getOpenBatchForTenant(tenantId: string): Promise<AnchorBatch | undefined> {
    return [...this.batches.values()].find(
      (batch) => batch.tenantId === tenantId && (batch.status === "pending" || batch.status === "anchoring")
    );
  }

  async listTenantsWithUnbatchedReceipts(): Promise<string[]> {
    return [...new Set(
      [...this.receipts.values()]
        .filter((receipt) => !this.receiptBatchIds.has(receipt.receiptHash))
        .map((receipt) => receipt.tenantId)
    )];
  }

  async claimNextPendingBatch():
    Promise<(AnchorBatch & { attempts: number; lastError?: string }) | undefined> {
    const batch = [...this.batches.values()].find((item) => item.status === "pending");
    if (!batch) {
      return undefined;
    }

    const next = {
      ...batch,
      status: "anchoring" as const,
      attempts: (batch.attempts ?? 0) + 1
    };
    this.batches.set(batch.batchId, next);
    return next;
  }

  async listBatches(): Promise<AnchorBatchRecord[]> {
    return [...this.batches.values()].reverse();
  }

  async getReceiptByMessageId(internalMessageId: string): Promise<EvidenceReceipt | undefined> {
    return this.receipts.get(internalMessageId);
  }

  async findBatchForReceipt(receiptHash: string) {
    for (const batch of this.batches.values()) {
      const leafIndex = batch.receiptHashes.indexOf(receiptHash);
      if (leafIndex === -1) {
        continue;
      }

      return {
        batch,
        proof: buildMerkleProof(batch.receiptHashes, leafIndex),
        leafIndex,
        solanaSignature: batch.solanaSignature
      };
    }

    return undefined;
  }

  async getBatch(batchId: string): Promise<AnchorBatchRecord | undefined> {
    return this.batches.get(batchId);
  }

  async listRecentMessages(limit = 25): Promise<DashboardMessage[]> {
    return [...this.messages.entries()]
      .map(([internalMessageId, row]) => {
        const receipt = this.receipts.get(internalMessageId);
        const latestEvent = this.webhookEvents
          .filter((event) => event.internalMessageId === internalMessageId)
          .at(-1)?.event.event;
        const batchId = receipt ? this.receiptBatchIds.get(receipt.receiptHash) : undefined;
        const batch = batchId ? this.batches.get(batchId) : undefined;

        return {
          internalMessageId,
          tenantId: row.message.tenantId,
          subject: row.message.subject,
          recipientAddresses: row.message.recipientAddresses,
          providerMessageId: row.providerMessageId,
          createdAt: row.createdAt,
          latestEvent,
          hasReceipt: Boolean(receipt),
          batchStatus: batch?.status
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}
