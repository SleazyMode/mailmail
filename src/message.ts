import type { CanonicalMessage } from "./types.js";

type CreateMessageInput = {
  tenantId: string;
  internalMessageId: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
};

export const createCanonicalMessage = (
  input: CreateMessageInput,
  mimeMessage: string
): CanonicalMessage => ({
  tenantId: input.tenantId,
  internalMessageId: input.internalMessageId,
  senderAddress: input.senderAddress,
  recipientAddresses: input.recipientAddresses,
  subject: input.subject,
  mimeBytes: Buffer.from(mimeMessage, "utf8"),
  attachments: []
});
