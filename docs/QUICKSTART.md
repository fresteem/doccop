# Quickstart

Get from "I've never seen doccop" to "I rendered my first document" in under 10 minutes.

> **Status:** outline. Each section TODO before v1.0 stable. Owner: doccop-docs-writer.

## Prerequisites

- Node ≥ 20, npm ≥ 10
- Postgres ≥ 14 (optional for in-memory mode)

## 1. Install

TODO — `npm install @doccop/core @doccop/server @doccop/storage-postgres`

## 2. Run the demo app

TODO — clone `demo-app/`, `docker compose up postgres`, `npm run dev`, open `http://localhost:3000`.

## 3. Upload your first template

TODO — drag a `.docx` into the demo UI; show what doccop discovers (placeholders, paragraph anchors).

## 4. Define a variable

TODO — highlight text, choose scope (`party_a`/`system`/`custom`), pick a data type, save. Explain the `<scope>.<key>` tag format.

## 5. Wire an entity resolver

TODO — minimal `EntityResolver` example: returns hardcoded values. Point to `INTEGRATION.md` for real adapter implementations.

## 6. Render

TODO — `POST /v1/documents` with parties bound to entities. Show the resulting `.docx` download and the audit row.

## What next

- [`INTEGRATION.md`](./INTEGRATION.md) — wire doccop into your existing host application (Supabase / your own DB / S3 / etc.)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the engine actually works
- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) — versioning and upgrade policy
