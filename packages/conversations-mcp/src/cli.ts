#!/usr/bin/env node
// conversations-mcp: the Conversations API's MCP server.
//   conversations-mcp          stdio (what coding assistants start): the docs tools.
//   conversations-mcp --http [--port 8788] [--host 127.0.0.1]
//                              the same docs over Streamable HTTP at http://<host>:<port>/mcp.
// This version reads no key and sends no turns. Logs go to stderr only (stdout carries the protocol).
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SERVER_VERSION } from './config.ts';
import { startDocsHttp } from './http.ts';
import { createConversationsServer } from './server.ts';
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
  console.log('conversations-mcp ' + SERVER_VERSION + ': the Conversations API for coding assistants.\n\n'
    + '  conversations-mcp          stdio server: the guide, the contract and the Build with Conversations kits\n'
    + '  conversations-mcp --http [--port 8788] [--host 127.0.0.1]   the same, over Streamable HTTP at /mcp\n\n'
    + 'Environment: CONVERSATIONS_MCP_SNAPSHOT (another snapshot file). This version reads no key.');
  process.exit(0);
}

const snapshot = loadSnapshot();

if (flag('http')) {
  const port = Number(value('port', '8788'));
  const host = value('host', '127.0.0.1');
  await startDocsHttp(port, host, { snapshot });
  console.error('conversations-mcp ' + SERVER_VERSION + ': docs of ' + snapshotDate(snapshot) + ', at http://' + host + ':' + port + '/mcp');
} else {
  serveStdio(() => createConversationsServer({ snapshot }), {
    onerror: (error) => console.error('conversations-mcp: ' + String(error?.message ?? error).replace(/fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi, '<redacted-key>')),
  });
  console.error('conversations-mcp ' + SERVER_VERSION + ': stdio, docs of ' + snapshotDate(snapshot));
}
