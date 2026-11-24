// The test user for each project, kept between runs so test turns reuse one user and one session.
// A key admits only a limited number of new users a day, and every turn is paid, so this tool never
// starts over on its own.
//
// Stored in ~/.foreverlearning/conversations-mcp/state.json (CONVERSATIONS_MCP_STATE_DIR overrides
// the folder). It holds a pseudonymous user id, the open test session, its room, whether its opening
// was sent, and the last request id: never the key, never a name or an email.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ProjectState {
  project: string;
  base_url: string;
  assignment: string;
  user_id: string;
  session_id: string;
  room_title: string;
  session_prepared_at: string;
  opened: boolean;
  last_request_id: string;
  last_request_at: string;
  turns_sent: number;
}

interface StateFile { version: 1; projects: Record<string, ProjectState> }

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONVERSATIONS_MCP_STATE_DIR?.trim() || join(homedir(), '.foreverlearning', 'conversations-mcp');
}

export function projectPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CONVERSATIONS_MCP_PROJECT?.trim() || process.cwd());
}

function file(env: NodeJS.ProcessEnv): string {
  return join(stateDir(env), 'state.json');
}

function read(env: NodeJS.ProcessEnv): StateFile {
  try {
    const data = JSON.parse(readFileSync(file(env), 'utf8')) as StateFile;
    if (data.version === 1 && data.projects && typeof data.projects === 'object') return data;
  } catch { /* first run, or unreadable: start fresh */ }
  return { version: 1, projects: {} };
}

function write(env: NodeJS.ProcessEnv, data: StateFile): void {
  mkdirSync(stateDir(env), { recursive: true });
  const target = file(env);
  const temp = target + '.' + process.pid + '.tmp';
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, target);
}

// One user per project, per API host and assignment.
function projectKey(project: string, base: string, assignment: string): string {
  return createHash('sha256').update(project.toLowerCase() + '\n' + base + '\n' + assignment).digest('hex').slice(0, 24);
}

export function loadProject(base: string, assignment: string, env: NodeJS.ProcessEnv = process.env): { key: string; state: ProjectState } {
  const project = projectPath(env);
  const key = projectKey(project, base, assignment);
  const data = read(env);
  const existing = data.projects[key];
  if (existing) return { key, state: existing };
  const state: ProjectState = {
    project,
    base_url: base,
    assignment,
    user_id: 'conversations-mcp-test-' + randomUUID(),
    session_id: '',
    room_title: '',
    session_prepared_at: '',
    opened: false,
    last_request_id: '',
    last_request_at: '',
    turns_sent: 0,
  };
  data.projects[key] = state;
  write(env, data);
  return { key, state };
}

export function saveProject(key: string, state: ProjectState, env: NodeJS.ProcessEnv = process.env): void {
  const data = read(env);
  data.projects[key] = state;
  write(env, data);
}
