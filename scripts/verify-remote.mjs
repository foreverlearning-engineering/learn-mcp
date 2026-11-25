// Client verification of a hosted docs endpoint: a real MCP client initializes, discovers and reads
// both products, and the health receipt is read. Read-only: docs-only endpoints, no key, no charge.
//   node scripts/verify-remote.mjs <base url> [result.json]   e.g. https://developers-mcp-staging.foreverlearning.ai
import { writeFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.argv[2]?.replace(/\/+$/, '');
if (!base) { console.error('usage: node scripts/verify-remote.mjs <base url> [result.json]'); process.exit(2); }
const out = process.argv[3];
const result = { base, checkedAt: new Date().toISOString(), client: 'fl-site-lane-verify/1', health: null, products: [], extras: {}, passed: false };
const ms = async (fn) => { const t = performance.now(); const value = await fn(); return { value, ms: Math.round(performance.now() - t) }; };

try {
  const h = await ms(() => fetch(base + '/mcp/healthz'));
  const body = await h.value.json().catch(() => null);
  result.health = {
    status: h.value.status, ms: h.ms,
    cacheControl: h.value.headers.get('cache-control'), robots: h.value.headers.get('x-robots-tag'), docsBuild: h.value.headers.get('x-fl-docs-build'),
    mode: body?.mode, sourceCommit: body?.sourceCommit, contentSha256: body?.contentSha256,
    snapshots: body?.snapshots && Object.fromEntries(Object.entries(body.snapshots).map(([k, v]) => [k, { sha256: v.sha256, takenAt: v.takenAt, verifiedKits: v.verifiedKits }])),
    workerBuild: body?.workerBuild ?? body?.worker ?? null,
  };
} catch (e) { result.health = { error: e.message }; }

for (const product of ['learn', 'conversations']) {
  const r = { product, url: base + '/mcp/' + product, steps: [], errors: [] };
  const client = new Client({ name: 'fl-site-lane-verify', version: '1' });
  try {
    const connect = await ms(() => client.connect(new StreamableHTTPClientTransport(new URL(r.url))));
    r.steps.push({ step: 'initialize', ms: connect.ms });
    r.serverInfo = client.getServerVersion?.() ?? null;
    r.capabilities = client.getServerCapabilities() ?? null;
    r.instructionsChars = (client.getInstructions?.() ?? '').length;
    const tools = await ms(() => client.listTools());
    r.tools = tools.value.tools.map((t) => t.name).sort(); r.steps.push({ step: 'tools/list', ms: tools.ms, count: r.tools.length });
    const resources = await ms(() => client.listResources());
    r.resources = resources.value.resources.length; r.steps.push({ step: 'resources/list', ms: resources.ms, count: r.resources });
    if (r.capabilities?.prompts) { const p = await ms(() => client.listPrompts()); r.prompts = p.value.prompts.length; r.steps.push({ step: 'prompts/list', ms: p.ms, count: r.prompts }); }
    for (const name of [product + '_guide', product + '_kits', product + '_contract']) {
      const call = await ms(() => client.callTool({ name, arguments: {} }));
      const text = JSON.stringify(call.value);
      r.steps.push({ step: 'tools/call ' + name, ms: call.ms, isError: call.value.isError === true, chars: text.length, head: (call.value.content?.[0]?.text ?? '').slice(0, 100) });
      if (call.value.isError) r.errors.push(name + ' returned isError');
    }
    if (resources.value.resources.length) {
      const first = resources.value.resources[0];
      const read = await ms(() => client.readResource({ uri: first.uri }));
      r.steps.push({ step: 'resources/read ' + first.uri, ms: read.ms, parts: read.value.contents.length });
    }
    for (const name of [product + '_test_turn', product + '_lookup_request']) {
      let refused = false;
      try { const c = await client.callTool({ name, arguments: {} }); refused = c.isError === true; } catch { refused = true; }
      r.steps.push({ step: 'refused ' + name, refused });
      if (!refused) r.errors.push(name + ' was not refused');
    }
    const expected = ['contract', 'guide', 'kit', 'kits', 'starter_file'].map((n) => product + '_' + n).sort();
    if (JSON.stringify(r.tools) !== JSON.stringify(expected)) r.errors.push('tool list differs from expected: ' + r.tools.join(','));
    // Absent and false mean the same to a client: nothing is advertised. Only true is a fault.
    for (const [k, v] of [['tools.listChanged', r.capabilities?.tools?.listChanged], ['resources.listChanged', r.capabilities?.resources?.listChanged], ['resources.subscribe', r.capabilities?.resources?.subscribe], ['prompts.listChanged', r.capabilities?.prompts?.listChanged]]) {
      if (v === true) r.errors.push(k + ' is advertised as true');
    }
    r.slowestMs = Math.max(...r.steps.map((s) => s.ms ?? 0));
  } catch (e) { r.errors.push(e.message); }
  finally { await client.close().catch(() => {}); }
  r.passed = r.errors.length === 0;
  result.products.push(r);
}

// Edge behaviour, recorded rather than judged: a browser-style GET, a bad origin, an unknown path, a wrong method.
for (const [name, init, path] of [
  ['browser GET', { headers: { accept: 'text/html' }, redirect: 'manual' }, '/mcp/learn'],
  ['unlisted origin', { headers: { origin: 'https://untrusted.invalid' } }, '/mcp/healthz'],
  ['unknown path', {}, '/mcp/missing'],
  ['PUT on mcp', { method: 'PUT' }, '/mcp/learn'],
]) {
  try { const res = await fetch(base + path, init); result.extras[name] = { status: res.status, location: res.headers.get('location') }; }
  catch (e) { result.extras[name] = { error: e.message }; }
}
result.passed = result.products.every((p) => p.passed) && result.health?.status === 200 && result.health?.mode === 'docs-only';
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
