export type SendGridEvent = {
  email?: string;
  event: string;
  timestamp: number;
  sg_event_id?: string;
  sg_message_id?: string;
  smtp_id?: string;
  "smtp-id"?: string;
  response?: string;
  reason?: string;
  status?: string;
  attempt?: string;
  tls?: number | string;
  ip?: string;
  category?: string | string[];
  unique_args?: Record<string, string>;
  [key: string]: unknown;
};

export type CanonicalMessage = {
  tenantId: string;
  internalMessageId: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  mimeBytes: Buffer;
  attachments: Array<{
    filename: string;
    bytes: Buffer;
  }>;
};

export type ReceiptEvent = {
  event: string;
  timestamp: number;
  sgEventId?: string;
  sgMessageId?: string;
  smtpId?: string;
  response?: string;
  reason?: string;
  status?: string;
  attempt?: string;
  tls?: number | string;
  ip?: string;
};

export type EvidenceReceipt = {
  version: 1;
  tenantId: string;
  internalMessageId: string;
  provider: "sendgrid";
  providerMessageId?: string;
  senderAddressHash: string;
  recipientAddressHashes: string[];
  subjectHash: string;
  mimeSha256: string;
  attachmentHashes: Array<{
    filenameHash: string;
    sha256: string;
    bytes: number;
  }>;
  sendgridEvents: ReceiptEvent[];
  createdAt: string;
  previousReceiptHash?: string;
  receiptHash: string;
  signature: string;
};

export type AnchorBatch = {
  version: 1;
  tenantId: string;
  batchId: string;
  root: string;
  count: number;
  status?: "pending" | "anchoring" | "anchored" | "failed";
  previousRoot?: string;
  receiptHashes: string[];
};

export type AnchorBatchRecord = AnchorBatch & {
  solanaSignature?: string;
  attempts?: number;
  lastError?: string;
};

export type VerificationPacket = {
  internalMessageId: string;
  receipt: EvidenceReceipt;
  inclusion: {
    batch: AnchorBatch;
    leafIndex: number;
    proof: string[];
    solanaSignature?: string;
  } | null;
  verification: {
    receiptSignatureValid: boolean;
    anchored: boolean;
  };
};

export type DashboardMessage = {
  internalMessageId: string;
  tenantId: string;
  subject: string;
  recipientAddresses: string[];
  providerMessageId?: string;
  createdAt: string;
  latestEvent?: string;
  hasReceipt: boolean;
  batchStatus?: "pending" | "anchoring" | "anchored" | "failed";
};
