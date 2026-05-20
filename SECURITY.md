# Security Policy

doccop processes user-uploaded `.docx` files and renders documents from external data. We take security seriously.

## Reporting a vulnerability

**Do not file public GitHub issues for security bugs.**

Report privately via [GitHub Security Advisories](https://github.com/fresteem/doccop/security/advisories/new).

Expected response time:
- Acknowledgement: within 3 business days.
- Triage + initial assessment: within 7 business days.
- Coordinated disclosure: agreed with reporter, typically 30–90 days depending on severity and the existence of a fix.

We do not currently run a bug bounty. Significant reports are credited in the release CHANGELOG (with reporter consent).

## Supported versions

| Version | Status | Security fixes |
|---|---|---|
| `0.x-alpha` | Active development | Best-effort on `main` |
| `0.x-beta` | (Future) | Latest beta only |
| `1.x` | (Future) | Current major + previous major for 6 months |

Pre-1.0 we ship security fixes on `main` only. Once 1.x is out, we backport critical and high-severity fixes per the matrix above.

## Threat model

doccop's threat surface, in descending order of attacker-controlled input:

1. **Uploaded `.docx` bytes.** The most likely attack vector. We defend with:
   - 10 MiB hard size limit (`MaxTemplateBytes` / `MaxSnippetBytes` in `EngineLimits`)
   - Strict ZIP entry validation via `pizzip`
   - **XXE rejection**: `parseXmlSafely` refuses any document containing `<!ENTITY` declarations (`XxeDetectedError`)
   - 500-placeholder cap per template (`MaxPlaceholders`)
   - 30-second render timeout (`RenderTimeoutMs`)
2. **Placeholder tags from clients.** Validated against strict regex in `TagValidator`. Tag and alias length bounded.
3. **Multipart upload streams.** Streamed via `@fastify/multipart` with bounded backpressure; never written outside the host-controlled `StorageAdapter`.
4. **HTML preview output.** Every text and attribute value is escaped via `escape.ts` (defence-in-depth: escapes `<` and `>` in attributes too, not just `&` and `"`). XSS-safe by construction.
5. **Idempotency keys.** Namespaced by `(key, user_id)` — two users sharing a key see distinct rows. No cross-user collision possible.
6. **Filesystem blob storage.** `FilesystemBlobStorage` sanitises owner ids, blocks path-traversal attempts, wraps fs errors in `StorageFailedError`.

Out of doccop's threat boundary (host responsibility):
- Authentication and authorization (host provides `AuthAdapter`).
- Database access control (host provides Drizzle/other connection).
- Transport security (TLS termination, header hardening — host configures Fastify).
- Resolver implementations — hosts must not leak data across users in their own `EntityResolver` code.

## Cryptographic dependencies

The engine has none. All transport/signing is host-controlled. The reference Postgres adapter relies on the host's `postgres` client TLS configuration.

## Supply chain

- All published packages use **npm provenance** (`--provenance` flag in the release workflow). The attestation is signed by GitHub for our public runners.
- All transitive dependencies are MIT / BSD / Apache-2.0 / ISC. CI fails on disallowed licenses.
- Dependency updates are reviewed manually before merge — we deliberately do not run Dependabot auto-merge on `main`.

## Audit history

| Date | Auditor | Scope | Outcome |
|---|---|---|---|
| — | — | — | No third-party audit performed yet |

Third-party security audit is a stretch goal before 1.0 stable. If your organisation depends on doccop and would sponsor or perform an audit, please reach out via the security advisories channel above.

## Acknowledgements

(Reporters credited here on first responsible disclosure.)
