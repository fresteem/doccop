# Migration: X.Y → X.Y+1

> Copy this file to `docs/migrations/<from>-to-<to>.md` for any release that contains a breaking change. Delete the unused sections.

## Summary

One paragraph: what changed at a high level, why, and what consumers must do.

## Breaking changes

For each: what broke, why, the failure mode (compile error / runtime error / silent semantic change), and the fix.

### Example: `EntityResolver.resolve` now returns `Promise<ResolvedValue>` instead of `ResolvedValue`

- **Affected**: every host that ships an `EntityResolver` implementation.
- **Failure mode**: `TypeError: cannot read property 'kind' of [object Promise]` at render time.
- **Fix**:

  ```diff
  - resolve(key, ctx): ResolvedValue {
  + async resolve(key, ctx): Promise<ResolvedValue> {
      return { kind: "text", value: lookup(key) };
    }
  ```

## Deprecations

Symbols still present but scheduled for removal in the next major.

| Symbol | Replacement | Removal target |
|---|---|---|
| (none) | — | — |

## Removals

Symbols removed in this release. If present, this section must be non-empty.

| Symbol | Replacement |
|---|---|
| (none) | — |

## New optional fields / methods

Additive changes worth highlighting. Existing code keeps working without changes.

| Symbol | What | When to adopt |
|---|---|---|
| (none) | — | — |

## Behavioural changes (non-breaking but visible)

Changes that don't break compilation but might surprise. e.g. defaults flipped, log verbosity, performance.

| Change | Impact | Mitigation |
|---|---|---|
| (none) | — | — |

## Security fixes

If any: CVE id (or `none-assigned`), CVSS, who reported. Cross-link to advisory.

## Upgrade checklist for hosts

- [ ] Update `@doccop/*` versions in `package.json` (all together)
- [ ] Re-run `npm install` and `npm run build`
- [ ] Apply diffs from the Breaking Changes section
- [ ] Run host integration tests
- [ ] Watch render warnings in staging for one full traffic cycle

## Internal notes

(For maintainers — release date, PR links, audit footprint. Not consumer-facing.)
