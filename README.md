# mail-anchor

`mail-anchor` is an MVP for verifiable proof email.

It is aimed at the same class of use cases as `RMail`: important notices, compliance mail, collections, HR delivery records, and other messages where proving what was sent matters more than bulk throughput.

The product goal is simple:

- send important email
- capture evidence automatically
- verify the receipt later
- keep it cheaper and more API-friendly than legacy proof-email vendors

## What It Does

- Sends mail through SendGrid with an internal proof ID
- Stores canonical message metadata in Postgres
- Verifies signed SendGrid Event Webhook payloads
- Builds a hashed evidence receipt
- Shows a human-readable verification page
- Batches receipt hashes for optional Solana anchoring

## What It Does Not Do

- store email content on-chain
- replace your mail transport stack
- provide legal advice
- match full enterprise RMail workflow parity yet

## Architecture

The design is intentionally narrow:

1. `POST /send` creates a canonical message record and sends via SendGrid
2. `POST /sendgrid/events` ingests signed provider delivery events
3. the app generates a tamper-evident receipt
4. `GET /verify/:internalMessageId/view` renders a proof page
5. batches can be previewed or anchored to Solana

Only hashes and batch metadata should ever be anchored on-chain.

## Project Status

Current status: `MVP in progress`

Working now:

- API send path
- webhook verification path
- Postgres persistence
- receipt generation
- JSON verification packet
- HTML verification page
- manual batch preview
- optional background anchor worker

Still missing for production:

- immutable evidence bundle storage
- proper tenant/auth model
- stronger operational metrics and alerts
- PDF evidence export
- polished dashboard and admin UX

## Repo Layout

```text
.
├── docs/
│   ├── api.md
│   └── mvp-roadmap.md
├── migrations/
│   └── 001_init.sql
├── src/
│   ├── server.ts
│   ├── repository.ts
│   ├── receipt.ts
│   ├── sendgrid.ts
│   ├── solana.ts
│   └── ...
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Requirements

- Node.js 22+
- PostgreSQL 16+
- SendGrid account
- optional Solana keypair and RPC endpoint for live anchoring

## Quick Start

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Fill in the required values in `.env`:

- `DATABASE_URL`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_ADDRESS`
- `SENDGRID_WEBHOOK_PUBLIC_KEY`
- `RECEIPT_SIGNING_SECRET`

Example:

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mail_anchor
SENDGRID_WEBHOOK_PUBLIC_KEY=your-sendgrid-webhook-public-key
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_ADDRESS=notices@example.com
RECEIPT_SIGNING_SECRET=replace-with-a-long-random-secret
ENABLE_ANCHOR_WORKER=false
ANCHOR_POLL_INTERVAL_MS=15000
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_COMMITMENT=confirmed
SOLANA_KEYPAIR_PATH=
SOLANA_MEMO_PROGRAM_ID=MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
ANCHOR_BATCH_SIZE=100
```

Notes:

- `.env` is for local secrets and should not be committed
- `.env.example` is the template that should be committed
- if you are only testing the MVP flow, you can leave `SOLANA_KEYPAIR_PATH` empty
- set `ENABLE_ANCHOR_WORKER=true` only when you want automatic Solana anchoring

3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

The server listens on `http://localhost:3000`.

## Docker Quick Start

For Ubuntu or any machine with Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

Before running `docker compose up`, edit `.env` and fill in the required values listed above.

Useful commands:

```bash
docker compose ps
docker compose logs -f app
docker compose down
```

The compose stack starts:

- `app` on port `3000`
- `postgres` on port `5432`

## Minimal Test Flow

1. Start the service
2. Send a message:

```bash
curl -s http://localhost:3000/send \
  -H 'content-type: application/json' \
  -d '{
    "tenantId":"tenant-a",
    "recipientAddresses":["you@example.com"],
    "subject":"Proof Mail Test",
    "textBody":"This is a proof-mail test."
  }'
```

3. Save the returned `internalMessageId`
4. Let SendGrid post events to `POST /sendgrid/events`
5. Open:

```text
http://localhost:3000/verify/<internalMessageId>/view
```

## Team Onboarding

For a new teammate:

1. Clone the repo
2. Copy `.env.example` to `.env`
3. Ask for the shared development values for:
   - `SENDGRID_API_KEY`
   - `SENDGRID_FROM_ADDRESS`
   - `SENDGRID_WEBHOOK_PUBLIC_KEY`
   - `RECEIPT_SIGNING_SECRET`
4. Start Postgres locally or use Docker Compose
5. Run `npm install`
6. Run `npm run dev`

Rules:

- never commit `.env`
- rotate shared secrets if they are accidentally exposed
- use `.env.example` as the source of truth for required variables

## Fast Smoke Test

If you want a quick MVP demo without waiting on real SendGrid delivery callbacks:

1. Start the service
2. Run:

```bash
npm run smoke
```

This uses two dev-only routes:

- `POST /dev/send`
- `POST /dev/simulate-events/:internalMessageId`

The script:

- creates a local message record
- simulates `processed` and `delivered` provider events
- builds the receipt
- previews a batch
- prints the verification URL

This is for development only. Real proof flow still depends on `POST /send` and real SendGrid webhook events.

## SendGrid Setup

Configure SendGrid Event Webhook to point at:

```text
POST /sendgrid/events
```

Recommended enabled events:

- `processed`
- `delivered`
- `deferred`
- `bounce`
- optionally `open`
- optionally `click`

Signature verification should be enabled.

## Solana Anchoring

Anchoring is optional for the MVP.

Without Solana, the product still gives you:

- canonical message capture
- delivery event evidence
- signed receipt generation
- verification packet rendering

With Solana configured, you can:

- preview a batch memo with `POST /anchor/:tenantId?preview=true`
- manually anchor a batch with `POST /anchor/:tenantId`
- enable background anchoring with `ENABLE_ANCHOR_WORKER=true`

Batch states:

- `pending`
- `anchoring`
- `anchored`
- `failed`

## API Surface

Main endpoints:

- `GET /health`
- `POST /send`
- `POST /sendgrid/events`
- `GET /receipts/:internalMessageId`
- `GET /verify/:internalMessageId`
- `GET /verify/:internalMessageId/view`
- `GET /verify/:internalMessageId/download`
- `GET /batches`
- `GET /batches/:batchId`
- `POST /anchor/:tenantId`

See [docs/api.md](docs/api.md) for request and response examples.

## Security Notes

- keep raw message bodies and attachments off-chain
- use a strong `RECEIPT_SIGNING_SECRET`
- protect SendGrid webhook verification keys
- treat this as evidence tooling, not absolute proof of human reading
- use immutable object storage before calling this production-ready

## Roadmap

See:

- [docs/mvp-roadmap.md](docs/mvp-roadmap.md)
- [docs/api.md](docs/api.md)
- [migrations/001_init.sql](migrations/001_init.sql)

## Development

Typecheck:

```bash
npm run check
```

Build:

```bash
npm run build
```

## Contributing

This is still an MVP codebase. Keep changes small, testable, and directly tied to the proof-email workflow.

If you extend it, prefer this order:

1. evidence quality
2. persistence and auditability
3. verification UX
4. operational safety
5. integration polish
# mailmail
