// Node convenience for the hosted docs endpoint: read the packaged snapshots and the build identity
// from this artifact and build the handler. handler.mjs itself never touches the file system; a
// Workers host imports the same JSON files as modules and calls createHostedDocsHandler directly.
import { readFileSync } from 'node:fs';
import { createHostedDocsHandler } from './handler.mjs';

export const PACKAGED_INPUTS = {
  learnSnapshot: 'snapshot/learn-docs.json',
  conversationsSnapshot: 'packages/conversations-mcp/snapshot/conversations-docs.json',
  identity: 'hosted-build.json',
};

export function readPackagedInputs(root = new URL('../', import.meta.url)) {
  const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  return Object.fromEntries(Object.entries(PACKAGED_INPUTS).map(([name, path]) => [name, read(path)]));
}

export function createHostedDocsHandlerFromFiles(options = {}, root) {
  return createHostedDocsHandler({ ...readPackagedInputs(root), ...options });
}
