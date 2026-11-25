# Hosted Learn and Conversations documentation

The docs-only MCP endpoints for both APIs, as one artifact a hosting adapter imports. No endpoint is deployed from here; the developer platform lane owns hosting, routing and the connection pages.

## What the artifact is

`node scripts/prepare-hosted.mjs <new-output-directory>` builds it from a clean source commit. It holds `dist/` (Learn), `packages/conversations-mcp/dist/`, both `snapshot/` folders, `hosted/`, `LICENSE`, a `package.json` with the production dependencies, and `hosted-build.json`: the source commit, a content digest, the digest and time of each snapshot, its verified kits, and a hash of every file. In the output directory run `npm ci --omit=dev --ignore-scripts`. Then from the repository, `node scripts/check-hosted.mjs <output-directory> <result.json>` checks those exact bytes.

## The hosted entry: web-standard

`hosted/handler.mjs` exports `createHostedDocsHandler(options)`. Its import graph is web-standard: no `node:` module, no `@modelcontextprotocol/node`, no `Buffer`, no file read, no `process`, and none of the turn, lookup, client or state modules. A bundle built from it holds no product-API client. `check-hosted` walks the graph and fails on any of those.

The host passes everything in as objects; nothing is read from disk or from the environment:

```js
import { createHostedDocsHandler } from './hosted/handler.mjs';
import learnSnapshot from './snapshot/learn-docs.json' with { type: 'json' };
import conversationsSnapshot from './packages/conversations-mcp/snapshot/conversations-docs.json' with { type: 'json' };
import identity from './hosted-build.json' with { type: 'json' };

const handler = createHostedDocsHandler({
  learnSnapshot, conversationsSnapshot, identity,
  allowedHosts: ['developers-mcp-staging.foreverlearning.ai'],   // explicit; never inferred from a request
  allowedOrigins: [],                                           // exact origins only; requests without Origin are served
  learnPath: '/mcp/learn',                                      // default
  conversationsPath: '/mcp/conversations',                      // default
  healthPath: '/mcp/healthz',                                   // default; a string or an array of paths
  maxRequestBytes: 65536,                                       // default
});
export default { fetch: (request) => handler.fetch(request) };
```

`handler.fetch(request)` takes a web-standard Request and returns a Response. `handler.routes` reports the configured paths. `handler.close()` releases the MCP handlers.

For a Node host, `hosted/node.mjs` exports `readPackagedInputs()` and `createHostedDocsHandlerFromFiles(options)`, which read the three packaged JSON files and call the same factory. The check script uses them.

## Behaviour

- Only documentation tools, resources and prompts are registered. No test-turn or request-lookup tool exists in the bundle, so a call to one fails as an unknown tool.
- Docs-only servers advertise `listChanged: false` for tools, resources and prompts and `subscribe: false` for resources: the docs never change within a deployment, so a client has no reason to hold a `subscriptions/listen` stream open through a proxy.
- The MCP paths answer GET, POST and DELETE as the SDK serves them (2025-era GET and DELETE answer 405 under stateless serving); other methods answer 405. The health path answers GET only.
- A request whose URL hostname is not in `allowedHosts` answers 421. A request carrying an `Origin` not in `allowedOrigins` answers 403. No CORS headers are sent.
- A body over `maxRequestBytes`, declared or streamed, answers 413.
- `GET <healthPath>` returns `{ mode: 'docs-only', ...hosted-build.json }` with `Cache-Control: no-store`: the source commit, content digest and snapshot identities, without calling any product API. It is an operational receipt, not an MCP connection URL.
- The server reads a dated snapshot; new documentation needs a refreshed artifact and a redeploy. Kits that are coming soon are listed as such, with their page and starter addresses, and without executable prompts or starter files.

Hosting must add request timeouts, rate and concurrency limits, HTTPS, proxy rules and monitoring. Do not provision API keys or forward user credentials: neither endpoint uses them. HTTPS and provider-specific controls are verified on preview before release.

## Public connection copy (draft for owner readback)

### Build with Learn in your assistant

Connect your assistant to the Learn API's guide, examples and verified starter kits. Add the Learn MCP URL as a remote server in an assistant that supports remote MCP. You do not need to install a package or provide an API key to read the documentation.

Ask: "Use the Learn API documentation to help me add a tutor to my app."

### Build with Conversations in your assistant

Connect your assistant to the Conversations API's guide, examples and API contract. Add the Conversations MCP URL as a remote server in an assistant that supports remote MCP. You do not need to install a package or provide an API key to read the documentation. Verified starter kits appear as they become available.

Ask: "Use the Conversations API documentation to help me add a practice room to my app."

### Try the API

These connections help your assistant build with the APIs. They do not run a tutor or a practice session themselves. Use the developer console Sandbox to try the API. Your application's API key stays on your server; do not paste it into an assistant conversation.

Release checklist: replace proposed URLs only after Developers confirms them, test the advertised assistant journeys against the staging address and record the exact configuration lines, publish the endpoints, and then enable the connection links and remote registry entries. Optional local packages support additional test-turn tools; hosted documentation access does not require them.
