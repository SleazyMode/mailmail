# Contributing

This repository is still an MVP. Keep changes narrow and practical.

## Priorities

Work in this order:

1. evidence correctness
2. persistence and audit trail quality
3. verification usability
4. operational safety
5. extra integrations

## Local Development

```bash
cp .env.example .env
npm install
npm run dev
```

Typecheck before handing off work:

```bash
npm run check
```

## Scope Discipline

Avoid spending time on:

- blockchain-heavy features that do not improve evidence quality
- fancy setup UX before the core proof flow is solid
- broad dashboard work before verification and audit paths are reliable

## MVP Standard

A good change should make at least one of these better:

- send flow
- webhook evidence capture
- receipt generation
- verification packet quality
- anchor job reliability
