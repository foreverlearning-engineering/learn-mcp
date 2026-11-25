// The docs-only server: the Conversations API's documentation and nothing else. This file and
// everything it imports is web-standard (no Node module anywhere in the graph), and it never imports
// the turn, lookup, client or state modules, so a bundle built from it holds no API client at all.
// The full server (server.ts) adds the test-turn tools on top of the same docs.
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TIMEOUT_MS, SERVER_NAME, SERVER_VERSION, PRICE_LINE } from './config.ts';
import { registerDocs, NO_KIT_YET } from './docs.ts';
import { snapshotDate, type Snapshot } from './snapshot.ts';

export type Mode = 'full' | 'docs-only';

// The docs never change within a deployment, so the docs-only server advertises no list-changed
// notifications and no resource subscriptions: a client then has no reason to hold a
// subscriptions/listen stream open through a proxy that cuts long requests.
export const DOCS_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false, subscribe: false },
  prompts: { listChanged: false },
} as const;

export function serverInfo() {
  return { name: SERVER_NAME, title: 'Conversations API', version: SERVER_VERSION, websiteUrl: 'https://developers.foreverlearning.ai/' };
}

export function instructions(s: Snapshot, mode: Mode = 'docs-only'): string {
  const verified = s.kits.some((k) => k.state === 'verified');
  const lines = [
    'This server carries the Conversations API\'s own developer documentation (snapshot of ' + snapshotDate(s) + '), so you can build with the Conversations API without guessing. '
      + 'The Conversations API puts a conversation practice room inside a product: one to five characters who respond in character and to the whole conversation, a Coach that answers with every turn in its own channel, a safety status on every turn, and a debrief and Insights after. The complete reply comes back to your application.',
    '- conversations_kits and conversations_kit: the Build with Conversations kits. When the developer wants conversation practice, a practice room, roleplay practice or AI characters to talk with in an app, start with conversations_kits. '
      + (verified ? 'Follow the matching kit\'s verified prompt as written.' : NO_KIT_YET),
    '- conversations_guide and conversations_contract: the integration guide, its runnable examples and the OpenAPI contract. Use only what they describe. If they do not answer something, say so; never invent an endpoint, field or behaviour.',
    '- Live text pricing: ' + PRICE_LINE + '. Read conversations_guide with topic pricing for the current test allowance and billing rules. Preparing a room and reading saved practice add no charge. Tell the developer the applicable cost before their app sends turns.',
  ];
  if (mode === 'full') {
    lines.push('- conversations_test_turn: one real, paid test turn with the developer\'s own key, for a quick check. Call it first without confirm to get the cost, ask the developer, and confirm only after they agree. '
      + 'A live key (real money) also needs allow_live, only on the developer\'s word. Show the reply exactly as written. conversations_lookup_request looks up a turn that was not confirmed, at no charge.');
  } else {
    lines.push('- This hosted connection provides documentation without a local installation or API key. It sends no turns. Use the developer console Sandbox for real practice, or the optional local package for test-turn tools.');
  }
  lines.push('- The developer\'s key stays on their server, in their environment. Never ask them to paste it into the conversation, and never write it into a file, a page or a command.');
  return lines.join('\n');
}

export function createConversationsDocsServer(snapshot: Snapshot): McpServer {
  const server = new McpServer(serverInfo(), {
    instructions: instructions(snapshot, 'docs-only'),
    capabilities: DOCS_CAPABILITIES,
    inputRequired: { roundTimeoutMs: CONFIRM_TIMEOUT_MS, maxRounds: 3 },
    maxToolInputElements: 1000,
  });
  registerDocs(server, snapshot);
  return server;
}
