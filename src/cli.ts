#!/usr/bin/env node
// learn-mcp: the Learn API's MCP server.
//   learn-mcp                 stdio (what coding assistants start). Docs tools, plus test turns when
//                             FOREVERLEARNING_API_KEY is set in this process's environment.
//   learn-mcp --docs-only     stdio, docs only: no key is read and no turn can be sent.
//   learn-mcp --http [--port 8787] [--host 127.0.0.1]
//                             docs only, over Streamable HTTP at http://<host>:<port>/mcp.
// Logs go to stderr only (stdout carries the protocol). The key is never logged.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SERVER_VERSION, maxTurns } from './config.ts';
import { startDocsHttp } from './http.ts';
import { createLearnServer } from './server.ts';
import { loadSnapshot, snapshotDate } from './snapshot.ts';

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
  console.log('learn-mcp ' + SERVER_VERSION + ': the Learn API for coding assistants.\n\n'
    + '  learn-mcp              stdio server (docs, plus test turns when FOREVERLEARNING_API_KEY is set)\n'
    + '  learn-mcp --docs-only  stdio server, docs only\n'
    + '  learn-mcp --http [--port 8787] [--host 127.0.0.1]   docs only, Streamable HTTP at /mcp\n\n'
    + 'Environment: FOREVERLEARNING_API_KEY, FOREVERLEARNING_BASE_URL, FOREVERLEARNING_ASSIGNMENT_ID,\n'
    + 'LEARN_MCP_MAX_TURNS (default 2, at most 10), LEARN_MCP_STATE_DIR, LEARN_MCP_PROJECT, LEARN_MCP_CONFIRM_DIALOG=off.');
  process.exit(0);
}

const snapshot = loadSnapshot();

if (flag('http')) {
  const port = Number(value('port', '8787'));
  const host = value('host', '127.0.0.1');
  await startDocsHttp(port, host, { snapshot });
  console.error('learn-mcp ' + SERVER_VERSION + ': docs only, docs of ' + snapshotDate(snapshot) + ', at http://' + host + ':' + port + '/mcp');
} else {
  const docsOnly = flag('docs-only');
  const env = docsOnly ? {} : process.env;
  serveStdio(() => createLearnServer({ mode: docsOnly ? 'docs-only' : 'full', snapshot, env }), {
    onerror: (error) => console.error('learn-mcp: ' + String(error?.message ?? error).replace(/fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi, '<redacted-key>')),
  });
  const keyed = !docsOnly && Boolean((process.env.FOREVERLEARNING_API_KEY ?? '').trim());
  console.error('learn-mcp ' + SERVER_VERSION + ': stdio, docs of ' + snapshotDate(snapshot) + (docsOnly ? ', docs only' : keyed ? ', test turns on (at most ' + maxTurns().limit + ')' : ', no key set: docs only'));
}
