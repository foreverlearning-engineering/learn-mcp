// Reading the bundled snapshot from disk. This is the one place the Learn docs touch Node's file
// system; everything that asks questions of a snapshot is in snapshot.ts, which has no Node imports.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_SCHEMA, type Snapshot } from './snapshot.ts';

let cached: Snapshot | undefined;

// The bundled snapshot sits at <package>/snapshot/learn-docs.json, one level above src/ and dist/.
// LEARN_MCP_SNAPSHOT points at another snapshot file (for example a newer one built locally).
export function loadSnapshot(path = process.env.LEARN_MCP_SNAPSHOT): Snapshot {
  if (cached && !path) return cached;
  const file = path ?? fileURLToPath(new URL('../snapshot/learn-docs.json', import.meta.url));
  const data = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  if (data.schema !== SNAPSHOT_SCHEMA) throw new Error('Unknown snapshot format in ' + file);
  if (!path) cached = data;
  return data;
}
