# API

This document covers the current MVP API surface.

Base URL:

```text
http://localhost:3000
```

## Health

`GET /health`

Response:

```json
{
  "ok": true
}
```

## Send Message

`POST /send`

Request:

```json
{
  "tenantId": "tenant-a",
  "recipientAddresses": ["counterparty@example.net"],
  "subject": "Notice of Amendment",
  "textBody": "Please review the attached change notice.",
  "htmlBody": "<p>Please review the attached change notice.</p>"
}
```

Response:

```json
{
  "accepted": true,
  "internalMessageId": "9d6c2d4d-....",
  "providerMessageId": "...."
}
```

## Dev Send

`POST /dev/send`

Development-only helper route. Creates the canonical message record without calling SendGrid.

## Dev Simulated Events

`POST /dev/simulate-events/:internalMessageId`

Development-only helper route. Persists simulated provider events and regenerates the receipt.

Example request:

```json
{
  "events": ["processed", "delivered"]
}
```

## SendGrid Event Webhook

`POST /sendgrid/events`

Expected headers:

- `X-Twilio-Email-Event-Webhook-Signature`
- `X-Twilio-Email-Event-Webhook-Timestamp`

The request body must be the raw SendGrid event array.

Response:

```json
{
  "accepted": ["9d6c2d4d-...."]
}
```

## Receipt Lookup

`GET /receipts/:internalMessageId`

Response:

```json
{
  "receipt": {
    "version": 1,
    "tenantId": "tenant-a",
    "internalMessageId": "9d6c2d4d-....",
    "provider": "sendgrid",
    "mimeSha256": "...",
    "receiptHash": "...",
    "signature": "..."
  },
  "inclusion": null
}
```

## Verification Packet

`GET /verify/:internalMessageId`

Returns:

- receipt payload
- Merkle inclusion data if batched
- verification flags

## Verification Page

`GET /verify/:internalMessageId/view`

Returns an HTML proof page for human review.

## Download Evidence Packet

`GET /verify/:internalMessageId/download`

Returns the verification packet as a downloadable JSON file.

## List Batches

`GET /batches`

Returns all locally known batches.

## Batch Detail

`GET /batches/:batchId`

Returns one batch with current status and any Solana signature.

## Preview Or Anchor Batch

`POST /anchor/:tenantId?preview=true`

Builds a batch and returns the Solana memo payload without submitting.

`POST /anchor/:tenantId`

Attempts to anchor the batch immediately.

If `ENABLE_ANCHOR_WORKER=true`, pending batches may also be anchored automatically in the background.
