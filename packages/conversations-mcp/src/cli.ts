#!/usr/bin/env node
// conversations-mcp: the Conversations API's MCP server.
//   conversations-mcp              stdio (what coding assistants start). Docs tools, plus a capped,
//                                  confirmed test turn when FOREVERLEARNING_API_KEY is set.
//   conversations-mcp --docs-only  stdio, docs only: no key is read and no turn can be sent.
//   conversations-mcp --http [--port 8788] [--host 127.0.0.1]
//                                  docs only, over Streamable HTTP at http://<host>:<port>/mcp.
// Logs go to stderr only (stdout carries the protocol). The key is never logged.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SERVER_VERSION, maxTurns } from './config.ts';
import { startDocsHttp } from './http.ts';
import { createConversationsServer } from './server.ts';
import { loadSnapshot } from './snapshot-file.ts';
import { snapshotDate } from './snapshot.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes('--' + name);
const value = (name: string, fallback: string) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (flag('version')) {
  console.log(SERVER_VERSION);
  process.exit(0);
}
if (flag('help')) {
  console.log('conversations-mcp ' + SERVER_VERSION + ': the Conversations API for coding assistants.\n\n'
    + '  conversations-mcp              stdio server (docs, plus a paid test turn when FOREVERLEARNING_API_KEY is set)\n'
    + '  conversations-mcp --docs-only  stdio server, docs only\n'
    + '  conversations-mcp --http [--port 8788] [--host 127.0.0.1]   docs only, Streamable HTTP at /mcp\n\n'
    + 'Environment: FOREVERLEARNING_API_KEY, FOREVERLEARNING_ASSIGNMENT_ID, FOREVERLEARNING_BASE_URL,\n'
    + 'CONVERSATIONS_MCP_MAX_TURNS (default 2, at most 10), CONVERSATIONS_MCP_STATE_DIR, CONVERSATIONS_MCP_PROJECT,\n'
    + 'CONVERSATIONS_MCP_CONFIRM_DIALOG=off, CONVERSATIONS_MCP_KEY_HELP, CONVERSATIONS_MCP_SNAPSHOT.');
  process.exit(0);
}

const snapshot = loadSnapshot();

if (flag('http')) {
  const port = Number(value('port', '8788'));
  const host = value('host', '127.0.0.1');
  await startDocsHttp(port, host, { snapshot });
  console.error('conversations-mcp ' + SERVER_VERSION + ': docs only, docs of ' + snapshotDate(snapshot) + ', at http://' + host + ':' + port + '/mcp');
} else {
  const docsOnly = flag('docs-only');
  const env = docsOnly ? {} : process.env;
  serveStdio(() => createConversationsServer({ mode: docsOnly ? 'docs-only' : 'full', snapshot, env }), {
    onerror: (error) => console.error('conversations-mcp: ' + String(error?.message ?? error).replace(/fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi, '<redacted-key>')),
  });
  const keyed = !docsOnly && Boolean((process.env.FOREVERLEARNING_API_KEY ?? '').trim());
  console.error('conversations-mcp ' + SERVER_VERSION + ': stdio, docs of ' + snapshotDate(snapshot) + (docsOnly ? ', docs only' : keyed ? ', paid test turns on (at most ' + maxTurns(process.env).limit + ', each confirmed)' : ', no key set: docs only'));
}
