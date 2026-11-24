// Settings that are facts about the Conversations API, kept in one place so each one changes once.

export const SERVER_NAME = 'conversations';
export const SERVER_VERSION = '0.1.0';
export const USER_AGENT = 'conversations-mcp/' + SERVER_VERSION;

// The interface version every request names (FL-API-Version).
export const API_VERSION = '2026-12-01';

// The production API host, and the staging one. Turns on staging are paid from a workspace's
// staging test balance (no real money); turns anywhere else spend real money.
export const DEFAULT_BASE_URL = 'https://developers-api.foreverlearning.ai/v1';
export const STAGING_BASE_URL = 'https://developers-api-staging.foreverlearning.ai/v1';

// The price, as the public copy says it. There is no free test allowance for the Conversations API
// today, so every turn is paid; the opening and the closeout are turns too.
export const PRICE_LINE = '3¢ per text turn';
export const TEXT_TURN_MICRO_USD = 30_000;

// The ready-made room a test turn uses unless the call names another (found by its title).
export const DEFAULT_ROOM_TITLE = 'Direct Feedback To A Report';

// Test turns this server sends per process: 2 by default (an opening and one message fit),
// raised with CONVERSATIONS_MCP_MAX_TURNS up to a hard ceiling that no setting can pass.
export const DEFAULT_MAX_TURNS = 2;
export const HARD_MAX_TURNS = 10;

// The complete reply comes back after the whole reply is checked; one generation attempt may take
// up to 240 seconds on the service's side, so a turn waits up to 120 seconds here, as the published
// example does, and then reports the turn as unconfirmed (to be looked up, never resent).
export const TURN_TIMEOUT_MS = 120_000;
export const READ_TIMEOUT_MS = 30_000;

// How long the confirmation dialog may wait for the developer, where the client supports one.
export const CONFIRM_TIMEOUT_MS = 120_000;

export function maxTurns(env: NodeJS.ProcessEnv = process.env): { limit: number; note: string } {
  const raw = env.CONVERSATIONS_MCP_MAX_TURNS;
  if (raw === undefined || raw.trim() === '') return { limit: DEFAULT_MAX_TURNS, note: '' };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { limit: DEFAULT_MAX_TURNS, note: 'CONVERSATIONS_MCP_MAX_TURNS is not a whole number; using ' + DEFAULT_MAX_TURNS + '.' };
  if (n > HARD_MAX_TURNS) return { limit: HARD_MAX_TURNS, note: 'CONVERSATIONS_MCP_MAX_TURNS is above the ceiling of ' + HARD_MAX_TURNS + '; using ' + HARD_MAX_TURNS + '.' };
  return { limit: n, note: '' };
}
