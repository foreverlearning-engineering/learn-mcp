// The server: one factory for both ways it runs.
//   full:      the npm package over stdio. Docs tools, prompts and resources, plus the test-turn
//              tools that use the developer's own key from their environment.
//   docs-only: no key and no Learn calls at all. What the hosted Streamable HTTP address serves.
// A second product (the Conversations API) plugs in later as one more register call.
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TIMEOUT_MS, SERVER_NAME, SERVER_VERSION } from './config.ts';
import { registerDocs } from './learn/docs.ts';
import { registerTurnTools } from './learn/turn.ts';
import { loadSnapshot, snapshotDate, type Snapshot } from './snapshot.ts';

export type Mode = 'full' | 'docs-only';

export interface ServerSettings {
  mode: Mode;
  snapshot?: Snapshot;
  env?: NodeJS.ProcessEnv;
}

export function instructions(s: Snapshot, mode: Mode): string {
  const lines = [
    'This server carries the Learn API\'s own developer documentation (snapshot of ' + snapshotDate(s) + '), so you can build with the Learn API without guessing. '
      + 'The Learn API is a learning system that teaches: a learner gets a hint toward their next step, not the answer.',
    '- learn_kits and learn_kit: the Build with Learn kits. Each kit\'s prompt is verified as written, with a check of what the finished app shows. '
      + 'When the developer wants a tutor, tutoring help or learning help in an app, start with learn_kits, then follow the matching kit\'s prompt as written.',
    '- learn_guide and learn_contract: the integration guide, its runnable examples and the OpenAPI contract. Use only what they describe. If they do not answer something, say so; never invent an endpoint, field or behaviour.',
  ];
  if (mode === 'full') {
    lines.push('- learn_test_turn: one real test turn with the developer\'s own key, for a quick check. It costs one of the workspace\'s free test attempts (they never reset) or, on a live key, 5¢ per turn that succeeds. '
      + 'Ask the developer before each one. Show Learn\'s reply exactly as written. learn_lookup_request looks up a turn that was not confirmed, free.');
    lines.push('- The developer\'s key stays in their environment. Never ask them to paste it into the conversation, and never write it into a file, a page or a command.');
  } else {
    lines.push('- This hosted connection provides documentation without a local installation or API key. It sends no turns. Use the developer console Sandbox for real practice, or the optional local package for test-turn tools.');
  }
  return lines.join('\n');
}

export function createLearnServer(settings: ServerSettings): McpServer {
  const s = settings.snapshot ?? loadSnapshot();
  const server = new McpServer(
    { name: SERVER_NAME, title: 'Learn API', version: SERVER_VERSION, websiteUrl: 'https://developers.foreverlearning.ai/' },
    {
      instructions: instructions(s, settings.mode),
      inputRequired: { roundTimeoutMs: CONFIRM_TIMEOUT_MS, maxRounds: 3 },
      maxToolInputElements: 1000,
    },
  );
  registerDocs(server, s);
  if (settings.mode === 'full') registerTurnTools(server, settings.env ?? process.env);
  return server;
}
