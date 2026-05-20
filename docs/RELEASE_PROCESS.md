# Release process

The conceptual flow. For operator commands (npm dist-tags, secrets, manual fallbacks) see [`../PUBLISHING.md`](../PUBLISHING.md).

## Release channels

| Channel | npm dist-tag | Audience | SLA |
|---|---|---|---|
| **Stable** | `latest` | Production hosts | Critical security fixes for 6 months per major; tracking-major fixes ongoing |
| **Beta** | `beta` | Integration testing | Until next beta or until promoted to stable |
| **Alpha** | `alpha` | Internal + early adopters who accept rapid change | No SLA; only the current alpha is supported |
| **Canary** | `canary` (future) | Per-commit `main` builds | No SLA; available if/when we enable continuous publishing |

`npm install @doccop/core` always picks up the latest `stable`. Pre-release channels require an explicit `@beta` / `@alpha` suffix or `--tag` flag.

## Promotion criteria

### Alpha → Beta

- All planned features for the minor are merged.
- Public API surface set frozen (no further additive changes planned during beta).
- `npm run api:update` regenerated and committed.
- `CHANGELOG.md` reflects everything in the alpha series under the upcoming beta heading.
- Integration test suite green on the matrix (Node 20 + 22).
- At least one external host has integrated the current alpha and reported back with no blocking issues.

### Beta → RC (or directly to Stable)

- Zero open `bug` issues with severity `critical` or `high` against the target version.
- Beta has been available for at least one full traffic cycle from real consumers (≥ 7 days, ideally longer for major releases).
- All P0 documentation (`README`, `QUICKSTART`, `INTEGRATION`, `ARCHITECTURE`, `SECURITY`) reflects the beta API surface.
- Migration guide populated if the beta introduced any deprecation or behaviour change since the previous stable.
- A "release notes" entry drafted from the CHANGELOG.

### Stable → next major

- Pre-1.0 we are not making any "next major" plans yet. Once we ship 1.0, the next major is gated by:
  - Sufficient breaking-change volume to justify the version bump (small breaks pile up into a 1.x deprecation window rather than triggering 2.0 individually).
  - A migration guide tested against the largest external host.
  - At least 30 days of "1.x → 2.x" deprecation warnings live on the previous stable line.

## v1.0 stable criteria

The concrete blockers. Move to ✅ when satisfied; this section is the single source of truth.

- [x] Public API frozen and snapshot-tested via api-extractor for `@doccop/core`, `@doccop/server`, `@doccop/storage-postgres`
- [x] `docs/QUICKSTART.md`, `docs/INTEGRATION.md`, `docs/ARCHITECTURE.md` populated and walked through end-to-end
- [x] `SECURITY.md` published with disclosure channel
- [x] CI matrix covers Node 20 + Node 22
- [x] License-check automation in CI (allowed: MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC + CC0/CC-BY-4.0/0BSD/Python-2.0/BlueOak)
- [x] `Logger` injection interface shipped; no `console.*` in `src/`
- [x] i18n strategy documented; `DocCopError.code` is the contract
- [x] `docs/migrations/TEMPLATE.md` exists; populated for any breaking changes since 0.x
- [x] `demo-app/` deployable via `npm run start` (Fastify + in-memory stores)
- [x] `CODE_OF_CONDUCT.md`, GitHub issue/PR templates
- [ ] Real-world `.docx` corpus committed under `test/fixtures/real/`; parser + render stability tests exercise it
- [ ] `@doccop/headless` + `@doccop/react-ui` published with stable API (Wave 14 — explicit v2 deferral if not ready)
- [ ] Third-party security audit (stretch — see `../SECURITY.md`)

## Version coordination

**All `@doccop/*` packages release together with the same version.** Cross-package dependencies are exact-pinned (no `^`):

```jsonc
// packages/server/package.json
"dependencies": {
  "@doccop/core": "0.2.0"      // exact, never "^0.2.0"
}
```

Why exact:

- The engine's public API and the server's expectations move in lockstep; a server compiled against `core@0.2.0`'s types is not guaranteed to compile against `core@0.2.1`'s types even though semver says "patch".
- Consumers pinning all `@doccop/*` to the same exact version is the simplest mental model.
- Once a stable release is cut, exact pins let us issue a patch on one package without dragging dependent packages along.

**Bumping is mechanical, not creative.** The chosen suffix follows the channel ladder:

| Current | Next iteration | Next channel |
|---|---|---|
| `0.X.Y-alpha.N` | `0.X.Y-alpha.N+1` | `0.X.Y-beta.0` |
| `0.X.Y-beta.N` | `0.X.Y-beta.N+1` | `0.X.Y-rc.0` *(if needed)* or `0.X.Y` (stable) |
| `0.X.Y` (stable) | `0.X.(Y+1)` (patch) or `0.(X+1).0-alpha.0` (next minor's alpha) | — |

`-rc` is optional — we skip it for releases where beta soak surfaced no blocking issues.

## Deprecation policy

**Pre-1.0 (current).** Anything in the public API can break in a minor bump. We try to avoid it, but the `0.x` semver convention permits it and we use that latitude when an API turns out to be wrong. Every break must:

- be labelled `breaking-change` on the PR;
- have a populated migration note under `docs/migrations/`;
- be called out at the top of the CHANGELOG entry, not buried.

**Post-1.0 (future).** Deprecations get a minimum two-minor-version grace period:

1. Symbol marked `@deprecated` in TSDoc; CHANGELOG entry under `Deprecated`.
2. Released in the next minor (`1.X.0`). Hosts can update at their pace.
3. Earliest removal: `1.(X+2).0`. Removal CHANGELOG entry references the original deprecation.

We do not delete symbols inside a patch (`1.X.Y → 1.X.(Y+1)`) — patches are bug-fix only.

## Rollback

If a published release reaches `latest` and we discover a blocking defect:

1. **Communicate first.** Open a GitHub Issue titled `[release] X.Y.Z rolled back — <reason>`, pin it, link the offending release.
2. **Deprecate via npm.** Run `npm deprecate "@doccop/core@X.Y.Z" "Rolled back — see GH issue #N"` for each affected package. This shows a warning to anyone installing the bad version but does NOT unpublish (unpublishing inside the 72h window is technically possible but considered hostile to consumers who already pulled the version).
3. **Move the `latest` tag back.** `npm dist-tag add @doccop/core@X.Y.(Z-1) latest`. Repeat for each `@doccop/*` package.
4. **Patch forward.** Fix the defect, cut `X.Y.(Z+1)` through the normal release workflow. The old `X.Y.Z` keeps its deprecation warning.
5. **Post-mortem.** Add a section to the rollback issue: what failed, why CI missed it, what test or check we'd add to catch it earlier. Resolve the issue only when the catching mechanism is in place.

## Release-day checklist

When you're cutting a stable:

- [ ] All "stable criteria" items above are ✅
- [ ] No open `bug` / severity-`high+` issues against the target version
- [ ] `npm run lint && npm run build && npm test && npm run api:check && npm run license:check` — all exit 0 on the candidate commit (not from a pipeline-masked output)
- [ ] Version bumps committed (all `@doccop/*` packages + `package-lock.json` synced)
- [ ] CHANGELOG section closed under `[X.Y.Z] - YYYY-MM-DD`; `[Unreleased]` opened above it
- [ ] Migration doc (if breaking) committed under `docs/migrations/`
- [ ] Git tag `vX.Y.Z` created and pushed (`git push --follow-tags`)
- [ ] GitHub Actions: `doccop release` workflow triggered with `dist-tag=latest`
- [ ] After workflow succeeds: `npm view @doccop/core` confirms the new version is `latest`
- [ ] After workflow succeeds: run the demo-app against the published packages (replace workspace links with version pins) — confirms publication actually works for external consumers
- [ ] Release notes posted to GitHub Releases (copy from CHANGELOG)

See [`../PUBLISHING.md`](../PUBLISHING.md) for the exact commands and the one-time GitHub Secrets setup.
