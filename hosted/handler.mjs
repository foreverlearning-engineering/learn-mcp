// The hosted docs endpoint: one web-standard fetch handler serving both products' documentation,
// with no Node module anywhere in its import graph (no node:*, no @modelcontextprotocol/node, no
// Buffer). The host passes the two snapshots and the build identity in as parsed objects (JSON
// modules, or files it read itself); this file reads nothing from disk and nothing from the
// environment. hosted/node.mjs is the Node convenience that reads the packaged files.
import { createDocsFetchHandler as learnHandler } from '../dist/hosted.js';
import { createDocsFetchHandler as conversationsHandler } from '../packages/conversations-mcp/dist/hosted.js';

const PATH = /^\/[a-zA-Z0-9/_-]+$/;

export function createHostedDocsHandler({
  learnSnapshot,
  conversationsSnapshot,
  identity,
  allowedHosts,
  allowedOrigins = [],
  learnPath = '/mcp/learn',
  conversationsPath = '/mcp/conversations',
  healthPath = '/mcp/healthz',
  maxRequestBytes = 65536,
} = {}) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.includes('*')) {
    throw new Error('Explicit allowedHosts are required');
  }
  if (!learnSnapshot || learnSnapshot.schema !== 'learn-mcp.snapshot.v1') throw new Error('learnSnapshot must be a parsed learn-mcp.snapshot.v1 object');
  if (!conversationsSnapshot || conversationsSnapshot.schema !== 'conversations-mcp.snapshot.v1') throw new Error('conversationsSnapshot must be a parsed conversations-mcp.snapshot.v1 object');
  if (!identity || typeof identity !== 'object' || typeof identity.contentSha256 !== 'string') throw new Error('identity must be the parsed hosted-build.json of this artifact');
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) throw new Error('Invalid request limit');
  const healthPaths = Array.isArray(healthPath) ? healthPath : [healthPath];
  for (const path of [learnPath, conversationsPath, ...healthPaths]) {
    if (typeof path !== 'string' || !PATH.test(path)) throw new Error('Invalid route path: ' + path);
  }
  if (new Set([learnPath, conversationsPath, ...healthPaths]).size !== 2 + healthPaths.length) throw new Error('Routes must be distinct');
  const origins = new Set(allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Use exact HTTP origins');
    return origin;
  }));
  // The same cap inside the SDK as around it, so no layer accepts more than the host intends.
  const learn = learnHandler({ allowedHosts, path: learnPath, snapshot: learnSnapshot, maxRequestBodySize: maxRequestBytes });
  const conversations = conversationsHandler({ allowedHosts, path: conversationsPath, snapshot: conversationsSnapshot, maxRequestBodySize: maxRequestBytes });
  const routes = new Map([[learnPath, learn], [conversationsPath, conversations]]);
  const health = { mode: 'docs-only', ...identity };
  return {
    routes: { learn: learnPath, conversations: conversationsPath, health: healthPaths },
    async fetch(request) {
      const url = new URL(request.url);
      if (!allowedHosts.includes(url.hostname)) return new Response('Unrecognized host', { status: 421 });
      const origin = request.headers.get('origin');
      if (origin && !origins.has(origin)) return new Response('Origin not allowed', { status: 403 });
      if (healthPaths.includes(url.pathname)) {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
      }
      const handler = routes.get(url.pathname);
      if (!handler) return new Response('Not found', { status: 404 });
      if (!['GET', 'POST', 'DELETE'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const declaredSize = request.headers.get('content-length');
      if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxRequestBytes)) {
        return new Response('Request too large', { status: 413 });
      }
      if (request.body) {
        const reader = request.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxRequestBytes) {
              await reader.cancel();
              return new Response('Request too large', { status: 413 });
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        request = new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
      }
      return handler.fetch(request);
    },
    async close() { await Promise.all([learn.mcp.close(), conversations.mcp.close()]); },
  };
}
