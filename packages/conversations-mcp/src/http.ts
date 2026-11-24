// The docs over Streamable HTTP. It reads no key and sends no turns, so it can be hosted at one
// public address. createDocsHandler() is a web-standard fetch handler (Request in, Response out);
// startDocsHttp() serves it locally with Node's http module.
import { createServer, type Server } from 'node:http';
import { createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames, type McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createConversationsServer } from './server.ts';
import { loadSnapshot, type Snapshot } from './snapshot.ts';

export interface DocsHandlerOptions {
  snapshot?: Snapshot;
  // Host names this address answers to (DNS rebinding protection). Local by default.
  allowedHosts?: string[];
  // The path the MCP endpoint answers on.
  path?: string;
}

export function createDocsHandler(options: DocsHandlerOptions = {}): { fetch: (request: Request) => Promise<Response>; mcp: McpHttpHandler } {
  const snapshot = options.snapshot ?? loadSnapshot();
  const path = options.path ?? '/mcp';
  const hosts = options.allowedHosts ?? localhostAllowedHostnames();
  // A fresh server per request: stateless, nothing shared, no key anywhere.
  const mcp = createMcpHandler(() => createConversationsServer({ mode: 'docs-only', snapshot, env: {} }));
  return {
    mcp,
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname !== path) return new Response('Not found', { status: 404 });
      const refused = hostHeaderValidationResponse(request, hosts);
      if (refused) return refused;
      return mcp.fetch(request);
    },
  };
}

export function startDocsHttp(port: number, host = '127.0.0.1', options: DocsHandlerOptions = {}): Promise<Server> {
  const handler = createDocsHandler(options);
  const node = toNodeHandler({ fetch: handler.fetch });
  const server = createServer((req, res) => {
    Promise.resolve(node(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('Server error');
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
