// One counted live check of the Conversations test-turn tool on STAGING, through the built stdio server
// and a real MCP client: the cost plan (no send), the room's opening, one message, then the lookup of
// the last request (no charge). Run under the kits key wrapper, which sets CONVERSATIONS_API_KEY,
// CONVERSATIONS_API_BASE and CONVERSATIONS_ASSIGNMENT_ID for this process only; they are mapped to the
// server's FOREVERLEARNING_* names in the child's environment and never printed. Records go to
// runs/live-<stamp>/ with the key redacted. Spend: two text turns of staging credit (about $0.06).
//   powershell -File C:/dev/foreverlearning-crm/Terry/Tools/run-with-conversations-staging-key.ps1 node scripts/live-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = process.env.CONVERSATIONS_API_KEY ?? '';
const base = process.env.CONVERSATIONS_API_BASE ?? '';
const assignment = process.env.CONVERSATIONS_ASSIGNMENT_ID ?? '';
if (!key || !base || !assignment) { console.error('Run this under run-with-conversations-staging-key.ps1: the key, base and assignment are not set.'); process.exit(2); }
if (!/developers-api-staging\.foreverlearning\.ai/.test(base)) { console.error('Refusing: the base is not the staging host.'); process.exit(2); }
const redact = (s) => String(s).split(key).join('<redacted-key>').replace(/fl_(live|stag|test)_[0-9a-f]{16,}(_[0-9a-f]+)?/gi, '<redacted-key>');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(root, 'runs', 'live-' + stamp);
mkdirSync(dir, { recursive: true });
const record = { startedAt: new Date().toISOString(), base, assignment, runtimeBefore: null, runtimeAfter: null, steps: [] };
const health = async () => { try { const r = await fetch(base.replace(/\/v1$/, '') + '/health'); const j = await r.json(); return j.runtime_release ?? j.runtime ?? JSON.stringify(j).slice(0, 120); } catch (e) { return 'unreadable: ' + e.message; } };
record.runtimeBefore = await health();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'dist', 'cli.js')],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CONVERSATIONS_API|^FOREVERLEARNING_/.test(k))),
    FOREVERLEARNING_API_KEY: key, FOREVERLEARNING_BASE_URL: base, FOREVERLEARNING_ASSIGNMENT_ID: assignment,
    CONVERSATIONS_MCP_CONFIRM_DIALOG: 'off', CONVERSATIONS_MCP_STATE_DIR: join(dir, 'state'), CONVERSATIONS_MCP_PROJECT: join(dir, 'project'),
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'conversations-live-check', version: '1' });
const step = async (name, args) => {
  const t = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const text = redact(r.content.map((c) => c.text ?? '').join('\n'));
  const entry = { name, args, ms: Math.round(performance.now() - t), isError: r.isError === true, text, structured: r.structuredContent ? JSON.parse(redact(JSON.stringify(r.structuredContent))) : null };
  record.steps.push(entry);
  console.log('=== ' + name + ' ' + JSON.stringify(args) + ' (' + entry.ms + ' ms' + (entry.isError ? ', isError' : '') + ')\n' + text + '\n');
  return entry;
};
try {
  await client.connect(transport);
  record.tools = (await client.listTools()).tools.map((t) => t.name);
  const plan = await step('conversations_test_turn', { opening: true });
  if (!/^Not sent yet/.test(plan.text)) throw new Error('The plan step did not stop before sending');
  const opening = await step('conversations_test_turn', { opening: true, confirm: true });
  if (opening.isError) throw new Error('The opening did not complete');
  const message = await step('conversations_test_turn', { message: 'I wanted to talk about the last two reports. They were late, and I want to understand what got in the way.', confirm: true });
  if (message.isError) throw new Error('The message turn did not complete');
  const lastId = message.structured?.receipt?.request_id;
  if (lastId) await step('conversations_lookup_request', { request_id: lastId });
  await step('conversations_lookup_request', { request_id: 'req_does_not_exist_' + stamp.slice(0, 10) });
  const third = await step('conversations_test_turn', { message: 'And one more.', confirm: true });
  if (!/its limit for one run/.test(third.text)) throw new Error('The cap did not hold at 2');
  record.passed = true;
} catch (e) {
  record.passed = false; record.error = redact(e.message);
  console.error('FAILED: ' + record.error);
} finally {
  await client.close().catch(() => {});
  record.runtimeAfter = await health();
  record.endedAt = new Date().toISOString();
  writeFileSync(join(dir, 'record.json'), redact(JSON.stringify(record, null, 2)) + '\n');
  console.log('record: ' + join(dir, 'record.json') + ' | runtime before ' + record.runtimeBefore + ' after ' + record.runtimeAfter + ' | passed ' + record.passed);
  process.exit(record.passed ? 0 : 1);
}
