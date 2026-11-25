// The bundled, dated snapshot of the Learn docs (built by scripts/snapshot.mjs) and the
// questions the docs tools ask of it. Nothing here calls the network, and nothing here imports a
// Node module: reading the snapshot from disk is snapshot-file.ts, so a hosted runtime can import
// this file and everything it uses as is.

export interface GuideSection { id: string; title: string; markdown: string }
export interface ContractFile { name: string; path: string; title: string; url: string; sha256: string; text: string }
export interface ExampleFile { name: string; url: string; text: string }
export interface Kit {
  id: string;
  step: string;
  title: string;
  byline: string;
  what_you_build: string;
  page: string;
  state: 'verified' | 'coming_soon';
  mcp_prompt: string | null;
  where_to_run: string;
  start_from: string;
  prompt: string;
  check: string;
  starter_folder: string;
  starter_url: string;
  starter_files: string[];
}
export interface Snapshot {
  schema: string;
  taken_at: string;
  sources: Record<string, string>;
  guide: { url: string; title: string; lead: string; intro: string; sections: GuideSection[] };
  contract: ContractFile[];
  examples: ExampleFile[];
  kits: Kit[];
  starter: { repository: string; commit: string; files: Record<string, string> };
  warnings: string[];
}

export const SNAPSHOT_SCHEMA = 'learn-mcp.snapshot.v1';

export function snapshotDate(s: Snapshot): string {
  return s.taken_at.slice(0, 10);
}

// ---------- The guide ----------
export function guideWhole(s: Snapshot): string {
  const parts = ['# ' + s.guide.title, s.guide.lead, s.guide.intro, ...s.guide.sections.map((x) => x.markdown)].filter(Boolean);
  return parts.join('\n\n') + '\n\nSource: ' + s.guide.url + ' (snapshot of ' + snapshotDate(s) + ')';
}

export function guideTopics(s: Snapshot): { id: string; title: string }[] {
  return s.guide.sections.map(({ id, title }) => ({ id, title }));
}

export function findSection(s: Snapshot, topic: string): GuideSection | undefined {
  const t = topic.trim().toLowerCase().replace(/^#/, '');
  const exact = s.guide.sections.find((x) => x.id === t || x.title.toLowerCase() === t);
  if (exact) return exact;
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return undefined;
  let best: GuideSection | undefined;
  let score = 0;
  for (const x of s.guide.sections) {
    const hay = (x.id + ' ' + x.title).toLowerCase();
    const n = words.filter((w) => hay.includes(w)).length;
    if (n > score) { best = x; score = n; }
  }
  return best;
}

export function sectionText(s: Snapshot, x: GuideSection): string {
  return x.markdown + '\n\nSource: ' + s.guide.url + '#' + x.id + ' (snapshot of ' + snapshotDate(s) + ')';
}

// ---------- The contract ----------
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const OPENAPI_DOCS = ['learn.openapi.json', 'developer-runtime.openapi.json'] as const;
// The relative references inside the published files, mapped to the files the snapshot holds.
const REF_FILES: Record<string, string> = {
  './schemas/quest-v1.schema.json': 'learn-v1.schema.json',
  './schemas/learn-v1.schema.json': 'learn-v1.schema.json',
  './schemas/developer-runtime.schema.json': 'developer-runtime.schema.json',
  './developer-runtime.schema.json': 'developer-runtime.schema.json',
  './developer-runtime.openapi.json': 'developer-runtime.openapi.json',
  './learn.openapi.json': 'learn.openapi.json',
  './quest.openapi.json': 'learn.openapi.json',
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const parsed = new WeakMap<Snapshot, Map<string, Json>>();
function docs(s: Snapshot): Map<string, Json> {
  let m = parsed.get(s);
  if (!m) {
    m = new Map(s.contract.map((c) => [c.name, JSON.parse(c.text) as Json]));
    parsed.set(s, m);
  }
  return m;
}

export function contractFile(s: Snapshot, name: string): ContractFile | undefined {
  const n = name.trim().toLowerCase();
  return s.contract.find((c) => c.name === n || c.path.toLowerCase() === n || c.url.toLowerCase() === n || c.title.toLowerCase() === n);
}

export interface OperationRow { document: string; method: string; path: string; operationId: string; summary: string }
export function operations(s: Snapshot): OperationRow[] {
  const rows: OperationRow[] = [];
  for (const name of OPENAPI_DOCS) {
    const doc = docs(s).get(name) as { paths?: Record<string, Record<string, { operationId?: string; summary?: string }>> } | undefined;
    for (const [path, item] of Object.entries(doc?.paths ?? {})) {
      for (const method of METHODS) {
        const op = item[method];
        if (op) rows.push({ document: name, method: method.toUpperCase(), path, operationId: op.operationId ?? '', summary: op.summary ?? '' });
      }
    }
  }
  return rows;
}

export function findOperations(s: Snapshot, query: string): OperationRow[] {
  const q = query.trim();
  const all = operations(s);
  const byId = all.filter((r) => r.operationId.toLowerCase() === q.toLowerCase());
  if (byId.length) return byId;
  const m = /^(get|post|put|patch|delete)\s+(\S+)$/i.exec(q);
  const norm = (p: string) => p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '').toLowerCase();
  const withV1 = (p: string) => (p.startsWith('/v1/') ? p : '/v1' + (p.startsWith('/') ? p : '/' + p));
  if (m) return all.filter((r) => r.method === m[1].toUpperCase() && norm(r.path) === norm(withV1(m[2])));
  return all.filter((r) => norm(r.path) === norm(withV1(q)));
}

function pointer(doc: Json, fragment: string): Json | undefined {
  let node: Json | undefined = doc;
  for (const raw of fragment.replace(/^#?\/?/, '').split('/').filter(Boolean)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node && typeof node === 'object' && !Array.isArray(node)) node = (node as Record<string, Json>)[key];
    else if (Array.isArray(node)) node = node[Number(key)];
    else return undefined;
  }
  return node;
}

// Inline every $ref an operation uses, from the published files themselves. A reference seen
// earlier in the same output is shown once and named after that.
function resolve(s: Snapshot, node: Json, file: string, seen: Set<string>, depth: number): Json {
  if (Array.isArray(node)) return node.map((n) => resolve(s, n, file, seen, depth));
  if (!node || typeof node !== 'object') return node;
  const ref = (node as Record<string, Json>).$ref;
  if (typeof ref === 'string') {
    const [target, fragment = ''] = ref.split('#');
    const targetFile = target ? REF_FILES[target] ?? target : file;
    const key = targetFile + '#' + fragment;
    const name = fragment.split('/').pop() || targetFile;
    if (seen.has(key) || depth > 14) return { $ref: ref, note: 'defined above as ' + name };
    const doc = docs(s).get(targetFile);
    const found = doc ? pointer(doc, fragment) : undefined;
    if (found === undefined) return node;
    seen.add(key);
    const rest = Object.fromEntries(Object.entries(node).filter(([k]) => k !== '$ref'));
    const inner = resolve(s, found, targetFile, seen, depth + 1);
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? { 'x-from': name, ...inner, ...rest } : inner;
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(s, v, file, seen, depth)]));
}

export function operationDetail(s: Snapshot, row: OperationRow): Json {
  const doc = docs(s).get(row.document) as { paths: Record<string, Record<string, Json>> };
  const item = doc.paths[row.path];
  const op = item[row.method.toLowerCase()];
  const shared: Record<string, Json> = item.parameters ? { 'x-path-parameters': item.parameters } : {};
  return resolve(s, { ...shared, ...(op as Record<string, Json>) }, row.document, new Set(), 0);
}

// ---------- The kits ----------
export function findKit(s: Snapshot, query: string): Kit | undefined {
  const q = query.trim().toLowerCase();
  const direct = s.kits.find((k) => k.id === q || k.starter_folder === q || k.title.toLowerCase() === q || k.page.toLowerCase().replace(/\/+$/, '').endsWith('/build/' + q.replace(/^step\s*/, '')));
  if (direct) return direct;
  const n = /^(?:step\s*)?0?(\d+)$/.exec(q)?.[1];
  if (n) return s.kits.find((k) => k.step.toLowerCase() === 'step ' + n);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: Kit | undefined;
  let score = 0;
  for (const k of s.kits) {
    const hay = (k.id + ' ' + k.title + ' ' + (k.mcp_prompt ?? '')).toLowerCase();
    const hit = words.filter((w) => hay.includes(w)).length;
    if (hit > score) { best = k; score = hit; }
  }
  return best;
}

export function starterFile(s: Snapshot, kit: Kit, path: string): string | undefined {
  const clean = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const full = clean.startsWith(kit.starter_folder + '/') ? clean : kit.starter_folder + '/' + clean;
  return s.starter.files[full];
}
