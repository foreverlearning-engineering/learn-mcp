// The docs-only mode over Streamable HTTP, served locally with Node's http module. The handler
// itself is hosted.ts (web-standard, no Node imports); this file only adds the bundled snapshot,
// the local host names and a Node server around it.
import { createServer, type Server } from 'node:http';
import { localhostAllowedHostnames } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createDocsFetchHandler, type DocsFetchHandler } from './hosted.ts';
import { loadSnapshot } from './snapshot-file.ts';
import { type Snapshot } from './snapshot.ts';

export interface DocsHandlerOptions {
  snapshot?: Snapshot;
  // Host names this address answers to (DNS rebinding protection). Local by default.
  allowedHosts?: string[];
  // The path the MCP endpoint answers on.
  path?: string;
}

export function createDocsHandler(options: DocsHandlerOptions = {}): DocsFetchHandler {
  return createDocsFetchHandler({
    snapshot: options.snapshot ?? loadSnapshot(),
    allowedHosts: options.allowedHosts ?? localhostAllowedHostnames(),
    path: options.path,
  });
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
