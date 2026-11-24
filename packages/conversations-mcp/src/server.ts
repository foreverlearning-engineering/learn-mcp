// The Conversations API's MCP server: one factory for both ways it runs.
//   full:      the npm package over stdio. Docs tools, prompts and resources, plus the test-turn
//              tools that use the developer's own key from their environment.
//   docs-only: no key and no API calls at all. What a hosted Streamable HTTP address serves.
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TIMEOUT_MS, SERVER_NAME, SERVER_VERSION, PRICE_LINE } from './config.ts';
import { registerDocs, NO_KIT_YET } from './docs.ts';
import { registerTurnTools } from './turn.ts';
import { loadSnapshot, snapshotDate, type Snapshot } from './snapshot.ts';

export type Mode = 'full' | 'docs-only';

export interface ServerSettings {
  mode?: Mode;
  snapshot?: Snapshot;
  env?: NodeJS.ProcessEnv;
}

export function instructions(s: Snapshot, mode: Mode = 'docs-only'): string {
  const verified = s.kits.some((k) => k.state === 'verified');
  const lines = [
    'This server carries the Conversations API\'s own developer documentation (snapshot of ' + snapshotDate(s) + '), so you can build with the Conversations API without guessing. '
      + 'The Conversations API puts a conversation practice room inside a product: one to five characters who respond in character and to the whole conversation, a Coach that answers with every turn in its own channel, a safety status on every turn, and a debrief and Insights after. The complete reply comes back to your application.',
    '- conversations_kits and conversations_kit: the Build with Conversations kits. When the developer wants conversation practice, a practice room, roleplay practice or AI characters to talk with in an app, start with conversations_kits. '
      + (verified ? 'Follow the matching kit\'s verified prompt as written.' : NO_KIT_YET),
    '- conversations_guide and conversations_contract: the integration guide, its runnable examples and the OpenAPI contract. Use only what they describe. If they do not answer something, say so; never invent an endpoint, field or behaviour.',
    '- Cost: every opening, turn and closeout is a billable text turn (' + PRICE_LINE + '); preparing a room and reading saved practice are free. There are no free test turns. Tell the developer before their app sends turns.',
  ];
  if (mode === 'full') {
    lines.push('- conversations_test_turn: one real, paid test turn with the developer\'s own key, for a quick check. Call it first without confirm to get the cost, ask the developer, and confirm only after they agree. '
      + 'A live key (real money) also needs allow_live, only on the developer\'s word. Show the reply exactly as written. conversations_lookup_request looks up a turn that was not confirmed, free.');
  } else {
    lines.push('- This is the docs-only mode: it sends no turns. To test with a key, the developer runs the npm package, which keeps the key in their own environment.');
  }
  lines.push('- The developer\'s key stays on their server, in their environment. Never ask them to paste it into the conversation, and never write it into a file, a page or a command.');
  return lines.join('\n');
}

export function createConversationsServer(settings: ServerSettings = {}): McpServer {
  const mode = settings.mode ?? 'docs-only';
  const s = settings.snapshot ?? loadSnapshot();
  const server = new McpServer(
    { name: SERVER_NAME, title: 'Conversations API', version: SERVER_VERSION, websiteUrl: 'https://developers.foreverlearning.ai/' },
    {
      instructions: instructions(s, mode),
      inputRequired: { roundTimeoutMs: CONFIRM_TIMEOUT_MS, maxRounds: 3 },
      maxToolInputElements: 1000,
    },
  );
  registerDocs(server, s);
  if (mode === 'full') registerTurnTools(server, settings.env ?? process.env);
  return server;
}
