// Settings that are facts about the Learn API, kept in one place so each one changes once.

export const SERVER_NAME = 'learn';
export const SERVER_VERSION = '0.1.0';
export const USER_AGENT = 'learn-mcp/' + SERVER_VERSION;

// The interface version every request names (FL-API-Version).
export const API_VERSION = '2026-12-01';

// The production API host. A developer testing on staging sets FOREVERLEARNING_BASE_URL.
export const DEFAULT_BASE_URL = 'https://developers-api.foreverlearning.ai/v1';

// Free test attempts per workspace, for the life of the workspace (the guide, "What counts as a turn").
// The developer lane confirms the number: 20 today. It becomes 30 when the developer lane's
// release carrying the higher allowance ships. Existing workspaces keep the allowance they
// enrolled under, so the tool states this as "your workspace's free test attempts".
export const FREE_TEST_ATTEMPTS = 20;

// The price of a turn that succeeds, as the public copy says it. The live price shown to the
// developer is read from GET /v1/quest/catalog for their own assignment.
export const PRICE_LINE = '5¢ per turn that succeeds';

// Test turns this server sends per process: 2 by default (an opening and one message fit),
// raised with LEARN_MCP_MAX_TURNS up to a hard ceiling that no setting can pass.
export const DEFAULT_MAX_TURNS = 2;
export const HARD_MAX_TURNS = 10;

// A reply arrives whole after about 10 to 20 seconds (about 19 when Learn first closes an
// earlier open session), so the turn timeout sits well above that.
export const TURN_TIMEOUT_MS = 60_000;
export const READ_TIMEOUT_MS = 30_000;

// How long the confirmation dialog may wait for the developer, where the client supports one.
export const CONFIRM_TIMEOUT_MS = 120_000;

export function maxTurns(env: NodeJS.ProcessEnv = process.env): { limit: number; note: string } {
  const raw = env.LEARN_MCP_MAX_TURNS;
  if (raw === undefined || raw.trim() === '') return { limit: DEFAULT_MAX_TURNS, note: '' };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { limit: DEFAULT_MAX_TURNS, note: 'LEARN_MCP_MAX_TURNS is not a whole number; using ' + DEFAULT_MAX_TURNS + '.' };
  if (n > HARD_MAX_TURNS) return { limit: HARD_MAX_TURNS, note: 'LEARN_MCP_MAX_TURNS is above the ceiling of ' + HARD_MAX_TURNS + '; using ' + HARD_MAX_TURNS + '.' };
  return { limit: n, note: '' };
}
