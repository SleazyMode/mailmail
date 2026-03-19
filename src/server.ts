import "dotenv/config";

import express from "express";

import { AnchorWorker } from "./anchor-worker.js";
import { config } from "./config.js";
import { verifyHmacSha256Hex, verifySendGridSignature } from "./crypto.js";
import { initSchema } from "./db.js";
import { generateInternalMessageId } from "./id.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { createCanonicalMessage } from "./message.js";
import { buildEvidenceReceipt } from "./receipt.js";
import { PgRepository, type Repository } from "./repository.js";
import { anchorBatchToSolana, buildAnchorMemo } from "./solana.js";
import { buildMimeMessage, sendViaSendGrid } from "./sendgrid.js";
import type { DashboardMessage, SendGridEvent, VerificationPacket } from "./types.js";

const app = express();
let repository: Repository = new PgRepository();
let storageMode: "postgres" | "memory" = "postgres";
let anchorWorker: AnchorWorker | undefined;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildVerificationPacket = async (
  internalMessageId: string
): Promise<VerificationPacket | undefined> => {
  const receipt = await repository.getReceiptByMessageId(internalMessageId);
  if (!receipt) {
    return undefined;
  }

  const inclusion = await repository.findBatchForReceipt(receipt.receiptHash);
  return {
    internalMessageId: receipt.internalMessageId,
    receipt,
    inclusion: inclusion
      ? {
          batch: inclusion.batch,
          leafIndex: inclusion.leafIndex,
          proof: inclusion.proof,
          solanaSignature: inclusion.solanaSignature
        }
      : null,
    verification: {
      receiptSignatureValid: verifyHmacSha256Hex(
        config.receiptSigningSecret,
        receipt.receiptHash,
        receipt.signature
      ),
      anchored: Boolean(inclusion?.solanaSignature)
    }
  };
};

const renderVerificationPage = (packet: VerificationPacket): string => {
  const events = packet.receipt.sendgridEvents
    .map(
      (event) => `
        <tr>
          <td>${escapeHtml(event.event)}</td>
          <td>${escapeHtml(new Date(event.timestamp * 1000).toISOString())}</td>
          <td>${escapeHtml(event.status ?? "")}</td>
          <td>${escapeHtml(event.response ?? event.reason ?? "")}</td>
        </tr>
      `
    )
    .join("");

  const anchorState = packet.inclusion
    ? packet.verification.anchored
      ? "Anchored on Solana"
      : "Batched, pending chain submission"
    : "Not yet batched";

  const batchDetails = packet.inclusion
    ? `
      <section class="card">
        <h2>Batch Inclusion</h2>
        <dl>
          <div><dt>Batch ID</dt><dd>${escapeHtml(packet.inclusion.batch.batchId)}</dd></div>
          <div><dt>Merkle Root</dt><dd class="mono">${escapeHtml(packet.inclusion.batch.root)}</dd></div>
          <div><dt>Leaf Index</dt><dd>${packet.inclusion.leafIndex}</dd></div>
          <div><dt>Batch Status</dt><dd>${escapeHtml(packet.inclusion.batch.status ?? "pending")}</dd></div>
          <div><dt>Solana Signature</dt><dd class="mono">${escapeHtml(packet.inclusion.solanaSignature ?? "Pending")}</dd></div>
        </dl>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Receipt Verification ${escapeHtml(packet.internalMessageId)}</title>
    <style>
      :root {
        --bg: #f3efe4;
        --ink: #1b2430;
        --muted: #5f6b7a;
        --panel: rgba(255,255,255,0.82);
        --line: rgba(27,36,48,0.12);
        --accent: #0f766e;
        --accent-2: #c2410c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 35%),
          radial-gradient(circle at bottom right, rgba(194,65,12,0.12), transparent 30%),
          var(--bg);
      }
      .wrap { max-width: 980px; margin: 0 auto; padding: 40px 20px 80px; }
      .hero { margin-bottom: 24px; }
      .eyebrow { font-family: "Courier New", monospace; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
      h1 { margin: 10px 0 8px; font-size: clamp(34px, 6vw, 58px); line-height: 0.95; }
      .summary { max-width: 760px; font-size: 18px; color: var(--muted); }
      .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-bottom: 18px; }
      .card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(27,36,48,0.06); }
      .card h2 { margin-top: 0; margin-bottom: 14px; font-size: 20px; }
      dl { margin: 0; }
      dl div { padding: 10px 0; border-top: 1px solid var(--line); }
      dl div:first-child { border-top: 0; padding-top: 0; }
      dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 4px; }
      dd { margin: 0; word-break: break-word; }
      .mono { font-family: "Courier New", monospace; font-size: 13px; }
      .status { display: inline-block; padding: 8px 12px; border-radius: 999px; font-family: "Courier New", monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(15,118,110,0.12); color: var(--accent); }
      .status.warn { background: rgba(194,65,12,0.12); color: var(--accent-2); }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; padding: 12px 10px; border-top: 1px solid var(--line); vertical-align: top; }
      th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
      .button { display: inline-block; text-decoration: none; padding: 12px 16px; border-radius: 999px; background: var(--ink); color: white; font-family: "Courier New", monospace; font-size: 13px; }
      .button.alt { background: transparent; color: var(--ink); border: 1px solid var(--line); }
      @media (max-width: 640px) {
        .wrap { padding: 26px 14px 52px; }
        .card { padding: 16px; }
        th, td { padding: 10px 6px; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <div class="eyebrow">Verified Message Receipt</div>
        <h1>Delivery Proof Packet</h1>
        <p class="summary">
          This page shows the current evidence state for message
          <span class="mono">${escapeHtml(packet.internalMessageId)}</span>.
          The receipt signature is ${packet.verification.receiptSignatureValid ? "valid" : "invalid"} and the current anchor state is
          <strong>${escapeHtml(anchorState)}</strong>.
        </p>
        <div class="actions">
          <a class="button" href="/verify/${encodeURIComponent(packet.internalMessageId)}">View JSON Packet</a>
          <a class="button alt" href="/verify/${encodeURIComponent(packet.internalMessageId)}/download">Download Evidence Packet</a>
        </div>
      </section>
      <section class="grid">
        <article class="card">
          <h2>Receipt Status</h2>
          <div class="status ${packet.verification.anchored ? "" : "warn"}">${escapeHtml(anchorState)}</div>
          <dl>
            <div><dt>Tenant</dt><dd>${escapeHtml(packet.receipt.tenantId)}</dd></div>
            <div><dt>Provider</dt><dd>${escapeHtml(packet.receipt.provider)}</dd></div>
            <div><dt>Created At</dt><dd>${escapeHtml(packet.receipt.createdAt)}</dd></div>
            <div><dt>Provider Message ID</dt><dd class="mono">${escapeHtml(packet.receipt.providerMessageId ?? "Pending")}</dd></div>
          </dl>
        </article>
        <article class="card">
          <h2>Content Evidence</h2>
          <dl>
            <div><dt>MIME SHA-256</dt><dd class="mono">${escapeHtml(packet.receipt.mimeSha256)}</dd></div>
            <div><dt>Subject Hash</dt><dd class="mono">${escapeHtml(packet.receipt.subjectHash)}</dd></div>
            <div><dt>Sender Hash</dt><dd class="mono">${escapeHtml(packet.receipt.senderAddressHash)}</dd></div>
            <div><dt>Recipient Count</dt><dd>${packet.receipt.recipientAddressHashes.length}</dd></div>
          </dl>
        </article>
      </section>
      ${batchDetails}
      <section class="card">
        <h2>Delivery Timeline</h2>
        <table>
          <thead>
            <tr><th>Event</th><th>Timestamp</th><th>Status</th><th>Provider Detail</th></tr>
          </thead>
          <tbody>
            ${events || '<tr><td colspan="4">No delivery events recorded yet.</td></tr>'}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
};

const renderDashboard = (messages: DashboardMessage[], notice?: string): string => {
  const rows = messages
    .map((message) => {
      const proofCell = message.hasReceipt
        ? `<a class="table-link" href="/verify/${encodeURIComponent(message.internalMessageId)}/view">Open Proof</a>`
        : `<span class="muted">Pending receipt</span>`;
      const batch = message.batchStatus ?? "not batched";
      return `
        <tr>
          <td><span class="mono">${escapeHtml(message.internalMessageId)}</span></td>
          <td>${escapeHtml(message.tenantId)}</td>
          <td>${escapeHtml(message.subject)}</td>
          <td>${escapeHtml(message.recipientAddresses.join(", "))}</td>
          <td>${escapeHtml(message.latestEvent ?? "created")}</td>
          <td>${escapeHtml(batch)}</td>
          <td>${proofCell}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mail Anchor Dashboard</title>
    <style>
      :root {
        --bg: #efe8da;
        --ink: #17202a;
        --muted: #66707a;
        --panel: rgba(255,255,255,0.84);
        --line: rgba(23,32,42,0.12);
        --accent: #0f766e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(15,118,110,0.14), transparent 34%),
          radial-gradient(circle at bottom right, rgba(193,121,23,0.10), transparent 30%),
          var(--bg);
      }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 18px 60px; }
      .hero { margin-bottom: 18px; }
      .eyebrow, .mono { font-family: "Courier New", monospace; }
      .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
      h1 { margin: 10px 0 8px; font-size: clamp(36px, 6vw, 62px); line-height: 0.95; }
      .summary { max-width: 760px; font-size: 18px; color: var(--muted); }
      .grid { display: grid; gap: 18px; grid-template-columns: minmax(320px, 400px) 1fr; align-items: start; }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 12px 32px rgba(23,32,42,0.06);
        backdrop-filter: blur(10px);
      }
      .card h2 { margin: 0 0 12px; font-size: 21px; }
      label { display: block; margin: 12px 0 8px; font-size: 14px; }
      input, textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: rgba(255,255,255,0.92);
        color: var(--ink);
        padding: 12px 14px;
        font: inherit;
      }
      textarea { min-height: 160px; resize: vertical; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
      button, a.button {
        display: inline-block;
        text-decoration: none;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: var(--ink);
        color: #fff;
        font-family: "Courier New", monospace;
        font-size: 13px;
        cursor: pointer;
      }
      a.button.alt, button.alt {
        background: transparent;
        color: var(--ink);
        border: 1px solid var(--line);
      }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { padding: 12px 10px; border-top: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .muted { color: var(--muted); }
      .notice {
        display: inline-block;
        margin-bottom: 14px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(15,118,110,0.12);
        color: var(--accent);
        font-family: "Courier New", monospace;
        font-size: 12px;
      }
      .table-link { color: var(--accent); text-decoration: none; }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <div class="eyebrow">MVP Dashboard</div>
        <h1>Mail Anchor</h1>
        <p class="summary">
          Demo the proof flow immediately with a local message, or switch to real SendGrid delivery when provider credentials are configured.
        </p>
      </section>
      ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}
      <section class="grid">
        <article class="card">
          <h2>Send Message</h2>
          <form method="post" action="/dashboard/send">
            <label for="tenantId">Tenant ID</label>
            <input id="tenantId" name="tenantId" value="tenant-a" required />

            <label for="recipientAddresses">Recipients</label>
            <input id="recipientAddresses" name="recipientAddresses" placeholder="alice@example.com,bob@example.com" required />

            <label for="subject">Subject</label>
            <input id="subject" name="subject" placeholder="Notice of Amendment" required />

            <label for="textBody">Message Body</label>
            <textarea id="textBody" name="textBody" required>Please review the attached notice.</textarea>

            <div class="actions">
              <button type="submit">Send via SendGrid</button>
              <button class="alt" type="submit" formaction="/dashboard/dev-send">Create Demo Message</button>
            </div>
            <p class="muted" style="margin-top:12px;">
              The demo button works without SendGrid. Use it for the fastest clickable walkthrough.
            </p>
          </form>
        </article>
        <article class="card">
          <h2>Recent Messages</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Tenant</th>
                <th>Subject</th>
                <th>Recipients</th>
                <th>Latest Event</th>
                <th>Batch</th>
                <th>Proof</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="7" class="muted">No messages yet.</td></tr>'}
            </tbody>
          </table>
        </article>
      </section>
    </main>
  </body>
</html>`;
};

app.use("/sendgrid/events", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/", (_request, response) => {
  response.redirect("/dashboard");
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, storageMode });
});

app.get("/dashboard", async (request, response) => {
  const notice =
    typeof request.query.notice === "string" ? request.query.notice : undefined;
  const messages = await repository.listRecentMessages();
  response.type("html").send(renderDashboard(messages, notice));
});

app.post("/send", async (request, response) => {
  if (!config.sendgridApiKey) {
    response.status(503).json({
      error: "SendGrid is not configured. Use /dev/send or the dashboard demo button."
    });
    return;
  }

  const body = request.body as {
    tenantId: string;
    recipientAddresses: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    internalMessageId?: string;
  };

  const internalMessageId = body.internalMessageId ?? generateInternalMessageId();
  const mimeMessage = buildMimeMessage({
    to: body.recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    internalMessageId
  });

  const message = createCanonicalMessage(
    {
      tenantId: body.tenantId,
      internalMessageId,
      senderAddress: config.sendgridFromAddress,
      recipientAddresses: body.recipientAddresses,
      subject: body.subject,
      textBody: body.textBody,
      htmlBody: body.htmlBody
    },
    mimeMessage
  );

  await repository.saveMessage(message);
  const providerMessageId = await sendViaSendGrid({
    to: body.recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    internalMessageId
  });
  await repository.setProviderMessageId(internalMessageId, providerMessageId);

  response.status(202).json({ accepted: true, internalMessageId, providerMessageId });
});

app.post("/dashboard/send", async (request, response) => {
  if (!config.sendgridApiKey) {
    response.redirect(
      `/dashboard?notice=${encodeURIComponent("SendGrid is not configured. Use Create Demo Message.")}`
    );
    return;
  }

  const body = request.body as Record<string, string>;
  const recipientAddresses = (body.recipientAddresses ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const internalMessageId = generateInternalMessageId();
  const mimeMessage = buildMimeMessage({
    to: recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    internalMessageId
  });

  const message = createCanonicalMessage(
    {
      tenantId: body.tenantId,
      internalMessageId,
      senderAddress: config.sendgridFromAddress,
      recipientAddresses,
      subject: body.subject,
      textBody: body.textBody
    },
    mimeMessage
  );

  await repository.saveMessage(message);
  const providerMessageId = await sendViaSendGrid({
    to: recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    internalMessageId
  });
  await repository.setProviderMessageId(internalMessageId, providerMessageId);

  response.redirect(
    `/dashboard?notice=${encodeURIComponent(`Queued ${internalMessageId} for delivery`)}`,
  );
});

app.post("/dev/send", async (request, response) => {
  const body = request.body as {
    tenantId: string;
    recipientAddresses: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    internalMessageId?: string;
  };

  const internalMessageId = body.internalMessageId ?? generateInternalMessageId();
  const mimeMessage = buildMimeMessage({
    to: body.recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    internalMessageId
  });

  const message = createCanonicalMessage(
    {
      tenantId: body.tenantId,
      internalMessageId,
      senderAddress: config.sendgridFromAddress,
      recipientAddresses: body.recipientAddresses,
      subject: body.subject,
      textBody: body.textBody,
      htmlBody: body.htmlBody
    },
    mimeMessage
  );

  await repository.saveMessage(message);
  await repository.setProviderMessageId(internalMessageId, `dev-${internalMessageId}`);

  response.status(202).json({
    accepted: true,
    internalMessageId,
    providerMessageId: `dev-${internalMessageId}`,
    simulated: true
  });
});

app.post("/dashboard/dev-send", async (request, response) => {
  const body = request.body as Record<string, string>;
  const recipientAddresses = (body.recipientAddresses ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const internalMessageId = generateInternalMessageId();
  const mimeMessage = buildMimeMessage({
    to: recipientAddresses,
    subject: body.subject,
    textBody: body.textBody,
    internalMessageId
  });

  const message = createCanonicalMessage(
    {
      tenantId: body.tenantId,
      internalMessageId,
      senderAddress: config.sendgridFromAddress,
      recipientAddresses,
      subject: body.subject,
      textBody: body.textBody
    },
    mimeMessage
  );

  await repository.saveMessage(message);
  await repository.setProviderMessageId(internalMessageId, `dev-${internalMessageId}`);
  await repository.saveWebhookEvents(
    internalMessageId,
    [
      {
        event: "processed",
        email: recipientAddresses[0],
        timestamp: Math.floor(Date.now() / 1000),
        sg_event_id: `${internalMessageId}-processed-dashboard`,
        sg_message_id: `dev-${internalMessageId}`,
        unique_args: { internalMessageId }
      },
      {
        event: "delivered",
        email: recipientAddresses[0],
        timestamp: Math.floor(Date.now() / 1000) + 1,
        sg_event_id: `${internalMessageId}-delivered-dashboard`,
        sg_message_id: `dev-${internalMessageId}`,
        response: "250 2.0.0 Ok",
        status: "2.0.0",
        unique_args: { internalMessageId }
      }
    ],
    JSON.stringify({ simulated: true }),
    true,
    { "x-dev-simulated": "true" },
    new Date().toISOString()
  );

  const allEvents = await repository.getEvents(internalMessageId);
  const receipt = buildEvidenceReceipt({
    message,
    sendgridEvents: allEvents,
    previousReceiptHash: await repository.getLatestReceiptHash(message.tenantId)
  });
  await repository.saveReceipt(receipt);

  response.redirect(
    `/dashboard?notice=${encodeURIComponent(`Created demo receipt ${internalMessageId}`)}`
  );
});

app.post("/sendgrid/events", async (request, response) => {
  const signature = request.header("X-Twilio-Email-Event-Webhook-Signature");
  const timestamp = request.header("X-Twilio-Email-Event-Webhook-Timestamp");

  if (!signature || !timestamp) {
    response.status(401).json({ error: "Missing SendGrid signature headers" });
    return;
  }

  const rawPayload = Buffer.isBuffer(request.body) ? request.body : Buffer.from([]);
  const verified = verifySendGridSignature(
    config.sendgridWebhookPublicKey,
    signature,
    timestamp,
    rawPayload
  );

  if (!verified) {
    response.status(401).json({ error: "Invalid SendGrid signature" });
    return;
  }

  const rawPayloadText = rawPayload.toString("utf8");
  const auditHeaders = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key, value ?? undefined])
  );
  const events = JSON.parse(rawPayloadText) as SendGridEvent[];
  const grouped = new Map<string, SendGridEvent[]>();

  for (const event of events) {
    const internalMessageId =
      typeof event.unique_args?.internalMessageId === "string"
        ? event.unique_args.internalMessageId
        : undefined;

    if (!internalMessageId) {
      continue;
    }

    const bucket = grouped.get(internalMessageId) ?? [];
    bucket.push(event);
    grouped.set(internalMessageId, bucket);
  }

  const accepted: string[] = [];
  for (const [internalMessageId, itemEvents] of grouped.entries()) {
    const message = await repository.getMessage(internalMessageId);
    if (!message) {
      continue;
    }

    await repository.saveWebhookEvents(
      internalMessageId,
      itemEvents,
      rawPayloadText,
      true,
      auditHeaders,
      timestamp
    );
    const allEvents = await repository.getEvents(internalMessageId);
    const previousReceiptHash = await repository.getLatestReceiptHash(message.tenantId);
    const receipt = buildEvidenceReceipt({
      message,
      sendgridEvents: allEvents,
      previousReceiptHash
    });

    const existing = await repository.getReceiptByMessageId(internalMessageId);
    if (!existing || existing.receiptHash !== receipt.receiptHash) {
      await repository.saveReceipt(receipt);
    }
    accepted.push(internalMessageId);
  }

  response.json({ accepted });
});

app.post("/dev/simulate-events/:internalMessageId", async (request, response) => {
  const message = await repository.getMessage(request.params.internalMessageId);
  if (!message) {
    response.status(404).json({ error: "Message not found" });
    return;
  }

  const body = request.body as {
    events?: string[];
  };

  const now = Math.floor(Date.now() / 1000);
  const events: SendGridEvent[] = (body.events ?? ["processed", "delivered"]).map(
    (eventName, index) => ({
      event: eventName,
      email: message.recipientAddresses[0],
      timestamp: now + index,
      sg_event_id: `${request.params.internalMessageId}-${eventName}-${index}`,
      sg_message_id: `dev-${request.params.internalMessageId}`,
      response: eventName === "delivered" ? "250 2.0.0 Ok" : undefined,
      status: eventName === "delivered" ? "2.0.0" : undefined,
      tls: 1,
      unique_args: {
        internalMessageId: request.params.internalMessageId
      }
    })
  );

  await repository.saveWebhookEvents(
    request.params.internalMessageId,
    events,
    JSON.stringify(events),
    true,
    {
      "x-dev-simulated": "true"
    },
    new Date().toISOString()
  );

  const allEvents = await repository.getEvents(request.params.internalMessageId);
  const previousReceiptHash = await repository.getLatestReceiptHash(message.tenantId);
  const receipt = buildEvidenceReceipt({
    message,
    sendgridEvents: allEvents,
    previousReceiptHash
  });

  const existing = await repository.getReceiptByMessageId(request.params.internalMessageId);
  if (!existing || existing.receiptHash !== receipt.receiptHash) {
    await repository.saveReceipt(receipt);
  }

  response.json({
    simulated: true,
    accepted: request.params.internalMessageId,
    events: events.map((event) => event.event)
  });
});

app.post("/anchor/:tenantId", async (request, response) => {
  const batch = await repository.createBatch(request.params.tenantId, config.anchorBatchSize);
  if (!batch) {
    response.status(404).json({ error: "No receipts available for tenant" });
    return;
  }

  if (request.query.preview === "true") {
    response.json({ batch, memo: buildAnchorMemo(batch) });
    return;
  }

  if (batch.status === "anchoring") {
    response.status(409).json({ error: "Batch is already being anchored", batch });
    return;
  }

  try {
    const signature = await anchorBatchToSolana(batch);
    await repository.setBatchSignature(batch.batchId, signature);
    response.json({ batch, signature });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown Solana anchor failure",
      batch,
      memo: buildAnchorMemo(batch)
    });
  }
});

app.get("/batches", async (_request, response) => {
  response.json({ batches: await repository.listBatches() });
});

app.get("/batches/:batchId", async (request, response) => {
  const batch = await repository.getBatch(request.params.batchId);
  if (!batch) {
    response.status(404).json({ error: "Batch not found" });
    return;
  }

  response.json({ batch });
});

app.get("/receipts/:internalMessageId", async (request, response) => {
  const receipt = await repository.getReceiptByMessageId(request.params.internalMessageId);
  if (!receipt) {
    response.status(404).json({ error: "Receipt not found" });
    return;
  }

  const inclusion = await repository.findBatchForReceipt(receipt.receiptHash);
  response.json({
    receipt,
    inclusion: inclusion
      ? {
          batch: inclusion.batch,
          leafIndex: inclusion.leafIndex,
          proof: inclusion.proof
        }
      : null
  });
});

app.get("/verify/:internalMessageId", async (request, response) => {
  const packet = await buildVerificationPacket(request.params.internalMessageId);
  if (!packet) {
    response.status(404).json({ error: "Receipt not found" });
    return;
  }

  response.json(packet);
});

app.get("/verify/:internalMessageId/view", async (request, response) => {
  const packet = await buildVerificationPacket(request.params.internalMessageId);
  if (!packet) {
    response.status(404).send("Receipt not found");
    return;
  }

  response.type("html").send(renderVerificationPage(packet));
});

app.get("/verify/:internalMessageId/download", async (request, response) => {
  const packet = await buildVerificationPacket(request.params.internalMessageId);
  if (!packet) {
    response.status(404).json({ error: "Receipt not found" });
    return;
  }

  response.setHeader(
    "Content-Disposition",
    `attachment; filename="evidence-${encodeURIComponent(packet.internalMessageId)}.json"`
  );
  response.json(packet);
});

const start = async (): Promise<void> => {
  try {
    await initSchema();
    repository = new PgRepository();
    storageMode = "postgres";
  } catch (error) {
    console.warn("Postgres unavailable, starting in demo memory mode.");
    console.warn(error);
    repository = new InMemoryRepository();
    storageMode = "memory";
  }

  if (config.enableAnchorWorker) {
    anchorWorker = new AnchorWorker({
      repository,
      batchSize: config.anchorBatchSize,
      intervalMs: config.anchorPollIntervalMs
    });
    anchorWorker.start();
  }
  app.listen(config.port, () => {
    console.log(`mail-anchor listening on :${config.port} (${storageMode})`);
  });
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
