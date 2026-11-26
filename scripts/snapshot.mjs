#!/usr/bin/env node
// Builds the dated docs snapshot the server bundles: snapshot/learn-docs.json.
//
// It fetches the developer site's Learn integration guide, the Learn contract (OpenAPI and
// JSON Schema, with the shared lifecycle contract it references) and the runnable examples,
// and reads the Build with Learn kits' verified files and the starter repository's committed
// files. Nothing is invented: every word the server serves comes from one of these sources.
//
//   node scripts/snapshot.mjs --kits <kits folder> [--starter <learn-tutor-starter>] [--docs <site>]
//
// Sources are swappable:
//   --docs          the developer site to read (default: the staging site until production serves the docs)
//   --guide-format  html (the guide page, default) or markdown (a Markdown page, once the site serves one)
//   --guide-url     the guide's address on that site (default /docs/learn/)
// Links are rewritten to the public developer site (--public, default https://developers.foreverlearning.ai).
// Needs no key. Fetches public pages only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => {
  if (a.startsWith('--')) pairs.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return pairs;
}, []));

const DOCS = (args.docs ?? process.env.LEARN_DOCS_BASE ?? 'https://foreverlearning-developers-staging.netlify.app').replace(/\/+$/, '');
const PUBLIC = (args.public ?? 'https://developers.foreverlearning.ai').replace(/\/+$/, '');
// Every rendered address of the site read from (the guide's MCP line, absolute links in Markdown copies)
// becomes the public site's. The site host never appears on purpose; the API hosts are not touched.
const publicise = (t) => (DOCS === PUBLIC || typeof t !== 'string' ? t : t.split(DOCS).join(PUBLIC));
const GUIDE_URL = args['guide-url'] ?? '/docs/learn/';
const GUIDE_FORMAT = args['guide-format'] ?? 'html';
const KITS = args.kits ?? process.env.LEARN_KITS_DIR;
const STARTER = args.starter ?? process.env.LEARN_STARTER_DIR ?? join(ROOT, '..', 'learn-tutor-starter');
const STARTER_PUBLIC = 'https://github.com/foreverlearning-engineering/learn-tutor-starter';
const OUT = args.out ?? join(ROOT, 'snapshot', 'learn-docs.json');
const UA = 'learn-mcp-snapshot/0.1 (+' + PUBLIC + ')';

if (!KITS) {
  console.error('Give the kits folder: --kits <folder> (or LEARN_KITS_DIR).');
  process.exit(2);
}

const warnings = [];
const sha = (text) => createHash('sha256').update(text).digest('hex');

async function get(path) {
  const url = path.startsWith('http') ? path : DOCS + path;
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('GET ' + url + ' answered ' + response.status);
  return await response.text();
}

// ---------- HTML to Markdown, for the small tag set the guide uses ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function absolute(href) {
  if (href.startsWith('#')) return PUBLIC + GUIDE_URL + href;
  if (href.startsWith('/')) return PUBLIC + href;
  return href.split(DOCS).join(PUBLIC);
}
function inline(html) {
  return decode(html
    .replace(/<code>([\s\S]*?)<\/code>/g, (_, c) => '`' + c.replace(/<[^>]+>/g, '') + '`')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => '[' + text.replace(/<[^>]+>/g, '') + '](' + absolute(decode(href)) + ')')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n');
}
function table(html) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => inline(c[1]).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()));
  if (!rows.length) return '';
  const lines = ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(() => '---').join(' | ') + ' |'];
  for (const row of rows.slice(1)) lines.push('| ' + row.join(' | ') + ' |');
  return lines.join('\n');
}
function blocks(html) {
  const out = [];
  const re = /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>|<table>([\s\S]*?)<\/table>|<(ul|ol)>([\s\S]*?)<\/\3>|<h([1-6])[^>]*>([\s\S]*?)<\/h\5>|<p[^>]*>([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      const code = decode(m[1].replace(/<[^>]+>/g, ''));
      const lang = /^\s*[{[]/.test(code) ? 'json' : /^\s*(curl|[A-Z]+=|#)/m.test(code) ? 'sh' : '';
      out.push('```' + lang + '\n' + code.replace(/\n+$/, '') + '\n```');
    } else if (m[2] !== undefined) out.push(table(m[2]));
    else if (m[3] !== undefined) {
      const items = [...m[4].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li, i) => (m[3] === 'ol' ? (i + 1) + '. ' : '- ') + inline(li[1]).trim());
      out.push(items.join('\n'));
    } else if (m[5] !== undefined) out.push('#'.repeat(Number(m[5])) + ' ' + inline(m[6]).trim());
    else if (m[7] !== undefined) {
      const text = inline(m[7]).trim();
      if (text) out.push(text);
    }
  }
  return out.join('\n\n');
}

function guideFromHtml(html) {
  const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1];
  if (!article) throw new Error('No <article> in the guide page');
  const first = article.indexOf('<section');
  const intro = article.slice(0, first < 0 ? article.length : first);
  const title = inline(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(intro)?.[1] ?? '').trim();
  const lead = inline(/<p class="lead">([\s\S]*?)<\/p>/.exec(intro)?.[1] ?? '').trim();
  const introMd = blocks(intro.replace(/<p class="eyebrow">[\s\S]*?<\/p>/, '').replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '').replace(/<p class="lead">[\s\S]*?<\/p>/, ''));
  const sections = [];
  for (const s of article.matchAll(/<section id="([^"]+)">([\s\S]*?)<\/section>/g)) {
    const heading = inline(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(s[2])?.[1] ?? s[1]).trim();
    sections.push({ id: s[1], title: heading, markdown: blocks(s[2]) });
  }
  if (!sections.length) throw new Error('No sections in the guide page');
  return { title, lead, intro: introMd, sections };
}

// A Markdown guide (for when the site serves Markdown pages): one section per "## " heading.
// The section id comes from an explicit {#id} on the heading, else a slug of the heading.
function guideFromMarkdown(md) {
  const text = md.replace(/\r\n/g, '\n');
  const parts = text.split(/^## /m);
  const head = parts.shift() ?? '';
  const title = (/^# (.+)$/m.exec(head)?.[1] ?? '').trim();
  const sections = parts.map((part) => {
    const [first, ...rest] = part.split('\n');
    const anchor = /\{#([a-z0-9-]+)\}\s*$/.exec(first);
    const heading = first.replace(/\s*\{#[a-z0-9-]+\}\s*$/, '').trim();
    const id = anchor?.[1] ?? heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { id, title: heading, markdown: ('## ' + heading + '\n' + rest.join('\n')).trim() };
  });
  return { title, lead: '', intro: head.replace(/^# .+$/m, '').trim(), sections };
}

// ---------- The kits ----------
function promptBlock(markdown) {
  const m = /```text\r?\n([\s\S]*?)```/.exec(markdown);
  if (!m) throw new Error('No ```text block');
  return m[1].replace(/\r\n/g, '\n');
}
function whereToRun(markdown) {
  return (/\*\*Where to run it\.\*\*\s*([^\n]+)/.exec(markdown)?.[1] ?? '').trim();
}
function pagePrompts(html) {
  return [...html.matchAll(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).replace(/\r\n/g, '\n'));
}
function startFrom(where) {
  // "Open a new, empty folder in your coding assistant, ..." -> "a new, empty folder"
  const m = /^Open (.+?) in your coding assistant/.exec(where);
  return m ? m[1] : where;
}

async function readKits() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'scripts', 'kits.manifest.json'), 'utf8')).kits;
  const status = await readFile(join(KITS, 'STATUS.md'), 'utf8');
  const kits = [];
  for (const k of manifest) {
    const folder = join(KITS, k.id);
    const plain = await readFile(join(folder, 'PROMPT_PLAIN.md'), 'utf8');
    const guide = await readFile(join(folder, 'GUIDE.md'), 'utf8');
    const check = (await readFile(join(folder, 'CHECK.md'), 'utf8')).replace(/\r\n/g, '\n');
    const prompt = promptBlock(plain);
    const where = whereToRun(plain);
    const title = (/^# (.+)$/m.exec(guide)?.[1] ?? k.id).trim();
    const byline = (/^\*\*Build with Learn[^\n]*$/m.exec(guide)?.[0] ?? '').replace(/\*\*/g, '').trim();
    const what = (/\*\*What you'll build\.\*\*\s*([^\n]+)/.exec(guide)?.[1] ?? '').trim();
    const row = status.split('\n').find((line) => line.includes('`' + k.id + '`') && line.trim().startsWith('|'));
    const verified = Boolean(row && /\*\*VERIFIED\*\*/.test(row));
    let onPage = false;
    try {
      onPage = pagePrompts(await get(k.page)).some((block) => block.trim() === prompt.trim());
    } catch (error) {
      warnings.push(k.id + ': could not read its page ' + k.page + ' (' + error.message + ')');
    }
    const available = verified && onPage && !k.hold;
    if (k.hold) warnings.push(k.id + ': ' + k.hold + '; listed as coming soon');
    else if (!verified) warnings.push(k.id + ': not marked VERIFIED in the kits record; listed as coming soon');
    else if (!onPage) warnings.push(k.id + ': VERIFIED, but its developer-site page ' + k.page + ' does not carry the same prompt word for word; listed as coming soon');
    kits.push({
      id: k.id,
      step: k.step,
      title,
      byline,
      what_you_build: what,
      page: PUBLIC + k.page,
      state: available ? 'verified' : 'coming_soon',
      mcp_prompt: available ? (k.prompt ?? null) : null,
      where_to_run: available ? where : '',
      start_from: available ? startFrom(where) : '',
      prompt: available ? prompt : '',
      check: available ? check : '',
      starter_folder: k.id,
      starter_url: STARTER_PUBLIC + '/tree/main/' + k.id,
    });
  }
  return kits;
}

// ---------- The starter repository: committed files only ----------
function git(...a) {
  return execFileSync('git', ['-C', STARTER, ...a], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}
function readStarter(folders) {
  if (!existsSync(join(STARTER, '.git'))) throw new Error('Starter repository not found at ' + STARTER);
  const commit = git('rev-parse', 'HEAD').trim();
  const files = {};
  for (const path of git('ls-files', '-z', ...folders).split('\0').filter(Boolean)) {
    if (/(^|\/)package-lock\.json$/.test(path)) continue; // regenerated by npm install
    files[path] = git('show', 'HEAD:' + path).replace(/\r\n/g, '\n');
  }
  for (const top of ['README.md', 'LICENSE']) files[top] = git('show', 'HEAD:' + top).replace(/\r\n/g, '\n');
  return { repository: STARTER_PUBLIC, commit, files };
}

// ---------- Run ----------
const started = new Date();
const guideText = await get(GUIDE_URL);
const guide = { url: PUBLIC + GUIDE_URL, ...(GUIDE_FORMAT === 'markdown' ? guideFromMarkdown(guideText) : guideFromHtml(guideText)) };
for (const key of ['title', 'lead', 'intro']) guide[key] = publicise(guide[key]);
for (const s of guide.sections) { s.title = publicise(s.title); s.markdown = publicise(s.markdown); }

// The Learn contract, at its Learn-named public addresses, and the shared lifecycle contract it
// references (POST /v1/chat, GET /v1/requests/{id} and the session lifecycle).
const CONTRACT = [
  { name: 'learn.openapi.json', path: '/openapi/learn.openapi.json', title: 'Learn OpenAPI' },
  { name: 'learn-v1.schema.json', path: '/schemas/learn-v1.json', title: 'Closed Learn JSON Schema' },
  { name: 'developer-runtime.openapi.json', path: '/openapi/developer-runtime.openapi.json', title: 'Shared lifecycle OpenAPI' },
  { name: 'developer-runtime.schema.json', path: '/openapi/schemas/developer-runtime.schema.json', title: 'Shared runtime JSON Schema' },
];
const contract = [];
for (const c of CONTRACT) {
  const text = (await get(c.path)).replace(/\r\n/g, '\n');
  JSON.parse(text); // must be JSON
  const served = publicise(text);
  contract.push({ ...c, url: PUBLIC + c.path, sha256: sha(served), text: served });
}

const EXAMPLES = ['README.md', 'prepare.mjs', 'quest.ts', 'quest.py', 'quest.sh', 'server.ts'];
const examples = [];
for (const name of EXAMPLES) {
  const text = (await get('/examples/learn/' + name)).replace(/\r\n/g, '\n');
  examples.push({ name, url: PUBLIC + '/examples/learn/' + name, text: publicise(text) });
}

const kits = await readKits();
const starter = readStarter(kits.filter((k) => k.state === 'verified').map((k) => k.starter_folder));
for (const k of kits) k.starter_files = Object.keys(starter.files).filter((p) => p.startsWith(k.starter_folder + '/')).map((p) => p.slice(k.starter_folder.length + 1));

const snapshot = {
  schema: 'learn-mcp.snapshot.v1',
  taken_at: started.toISOString(),
  sources: { docs_read_from: DOCS, links_point_to: PUBLIC, guide_format: GUIDE_FORMAT, kits: 'Build with Learn kits (verified prompts and checks)', starter_commit: starter.commit },
  guide,
  contract,
  examples,
  kits,
  starter,
  warnings,
};
const json = JSON.stringify(snapshot, null, 1) + '\n';

// Guard: no key, ever. A server key looks like fl_live_, fl_stag_ or fl_test_ followed by hex.
const leak = /fl_(live|stag|test)_[0-9a-f]{16,}/.exec(json);
if (leak) {
  console.error('REFUSED: the snapshot contains something shaped like a server key. Nothing written.');
  process.exit(1);
}
if (DOCS !== PUBLIC && JSON.stringify({ ...snapshot, sources: null }).includes(DOCS)) {
  console.error('REFUSED: the docs host read from still appears in the served text. Nothing written.');
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ ...snapshot, warnings }, null, 1) + '\n');
console.log(JSON.stringify({
  out: OUT,
  taken_at: snapshot.taken_at,
  guide_sections: guide.sections.length,
  contract: contract.map((c) => c.name + ' ' + c.sha256.slice(0, 12)),
  examples: examples.length,
  kits: kits.map((k) => k.id + ':' + k.state),
  starter_files: Object.keys(starter.files).length,
  starter_commit: starter.commit.slice(0, 7),
  warnings,
}, null, 1));
