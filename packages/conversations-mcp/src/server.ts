// The Conversations API's MCP server: the docs tools, prompts and resources, from the bundled
// snapshot. This first version reads no key and sends nothing. A capped, confirmed test turn with
// the developer's own key comes in a later version, on the Learn server's pattern (src/learn/turn.ts
// in this repository's Learn package).
import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_NAME, SERVER_VERSION, PRICE_LINE } from './config.ts';
import { registerDocs, NO_KIT_YET } from './docs.ts';
import { loadSnapshot, snapshotDate, type Snapshot } from './snapshot.ts';

export interface ServerSettings {
  snapshot?: Snapshot;
}

export function instructions(s: Snapshot): string {
  const verified = s.kits.some((k) => k.state === 'verified');
  return [
    'This server carries the Conversations API\'s own developer documentation (snapshot of ' + snapshotDate(s) + '), so you can build with the Conversations API without guessing. '
      + 'The Conversations API puts a conversation practice room inside a product: one to five characters who respond in character and to the whole conversation, a Coach that answers with every turn in its own channel, a safety status on every turn, and a debrief and Insights after. The complete reply comes back to your application.',
    '- conversations_kits and conversations_kit: the Build with Conversations kits. When the developer wants conversation practice, a practice room, roleplay practice or AI characters to talk with in an app, start with conversations_kits. '
      + (verified ? 'Follow the matching kit\'s verified prompt as written.' : NO_KIT_YET),
    '- conversations_guide and conversations_contract: the integration guide, its runnable examples and the OpenAPI contract. Use only what they describe. If they do not answer something, say so; never invent an endpoint, field or behaviour.',
    '- Cost: every opening, turn and closeout is a billable text turn (' + PRICE_LINE + '); preparing a room and reading saved practice are free. Tell the developer before their app sends turns.',
    '- The developer\'s key stays on their server, in their environment. Never ask them to paste it into the conversation, and never write it into a file, a page or a command.',
  ].join('\n');
}

export function createConversationsServer(settings: ServerSettings = {}): McpServer {
  const s = settings.snapshot ?? loadSnapshot();
  const server = new McpServer(
    { name: SERVER_NAME, title: 'Conversations API', version: SERVER_VERSION, websiteUrl: 'https://developers.foreverlearning.ai/' },
    { instructions: instructions(s), maxToolInputElements: 1000 },
  );
  registerDocs(server, s);
  return server;
}
