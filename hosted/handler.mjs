// Node-compatible fetch adapter. No ambient snapshot override or API credentials.
import { readFileSync } from 'node:fs';
import { createDocsHandler as learnHandler } from '../dist/http.js';
import { createDocsHandler as conversationsHandler } from '../packages/conversations-mcp/dist/http.js';

export function createHostedDocsHandler({
  allowedHosts,
  allowedOrigins = [],
  learnPath = '/mcp/learn',
  conversationsPath = '/mcp/conversations',
  maxRequestBytes = 65536,
} = {}) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.includes('*')) {
    throw new Error('Explicit allowedHosts are required');
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) throw new Error('Invalid request limit');
  for (const path of [learnPath, conversationsPath]) {
    if (!/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('Invalid MCP path');
  }
  if (learnPath === conversationsPath || [learnPath, conversationsPath].includes('/healthz')) throw new Error('Routes must be distinct');
  const origins = new Set(allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Use exact HTTP origins');
    return origin;
  }));
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const learn = learnHandler({ allowedHosts, path: learnPath, snapshot: read('../snapshot/learn-docs.json') });
  const conversations = conversationsHandler({ allowedHosts, path: conversationsPath, snapshot: read('../packages/conversations-mcp/snapshot/conversations-docs.json') });
  const identity = read('../hosted-build.json');
  const routes = new Map([[learnPath, learn], [conversationsPath, conversations]]);
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (!allowedHosts.includes(url.hostname)) return new Response('Unrecognized host', { status: 421 });
      const origin = request.headers.get('origin');
      if (origin && !origins.has(origin)) return new Response('Origin not allowed', { status: 403 });
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return Response.json({ mode: 'docs-only', ...identity }, { headers: { 'Cache-Control': 'no-store' } });
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
        request = new Request(request.url, {
          method: request.method, headers: request.headers,
          body: Buffer.concat(chunks), signal: request.signal,
        });
      }
      return handler.fetch(request);
    },
    async close() { await Promise.all([learn.mcp.close(), conversations.mcp.close()]); },
  };
}
