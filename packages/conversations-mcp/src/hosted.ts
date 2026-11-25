// The docs over Streamable HTTP as a web-standard fetch handler (Request in, Response out). No Node
// module is anywhere in this file's import graph, so a hosted runtime (a Worker, an edge function)
// imports it as is; http.ts wraps it for local serving with Node's http module. The snapshot is
// passed in: nothing here reads a file, a key or the environment.
import { createMcpHandler, hostHeaderValidationResponse, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createConversationsDocsServer } from './docs-server.ts';
import { SNAPSHOT_SCHEMA, type Snapshot } from './snapshot.ts';

export interface DocsFetchOptions {
  snapshot: Snapshot;
  // Host names this address answers to (DNS rebinding protection). Explicit, never inferred.
  allowedHosts: string[];
  // The path the MCP endpoint answers on.
  path?: string;
  // The SDK's own cap on a request body, in bytes (a docs read needs far less than the default 64 KiB).
  maxRequestBodySize?: number;
}

export interface DocsFetchHandler {
  fetch: (request: Request) => Promise<Response>;
  mcp: McpHttpHandler;
}

export function createDocsFetchHandler(options: DocsFetchOptions): DocsFetchHandler {
  const { snapshot, allowedHosts } = options;
  if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA) throw new Error('snapshot must be a parsed ' + SNAPSHOT_SCHEMA + ' object');
  if (!Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.includes('*')) throw new Error('Explicit allowedHosts are required');
  const path = options.path ?? '/mcp';
  const maxRequestBodySize = options.maxRequestBodySize ?? 65536;
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize < 1) throw new Error('Invalid maxRequestBodySize');
  // A fresh docs-only server per request: stateless, nothing shared, no key anywhere.
  const mcp = createMcpHandler(() => createConversationsDocsServer(snapshot), { maxRequestBodySize });
  return {
    mcp,
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname !== path) return new Response('Not found', { status: 404 });
      const refused = hostHeaderValidationResponse(request, allowedHosts);
      if (refused) return refused;
      return mcp.fetch(request);
    },
  };
}
