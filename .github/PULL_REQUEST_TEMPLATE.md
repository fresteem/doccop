<!-- Thanks for contributing! A few checks before you submit. -->

## What

<!-- One paragraph: what changes, and why. Link the issue if any. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (additive, non-breaking)
- [ ] Breaking change (requires `breaking-change` label + migration note)
- [ ] Documentation only
- [ ] Build / CI / tooling

## Pre-merge checklist

- [ ] `npm run lint && npm run build && npm test` all pass locally
- [ ] `npm run api:check` passes — OR PR is labelled `breaking-change` and `docs/migrations/X.Y-to-X.Y+1.md` is populated
- [ ] New deps: license verified (MIT / BSD / Apache-2.0 / ISC) and noted in CHANGELOG with the license string
- [ ] CHANGELOG entry added under `[Unreleased]` in the relevant section (Added / Changed / Fixed / Security)
- [ ] Tests cover happy path AND every rejection / error branch (engine code) or every status code (server code)
- [ ] Public symbols have TSDoc; internal helpers have short prose comments explaining *why*, not *what*

## Public API impact

<!--
If this PR changes any exported type, function, error class, or HTTP route/status:
- Describe the change here
- Confirm the `etc/<pkg>.api.md` snapshot was regenerated (`npm run api:update`)
- Confirm a migration note was added if the change is breaking
-->

## How to verify

<!--
For reviewers: how would they manually verify this works end-to-end?
Include curl commands, code snippets, or links to the affected test files.
-->

## Related

<!-- Link the issue this closes (e.g. `Closes #123`) and any related PRs. -->
