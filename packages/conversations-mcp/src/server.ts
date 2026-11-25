// The Conversations API's MCP server: one factory for both ways it runs.
//   full:      the npm package over stdio. Docs tools, prompts and resources, plus the test-turn
//              tools that use the developer's own key from their environment.
//   docs-only: no key and no API calls at all. What a hosted Streamable HTTP address serves; its
//              factory is docs-server.ts, and nothing hosted imports this file.
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TIMEOUT_MS } from './config.ts';
import { createConversationsDocsServer, instructions, serverInfo, type Mode } from './docs-server.ts';
import { registerDocs } from './docs.ts';
import { registerTurnTools } from './turn.ts';
import { loadSnapshot } from './snapshot-file.ts';
import { type Snapshot } from './snapshot.ts';

export { instructions, type Mode };

export interface ServerSettings {
  mode?: Mode;
  snapshot?: Snapshot;
  env?: NodeJS.ProcessEnv;
}

export function createConversationsServer(settings: ServerSettings = {}): McpServer {
  const mode = settings.mode ?? 'docs-only';
  const s = settings.snapshot ?? loadSnapshot();
  if (mode === 'docs-only') return createConversationsDocsServer(s);
  const server = new McpServer(serverInfo(), {
    instructions: instructions(s, 'full'),
    inputRequired: { roundTimeoutMs: CONFIRM_TIMEOUT_MS, maxRounds: 3 },
    maxToolInputElements: 1000,
  });
  registerDocs(server, s);
  registerTurnTools(server, settings.env ?? process.env);
  return server;
}
