// Build both products into a new, portable directory; never deploy or overwrite an artifact.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, 'artifacts', 'hosted-docs'));
if (existsSync(output)) throw new Error('Use a new artifact path: ' + output);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const paths = ['dist', 'snapshot', 'hosted', 'LICENSE', 'packages/conversations-mcp/dist', 'packages/conversations-mcp/snapshot'];
for (const project of ['tsconfig.json', 'packages/conversations-mcp/tsconfig.json']) {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', project], { cwd: root, stdio: 'inherit', windowsHide: true });
}
mkdirSync(output, { recursive: true });
for (const path of paths) cpSync(join(root, path), join(output, path), { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const artifactPackage = {
  name: '@foreverlearning/hosted-docs', version: pkg.version, private: true,
  type: 'module', engines: pkg.engines, dependencies: pkg.dependencies,
};
lock.name = artifactPackage.name;
lock.packages[''] = { ...artifactPackage };
delete lock.packages[''].private;
delete lock.packages[''].type;
writeJson(join(output, 'package.json'), artifactPackage);
writeJson(join(output, 'package-lock.json'), lock);
const snapshots = {};
for (const [product, path] of [
  ['learn', 'snapshot/learn-docs.json'],
  ['conversations', 'packages/conversations-mcp/snapshot/conversations-docs.json'],
]) {
  const bytes = readFileSync(join(output, path));
  const snapshot = JSON.parse(bytes);
  snapshots[product] = { sha256: sha(bytes), takenAt: snapshot.taken_at, warnings: snapshot.warnings,
    verifiedKits: snapshot.kits.filter((k) => k.state === 'verified').map((k) => k.id) };
}
const files = {};
function inventory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) inventory(path);
    else files[relative(output, path).replaceAll('\\', '/')] = sha(readFileSync(path));
  }
}
inventory(output);
const contentSha256 = sha(JSON.stringify(files));
const manifest = { schema: 'foreverlearning.hosted-mcp.v1', sourceCommit: git('rev-parse', 'HEAD'),
  sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')), contentSha256,
  builtAt: new Date().toISOString(), snapshots, files };
writeJson(join(output, 'hosted-build.json'), manifest);
console.log(JSON.stringify({ output, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty, contentSha256, snapshots }, null, 2));
