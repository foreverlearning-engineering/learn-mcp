// The Conversations API's docs, from the bundled snapshot: tools, prompts and resources.
// No key and no network: every answer is the published text itself.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  contractFile, conversationOperations, findKit, findOperations, findSection, guideTopics, guideWhole,
  operationDetail, schemaDefinition, schemaNames, sectionText, snapshotDate, starterFile, type Kit, type Snapshot,
} from './snapshot.ts';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
function notFound(t: string) {
  return { content: [{ type: 'text' as const, text: t }], isError: true };
}

export function kitSummary(k: Kit): string {
  if (k.state !== 'verified') return '- ' + k.id + ' (' + k.step + '): ' + k.title + '. Coming soon.';
  return '- ' + k.id + ' (' + k.step + '): ' + k.title + '. Start from ' + k.start_from + '.';
}

// Until a kit is verified on the release developers use, the docs are the way to build.
export const NO_KIT_YET = 'No Build with Conversations kit is verified yet. Until one is, build from conversations_guide and conversations_contract, in the guide\'s order: read the catalog, prepare a session, request the opening, send turns, close the session, read the debrief.';

export function kitText(s: Snapshot, k: Kit): string {
  if (k.state !== 'verified') return k.title + ' (' + k.step + ') is coming soon. ' + NO_KIT_YET;
  return [
    '# ' + k.title,
    'Where to run it: ' + k.where_to_run,
    '## The prompt, word for word',
    'This prompt is verified as written: before we publish a kit, we run its prompt in coding assistants against the release you use, and check the app it builds. Follow it as written. The pages it names under "Read first" are in this server: conversations_guide (the integration guide and its examples) and conversations_contract (the OpenAPI contract).',
    '```text\n' + k.prompt.replace(/\n+$/, '') + '\n```',
    '## The check: what you should see',
    k.check.replace(/^# [^\n]*\n+/, ''),
    '## The finished checkpoint',
    'Folder `' + k.starter_folder + '` of conversations-room-starter (' + k.starter_url + ', MIT). Files: ' + k.starter_files.join(', ') + '. Read one with conversations_starter_file.',
    'Kit page: ' + k.page + '. Snapshot of ' + snapshotDate(s) + '.',
  ].join('\n\n');
}

export function registerDocs(server: McpServer, s: Snapshot): void {
  const date = snapshotDate(s);
  const topics = guideTopics(s);
  const verified = s.kits.filter((k) => k.state === 'verified');

  server.registerTool('conversations_guide', {
    title: 'Conversations API integration guide',
    description: 'Read the Conversations API integration guide (snapshot of ' + date + '), whole or by topic, or one of its runnable examples. '
      + 'Use it for any question about putting a conversation practice room inside a product: choosing a room and its characters, preparing a session, the opening and each turn, '
      + 'accepting a turn only on its final done event, the characters\' faces and presence, the Coach, the safety status, closing a session and reading the debrief and Insights, optional voices, export and deletion, and the price. '
      + 'Answer only from what it says; if it does not cover something, say so instead of guessing. '
      + 'Topics: ' + topics.map((t) => t.id).join(', ') + '. Examples: ' + s.examples.map((e) => e.name).join(', ') + '.',
    inputSchema: z.object({
      topic: z.string().max(200).optional().describe('A topic id from the list (for example "setup", "turns", "characters") or words from its heading. Leave it out for the whole guide.'),
      example: z.string().max(200).optional().describe('A runnable example file to read instead, for example "conversation.ts" or "README.md".'),
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

  server.registerTool('conversations_contract', {
    title: 'Conversations API contract',
    description: 'Read the Conversations API contract (OpenAPI 3.1 and JSON Schema, snapshot of ' + date + '). '
      + 'With no arguments: every operation a Conversations integration uses, by method, path and operationId. '
      + 'With operation (an operationId such as "conversationChat", or "POST /v1/conversation/sessions"): that operation with every schema it uses filled in. '
      + 'With schema (a definition name such as "Turn", "StreamEvent", "Character" or "Debrief"): that definition filled in. With file: one whole contract file (large). '
      + 'Use only fields the contract defines.',
    inputSchema: z.object({
      operation: z.string().max(200).optional().describe('An operationId, or a method and path such as "GET /v1/conversation/catalog".'),
      schema: z.string().max(100).optional().describe('A schema definition name, for example "Turn" or "StreamEvent".'),
      file: z.enum(s.contract.map((c) => c.name) as [string, ...string[]]).optional().describe('One whole contract file.'),
    }),
    annotations: READ_ONLY,
  }, async ({ operation, schema, file }) => {
    if (file) {
      const f = contractFile(s, file);
      if (!f) return notFound('No contract file named "' + file + '".');
      return text(f.title + ' (' + f.url + ', snapshot of ' + date + ', sha256 ' + f.sha256 + '):\n\n' + f.text);
    }
    if (schema) {
      const d = schemaDefinition(s, schema);
      if (d === undefined) return notFound('No schema definition named "' + schema + '". Definitions: ' + schemaNames(s).join(', ') + '.');
      return text('Schema definition ' + schema + ' (conversation-v1.json, snapshot of ' + date + '), with each $ref filled in:\n\n' + JSON.stringify(d));
    }
    if (operation) {
      const rows = findOperations(s, operation);
      if (!rows.length) return notFound('No operation matches "' + operation + '". Call conversations_contract with no arguments for the list.');
      return text(rows.map((r) => r.method + ' ' + r.path + ' (' + r.operationId + ', from ' + r.document + '), with each $ref filled in:\n\n' + JSON.stringify(operationDetail(s, r))).join('\n\n') + '\n\nSnapshot of ' + date + '.');
    }
    const rows = conversationOperations(s);
    return text('The Conversations API contract, snapshot of ' + date + '. The Conversations operations (conversation.openapi.json) and the shared lifecycle operations they use (developer-runtime.openapi.json):\n\n'
      + rows.map((r) => r.method + ' ' + r.path + '  ' + r.operationId + ': ' + r.summary + '  [' + r.document + ']').join('\n')
      + '\n\nFiles: ' + s.contract.map((c) => c.name + ' (' + c.url + ')').join(', ') + '.');
  });

  server.registerTool('conversations_kits', {
    title: 'Build with Conversations kits',
    description: 'List the Build with Conversations kits: step-by-step builds with the Conversations API, from a first practice room to embedding one in an existing app and ready-made recipes such as interview practice. '
      + 'Each verified kit has a prompt for coding assistants that is verified as written, a check of what the result should show, and a finished checkpoint folder. '
      + 'Start here when the developer wants conversation practice, roleplay practice, a practice room, interview, sales or language practice, or AI characters to talk with, in an app.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => text('Build with Conversations kits (snapshot of ' + date + '). Read one with conversations_kit.\n\n'
    + s.kits.map(kitSummary).join('\n')
    + '\n\n' + (verified.length ? 'New to the Conversations API: start with ' + verified[0].id + '.' : NO_KIT_YET)));

  server.registerTool('conversations_kit', {
    title: 'One Build with Conversations kit',
    description: 'Read one Build with Conversations kit: where to run it, its verified prompt word for word, its check, and its finished checkpoint folder in conversations-room-starter. '
      + 'Kits: ' + s.kits.map((k) => k.id + (k.state === 'verified' ? '' : ' (coming soon)')).join(', ') + '.',
    inputSchema: z.object({
      kit: z.string().max(200).describe('A kit id such as "01-first-room" or "embed", a step number, or words from its title.'),
    }),
    annotations: READ_ONLY,
  }, async ({ kit }) => {
    const k = findKit(s, kit);
    if (!k) return notFound('No kit matches "' + kit + '". Kits:\n' + s.kits.map(kitSummary).join('\n'));
    return text(kitText(s, k));
  });

  server.registerTool('conversations_starter_file', {
    title: 'A file from a kit checkpoint',
    description: "Read one file of a verified kit's finished checkpoint folder in conversations-room-starter (MIT), to compare with or start from. conversations_kit lists each folder's files.",
    inputSchema: z.object({
      kit: z.string().max(200).describe('The kit id, for example "01-first-room".'),
      path: z.string().max(300).describe('The file path inside the kit folder, for example "conversations.ts" or "public/app.js".'),
    }),
    annotations: READ_ONLY,
  }, async ({ kit, path }) => {
    const k = findKit(s, kit);
    if (!k || k.state !== 'verified') return notFound('No verified kit matches "' + kit + '". ' + NO_KIT_YET);
    const body = starterFile(s, k, path);
    if (body === undefined) return notFound('No file "' + path + '" in ' + k.starter_folder + '. Files: ' + k.starter_files.join(', ') + '.');
    return text(k.starter_folder + '/' + path.replace(/^\.?\/*/, '') + ' (conversations-room-starter at ' + s.starter.commit.slice(0, 7) + ', MIT):\n\n' + body);
  });

  // ---------- Prompts: the verified entry points, word for word ----------
  for (const k of verified.filter((x) => x.mcp_prompt)) {
    server.registerPrompt(k.mcp_prompt as string, {
      title: k.title,
      description: 'The verified Build with Conversations prompt for "' + k.title + '", word for word. Where to run it: ' + k.where_to_run,
    }, () => ({
      description: k.title + ' (Build with Conversations, ' + k.step.toLowerCase() + ')',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: k.prompt } }],
    }));
  }

  // ---------- Resources ----------
  server.registerResource('conversations-guide', 'conversations://guide', {
    title: 'Conversations API integration guide',
    description: 'The whole Conversations API integration guide, snapshot of ' + date + '.',
    mimeType: 'text/markdown',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideWhole(s) }] }));

  server.registerResource('conversations-guide-topic', new ResourceTemplate('conversations://guide/{topic}', {
    list: async () => ({ resources: topics.map((t) => ({ uri: 'conversations://guide/' + t.id, name: 'guide-' + t.id, title: t.title, mimeType: 'text/markdown' })) }),
  }), {
    title: 'Conversations API integration guide, one topic',
    mimeType: 'text/markdown',
  }, async (uri, variables) => {
    const section = findSection(s, String(variables.topic));
    if (!section) throw new Error('No guide topic ' + String(variables.topic));
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: sectionText(s, section) }] };
  });

  server.registerResource('conversations-contract', new ResourceTemplate('conversations://contract/{file}', {
    list: async () => ({ resources: s.contract.map((c) => ({ uri: 'conversations://contract/' + c.name, name: c.name, title: c.title, mimeType: 'application/json' })) }),
  }), {
    title: 'Conversations API contract file',
    mimeType: 'application/json',
  }, async (uri, variables) => {
    const f = contractFile(s, String(variables.file));
    if (!f) throw new Error('No contract file ' + String(variables.file));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: f.text }] };
  });

  server.registerResource('conversations-example', new ResourceTemplate('conversations://examples/{file}', {
    list: async () => ({ resources: s.examples.map((e) => ({ uri: 'conversations://examples/' + e.name, name: 'example-' + e.name, title: 'Runnable example ' + e.name, mimeType: 'text/plain' })) }),
  }), {
    title: 'Conversations API runnable example',
    mimeType: 'text/plain',
  }, async (uri, variables) => {
    const e = s.examples.find((x) => x.name === String(variables.file));
    if (!e) throw new Error('No example ' + String(variables.file));
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: e.text }] };
  });

  if (verified.length) {
    server.registerResource('conversations-kit-prompt', new ResourceTemplate('conversations://kits/{kit}/prompt', {
      list: async () => ({ resources: verified.map((k) => ({ uri: 'conversations://kits/' + k.id + '/prompt', name: k.id + '-prompt', title: k.title + ': the verified prompt', mimeType: 'text/plain' })) }),
    }), {
      title: 'Build with Conversations kit prompt',
      mimeType: 'text/plain',
    }, async (uri, variables) => {
      const k = verified.find((x) => x.id === String(variables.kit));
      if (!k) throw new Error('No verified kit ' + String(variables.kit));
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: k.prompt }] };
    });
  }

  server.registerResource('conversations-snapshot', 'conversations://snapshot', {
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
