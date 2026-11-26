// Compare two docs snapshots (Learn or Conversations) section by section: which guide sections, contract
// files, examples and kit fields differ, and how many times each environment-specific host string appears
// in each. Used before a hosted cut whose snapshot was read from the staging site: everything but the
// expected contract additions must match a production read, and no staging address may appear beyond the
// intended mentions a production read also carries.
//   node scripts/compare-snapshots.mjs <a.json> <b.json> [result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [aPath, bPath, out] = process.argv.slice(2);
if (!aPath || !bPath) { console.error('usage: node scripts/compare-snapshots.mjs <a.json> <b.json> [result.json]'); process.exit(2); }
const a = JSON.parse(readFileSync(aPath, 'utf8'));
const b = JSON.parse(readFileSync(bPath, 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const HOSTS = ['foreverlearning-developers-staging.netlify.app', 'developers-api-staging.foreverlearning.ai', 'developers-mcp-staging.foreverlearning.ai', '/mcp/learn', '/mcp/conversations', 'developers-api.foreverlearning.ai', 'developers.foreverlearning.ai'];
const count = (text, needle) => text.split(needle).length - 1;
const byKey = (list, key) => new Map((list ?? []).map((x) => [x[key], x]));
const diffMaps = (ma, mb, textOf) => {
  const rows = [];
  for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const ta = ma.has(k) ? textOf(ma.get(k)) : null, tb = mb.has(k) ? textOf(mb.get(k)) : null;
    if (ta === tb) continue;
    rows.push({ key: k, inA: ta !== null, inB: tb !== null, shaA: ta === null ? null : sha(ta), shaB: tb === null ? null : sha(tb), lengthA: ta?.length ?? null, lengthB: tb?.length ?? null });
  }
  return rows;
};
const result = {
  a: { path: aPath, schema: a.schema, taken_at: a.taken_at, sources: a.sources }, b: { path: bPath, schema: b.schema, taken_at: b.taken_at, sources: b.sources },
  guide: { title: a.guide?.title === b.guide?.title, lead: a.guide?.lead === b.guide?.lead, intro: a.guide?.intro === b.guide?.intro, sections: diffMaps(byKey(a.guide?.sections, 'id'), byKey(b.guide?.sections, 'id'), (s) => s.title + '\n' + s.markdown) },
  contract: diffMaps(byKey(a.contract, 'name'), byKey(b.contract, 'name'), (c) => c.text),
  examples: diffMaps(byKey(a.examples, 'name'), byKey(b.examples, 'name'), (e) => e.text),
  kits: diffMaps(byKey(a.kits, 'id'), byKey(b.kits, 'id'), (k) => JSON.stringify({ state: k.state, page: k.page, prompt: k.prompt, mcp_prompt: k.mcp_prompt, check: k.check, starter_folder: k.starter_folder, starter_url: k.starter_url, starter_files: k.starter_files })),
  starter: { commitA: a.starter?.commit, commitB: b.starter?.commit, filesEqual: JSON.stringify(a.starter?.files ?? {}) === JSON.stringify(b.starter?.files ?? {}) },
  hosts: Object.fromEntries(HOSTS.map((h) => [h, { a: count(JSON.stringify({ ...a, sources: null }), h), b: count(JSON.stringify({ ...b, sources: null }), h) }])),
  warnings: { a: a.warnings, b: b.warnings },
};
result.identicalExcept = [
  ...(result.guide.title && result.guide.lead && result.guide.intro ? [] : ['guide header']),
  ...result.guide.sections.map((r) => 'guide section ' + r.key),
  ...result.contract.map((r) => 'contract ' + r.key),
  ...result.examples.map((r) => 'example ' + r.key),
  ...result.kits.map((r) => 'kit ' + r.key),
  ...(result.starter.filesEqual ? [] : ['starter files']),
];
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
