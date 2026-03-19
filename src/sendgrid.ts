import MailService from "@sendgrid/mail";

import { config } from "./config.js";

if (config.sendgridApiKey) {
  MailService.setApiKey(config.sendgridApiKey);
}

type SendMailInput = {
  to: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  internalMessageId: string;
};

export const buildMimeMessage = (input: SendMailInput): string => {
  const headers = [
    `From: ${config.sendgridFromAddress}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0"
  ];

  if (input.htmlBody) {
    const boundary = `mail-anchor-${input.internalMessageId}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.textBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      input.htmlBody,
      `--${boundary}--`
    ].join("\r\n");
  }

  return [...headers, 'Content-Type: text/plain; charset="utf-8"', "", input.textBody].join(
    "\r\n"
  );
};

export const sendViaSendGrid = async (input: SendMailInput): Promise<string | undefined> => {
  if (!config.sendgridApiKey) {
    throw new Error("SendGrid is not configured. Use the demo flow instead.");
  }

  const [response] = await MailService.send({
    to: input.to,
    from: config.sendgridFromAddress,
    subject: input.subject,
    text: input.textBody,
    html: input.htmlBody,
    customArgs: {
      internalMessageId: input.internalMessageId
    }
  });

  return response.headers["x-message-id"] as string | undefined;
};
