// A small Conversations API client for the test-turn tools, after the starter's conversations.ts
// (conversations-room-starter/01-first-room). It never retries: a turn is sent once, and an
// unconfirmed turn is reported with its request id for a lookup (no charge). It has no call that ends a
// session. The key is read from the environment at call time, sent only in the Authorization
// header, and removed from every message this module produces.
import { randomUUID } from 'node:crypto';
import { API_VERSION, DEFAULT_BASE_URL, READ_TIMEOUT_MS, STAGING_BASE_URL, TURN_TIMEOUT_MS, USER_AGENT } from './config.ts';

export interface Settings { key: string; base: string; assignment: string }

export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    key: (env.FOREVERLEARNING_API_KEY ?? '').trim(),
    base: (env.FOREVERLEARNING_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    assignment: (env.FOREVERLEARNING_ASSIGNMENT_ID ?? '').trim(),
  };
}

// Where a turn's money would come from. A key's assignment is in test mode (free attempts, no
// money) or live (real money), and the catalog does not say which; only the receipt afterwards does.
// Staging never spends real money (staging credit, or an attempt). Any other host, production
// included, may be live, so it is treated as live until the receipt says otherwise.
export type Environment = 'staging' | 'live';
export function environmentOf(base: string): Environment {
  try {
    return new URL(base).host === new URL(STAGING_BASE_URL).host ? 'staging' : 'live';
  } catch {
    return 'live';
  }
}

// Anything shaped like a server key, and the configured key itself, never leave this process.
const KEY_SHAPE = /fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi;
export function redact(text: string, key = settings().key): string {
  let out = String(text);
  if (key) out = out.split(key).join('<redacted-key>');
  return out.replace(KEY_SHAPE, '<redacted-key>');
}

export interface Safety { level: string; evaluated: boolean; response_action: string; source: string }
export interface Segment { speaker_id: string; display_name: string; order: number; text: string; language: string }
export interface Character { speaker_id: string; persona_id: string; expression: string | null; expression_group: string | null; presence: string }
export interface Turn {
  turn_id: string;
  request_id: string;
  session_id: string;
  ordinal: number;
  operation: string;
  cast: Segment[];
  coach: { text: string; language: string } | null;
  text: string;
  safety: Safety;
  structure: string;
  state: string;
  characters: Character[] | null;
}
export interface Meter { unit: string; units: number; amount_micro_usd: number; settlement: string; charge_id: string | null; rate_version: string }
export interface Receipt { request_id: string; session_id: string; content_release: string; text: Meter | null; audio: Meter | null }
export interface TurnResult { request_id: string; session_id: string; turn: Turn; safety: Safety; receipt: Receipt }

// Every way a request can end without a confirmed turn.
//   refused:     the API answered with an error before the turn ran (HTTP 4xx or 5xx). Nothing to look up.
//   failed:      the turn ran and the API reported it failed (an error event) before any reply was shown.
//   unconfirmed: the answer ended, dropped or timed out before the final done event. It may have
//                been saved, and charged: look it up by request id before anything else.
//   network:     no answer reached this process.
export type FailureKind = 'refused' | 'failed' | 'unconfirmed' | 'network';
export class ConversationsError extends Error {
  kind: FailureKind;
  status: number;
  code: string;
  requestId: string;
  retryAfterSeconds?: number;
  constructor(kind: FailureKind, status: number, code: string, message: string, requestId = '', retryAfterSeconds?: number) {
    super(redact(message));
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function headers(s: Settings, userId: string, idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: 'Bearer ' + s.key,
    'X-User-Id': userId,
    'X-Assignment-Id': s.assignment,
    'FL-API-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

async function refusal(response: Response): Promise<ConversationsError> {
  let code = 'HTTP_' + response.status;
  let message = 'The Conversations API answered HTTP ' + response.status + '.';
  let requestId = response.headers.get('x-request-id') ?? '';
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.code === 'string') code = body.code;
    if (typeof body.message === 'string') message = body.message;
    if (typeof body.request_id === 'string') requestId = body.request_id;
  } catch { /* keep the HTTP status */ }
  const header = Number(response.headers.get('retry-after'));
  return new ConversationsError('refused', response.status, code, message, requestId, Number.isFinite(header) && header > 0 ? header : undefined);
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const e = error as Error;
    throw new ConversationsError('network', 0, e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', 'No answer from ' + new URL(url).host + ': ' + e.message);
  }
}

export interface Room { room_id: string; title: string; modes: string[]; min_participants: number; recommended_personas: string[]; topic_consent_required: boolean; default_tier: string }
export interface Catalog { content_release: string; rooms: Room[]; personas: { persona_id: string; display_name: string }[] }

// GET /v1/conversation/catalog: the rooms and people this key can use. No charge.
export async function readCatalog(s: Settings, userId: string): Promise<Catalog> {
  const all: Catalog = { content_release: '', rooms: [], personas: [] };
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const response = await call(s.base + '/conversation/catalog' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { headers: headers(s, userId) }, READ_TIMEOUT_MS);
    if (!response.ok) throw await refusal(response);
    const body = await response.json() as Record<string, any>;
    all.content_release = String(body.content_release ?? '');
    all.rooms.push(...(Array.isArray(body.rooms) ? body.rooms : []));
    all.personas.push(...(Array.isArray(body.personas) ? body.personas : []));
    cursor = typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
    if (!cursor) break;
  }
  return all;
}

export interface Prepared { session_id: string; cast: { display_name: string; role: string }[] }

// POST /v1/conversation/sessions: prepare a session in a ready-made room. Nothing is generated; no charge.
export async function prepareRoom(s: Settings, userId: string, room: { room_id: string; mode: string; persona_id: string }): Promise<Prepared> {
  const body = { setup: { kind: 'room', room_id: room.room_id, mode: room.mode, participants: [{ persona_id: room.persona_id }] } };
  const response = await call(s.base + '/conversation/sessions', { method: 'POST', headers: headers(s, userId, randomUUID()), body: JSON.stringify(body) }, READ_TIMEOUT_MS);
  if (!response.ok) throw await refusal(response);
  const session = await response.json() as { session_id?: string; cast?: { display_name: string; role: string }[] };
  if (!session.session_id) throw new ConversationsError('refused', 502, 'NO_SESSION', 'The Conversations API did not return a session id.');
  return { session_id: session.session_id, cast: session.cast ?? [] };
}

export interface TurnInput { sessionId: string; prompt: string; opening: boolean }

// POST /v1/chat: the opening, or one learner turn, sent once. The result counts only when the saved
// conversation_turn and the final done event arrive with the same request and session identity,
// after the safety status.
export async function sendTurn(s: Settings, userId: string, input: TurnInput, idempotencyKey = randomUUID()): Promise<TurnResult> {
  const body = input.opening
    ? { session_id: input.sessionId, conversation: { operation: 'opening' } }
    : { session_id: input.sessionId, prompt: input.prompt, conversation: { operation: 'turn' } };
  const response = await call(s.base + '/chat', { method: 'POST', headers: { ...headers(s, userId, idempotencyKey), Accept: 'text/event-stream' }, body: JSON.stringify(body) }, TURN_TIMEOUT_MS);
  if (!response.ok || !response.body) throw await refusal(response);

  let requestId = response.headers.get('x-request-id') ?? '';
  let sessionId = '';
  let turn: Turn | undefined;
  let safety: Safety | undefined;
  let done: Record<string, any> | undefined;
  let failure: ConversationsError | undefined;

  const handle = (event: Record<string, any>) => {
    switch (event.type) {
      case 'metadata':
        if (event.request_id) requestId = String(event.request_id);
        sessionId = String(event.sessionId ?? '');
        break;
      case 'safety_status':
        safety = { level: String(event.level), evaluated: Boolean(event.evaluated), response_action: String(event.response_action), source: String(event.source) };
        break;
      case 'conversation_turn':
        turn = event.turn as Turn;
        break;
      case 'done':
        done = event;
        break;
      case 'error':
        failure = new ConversationsError('failed', 0, String(event.code ?? 'TURN_FAILED'), String(event.message ?? 'The turn did not complete.'), String(event.request_id ?? requestId));
        break;
      default:
        break; // content and display_complete are provisional; unknown future events never count as success
    }
  };

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) handle(JSON.parse(data));
      }
    }
  } catch (error) {
    if (failure) throw failure;
    throw new ConversationsError('unconfirmed', 0, 'STREAM_INTERRUPTED', 'The answer stopped before the turn was confirmed (' + (error as Error).message + ').', requestId);
  }
  if (failure) throw failure;

  const receipt = done?.receipt as Receipt | undefined;
  if (!done || !receipt || receipt.request_id !== requestId || !turn || turn.request_id !== requestId || !safety) {
    throw new ConversationsError('unconfirmed', 0, 'INCOMPLETE', 'The turn was not confirmed: the saved turn and the final done event did not both arrive with the same request id, after the safety status.', requestId);
  }
  if (sessionId !== input.sessionId || String(done.sessionId ?? '') !== input.sessionId || receipt.session_id !== input.sessionId) {
    throw new ConversationsError('unconfirmed', 0, 'SESSION_MISMATCH', 'The answer named a different session.', requestId);
  }
  return { request_id: requestId, session_id: sessionId, turn, safety, receipt };
}

export type Lookup =
  | { status: 'committed'; request_id: string; session_id: string; conversation: string; display: string; safety: Safety; units: number; amount_micro_usd: number; settlement: string; charge_id: string | null }
  | { status: 'in_progress' | 'unavailable'; request_id: string; session_id: string };

// GET /v1/requests/<id>: the original result of an accepted request, read as the same user. No charge.
export async function lookupRequest(s: Settings, userId: string, requestId: string): Promise<Lookup> {
  const response = await call(s.base + '/requests/' + encodeURIComponent(requestId), { headers: headers(s, userId) }, READ_TIMEOUT_MS);
  if (!response.ok) throw await refusal(response);
  const body = await response.json() as Record<string, any>;
  if (body.status !== 'committed') return { status: body.status === 'in_progress' ? 'in_progress' : 'unavailable', request_id: String(body.request_id ?? requestId), session_id: String(body.session_id ?? '') };
  const parts = (body.result?.parts ?? []) as { part: string; text: string }[];
  const c = body.result?.commercial ?? {};
  return {
    status: 'committed',
    request_id: String(body.request_id),
    session_id: String(body.session_id),
    conversation: parts.filter((p) => p.part === 'conversation').map((p) => p.text).join(''),
    display: parts.filter((p) => p.part === 'display').map((p) => p.text).join(''),
    safety: body.result?.safety_status as Safety,
    units: Number(c.billable_units ?? 0),
    amount_micro_usd: Number(c.charge?.amount_micro_usd ?? c.amount_micro_usd ?? 0),
    settlement: String(c.settlement ?? ''),
    charge_id: typeof c.charge?.charge_id === 'string' ? c.charge.charge_id : typeof c.charge_id === 'string' ? c.charge_id : null,
  };
}
