# Contributing to doccop

Thanks for your interest in contributing.

## Development setup

```bash
cd doccop
npm install
npm run build
npm test
```

Requires Node >= 20 and npm >= 10.

## Workflow

1. Open an issue describing the change.
2. Fork + create a feature branch.
3. Make changes with tests.
4. Ensure `npm run lint`, `npm run typecheck`, `npm test` all pass.
5. Open a pull request.

## Architectural ground rules

These exist to keep doccop OSS-extractable from its current host:

- **No imports from outside `doccop/`**. Each package is self-contained. The host application integrates via the published interfaces only.
- **No commercial-license dependencies**. All transitive deps must be MIT/BSD/Apache/ISC. CI enforces via SBOM check.
- **No hard-coded business logic**. Variable keys, entity types, storage details — all behind interfaces in `@doccop/core/types.ts`.
- **Strict TypeScript**. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, all the strict flags. No `any`.
- **Errors are typed**. Custom error classes from `@doccop/core/errors.ts`. No throwing strings.

## Coding style

`biome.json` is the source of truth. Run `npm run format` before committing.

## License

By contributing you agree your contributions are MIT-licensed.
