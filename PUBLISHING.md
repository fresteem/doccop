# Publishing doccop

Once-only setup, then per-release.

## One-time setup

1. **Create npm organisation** at <https://www.npmjs.com/org/create>:
   - Name: `doccop`
   - Plan: Free for public packages
2. **Create npm automation token**:
   - <https://www.npmjs.com/settings/<your-user>/tokens>
   - Type: **Automation** (bypasses 2FA for CI publishes)
   - Scope: Read and write
   - Copy the token (`npm_xxxxxx...`)
3. **Add token to GitHub repo**:
   - Repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: the token from step 2

## Releasing a new version

The release workflow is `workflow_dispatch` — kicked off manually from the GitHub UI.

1. Bump versions in `packages/*/package.json`. Every package version must agree
   with the inter-package `dependencies` entries (e.g. `@doccop/server` must list
   the same version of `@doccop/core` it expects).
2. Update `CHANGELOG.md` under a new heading.
3. Commit and tag:
   ```bash
   git commit -am "release: 0.1.0-alpha.1"
   git tag v0.1.0-alpha.1
   git push --follow-tags
   ```
4. Trigger the `doccop release` workflow:
   - Repo → Actions → "doccop release" → Run workflow
   - Choose dist-tag (`alpha`, `beta`, or `latest`)
5. The workflow builds, tests, and publishes all three packages in dependency
   order with `--provenance`.

## Local publishing (emergency)

If CI is broken and you need to publish from a local machine:

```bash
npm ci
npm run build
npm test

cd packages/core
npm publish --provenance --access public --tag alpha

cd ../server
npm publish --provenance --access public --tag alpha

cd ../storage-postgres
npm publish --provenance --access public --tag alpha
```

You'll need `npm login --scope=@doccop` first.

## Version bump conventions

- **Patch** (`0.1.0` → `0.1.1`): bug fixes, no API change.
- **Minor** (`0.1.0` → `0.2.0`): new features, additive API.
- **Major** (`0.1.0` → `1.0.0`): breaking API changes; bump after the v1 freeze.
- **Pre-release** suffix (`-alpha.N`, `-beta.N`): for unstable iteration before v1.
