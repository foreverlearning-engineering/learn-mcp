# Hosted documentation release preparation

November 25, 2026. Local preparation only; no push, deployment or publication.

## Completed

- Isolated branch `content/hosted-docs-20261125` combines the existing Conversations package with Learn's fifty-attempt documentation change.
- Both snapshots refreshed from the production developer site. Learn: six verified kits, Class still held for terms-publication confirmation. Conversations: all five revised kits withheld pending verification and public-page parity; step 3 is now represented in the manifest.
- Node-compatible fetch adapter for two configurable routes, explicit hosts/origins, bounded request bodies and a source/snapshot health receipt.
- Portable, hash-inventoried artifact builder; production dependency installation succeeds without publishing our packages to npm.
- URL-first connection copy in README, marked draft for owner readback. Optional local-package instructions remain a separate route.
- Existing suites pass: Learn 15/15, Conversations 26/26. The artifact check uses a real Streamable HTTP client and passes discovery, tools, resources, prompts, withheld-kit behavior, rejected generation/lookup tools, host/origin/body checks and identity verification. No external fetch occurs during that check.

## Reproduce

1. `npm ci --ignore-scripts`
2. `npm test`
3. `npm --prefix packages/conversations-mcp test`
4. `node scripts/prepare-hosted.mjs artifacts/<new-candidate-name>`
5. In the artifact: `npm ci --omit=dev --ignore-scripts`
6. From the repository: `node scripts/check-hosted.mjs artifacts/<new-candidate-name> artifacts/<new-candidate-name>-check.json`

The builder refuses existing output directories. A clean source commit is required for a release artifact; its `hosted-build.json` reports source commit, source dirty state, content hash, per-file hashes and snapshot qualifications. It does not claim any provider deployment identity.

## Developers reply needed

Confirm final URLs (proposed `/mcp/learn` and `/mcp/conversations`), Node-compatible hosting target and deployment adapter, preview routes, proxy behavior, supported assistant applications, production sequence and operational limits/monitoring. The adapter currently rejects unlisted Origin headers; browser CORS support must be implemented and checked if a supported client needs it. Transport-library testing does not establish compatibility with every assistant application.

Deployment can proceed with guides/contracts/examples while pending kits remain unavailable. The separate safe-runtime window is needed for live kit and optional test-turn qualification, not hosted docs checks. The local Conversations test-turn tool still needs reconciliation with current test/live and closeout behavior; it is not registered by this hosted artifact.

Remaining acceptance: qualified preview HTTPS/proxy, actual advertised assistant connections, operational controls, approved public copy, production release/readback, registry remote entries and site connection links. No CCD dependency remains.
