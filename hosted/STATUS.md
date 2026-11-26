# Hosted documentation release preparation

## November 26: rc4, the candidate for the joint production step

- **Pinned source commit `fe29388`**, tag `hosted-docs-rc4`, on `main` of the private repository. Artifact `release-candidate-04`: content digest `7869404b1c403e88f97dcefd381e3f0a2770289fae72dcadeae911cd45b4748c`, `sourceDirty: false`, `check-hosted` passed (`artifacts/release-candidate-04-check.json`). Bundle `artifacts/hosted-docs-fe29388.tgz` (no node_modules), SHA-256 `558f2d878dd9dfe682881ce551874f8a6685a634f381cfb883afcae1f369feb2`.
- **Snapshots** read from the developers staging site (deploy 6b08400b), the content the joint production step will serve, with every rendered site address rewritten to the public site. Against production reads (`scripts/compare-snapshots.mjs`), the only differences are the ones the release brings: Learn's guide gains the hosted MCP line (section `access`) and "Usage" becomes "Billing, under Charges" (section `open-session`); `developer-runtime.openapi.json` and its schema gain the Reporting read; the five Conversations kits are bundled as verified (6 of 6 counted runs each on runtime 2026.11.25.4, starter `fe714db`, US spellings under ruling C22). The staging API host appears only where production also names it. Learn: six verified kits, Class coming soon until the terms revision publishes.
- **Also in rc4 since rc3:** the Conversations test-turn tool reconciled with the November 25 runtime (local stdio only; not in the hosted bundle), `maxRequestBodySize` passed to the SDK by both hosted handlers, `check-hosted` judging every kit by the snapshot's state.
- Tests: Learn 15/15, Conversations 29/29. The hosted graph is unchanged in shape (11 files; `@modelcontextprotocol/server` and `zod/v4` only).
- After the joint production publish: fetch production's served guide and contract bytes and compare with the snapshot digests; equal means rc4 stands, different means a docs refresh (Worker only).

## November 25, later: the pinned artifact for the Developer Platform lane

Terry: "lets do the repo now since thats the real fix", and "yes we can proceed with the fixes".

- **Pinned source commit `e40d74d`** on `content/hosted-docs-20261125`, tagged `hosted-docs-rc3`, pushed to the private repository `https://github.com/foreverlearning-engineering/learn-mcp` as `main`. Terry created the repository; the Conversations package lives in it under `packages/conversations-mcp`.
- **Artifact `release-candidate-03`**, built from that commit with `sourceDirty: false`: content digest `a42033a11cd8aa514aedc1c17308c30e770ba42dd23553fcbada89f91e081236`. `check-hosted` on those bytes: passed (`artifacts/release-candidate-03-check.json`). Bundle `artifacts/hosted-docs-e40d74d.tgz` (without node_modules; run `npm ci --omit=dev --ignore-scripts` inside), SHA-256 `0dd2c9693284b0879a5dae2e6c4087cd23826b5adcc7dac1bc6a8649d52e35fe`.
- **What changed since `b14bee1`,** answering the Developer Platform reply's H2 items:
  1. A clean, fetchable commit: the repository above.
  2. A web-standard hosted entry: `hosted/handler.mjs` takes the two snapshots and `hosted-build.json` as objects; its import graph is 11 files with only `@modelcontextprotocol/server` and `zod/v4` as bare imports, and no `node:` module, Node adapter, `Buffer`, `process` or file read. `check-hosted` walks the graph and fails on any of those.
  3. A docs-only factory: `docs-server.ts` in each package imports none of the turn, lookup, client or state modules. The bundle holds no API client.
  4. `listChanged: false` for tools, resources and prompts, and `subscribe: false` for resources, in docs-only mode; asserted through a real client in `check-hosted`.
  5. A configurable health path (`healthPath`, string or array; default `/mcp/healthz`), answering GET only with `mode: docs-only` and the build identity.
  6. Snapshots: unchanged from `b14bee1` (they match production byte for byte per the Developer Platform reply). They are retaken after the Reporting release's site change reaches production; a docs refresh redeploys the Worker only.
  7. Kit URLs stay in the snapshot resource: Terry's ruling, since the Conversations kits go live together with everything else on staging and production ("everything will meet on staging and move to production together").
  8. The fifty-free-attempts wording was already committed in the Conversations snapshot at `b14bee1`; the "every test turn is charged" line is in the local test-turn tool only, which the hosted bundle does not contain.
  9. Connection copy: the draft in `hosted/README.md`, for Terry's readback. Verified client lines follow client verification against the staging address.
- Existing suites still pass: Learn 15/15, Conversations 26/26. The local stdio packages behave as before; `maxTurns` now takes the environment from its caller.

Remaining acceptance is unchanged: the Workers-runtime tests (Developer Platform), qualified preview HTTPS/proxy, actual advertised assistant connections, operational controls, approved public copy, production release and readback, registry remote entries and site connection links.

## November 25, earlier: hosted-first candidate prepared and locally verified (history)

- Isolated branch `content/hosted-docs-20261125` combines the existing Conversations package with Learn's fifty-attempt documentation change.
- Both snapshots refreshed from the production developer site. Learn: six verified kits, Class still held for terms-publication confirmation. Conversations: all five revised kits withheld pending verification and public-page parity; step 3 is now represented in the manifest.
- Node-compatible fetch adapter for two configurable routes, explicit hosts/origins, bounded request bodies and a source/snapshot health receipt (superseded by the web-standard entry above).
- Portable, hash-inventoried artifact builder; production dependency installation succeeds without publishing our packages to npm.
- URL-first connection copy in README, marked draft for owner readback. Optional local-package instructions remain a separate route.

## Reproduce

1. `npm ci --ignore-scripts`
2. `npm test`
3. `npm --prefix packages/conversations-mcp test`
4. `node scripts/prepare-hosted.mjs artifacts/<new-candidate-name>`
5. In the artifact: `npm ci --omit=dev --ignore-scripts`
6. From the repository: `node scripts/check-hosted.mjs artifacts/<new-candidate-name> artifacts/<new-candidate-name>-check.json`

The builder refuses existing output directories. A clean source commit is required for a release artifact; its `hosted-build.json` reports source commit, source dirty state, content hash, per-file hashes and snapshot qualifications. It does not claim any provider deployment identity.
