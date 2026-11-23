// Unit tests against a mocked Learn API: the done event, failed and unconfirmed turns, the cap,
// no retry, the live-key gate, confirmation, and the key never appearing in any output.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createLearnServer } from '../src/server.ts';
import { resetBudgetForTests } from '../src/learn/turn.ts';
import { maxTurns, HARD_MAX_TURNS } from '../src/config.ts';
import { loadSnapshot } from '../src/snapshot.ts';
import { startDocsHttp } from '../src/http.ts';
import { startMock, TEST_KEY, REPLY, type Mock } from './mock-learn.ts';

const snapshot = loadSnapshot();
const seen: string[] = []; // every tool result any test received, for the key check at the end
let mock: Mock;
let stateDir: string;

before(async () => { mock = await startMock(); });
after(async () => { await mock.close(); });
beforeEach(() => {
  resetBudgetForTests();
  mock.reset();
  stateDir = mkdtempSync(join(tmpdir(), 'learn-mcp-test-'));
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { FOREVERLEARNING_API_KEY: TEST_KEY, FOREVERLEARNING_BASE_URL: mock.url, LEARN_MCP_STATE_DIR: stateDir, LEARN_MCP_PROJECT: join(stateDir, 'project'), ...extra };
}

async function connect(e: NodeJS.ProcessEnv, options: ConstructorParameters<typeof Client>[1] = {}) {
  const server = createLearnServer({ mode: 'full', snapshot, env: e });
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
const prepares = () => mock.requests.filter((r) => r.path === '/quest/sessions');

test('docs tools answer without a key and without the network', async () => {
  const c = await connect({ LEARN_MCP_STATE_DIR: stateDir });
  const kits = await c.call('learn_kits');
  assert.match(kits.text, /01-first-tutor/);
  assert.match(kits.text, /embed/);
  const kit = await c.call('learn_kit', { kit: '01-first-tutor' });
  const verified = snapshot.kits.find((k) => k.id === '01-first-tutor')!;
  assert.ok(kit.text.includes(verified.prompt.trim()), 'the verified prompt, word for word');
  const guide = await c.call('learn_guide', { topic: 'turn' });
  assert.match(guide.text, /Send a turn and validate its result/);
  const op = await c.call('learn_contract', { operation: 'GET /v1/requests/{request_id}' });
  assert.match(op.text, /developerReplay/);
  const noKey = await c.call('learn_test_turn', { message: 'hi', confirm: true });
  assert.match(noKey.text, /No Learn API key is set/);
  const prompt = await c.client.getPrompt({ name: 'embed-learn' });
  assert.equal((prompt.messages[0].content as { text: string }).text, snapshot.kits.find((k) => k.id === 'embed')!.prompt);
  assert.equal(mock.requests.length, 0);
  await c.close();
});

test('without confirm, the tool states the cost and sends nothing', async () => {
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'I am stuck on 3x + 5 = 20.' });
  assert.equal(r.isError, undefined);
  assert.match(r.text, /Not sent yet/);
  assert.match(r.text, /uses 1 of your workspace's free test attempts/);
  assert.doesNotMatch(r.text, /\d+ free test attempts/, 'no allowance number unless Learn sends one');
  assert.equal(chats().length, 0);
  assert.equal(prepares().length, 0);
  await c.close();
});

test('a confirmed turn returns the reply word for word, with its safety status and receipt', async () => {
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'Can you just tell me what x is?', confirm: true });
  assert.equal(r.isError, undefined, r.text);
  assert.ok(r.text.includes(REPLY.conversation), 'conversation part verbatim');
  assert.ok(r.text.includes(REPLY.display), 'display part verbatim');
  assert.match(r.text, /Safety: clear/);
  assert.match(r.text, /1 turn · \$0\.05 · settled · request req_mock_1/);
  assert.equal(r.structuredContent?.conversation, REPLY.conversation);
  assert.equal(r.structuredContent?.display, REPLY.display);
  assert.equal(r.structuredContent?.receipt.request_id, 'req_mock_1');
  const sent = chats()[0];
  assert.equal(sent.body.posture, 'guided');
  assert.equal(sent.body.quest.operation, 'turn');
  assert.equal(sent.headers['fl-api-version'], '2026-12-01');
  assert.match(String(sent.headers['user-agent']), /^learn-mcp\//);
  assert.match(String(sent.headers['x-user-id']), /^learn-mcp-test-/);
  assert.ok(sent.headers['idempotency-key']);
  await c.close();
});

test('the test learner and its session are kept between server runs', async () => {
  const first = await connect(env());
  await first.call('learn_test_turn', { message: 'one', confirm: true });
  await first.close();
  resetBudgetForTests(); // a new process
  const second = await connect(env());
  await second.call('learn_test_turn', { message: 'two', kind: 'feedback', confirm: true });
  await second.close();
  assert.equal(prepares().length, 1, 'one session prepared, then reused');
  const users = new Set(chats().map((r) => r.headers['x-user-id']));
  assert.equal(users.size, 1, 'one stable test learner');
  assert.equal(chats()[1].body.session_id, 'sess_mock_1');
  assert.equal(chats()[1].body.posture, 'feedback');
});

test('every request, from the first cost preview on, uses the one test learner', async () => {
  mock.mode = 'live';
  const c = await connect(env());
  await c.call('learn_test_turn', { message: 'a' }); // refused: live, not allowed
  await c.call('learn_test_turn', { message: 'a', allow_live: true }); // the cost preview
  await c.call('learn_test_turn', { message: 'a', allow_live: true, confirm: true }); // sent
  await c.close();
  const users = new Set(mock.requests.map((r) => r.headers['x-user-id']));
  assert.equal(mock.requests.filter((r) => r.path === '/quest/catalog').length, 3);
  assert.equal(users.size, 1, 'one learner id across catalog reads, preparation and the turn');
});

test('the cap: 2 turns per process by default, an override, and a hard ceiling', async () => {
  const c = await connect(env());
  await c.call('learn_test_turn', { message: 'a', confirm: true });
  await c.call('learn_test_turn', { message: 'b', confirm: true });
  const third = await c.call('learn_test_turn', { message: 'c', confirm: true });
  assert.equal(third.isError, true);
  assert.match(third.text, /limit for one run \(2\)/);
  assert.equal(chats().length, 2);
  await c.close();

  resetBudgetForTests();
  mock.requests.length = 0;
  const one = await connect(env({ LEARN_MCP_MAX_TURNS: '1' }));
  await one.call('learn_test_turn', { message: 'a', confirm: true });
  const refused = await one.call('learn_test_turn', { message: 'b', confirm: true });
  assert.equal(refused.isError, true);
  assert.equal(chats().length, 1);
  await one.close();

  assert.equal(maxTurns({ LEARN_MCP_MAX_TURNS: '500' }).limit, HARD_MAX_TURNS);
  assert.equal(maxTurns({ LEARN_MCP_MAX_TURNS: 'lots' }).limit, 2);
  assert.equal(maxTurns({}).limit, 2);
});

test('a failed turn is reported, counted, and never sent again', async () => {
  mock.chat = ['error-event'];
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /failed \(GENERATION_FAILED\)/);
  assert.match(r.text, /not charged/);
  assert.match(r.text, /never sends a turn again on its own/);
  assert.equal(chats().length, 1, 'no retry');
  assert.match(r.text, /1 of 2/);
  await c.close();
});

test('an unconfirmed turn returns its request id and the lookup, with no retry', async () => {
  mock.chat = ['no-done'];
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /did not confirm/);
  assert.match(r.text, /learn_lookup_request with request_id "req_mock_1"/);
  assert.equal(r.structuredContent?.request_id, 'req_mock_1');
  assert.equal(chats().length, 1, 'no retry');
  const look = await c.call('learn_lookup_request', { request_id: 'req_mock_1' });
  assert.ok(look.text.includes(REPLY.conversation));
  assert.match(look.text, /no new turn and no new charge/);
  assert.equal(chats().length, 1);
  const lookups = mock.requests.filter((x) => x.path.startsWith('/requests/'));
  assert.equal(lookups[0].headers['x-user-id'], chats()[0].headers['x-user-id'], 'looked up as the same learner');
  await c.close();
});

test('a done event for another request is not accepted', async () => {
  mock.chat = ['mismatch'];
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /did not confirm/);
  await c.close();
});

test('refusals are explained and not retried', async () => {
  mock.chat = ['refused-429', 'refused-403-workload'];
  const c = await connect(env({ LEARN_MCP_MAX_TURNS: '3' }));
  const rate = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.match(rate.text, /429 DEVELOPER_CAPACITY_LIMIT/);
  assert.match(rate.text, /after 60 seconds/);
  const pool = await c.call('learn_test_turn', { message: 'b', confirm: true });
  assert.match(pool.text, /403 DEVELOPER_WORKLOAD_REVIEW_REQUIRED: Learn has paused new turns for now, for a reason on its own side/);
  assert.match(pool.text, /You did nothing wrong, and nothing was charged\. Stop here and try again later\./);
  assert.match(pool.text, /never sends a turn again on its own/);
  assert.equal(chats().length, 2, 'each sent once');
  await c.close();
});

test('a live key is refused unless the call allows it', async () => {
  mock.mode = 'live';
  const c = await connect(env());
  const refused = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /live/);
  assert.equal(chats().length, 0);
  assert.equal(prepares().length, 0);
  const preview = await c.call('learn_test_turn', { message: 'a', allow_live: true });
  assert.match(preview.text, /live key: the turn costs \$0\.05/);
  const sent = await c.call('learn_test_turn', { message: 'a', allow_live: true, confirm: true });
  assert.equal(sent.isError, undefined, sent.text);
  assert.match(sent.text, /Charged: \$0\.05/);
  await c.close();
});

test('where the client supports it, the developer confirms in a dialog', async () => {
  for (const [answer, expectSent] of [[{ action: 'accept', content: { send: true } }, true], [{ action: 'decline' }, false]] as const) {
    resetBudgetForTests();
    mock.requests.length = 0;
    const asked: string[] = [];
    const c = await connect(env(), { capabilities: { elicitation: { form: {} } } });
    c.client.setRequestHandler('elicitation/create', async (request) => {
      asked.push(String(request.params.message));
      return answer as never;
    });
    const r = await c.call('learn_test_turn', { message: 'a', confirm: true });
    assert.equal(asked.length, 1);
    assert.match(asked[0], /free test attempts/);
    assert.equal(chats().length, expectSent ? 1 : 0, r.text);
    await c.close();
  }
});

test('the key never appears in any output, error or saved file', async () => {
  mock.chat = ['refused-401-echo-key'];
  const c = await connect(env());
  const r = await c.call('learn_test_turn', { message: 'a', confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /401 DEVELOPER_AUTHENTICATION_REQUIRED/);
  await c.close();
  for (const text of seen) assert.ok(!text.includes(TEST_KEY), 'key in a tool result');
  for (const file of readdirSync(stateDir)) {
    if (file.endsWith('.json')) assert.ok(!readFileSync(join(stateDir, file), 'utf8').includes(TEST_KEY), 'key in the state file');
  }
});

test('the docs-only HTTP mode serves docs and no key-backed tool, even with a key set', async () => {
  const saved = process.env.FOREVERLEARNING_API_KEY;
  process.env.FOREVERLEARNING_API_KEY = TEST_KEY;
  const server = await startDocsHttp(0, '127.0.0.1', { snapshot });
  const port = (server.address() as { port: number }).port;
  const client = new Client({ name: 'http-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + port + '/mcp')));
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('learn_guide'));
  assert.ok(!names.includes('learn_test_turn'));
  assert.ok(!names.includes('learn_lookup_request'));
  const r = await client.callTool({ name: 'learn_kits', arguments: {} }) as { content: { text: string }[] };
  assert.match(r.content[0].text, /01-first-tutor/);
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  if (saved === undefined) delete process.env.FOREVERLEARNING_API_KEY; else process.env.FOREVERLEARNING_API_KEY = saved;
  assert.equal(mock.requests.length, 0);
});
