# Cheaper-Than-RMail MVP

## Product position

Build an `RMail alternative`, not a blockchain product.

Primary promise:

- send important email
- get a proof receipt automatically
- verify the receipt independently
- pay less than RMail

## Who this is for

Initial target users:

- legal operations teams
- collections and dunning teams
- HR/compliance teams
- insurance and notice workflows
- any small business already paying for RMail-like proof mail

## MVP scope

The first release only needs five things:

1. Send a high-value email through API or SMTP.
2. Capture canonical MIME and attachment hashes.
3. Ingest provider delivery events and sign a receipt.
4. Return a clean verification packet.
5. Batch-anchor receipt hashes to Solana in the background.

## What can wait

- Outlook plugin
- Gmail plugin
- PDF receipt rendering
- multi-provider failover
- enterprise SSO
- full legal opinion packaging
- inbox UI beyond search and export

## Feature order

1. API send path
2. Receipt verification endpoint
3. Postgres persistence
4. Object storage for evidence bundles
5. Background anchoring job
6. Basic dashboard
7. PDF/exportable receipt packet

## Pricing intent

The goal is not just "cheaper." The goal is "cheaper with enough trust."

Suggested early pricing model:

- low monthly base fee
- included proof emails
- predictable overage pricing
- free verification links for recipients and auditors

## Commercial wedge

Do not sell "Solana."

Sell:

- proof of sending
- proof of content
- proof of delivery timeline
- independently verifiable receipts
- lower total cost than RMail

## Immediate engineering next steps

1. Replace the in-memory store with Postgres.
2. Add a real outbound send path that injects `internalMessageId` into SendGrid metadata.
3. Store raw webhook payloads and verification status for auditability.
4. Persist evidence bundles to immutable object storage.
5. Add a public verification page that reads a receipt and Merkle proof.
