import { hmacSha256Hex, sha256Hex, stableStringify } from "./crypto.js";
import { config } from "./config.js";
import type { CanonicalMessage, EvidenceReceipt, ReceiptEvent, SendGridEvent } from "./types.js";

const hashPii = (value: string): string =>
  sha256Hex(Buffer.from(`${config.receiptSigningSecret}:${value.toLowerCase()}`, "utf8"));

const normalizeEvent = (event: SendGridEvent): ReceiptEvent => ({
  event: event.event,
  timestamp: event.timestamp,
  sgEventId: event.sg_event_id,
  sgMessageId: event.sg_message_id,
  smtpId: event.smtp_id ?? event["smtp-id"],
  response: event.response,
  reason: event.reason,
  status: event.status,
  attempt: event.attempt,
  tls: event.tls,
  ip: event.ip
});

type BuildReceiptInput = {
  message: CanonicalMessage;
  sendgridEvents: SendGridEvent[];
  previousReceiptHash?: string;
};

export const buildEvidenceReceipt = ({
  message,
  sendgridEvents,
  previousReceiptHash
}: BuildReceiptInput): EvidenceReceipt => {
  const baseReceipt = {
    version: 1 as const,
    tenantId: message.tenantId,
    internalMessageId: message.internalMessageId,
    provider: "sendgrid" as const,
    providerMessageId: sendgridEvents[0]?.sg_message_id,
    senderAddressHash: hashPii(message.senderAddress),
    recipientAddressHashes: [...message.recipientAddresses]
      .map((recipient) => hashPii(recipient))
      .sort(),
    subjectHash: hashPii(message.subject),
    mimeSha256: sha256Hex(message.mimeBytes),
    attachmentHashes: message.attachments.map((attachment) => ({
      filenameHash: hashPii(attachment.filename),
      sha256: sha256Hex(attachment.bytes),
      bytes: attachment.bytes.length
    })),
    sendgridEvents: [...sendgridEvents]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map(normalizeEvent),
    createdAt: new Date().toISOString(),
    previousReceiptHash
  };

  const receiptHash = sha256Hex(stableStringify(baseReceipt));
  const signature = hmacSha256Hex(config.receiptSigningSecret, receiptHash);

  return {
    ...baseReceipt,
    receiptHash,
    signature
  };
};
