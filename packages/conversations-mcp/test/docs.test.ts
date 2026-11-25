// Unit tests for the Conversations docs server: every tool answers from the bundled snapshot, with
// no key and no network, and nothing in the copy breaks the public copy rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createConversationsServer, instructions } from '../src/server.ts';
import { loadSnapshot } from '../src/snapshot-file.ts';
import { startDocsHttp } from '../src/http.ts';

const snapshot = loadSnapshot();

async function connect() {
  const server = createConversationsServer({ snapshot });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; isError?: boolean };
    return { ...r, text: r.content.map((c) => c.text).join('\n') };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}

test('the server lists its docs tools and no turn tool', async () => {
  const c = await connect();
  const names = (await c.client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['conversations_contract', 'conversations_guide', 'conversations_kit', 'conversations_kits', 'conversations_starter_file']);
  await c.close();
});

test('the guide answers whole, by topic, and with an example', async () => {
  const c = await connect();
  const whole = await c.call('conversations_guide');
  assert.match(whole.text, /Build a complete practice conversation\./);
  const setup = await c.call('conversations_guide', { topic: 'setup' });
  assert.match(setup.text, /GET \/v1\/conversation\/catalog/);
  const characters = await c.call('conversations_guide', { topic: 'characters' });
  assert.match(characters.text, /expression_group/);
  const close = await c.call('conversations_guide', { topic: 'turns' });
  assert.match(close.text, /\/v1\/sessions\/SESSION_ID\/end/);
  const example = await c.call('conversations_guide', { example: 'conversation.ts' });
  assert.match(example.text, /parseConversationStream/);
  const missing = await c.call('conversations_guide', { topic: 'zzzz qqqq' });
  assert.equal(missing.isError, true);
  await c.close();
});

test('the contract lists the Conversations operations and fills in references', async () => {
  const c = await connect();
  const list = await c.call('conversations_contract');
  for (const op of ['GET /v1/conversation/catalog', 'POST /v1/conversation/sessions', 'POST /v1/chat', 'GET /v1/conversation/sessions/{session_id}/debrief', 'GET /v1/conversation/insights', 'POST /v1/conversation/voice', 'POST /v1/sessions/{session_id}/end', 'GET /v1/requests/{request_id}']) {
    assert.ok(list.text.includes(op), 'lists ' + op);
  }
  assert.ok(!list.text.includes('/sandbox/'), 'leaves out the console Sandbox routes');
  const prepare = await c.call('conversations_contract', { operation: 'POST /v1/conversation/sessions' });
  assert.match(prepare.text, /"x-from":"CreateSession"/);
  assert.match(prepare.text, /open_practice/);
  const turn = await c.call('conversations_contract', { schema: 'Turn' });
  assert.match(turn.text, /"expression_group"/);
  assert.match(turn.text, /"coach"/);
  const chat = await c.call('conversations_contract', { operation: 'conversationChat' });
  assert.match(chat.text, /POST \/v1\/chat/);
  await c.close();
});

test('kits that are not verified are listed as coming soon, with no prompt to follow', async () => {
  const c = await connect();
  const kits = await c.call('conversations_kits');
  for (const k of snapshot.kits) assert.ok(kits.text.includes(k.id), 'lists ' + k.id);
  if (!snapshot.kits.some((k) => k.state === 'verified')) {
    assert.match(kits.text, /No Build with Conversations kit is verified yet/);
    const one = await c.call('conversations_kit', { kit: '1' });
    assert.match(one.text, /coming soon/);
    assert.doesNotMatch(one.text, /```text/);
    const file = await c.call('conversations_starter_file', { kit: '01-first-room', path: 'server.ts' });
    assert.equal(file.isError, true);
    assert.equal((await c.client.listPrompts()).prompts.length, 0);
  }
  await c.close();
});

test('the server never reads a key and holds none', async () => {
  const before = process.env.FOREVERLEARNING_API_KEY;
  process.env.FOREVERLEARNING_API_KEY = 'fl_test_' + 'a'.repeat(64);
  try {
    const c = await connect();
    const seen = [await c.call('conversations_kits'), await c.call('conversations_guide', { topic: 'privacy' }), await c.call('conversations_contract')];
    for (const r of seen) assert.doesNotMatch(r.text, /fl_test_a{64}/);
    await c.close();
  } finally {
    if (before === undefined) delete process.env.FOREVERLEARNING_API_KEY; else process.env.FOREVERLEARNING_API_KEY = before;
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /fl_(live|stag|test)_[0-9a-f]{16,}/);
});

test('our own words follow the public copy rules', () => {
  const ours = instructions(snapshot) + '\n' + JSON.stringify((Object.values(snapshot.kits)));
  assert.doesNotMatch(ours, /—/, 'no em dash');
  assert.doesNotMatch(ours, /Conversation API\b/, 'the name is plural');
  assert.doesNotMatch(ours, /does not score|doesn't score/i);
  assert.doesNotMatch(ours, /stream(s|ing)? (back|in)/i, 'the reply arrives complete');
  assert.match(instructions(snapshot), /3¢ per text turn/);
});

test('the docs answer over Streamable HTTP too', async () => {
  const http = await startDocsHttp(0, '127.0.0.1', { snapshot });
  const port = (http.address() as { port: number }).port;
  const client = new Client({ name: 'http-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + port + '/mcp')));
  const r = await client.callTool({ name: 'conversations_kits', arguments: {} }) as { content: { text: string }[] };
  assert.match(r.content[0].text, /01-first-room/);
  await client.close();
  await new Promise((resolve) => http.close(resolve));
});
