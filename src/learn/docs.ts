// The Learn API's docs, from the bundled snapshot: tools, prompts and resources.
// No key and no network: every answer is the published text itself.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  contractFile, findKit, findOperations, findSection, guideTopics, guideWhole, operationDetail, operations,
  sectionText, snapshotDate, starterFile, type Kit, type Snapshot,
} from '../snapshot.ts';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
function notFound(t: string) {
  return { content: [{ type: 'text' as const, text: t }], isError: true };
}

export function kitSummary(k: Kit): string {
  if (k.state !== 'verified') return '- ' + k.id + ' (' + k.step + '): ' + k.title + '. Coming soon on the developer site.';
  const time = k.byline.split(' · ').filter((part) => /minute|hour|afternoon/i.test(part)).join(', ');
  return '- ' + k.id + ' (' + k.step + '): ' + k.title + '. ' + (time ? time + '. ' : '') + 'Start from ' + k.start_from + '.';
}

export function kitText(s: Snapshot, k: Kit): string {
  if (k.state !== 'verified') return k.title + ' (' + k.step + ') is coming soon. Its page: ' + k.page;
  return [
    '# ' + k.title,
    k.byline,
    "What you'll build: " + k.what_you_build,
    'Where to run it: ' + k.where_to_run,
    '## The prompt, word for word',
    'This prompt is verified as written: before we publish a kit, we run its prompt in coding assistants against the release you use, and check the app it builds. Follow it as written. The pages it names under "Read first" are in this server: learn_guide (the Learn integration guide, and its runnable examples), learn_contract (the Learn OpenAPI contract).',
    '```text\n' + k.prompt.replace(/\n+$/, '') + '\n```',
    '## The check: what you should see',
    k.check.replace(/^# [^\n]*\n+/, ''),
    '## The finished checkpoint',
    'Folder `' + k.starter_folder + '` of learn-tutor-starter (' + k.starter_url + ', MIT). Files: ' + k.starter_files.join(', ') + '. Read one with learn_starter_file.',
    'Kit page: ' + k.page + '. Snapshot of ' + snapshotDate(s) + '.',
  ].join('\n\n');
}

export function registerDocs(server: McpServer, s: Snapshot): void {
  const date = snapshotDate(s);
  const topics = guideTopics(s);
  const verified = s.kits.filter((k) => k.state === 'verified');

  server.registerTool('learn_guide', {
    title: 'Learn integration guide',
    description: 'Read the Learn API integration guide (snapshot of ' + date + '), whole or by topic, or one of its runnable examples. '
      + 'Use it for any question about building with the Learn API: preparing a session, the four kinds of help, sending a turn and accepting it only on its final done event, '
      + 'the safety status, receipts, errors and recovery. Answer only from what it says; if it does not cover something, say so instead of guessing. '
      + 'Topics: ' + topics.map((t) => t.id).join(', ') + '. Examples: ' + s.examples.map((e) => e.name).join(', ') + '.',
    inputSchema: z.object({
      topic: z.string().max(200).optional().describe('A topic id from the list (for example "turn", "safety", "errors") or words from its heading. Leave it out for the whole guide.'),
      example: z.string().max(200).optional().describe('A runnable example file to read instead, for example "quest.ts" or "README.md".'),
    }),
    annotations: READ_ONLY,
  }, async ({ topic, example }) => {
    if (example) {
      const e = s.examples.find((x) => x.name.toLowerCase() === example.trim().toLowerCase().replace(/^.*\//, ''));
      if (!e) return notFound('No example named "' + example + '". Examples: ' + s.examples.map((x) => x.name).join(', ') + '.');
      return text('Runnable example ' + e.name + ' (' + e.url + ', snapshot of ' + date + '):\n\n' + e.text);
    }
    if (!topic || /^(all|whole|everything)$/i.test(topic.trim())) return text(guideWhole(s));
    const section = findSection(s, topic);
    if (!section) return notFound('No guide topic matches "' + topic + '". Topics: ' + topics.map((t) => t.id + ' (' + t.title + ')').join('; ') + '.');
    return text(sectionText(s, section));
  });

  server.registerTool('learn_contract', {
    title: 'Learn API contract',
    description: 'Read the Learn API contract (OpenAPI 3.1 and JSON Schema, snapshot of ' + date + '). '
      + 'With no arguments: every operation, by method, path and operationId. With operation (an operationId such as "developerChat", or "POST /v1/chat"): '
      + 'that operation with every schema it uses filled in. With file: one whole contract file (large). Use only fields the contract defines.',
    inputSchema: z.object({
      operation: z.string().max(200).optional().describe('An operationId, or a method and path such as "GET /v1/requests/{request_id}".'),
      file: z.enum(s.contract.map((c) => c.name) as [string, ...string[]]).optional().describe('One whole contract file.'),
    }),
    annotations: READ_ONLY,
  }, async ({ operation, file }) => {
    if (file) {
      const f = contractFile(s, file);
      if (!f) return notFound('No contract file named "' + file + '".');
      return text(f.title + ' (' + f.url + ', snapshot of ' + date + ', sha256 ' + f.sha256 + '):\n\n' + f.text);
    }
    if (operation) {
      const rows = findOperations(s, operation);
      if (!rows.length) return notFound('No operation matches "' + operation + '". Call learn_contract with no arguments for the list.');
      return text(rows.map((r) => r.method + ' ' + r.path + ' (' + r.operationId + ', from ' + r.document + '), with each $ref filled in:\n\n' + JSON.stringify(operationDetail(s, r))).join('\n\n') + '\n\nSnapshot of ' + date + '.');
    }
    const rows = operations(s);
    return text('The Learn API contract, snapshot of ' + date + '. Learn operations (learn.openapi.json) and the shared lifecycle operations they use (developer-runtime.openapi.json):\n\n'
      + rows.map((r) => r.method + ' ' + r.path + '  ' + r.operationId + ': ' + r.summary + '  [' + r.document + ']').join('\n')
      + '\n\nFiles: ' + s.contract.map((c) => c.name + ' (' + c.url + ')').join(', ') + '.');
  });

  server.registerTool('learn_kits', {
    title: 'Build with Learn kits',
    description: 'List the Build with Learn kits: step-by-step builds with the Learn API, from a first tutor page to embedding Learn in an existing app. '
      + 'Each kit has a prompt for coding assistants that is verified as written, a check of what the result should show, and a finished checkpoint folder. '
      + 'Start here when the developer wants to add tutoring, a tutor, homework help or learning help to an app with the Learn API.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => text('Build with Learn kits (snapshot of ' + date + '). Read one with learn_kit.\n\n'
    + s.kits.map(kitSummary).join('\n')
    + '\n\nNew to the Learn API: start with 01-first-tutor. Adding Learn to an existing product: embed.'));

  server.registerTool('learn_kit', {
    title: 'One Build with Learn kit',
    description: 'Read one Build with Learn kit: where to run it, its verified prompt word for word, its check (what the finished app shows, with a real reply), '
      + 'and its finished checkpoint folder in learn-tutor-starter. Kits: ' + verified.map((k) => k.id).join(', ') + '.',
    inputSchema: z.object({
      kit: z.string().max(200).describe('A kit id such as "01-first-tutor" or "embed", a step number, or words from its title.'),
    }),
    annotations: READ_ONLY,
  }, async ({ kit }) => {
    const k = findKit(s, kit);
    if (!k) return notFound('No kit matches "' + kit + '". Kits:\n' + s.kits.map(kitSummary).join('\n'));
    return text(kitText(s, k));
  });

  server.registerTool('learn_starter_file', {
    title: 'A file from a kit checkpoint',
    description: "Read one file of a kit's finished checkpoint folder in learn-tutor-starter (MIT), to compare with or start from. learn_kit lists each folder's files.",
    inputSchema: z.object({
      kit: z.string().max(200).describe('The kit id, for example "01-first-tutor".'),
      path: z.string().max(300).describe('The file path inside the kit folder, for example "learn.ts" or "public/app.js".'),
    }),
    annotations: READ_ONLY,
  }, async ({ kit, path }) => {
    const k = findKit(s, kit);
    if (!k || k.state !== 'verified') return notFound('No verified kit matches "' + kit + '".');
    const body = starterFile(s, k, path);
    if (body === undefined) return notFound('No file "' + path + '" in ' + k.starter_folder + '. Files: ' + k.starter_files.join(', ') + '.');
    return text(k.starter_folder + '/' + path.replace(/^\.?\/*/, '') + ' (learn-tutor-starter at ' + s.starter.commit.slice(0, 7) + ', MIT):\n\n' + body);
  });

  // ---------- Prompts: the two verified entry points, word for word ----------
  for (const k of verified.filter((x) => x.mcp_prompt)) {
    server.registerPrompt(k.mcp_prompt as string, {
      title: k.title,
      description: 'The verified Build with Learn prompt for "' + k.title + '", word for word. Where to run it: ' + k.where_to_run,
    }, () => ({
      description: k.title + ' (Build with Learn, ' + k.step.toLowerCase() + ')',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: k.prompt } }],
    }));
  }

  // ---------- Resources ----------
  server.registerResource('learn-guide', 'learn://guide', {
    title: 'Learn integration guide',
    description: 'The whole Learn integration guide, snapshot of ' + date + '.',
    mimeType: 'text/markdown',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideWhole(s) }] }));

  server.registerResource('learn-guide-topic', new ResourceTemplate('learn://guide/{topic}', {
    list: async () => ({ resources: topics.map((t) => ({ uri: 'learn://guide/' + t.id, name: 'guide-' + t.id, title: t.title, mimeType: 'text/markdown' })) }),
  }), {
    title: 'Learn integration guide, one topic',
    mimeType: 'text/markdown',
  }, async (uri, variables) => {
    const section = findSection(s, String(variables.topic));
    if (!section) throw new Error('No guide topic ' + String(variables.topic));
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: sectionText(s, section) }] };
  });

  server.registerResource('learn-contract', new ResourceTemplate('learn://contract/{file}', {
    list: async () => ({ resources: s.contract.map((c) => ({ uri: 'learn://contract/' + c.name, name: c.name, title: c.title, mimeType: 'application/json' })) }),
  }), {
    title: 'Learn API contract file',
    mimeType: 'application/json',
  }, async (uri, variables) => {
    const f = contractFile(s, String(variables.file));
    if (!f) throw new Error('No contract file ' + String(variables.file));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: f.text }] };
  });

  server.registerResource('learn-example', new ResourceTemplate('learn://examples/{file}', {
    list: async () => ({ resources: s.examples.map((e) => ({ uri: 'learn://examples/' + e.name, name: 'example-' + e.name, title: 'Runnable example ' + e.name, mimeType: 'text/plain' })) }),
  }), {
    title: 'Learn runnable example',
    mimeType: 'text/plain',
  }, async (uri, variables) => {
    const e = s.examples.find((x) => x.name === String(variables.file));
    if (!e) throw new Error('No example ' + String(variables.file));
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: e.text }] };
  });

  server.registerResource('learn-kit-prompt', new ResourceTemplate('learn://kits/{kit}/prompt', {
    list: async () => ({ resources: verified.map((k) => ({ uri: 'learn://kits/' + k.id + '/prompt', name: k.id + '-prompt', title: k.title + ': the verified prompt', mimeType: 'text/plain' })) }),
  }), {
    title: 'Build with Learn kit prompt',
    mimeType: 'text/plain',
  }, async (uri, variables) => {
    const k = verified.find((x) => x.id === String(variables.kit));
    if (!k) throw new Error('No verified kit ' + String(variables.kit));
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: k.prompt }] };
  });

  server.registerResource('learn-kit-check', new ResourceTemplate('learn://kits/{kit}/check', {
    list: async () => ({ resources: verified.map((k) => ({ uri: 'learn://kits/' + k.id + '/check', name: k.id + '-check', title: k.title + ': what you should see', mimeType: 'text/markdown' })) }),
  }), {
    title: 'Build with Learn kit check',
    mimeType: 'text/markdown',
  }, async (uri, variables) => {
    const k = verified.find((x) => x.id === String(variables.kit));
    if (!k) throw new Error('No verified kit ' + String(variables.kit));
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: k.check }] };
  });

  server.registerResource('learn-snapshot', 'learn://snapshot', {
    title: 'About this docs snapshot',
    description: 'When the bundled docs were taken, from where, and which kits they include.',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({
        taken_at: s.taken_at,
        guide: s.guide.url,
        contract: s.contract.map((c) => ({ file: c.name, url: c.url, sha256: c.sha256 })),
        kits: s.kits.map((k) => ({ id: k.id, state: k.state, page: k.page })),
        starter: { repository: s.starter.repository, commit: s.starter.commit },
      }, null, 2),
    }],
  }));
}
