// A small Learn API client for the test-turn tools, after the starter's learn.ts
// (learn-tutor-starter/01-first-tutor). It never retries: a turn is sent once, and an
// unconfirmed turn is reported with its request id for a free lookup.
// The key is read from the environment at call time, sent only in the Authorization header,
// and removed from every message this module produces.
import { randomUUID } from 'node:crypto';
import { API_VERSION, DEFAULT_BASE_URL, READ_TIMEOUT_MS, TURN_TIMEOUT_MS, USER_AGENT } from '../config.ts';

export type Kind = 'guided' | 'feedback' | 'explain';

export interface Settings { key: string; base: string; assignment: string }

export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    key: (env.FOREVERLEARNING_API_KEY ?? '').trim(),
    base: (env.FOREVERLEARNING_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    assignment: (env.FOREVERLEARNING_ASSIGNMENT_ID ?? '').trim(),
  };
}

// Anything shaped like a server key, and the configured key itself, never leave this process.
const KEY_SHAPE = /fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi;
export function redact(text: string, key = settings().key): string {
  let out = String(text);
  if (key) out = out.split(key).join('<redacted-key>');
  return out.replace(KEY_SHAPE, '<redacted-key>');
}

export interface SafetyStatus { level: string; evaluated: boolean; response_action: string; source: string }
export interface Commercial { billable_units: number; charge_micro_usd: number; currency: string; settlement: string; request_id: string }
export interface QuestReceipt { posture: string; turn_index: number; team_dialog: boolean; mode?: string; composition_hash?: string; repairs?: unknown[]; validation_failures?: unknown[] }

export interface TurnResult {
  request_id: string;
  session_id: string;
  conversation: string;
  display: string;
  safety: SafetyStatus;
  receipt: QuestReceipt;
  commercial: Commercial;
}

// Every way a request can end without a confirmed turn.
//   refused:     Learn answered with an error before the turn ran (HTTP 4xx or 5xx). Nothing to look up.
//   failed:      the turn ran and Learn reported it failed (an error event). Not charged.
//   unconfirmed: the stream ended, dropped or timed out before the final done event. It may
//                have committed: look it up by request id before anything else.
//   network:     no answer reached this process.
export type FailureKind = 'refused' | 'failed' | 'unconfirmed' | 'network';
export class LearnError extends Error {
  kind: FailureKind;
  status: number;
  code: string;
  requestId: string;
  reason?: string;
  retryAfterSeconds?: number;
  field?: string;
  issue?: string;
  constructor(kind: FailureKind, status: number, code: string, message: string, requestId = '', extra: Partial<Pick<LearnError, 'reason' | 'retryAfterSeconds' | 'field' | 'issue'>> = {}) {
    super(redact(message));
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    Object.assign(this, extra);
  }
}

function headers(s: Settings, learnerId: string, idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: 'Bearer ' + s.key,
    'X-User-Id': learnerId,
    'FL-API-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (s.assignment) h['X-Assignment-Id'] = s.assignment;
  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

async function refusal(response: Response): Promise<LearnError> {
  let code = 'HTTP_' + response.status;
  let message = 'Learn answered HTTP ' + response.status + '.';
  let requestId = response.headers.get('x-request-id') ?? '';
  const extra: Partial<Pick<LearnError, 'reason' | 'retryAfterSeconds' | 'field' | 'issue'>> = {};
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.code === 'string') code = body.code;
    if (typeof body.message === 'string') message = body.message;
    if (typeof body.request_id === 'string') requestId = body.request_id;
    if (typeof body.reason === 'string') extra.reason = body.reason;
    if (typeof body.retry_after_seconds === 'number') extra.retryAfterSeconds = body.retry_after_seconds;
    if (typeof body.field === 'string') extra.field = body.field;
    if (typeof body.issue === 'string') extra.issue = body.issue;
  } catch { /* keep the HTTP status */ }
  const header = Number(response.headers.get('retry-after'));
  if (extra.retryAfterSeconds === undefined && Number.isFinite(header) && header > 0) extra.retryAfterSeconds = header;
  return new LearnError('refused', response.status, code, message, requestId, extra);
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const e = error as Error;
    throw new LearnError('network', 0, e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', 'No answer from ' + new URL(url).host + ': ' + e.message);
  }
}

export interface Catalog { mode: string; price_micro_usd: number | null; currency: string; postures: string[]; release_id: string; content_release: string; test_allowance: number | null }

// The workspace's own free-test allowance, when a response carries it. As of 2026-11-23 the
// contract defines no such field in the catalog (or elsewhere), so this returns null and the
// tool names no number. When the developer lane's release adds one, read it here, by the name
// the contract gives it, and nowhere else.
function testAllowance(_body: Record<string, any>): number | null {
  return null;
}

// GET /v1/quest/catalog: the assignment's mode (test or live), postures and price. Free.
export async function readCatalog(s: Settings, learnerId: string): Promise<Catalog> {
  const response = await call(s.base + '/quest/catalog', { headers: headers(s, learnerId) }, READ_TIMEOUT_MS);
  if (!response.ok) throw await refusal(response);
  const body = await response.json() as Record<string, any>;
  return {
    mode: String(body.mode ?? ''),
    price_micro_usd: typeof body.price?.amount_micro_usd === 'number' ? body.price.amount_micro_usd : null,
    currency: String(body.price?.currency ?? 'USD'),
    postures: Array.isArray(body.postures) ? body.postures.map(String) : [],
    release_id: String(body.release_id ?? ''),
    content_release: String(body.content_release ?? ''),
    test_allowance: testAllowance(body),
  };
}

// POST /v1/quest/sessions: prepare a session. No reply is generated; free.
export async function prepareSession(s: Settings, learnerId: string, setup: Record<string, unknown>): Promise<string> {
  const response = await call(s.base + '/quest/sessions', { method: 'POST', headers: headers(s, learnerId, randomUUID()), body: JSON.stringify({ setup }) }, READ_TIMEOUT_MS);
  if (!response.ok) throw await refusal(response);
  const body = await response.json() as { session_id?: string; data?: { session_id?: string } };
  const id = body.session_id ?? body.data?.session_id;
  if (!id) throw new LearnError('refused', 502, 'NO_SESSION', 'Learn did not return a session id.');
  return id;
}

export interface TurnInput { sessionId: string; prompt: string; kind: Kind; opening: boolean }

// POST /v1/chat: one turn, sent once. The result counts only when the final done event
// arrives with the same request and session identity, after the safety status and the receipt.
export async function sendTurn(s: Settings, learnerId: string, input: TurnInput, idempotencyKey = randomUUID()): Promise<TurnResult> {
  const body = {
    session_id: input.sessionId,
    prompt: input.opening ? '' : input.prompt,
    posture: input.kind,
    quest: { operation: input.opening ? 'opening' : 'turn', requested_support: 'auto', team_dialog: false },
  };
  const response = await call(s.base + '/chat', { method: 'POST', headers: headers(s, learnerId, idempotencyKey), body: JSON.stringify(body) }, TURN_TIMEOUT_MS);
  if (!response.ok || !response.body) throw await refusal(response);

  let requestId = response.headers.get('x-request-id') ?? '';
  let sessionId = '';
  let conversation = '';
  let display = '';
  let safety: SafetyStatus | undefined;
  let receipt: QuestReceipt | undefined;
  let done: Record<string, any> | undefined;
  let failure: LearnError | undefined;

  const handle = (event: Record<string, any>) => {
    switch (event.type) {
      case 'metadata':
        if (event.request_id) requestId = String(event.request_id);
        sessionId = String(event.sessionId ?? event.session_id ?? '');
        break;
      case 'content':
        if (event.part === 'conversation') conversation += event.text;
        else if (event.part === 'display') display += event.text;
        break; // a frame part only comes with team dialog, which this tool keeps off
      case 'safety_status':
        safety = { level: String(event.level), evaluated: Boolean(event.evaluated), response_action: String(event.response_action), source: String(event.source) };
        break;
      case 'quest_receipt':
        receipt = event.receipt as QuestReceipt;
        break;
      case 'done':
        done = event;
        break;
      case 'error':
        failure = new LearnError('failed', 0, String(event.code ?? 'STREAM_ERROR'), String(event.message ?? 'The turn did not complete.'), String(event.request_id ?? requestId));
        break;
      default:
        break; // unknown future events never count as success
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
    throw new LearnError('unconfirmed', 0, 'STREAM_INTERRUPTED', 'The answer stopped before Learn confirmed the turn (' + (error as Error).message + ').', requestId);
  }
  if (failure) throw failure;

  const commercial = done?.commercial as Record<string, any> | undefined;
  if (!done || !commercial || commercial.request_id !== requestId || !safety || !receipt) {
    throw new LearnError('unconfirmed', 0, 'INCOMPLETE', 'Learn did not confirm the turn: the final done event did not arrive with the same request id, the safety status and the receipt.', requestId);
  }
  const doneSession = String(done.sessionId ?? done.session_id ?? sessionId);
  if (sessionId !== input.sessionId || doneSession !== input.sessionId) {
    throw new LearnError('unconfirmed', 0, 'SESSION_MISMATCH', 'The answer named a different session.', requestId);
  }
  return {
    request_id: requestId,
    session_id: sessionId,
    conversation,
    display,
    safety,
    receipt,
    commercial: {
      billable_units: Number(commercial.billable_units),
      charge_micro_usd: Number(commercial.charge?.amount_micro_usd ?? 0),
      currency: String(commercial.charge?.currency ?? 'USD'),
      settlement: String(commercial.settlement),
      request_id: String(commercial.request_id),
    },
  };
}

export type Lookup =
  | { status: 'committed'; request_id: string; session_id: string; conversation: string; display: string; safety: SafetyStatus; commercial: Commercial; receipt?: QuestReceipt; session_ended: boolean }
  | { status: 'in_progress' | 'unavailable'; request_id: string; session_id: string };

// GET /v1/requests/<id>: the original result of an accepted request, read as the same learner. Free.
export async function lookupRequest(s: Settings, learnerId: string, requestId: string): Promise<Lookup> {
  const response = await call(s.base + '/requests/' + encodeURIComponent(requestId), { headers: headers(s, learnerId) }, READ_TIMEOUT_MS);
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
    safety: body.result?.safety_status as SafetyStatus,
    receipt: body.result?.quest as QuestReceipt | undefined,
    session_ended: Boolean(body.result?.session_ended),
    commercial: {
      billable_units: Number(c.billable_units ?? 0),
      charge_micro_usd: Number(c.charge?.amount_micro_usd ?? c.amount_micro_usd ?? 0),
      currency: String(c.charge?.currency ?? 'USD'),
      settlement: String(c.settlement ?? ''),
      request_id: String(c.request_id ?? body.request_id),
    },
  };
}
