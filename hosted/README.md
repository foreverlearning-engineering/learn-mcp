# Hosted Learn and Conversations documentation

Local candidate for the November 25 hosted-first launch decision. No endpoint is deployed.

## Hosting interface

Use Node 24 or a compatible runtime with Node filesystem support. The snapshot JSON files must remain in the artifact at their packaged paths. This is not yet a qualified Cloudflare Worker or Netlify adapter.

Build from the repository with `node scripts/prepare-hosted.mjs <new-output-directory>`. In the output directory run `npm ci --omit=dev --ignore-scripts`. Public npm publication of our own packages is not required.

The hosting adapter imports `createHostedDocsHandler` from `./hosted/handler.mjs`, calls it once, and forwards web-standard Requests to its `fetch` method. Configure explicit `allowedHosts`, exact `allowedOrigins` when a client sends Origin, and optionally `learnPath` and `conversationsPath`. Defaults are the proposed `/mcp/learn` and `/mcp/conversations`; Developers must confirm the final routes. Never infer an allowed host from an incoming request. The proxy must preserve the configured URL hostname and endpoint path. Browser CORS/preflight support, if needed by a supported client, belongs in the qualified hosting adapter.

The default request-body cap is 64 KiB. Hosting must also set request timeouts, rate/concurrency limits and basic monitoring. Do not provision API keys or forward user credentials: neither endpoint uses them. The adapter rejects unlisted origins; requests without Origin are supported. `/healthz` returns the source and snapshot identity without calling any product API. Treat it as an operational receipt, not an MCP connection URL. HTTPS and provider-specific controls are verified on preview before release.

Only documentation tools are registered. No test-turn or request-lookup tools are exposed. The server reads a dated snapshot; new documentation requires a refreshed build and deployment. Pending kits are listed as coming soon without executable prompts or starter files.

## Public connection copy (draft for owner readback)

### Build with Learn in your assistant

Connect your assistant to the Learn API's guide, examples and verified starter kits. Add the Learn MCP URL as a remote server in an assistant that supports remote MCP. You do not need to install a package or provide an API key to read the documentation.

Ask: "Use the Learn API documentation to help me add a tutor to my app."

### Build with Conversations in your assistant

Connect your assistant to the Conversations API's guide, examples and API contract. Add the Conversations MCP URL as a remote server in an assistant that supports remote MCP. You do not need to install a package or provide an API key to read the documentation. Verified starter kits appear as they become available.

Ask: "Use the Conversations API documentation to help me add a practice room to my app."

### Try the API

These connections help your assistant build with the APIs. They do not run a tutor or a practice session themselves. Use the developer console Sandbox to try the API. Your application's API key stays on your server; do not paste it into an assistant conversation.

Release checklist: replace proposed URLs only after Developers confirms them, test the advertised assistant journeys, publish the endpoints, and then enable the connection links and remote registry entries. Optional local packages support additional test-turn tools; hosted documentation access does not require them.
