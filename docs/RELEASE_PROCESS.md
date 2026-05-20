# Release process

The conceptual flow. For the operator runbook (npm commands, dist-tags, secrets) see [`../PUBLISHING.md`](../PUBLISHING.md).

> **Status:** outline. Each section TODO before v1.0 stable. Owner: doccop-docs-writer.

## Release channels

| Channel | npm dist-tag | Audience | SLA |
|---|---|---|---|
| **Stable** | `latest` | Production hosts | 6-month security fixes per major |
| **Beta** | `beta` | Integration testing | Until next beta or stable |
| **Alpha** | `alpha` | Internal + early adopters | No SLA; current alpha only |
| **Canary** | `canary` (future) | Per-commit `main` build | No SLA |

## Promotion criteria

TODO — what must be true to promote from alpha → beta → RC → stable.

## v1.0 stable criteria

Concrete blockers tracked in this section. Move to ✅ when satisfied.

- [ ] Public API frozen and snapshot-tested via api-extractor for `@doccop/core`, `@doccop/server`, `@doccop/storage-postgres`, `@doccop/headless`, `@doccop/react-ui`
- [ ] `docs/QUICKSTART.md`, `docs/INTEGRATION.md`, `docs/ARCHITECTURE.md` fully populated and walked through end-to-end
- [ ] `SECURITY.md` published; vulnerability reporting channel verified
- [ ] CI matrix covers Node 20 + Node 22
- [ ] License-check automation in CI (allowed: MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC)
- [ ] Real-world `.docx` corpus committed under `test/fixtures/real/`; parser + render stability tests green
- [ ] `Logger` injection interface shipped; no `console.*` in `src/`
- [ ] i18n strategy documented; `DocCopError.code` is the contract
- [ ] `docs/migrations/TEMPLATE.md` exists; populated for any breaking changes since 0.x
- [ ] `demo-app` deployable via `docker compose up`
- [ ] `@doccop/headless` + `@doccop/react-ui` published with stable API
- [ ] Third-party security audit (stretch — see `SECURITY.md`)

## Version coordination

TODO — all packages bump together. Exact-version cross-package dependencies (no `^`). Why.

## Deprecation policy

TODO — how we announce, the grace period, when symbols can finally be removed. Tied to `breaking-change` PR label.

## Rollback

TODO — `npm deprecate` flow, communication checklist, post-mortem template.
