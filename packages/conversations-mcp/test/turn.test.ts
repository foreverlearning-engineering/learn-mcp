// Unit tests for the test-turn tools against the local mock (test/mock-api.ts): the cost first and
// confirm required, the live-key gate, the cap, no retry, no closeout, the reply as written, and the
// key never appearing in any output. No real API is called.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createConversationsServer } from '../src/server.ts';
import { resetBudgetForTests } from '../src/turn.ts';
import { environmentOf } from '../src/client.ts';
import { maxTurns, HARD_MAX_TURNS, STAGING_BASE_URL, DEFAULT_BASE_URL } from '../src/config.ts';
import { loadSnapshot } from '../src/snapshot-file.ts';
import { startDocsHttp } from '../src/http.ts';
import { startMock, TEST_KEY, ASSIGNMENT, LINES, type Mock } from './mock-api.ts';

const snapshot = loadSnapshot();
const seen: string[] = [];
let mock: Mock;
let stateDir: string;

before(async () => { mock = await startMock(); });
after(async () => { await mock.close(); });
beforeEach(() => {
  resetBudgetForTests();
  mock.reset();
  stateDir = mkdtempSync(join(tmpdir(), 'conversations-mcp-test-'));
});

// The mock is not the staging host, so to the tool it is a live key: calls that send set allow_live.
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { FOREVERLEARNING_API_KEY: TEST_KEY, FOREVERLEARNING_ASSIGNMENT_ID: ASSIGNMENT, FOREVERLEARNING_BASE_URL: mock.url, CONVERSATIONS_MCP_STATE_DIR: stateDir, CONVERSATIONS_MCP_PROJECT: join(stateDir, 'project'), CONVERSATIONS_MCP_CONFIRM_DIALOG: 'off', ...extra };
}

async function connect(e: NodeJS.ProcessEnv, options: ConstructorParameters<typeof Client>[1] = {}) {
  const server = createConversationsServer({ mode: 'full', snapshot, env: e });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' }, options);
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, any> };
    seen.push(JSON.stringify(r));
    return { ...r, text: r.content.map((c) => c.text).join('\n') };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}

const chats = () => mock.requests.filter((r) => r.path === '/chat');
const prepares = () => mock.requests.filter((r) => r.path === '/conversation/sessions' && r.method === 'POST');
const closeouts = () => mock.requests.filter((r) => /\/sessions\/[^/]+\/end$/.test(r.path) || /\/sessions\/[^/]+\/discard$/.test(r.path) || r.method === 'DELETE');

test('the full server adds the two key-backed tools; docs-only has none of them', async () => {
  const c = await connect(env());
  const names = (await c.client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('conversations_test_turn') && names.includes('conversations_lookup_request'));
  await c.close();
  const server = createConversationsServer({ mode: 'docs-only', snapshot, env: env() });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(a);
  const docsOnly = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!docsOnly.includes('conversations_test_turn'));
  await client.close(); await server.close();
});

test('without a key or an assignment, nothing is sent', async () => {
  const noKey = await connect({ CONVERSATIONS_MCP_STATE_DIR: stateDir });
  const r = await noKey.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(r.text, /FOREVERLEARNING_API_KEY is not set/);
  assert.match(r.text, /Never paste the key into the conversation\./);
  await noKey.close();
  const noAssignment = await connect(env({ FOREVERLEARNING_ASSIGNMENT_ID: '' }));
  const r2 = await noAssignment.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(r2.text, /FOREVERLEARNING_ASSIGNMENT_ID/);
  await noAssignment.close();
  assert.equal(mock.requests.length, 0);
});

test('the cost comes first: without confirm, nothing at all is sent', async () => {
  const c = await connect(env());
  const plan = await c.call('conversations_test_turn', { opening: true, allow_live: true });
  assert.match(plan.text, /^Not sent yet/);
  assert.match(plan.text, /\$0\.03/);
  assert.match(plan.text, /3¢ per text turn/);
  assert.match(plan.text, /Every test turn is charged/);
  assert.doesNotMatch(plan.text, /\bfree\b/i, 'nothing says free until production serves the free test turns');
  assert.match(plan.text, /never ends the session/);
  assert.match(plan.text, /Call again with confirm: true only after they agree/);
  assert.equal(mock.requests.length, 0, 'not even a free read');
  await c.close();
});

test('a live key is refused unless the call allows it, before any request', async () => {
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /live key/);
  assert.match(r.text, /allow_live: true/);
  assert.equal(mock.requests.length, 0);
  await c.close();
  assert.equal(environmentOf(STAGING_BASE_URL), 'staging');
  assert.equal(environmentOf(DEFAULT_BASE_URL), 'live');
  assert.equal(environmentOf('http://127.0.0.1:9/v1'), 'live');
  assert.equal(environmentOf('not a url'), 'live');
});

test('a confirmed opening: one session, one turn, the reply exactly as written, safety and receipt', async () => {
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.equal(r.isError, undefined, r.text);
  assert.ok(r.text.includes(LINES.opening), 'the character\'s line, word for word, under their name');
  assert.ok(r.text.includes(LINES.coach), 'the Coach, word for word');
  assert.match(r.text, /exactly as written/);
  assert.match(r.text, /Safety: clear/);
  assert.match(r.text, /Receipt: 1 text turn · \$0\.03 · settled · request req_mock_1/);
  assert.match(r.text, /Charged: \$0\.03 from your workspace balance/);
  assert.match(r.text, /Jon: more careful, present/);
  assert.equal(r.structuredContent?.operation, 'opening');
  assert.equal(prepares().length, 1);
  assert.equal(chats().length, 1);
  assert.deepEqual(chats()[0].body, { session_id: 'sess_mock_1', conversation: { operation: 'opening' } });
  const h = chats()[0].headers;
  assert.equal(h['x-assignment-id'], ASSIGNMENT);
  assert.equal(h['fl-api-version'], '2026-12-01');
  assert.match(String(h['idempotency-key']), /^[0-9a-f-]{36}$/);
  assert.match(String(h['x-user-id']), /^conversations-mcp-test-/);
  // The prepared session names the room's recommended persona, guided, and no controls.
  assert.deepEqual(prepares()[0].body, { setup: { kind: 'room', room_id: 'S01', mode: 'guided', participants: [{ persona_id: 'jon_guarded_report' }] } });
  // The session is kept: a second turn reuses it, with no second preparation, and the opening is not sent twice.
  const again = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(again.text, /already has its opening/);
  const msg = await c.call('conversations_test_turn', { message: 'I wanted to talk about the last two reports.', confirm: true, allow_live: true });
  assert.equal(msg.isError, undefined, msg.text);
  assert.ok(msg.text.includes('Jon: ' + LINES.reply), 'a reply that carries its own dash and curly quote is kept as written');
  assert.equal(prepares().length, 1);
  assert.equal(chats().length, 2);
  assert.equal(chats()[1].body.prompt, 'I wanted to talk about the last two reports.');
  await c.close();
});

test('at most 2 turns per server run; the setting cannot pass the ceiling', async () => {
  const c = await connect(env());
  await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  await c.call('conversations_test_turn', { message: 'a', confirm: true, allow_live: true });
  const third = await c.call('conversations_test_turn', { message: 'b', confirm: true, allow_live: true });
  assert.equal(third.isError, true);
  assert.match(third.text, /its limit for one run \(2\)/);
  assert.equal(chats().length, 2);
  await c.close();
  assert.equal(maxTurns({}).limit, 2);
  assert.equal(maxTurns({ CONVERSATIONS_MCP_MAX_TURNS: '50' }).limit, HARD_MAX_TURNS);
  assert.equal(maxTurns({ CONVERSATIONS_MCP_MAX_TURNS: 'x' }).limit, 2);
});

test('never a retry: a failed turn is sent once and reported as not charged', async () => {
  mock.chat = ['error-event'];
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /failed before any reply was shown \(GENERATION_FAILED\)/);
  assert.match(r.text, /not charged/);
  assert.match(r.text, /never sends a turn again on its own/);
  assert.equal(chats().length, 1);
  await c.close();
});

test('a failed opening forgets its session, so the next turn prepares a new one', async () => {
  mock.chat = ['error-event'];
  const c = await connect(env({ CONVERSATIONS_MCP_MAX_TURNS: '3' }));
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(r.text, /When an opening fails, its conversation closes without charge/);
  await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.equal(prepares().length, 2);
  assert.equal(chats().length, 2);
  await c.close();
});

test('an unconfirmed turn is never resent: it returns the request id for a free lookup', async () => {
  for (const scenario of ['no-done', 'mismatch'] as const) {
    resetBudgetForTests();
    mock.reset();
    mock.chat = [scenario];
    const c = await connect(env());
    const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
    assert.equal(r.isError, true);
    assert.match(r.text, /not confirmed/);
    assert.match(r.text, /conversations_lookup_request with request_id "req_mock_1"/);
    assert.equal(r.structuredContent?.lookup, 'conversations_lookup_request');
    assert.equal(chats().length, 1, scenario);
    await c.close();
  }
});

test('the lookup is free and shows the saved reply as written, or says it is still running', async () => {
  const c = await connect(env());
  const r = await c.call('conversations_lookup_request', { request_id: 'req_mock_9' });
  assert.ok(r.text.includes(LINES.reply));
  assert.ok(r.text.includes(LINES.coach));
  assert.match(r.text, /no new turn and no new charge/);
  mock.lookup = 'in_progress';
  const r2 = await c.call('conversations_lookup_request', { request_id: 'req_mock_9' });
  assert.match(r2.text, /still running/);
  assert.equal(chats().length, 0);
  await c.close();
});

test('refusals are explained, and a session the API no longer knows is forgotten', async () => {
  mock.chat = ['refused-429', 'refused-404-session'];
  const c = await connect(env({ CONVERSATIONS_MCP_MAX_TURNS: '3' }));
  const busy = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(busy.text, /429 DEVELOPER_CAPACITY_LIMIT/);
  assert.match(busy.text, /retry can succeed after 60 seconds/);
  assert.match(busy.text, /nothing was charged/);
  await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.equal(prepares().length, 2, 'a new session after the 404');
  assert.equal(chats().length, 3);
  await c.close();
});

test('an unstructured turn keeps its text with no invented speaker; a critical turn shows no charge', async () => {
  mock.chat = ['unstructured', 'ok-critical'];
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.match(r.text, /No speaker labels on this turn/);
  assert.match(r.text, /Never invent a speaker/);
  const crit = await c.call('conversations_test_turn', { message: 'b', confirm: true, allow_live: true });
  assert.match(crit.text, /Safety: critical/);
  assert.match(crit.text, /Not charged \(a turn at the critical safety level is not charged\)/);
  assert.match(crit.text, /no expression reported \(show the neutral face\)/);
  await c.close();
});

test('rooms that need consent are not used; an unknown room is named, not guessed', async () => {
  const c = await connect(env());
  const consent = await c.call('conversations_test_turn', { opening: true, room: 'Telling Your Partner About A Diagnosis', confirm: true, allow_live: true });
  assert.match(consent.text, /needs the user's consent first/);
  const unknown = await c.call('conversations_test_turn', { opening: true, room: 'No Such Room', confirm: true, allow_live: true });
  assert.match(unknown.text, /no ready-made room titled "No Such Room"/);
  assert.equal(prepares().length, 0);
  assert.equal(chats().length, 0);
  await c.close();
});

test('where the client supports it, the developer confirms in a dialog', async () => {
  for (const [answer, expectSent] of [[{ action: 'accept', content: { send: true } }, true], [{ action: 'decline' }, false]] as const) {
    resetBudgetForTests();
    mock.reset();
    stateDir = mkdtempSync(join(tmpdir(), 'conversations-mcp-test-')); // a fresh project each pass
    const asked: string[] = [];
    const c = await connect(env({ CONVERSATIONS_MCP_CONFIRM_DIALOG: '' }), { capabilities: { elicitation: { form: {} } } });
    c.client.setRequestHandler('elicitation/create', async (request) => {
      asked.push(String(request.params.message));
      return answer as never;
    });
    const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
    assert.equal(asked.length, 1, r.text);
    assert.match(asked[0], /real money, \$0\.03/);
    assert.equal(chats().length, expectSent ? 1 : 0, r.text);
    await c.close();
  }
});

test('a message before the opening is not sent: the opening comes first', async () => {
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { message: 'Hello Jon', confirm: true, allow_live: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /has no opening yet/);
  assert.match(r.text, /opening: true/);
  assert.equal(mock.requests.length, 0);
  await c.close();
});

test('a different room starts a new session there; the earlier one stays open', async () => {
  const c = await connect(env());
  await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  const plan = await c.call('conversations_test_turn', { opening: true, room: 'Interview Practice', allow_live: true });
  assert.match(plan.text, /in a new test session in the room "Interview Practice"/);
  assert.match(plan.text, /earlier session, in the room "Direct Feedback To A Report", stays open/);
  const r = await c.call('conversations_test_turn', { opening: true, room: 'Interview Practice', confirm: true, allow_live: true });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(prepares().length, 2);
  assert.equal(prepares()[1].body.setup.room_id, 'S22');
  assert.equal(chats().length, 2);
  await c.close();
});

test('the test never ends a session: no closeout, discard or delete was ever sent', () => {
  assert.equal(closeouts().length, 0);
});

test('the key never appears in any output or saved file', async () => {
  mock.chat = ['refused-401-echo-key'];
  const c = await connect(env());
  const r = await c.call('conversations_test_turn', { opening: true, confirm: true, allow_live: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /401 DEVELOPER_AUTHENTICATION_REQUIRED/);
  assert.match(r.text, /<redacted-key>/);
  await c.close();
  for (const text of seen) assert.ok(!text.includes(TEST_KEY), 'key in a tool result');
  for (const file of readdirSync(stateDir)) {
    if (file.endsWith('.json')) assert.ok(!readFileSync(join(stateDir, file), 'utf8').includes(TEST_KEY), 'key in the state file');
  }
});

test('the docs-only HTTP mode serves no key-backed tool, even with a key set', async () => {
  const saved = process.env.FOREVERLEARNING_API_KEY;
  process.env.FOREVERLEARNING_API_KEY = TEST_KEY;
  const server = await startDocsHttp(0, '127.0.0.1', { snapshot });
  const port = (server.address() as { port: number }).port;
  const client = new Client({ name: 'http-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + port + '/mcp')));
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('conversations_guide'));
  assert.ok(!names.includes('conversations_test_turn'));
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  if (saved === undefined) delete process.env.FOREVERLEARNING_API_KEY; else process.env.FOREVERLEARNING_API_KEY = saved;
  assert.equal(mock.requests.length, 0);
});
