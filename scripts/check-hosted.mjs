// Exercise the built artifact with a real HTTP MCP client on an ephemeral loopback port, and prove
// the hosted entry's import graph is web-standard.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';

const artifact = resolve(process.argv[2]);
const identity = JSON.parse(readFileSync(join(artifact, 'hosted-build.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
for (const [path, expected] of Object.entries(identity.files)) {
  assert.equal(sha(readFileSync(join(artifact, path))), expected, 'artifact bytes: ' + path);
}
assert.equal(sha(JSON.stringify(identity.files)), identity.contentSha256);

// The import graph of the hosted entry, followed through every relative import: no node: module,
// no @modelcontextprotocol/node, no Buffer, no require, no file read. Bare specifiers are reported.
const graph = { files: [], bare: new Set() };
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
function walk(fileUrl) {
  const file = fileURLToPath(fileUrl);
  if (graph.files.includes(file)) return;
  graph.files.push(file);
  // Comments are stripped first: the rules below are about code, and a comment may name what it avoids.
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, /\bBuffer\b/, 'Buffer in hosted graph: ' + file);
  assert.doesNotMatch(text, /\brequire\(/, 'require() in hosted graph: ' + file);
  assert.doesNotMatch(text, /\breadFileSync|\bfs\./, 'file read in hosted graph: ' + file);
  assert.doesNotMatch(text, /\bprocess\./, 'process in hosted graph: ' + file);
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec.startsWith('.') || spec.startsWith('/')) walk(new URL(spec, fileUrl));
    else graph.bare.add(spec);
  }
}
walk(pathToFileURL(join(artifact, 'hosted/handler.mjs')));
for (const spec of graph.bare) {
  assert.ok(!spec.startsWith('node:'), 'Node module in hosted graph: ' + spec);
  assert.notEqual(spec, '@modelcontextprotocol/node', 'Node adapter in hosted graph');
}
for (const banned of ['turn.js', 'client.js', 'state.js', 'lookup.js', 'http.js', 'snapshot-file.js', 'cli.js']) {
  assert.ok(!graph.files.some((f) => f.replaceAll('\\', '/').endsWith('/' + banned)), banned + ' must not be in the hosted graph');
}

const { createHostedDocsHandler } = await import(pathToFileURL(join(artifact, 'hosted/handler.mjs')));
const { readPackagedInputs } = await import(pathToFileURL(join(artifact, 'hosted/node.mjs')));
const inputs = readPackagedInputs(pathToFileURL(artifact + '/'));
assert.throws(() => createHostedDocsHandler(), /allowedHosts/);
assert.throws(() => createHostedDocsHandler({ allowedHosts: ['*'] }), /allowedHosts/);
assert.throws(() => createHostedDocsHandler({ allowedHosts: ['127.0.0.1'] }), /learnSnapshot/);
assert.throws(() => createHostedDocsHandler({ ...inputs, allowedHosts: ['127.0.0.1'], identity: {} }), /identity/);
assert.throws(() => createHostedDocsHandler({ ...inputs, allowedHosts: ['127.0.0.1'], healthPath: '/mcp/learn' }), /distinct/);
const savedEnv = {};
for (const [name, value] of Object.entries({
  FOREVERLEARNING_API_KEY: 'synthetic-hosted-test-marker',
  FOREVERLEARNING_BASE_URL: 'https://must-not-call.invalid/v1',
  LEARN_MCP_SNAPSHOT: 'must-not-read-ambient-snapshot',
  CONVERSATIONS_MCP_SNAPSHOT: 'must-not-read-ambient-snapshot',
})) { savedEnv[name] = process.env[name]; process.env[name] = value; }
const handler = createHostedDocsHandler({ ...inputs, allowedHosts: ['127.0.0.1'], allowedOrigins: ['https://client.example'], healthPath: ['/mcp/healthz', '/healthz'] });
const bridge = toNodeHandler({ fetch: handler.fetch });
const server = createServer((req, res) => {
  Promise.resolve(bridge(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = 'http://127.0.0.1:' + server.address().port;
const originalFetch = globalThis.fetch;
let externalFetches = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== base) { externalFetches++; throw new Error('Unexpected outbound network request'); }
  return originalFetch(input, init);
};
const products = [];
try {
  for (const product of ['learn', 'conversations']) {
    const client = new Client({ name: 'hosted-release-check', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/' + product)));
      const caps = client.getServerCapabilities() ?? {};
      assert.equal(caps.tools?.listChanged, false, product + ': tools.listChanged must be false');
      assert.equal(caps.resources?.listChanged, false, product + ': resources.listChanged must be false');
      assert.equal(caps.resources?.subscribe, false, product + ': resources.subscribe must be false');
      if (caps.prompts) assert.equal(caps.prompts.listChanged, false, product + ': prompts.listChanged must be false');
      const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      assert.deepEqual(tools, ['contract', 'guide', 'kit', 'kits', 'starter_file'].map((name) => product + '_' + name).sort());
      const guide = await client.callTool({ name: product + '_guide', arguments: {} });
      assert.ok(!guide.isError && JSON.stringify(guide).length > 500);
      assert.ok(!JSON.stringify(guide).includes('synthetic-hosted-test-marker'));
      const contract = await client.callTool({ name: product + '_contract', arguments: {} });
      assert.ok(!contract.isError);
      const resources = (await client.listResources()).resources;
      assert.ok(resources.length);
      const resource = await client.readResource({ uri: resources[0].uri });
      assert.ok(resource.contents.length);
      const prompts = caps.prompts ? (await client.listPrompts()).prompts : [];
      if (prompts.length) assert.ok((await client.getPrompt({ name: prompts[0].name })).messages.length);
      for (const suffix of ['test_turn', 'lookup_request']) {
        let refused = false;
        try { const result = await client.callTool({ name: product + '_' + suffix, arguments: {} }); refused = result.isError === true; }
        catch { refused = true; }
        assert.ok(refused, 'unregistered generation/lookup tool must fail');
      }
      if (product === 'conversations') {
        const kit = await client.callTool({ name: 'conversations_kit', arguments: { kit: '03-room-and-cast' } });
        assert.match(JSON.stringify(kit), /coming soon/i);
        assert.doesNotMatch(JSON.stringify(kit), /```text/);
      }
      products.push({ product, tools, resources: resources.length, prompts: prompts.length, capabilities: caps, passed: true });
    } finally { await client.close(); }
  }
  assert.equal((await handler.fetch(new Request('http://untrusted.invalid/mcp/learn'))).status, 421);
  assert.equal((await fetch(base + '/mcp/healthz', { headers: { origin: 'https://untrusted.invalid' } })).status, 403);
  assert.equal((await fetch(base + '/mcp/healthz', { headers: { origin: 'https://client.example' } })).status, 200);
  assert.equal((await fetch(base + '/mcp/healthz', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/mcp/learn', { method: 'PUT' })).status, 405);
  assert.equal((await handler.fetch(new Request(base + '/mcp/learn', { method: 'POST', body: 'x'.repeat(65537) }))).status, 413);
  assert.equal((await handler.fetch(new Request(base + '/mcp/learn', { method: 'POST', body: 'x', headers: { 'content-length': '65537' } }))).status, 413);
  for (const path of ['/mcp/healthz', '/healthz']) {
    const health = await (await fetch(base + path)).json();
    assert.equal(health.contentSha256, identity.contentSha256);
    assert.equal(health.sourceCommit, identity.sourceCommit);
    assert.equal(health.mode, 'docs-only');
  }
  assert.equal(externalFetches, 0);
  const result = { passed: true, sourceCommit: identity.sourceCommit, sourceDirty: identity.sourceDirty,
    contentSha256: identity.contentSha256, products, externalFetches,
    hostedGraph: { files: graph.files.map((f) => f.slice(artifact.length + 1).replaceAll('\\', '/')), bareImports: [...graph.bare].sort() },
    checks: ['artifact hashes', 'hosted import graph is web-standard (no node:, no Node adapter, no Buffer, no file read, no turn/client/state modules)',
      'HTTP MCP discovery and reads', 'listChanged false and no resource subscribe in docs-only mode', 'prompts and resources', 'generation and lookup refused',
      'pending kit withheld', 'ambient credentials and snapshot overrides ignored', 'host and origin restrictions', 'body limit', 'route and method restrictions', 'configurable health path and identity'],
    limitations: ['Local loopback HTTP through the Node adapter only; the Workers runtime, provider HTTPS/proxy, advertised assistant apps, rate controls and monitoring remain for preview qualification.'],
  };
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await handler.close();
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
