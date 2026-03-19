import { anchorBatchToSolana } from "./solana.js";
import type { Repository } from "./repository.js";

type AnchorWorkerOptions = {
  repository: Repository;
  batchSize: number;
  intervalMs: number;
};

export class AnchorWorker {
  private readonly repository: Repository;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: AnchorWorkerOptions) {
    this.repository = options.repository;
    this.batchSize = options.batchSize;
    this.intervalMs = options.intervalMs;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.ensurePendingBatches();
      await this.processPendingBatches();
    } finally {
      this.running = false;
    }
  }

  private async ensurePendingBatches(): Promise<void> {
    const tenants = await this.repository.listTenantsWithUnbatchedReceipts();
    for (const tenantId of tenants) {
      await this.repository.createBatch(tenantId, this.batchSize);
    }
  }

  private async processPendingBatches(): Promise<void> {
    while (true) {
      const batch = await this.repository.claimNextPendingBatch();
      if (!batch) {
        return;
      }

      try {
        const signature = await anchorBatchToSolana(batch);
        await this.repository.setBatchSignature(batch.batchId, signature);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown anchor failure";
        await this.repository.markBatchFailed(batch.batchId, message);
      }
    }
  }
}
