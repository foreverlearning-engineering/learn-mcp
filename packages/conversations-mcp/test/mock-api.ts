// A local stand-in for the Conversations API, for the unit tests. It speaks the shapes the guide
// and the contract describe (catalog, session preparation, the /chat event stream, request lookup)
// and records every request it receives. It never calls anything outside this process.
// Behaviour follows the developer platform's November 25 release: a turn before the opening is
// 409 CONVERSATION_OPENING_REQUIRED, an unknown lookup is 404 DEVELOPER_REQUEST_NOT_FOUND, and a
// settled receipt carries charge_id.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const TEST_KEY = 'fl_test_' + 'c0ffee12'.repeat(8);
export const ASSIGNMENT = '11111111-2222-4333-8444-555555555555';

export type ChatScenario =
  | 'ok'
  | 'ok-critical'
  | 'ok-test-mode'
  | 'unstructured'
  | 'error-event'
  | 'no-done'
  | 'mismatch'
  | 'refused-429'
  | 'refused-401-echo-key'
  | 'refused-404-session'
  | 'refused-409-opening-required'
  | 'refused-409-in-progress';

export interface Recorded { method: string; path: string; body: any; headers: Record<string, string | string[] | undefined> }

// Words a test checks for, as written (curly quotes and a dash in a character's line are theirs to keep).
export const LINES = {
  opening: 'Jon: You wanted to see me? I’ve got about ten minutes before the standup.',
  reply: 'Look, I know the reports were late — the data team kept changing the numbers on me.',
  coach: 'Jon gave you a reason. Before you answer it, decide whether you want to explore it or hold the deadline.',
};

export interface Mock {
  url: string;
  requests: Recorded[];
  chat: ChatScenario[];
  lookup: 'committed' | 'in_progress';
  reset(): void;
  close(): Promise<void>;
}

function sse(res: ServerResponse, events: object[], requestId: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Request-Id': requestId });
  for (const e of events) res.write('data: ' + JSON.stringify(e) + '\n\n');
  res.end();
}
function json(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
}

export async function startMock(): Promise<Mock> {
  let turn = 0;
  let prepared = 0;
  const opened = new Set<string>();
  const mock: Mock = {
    url: '', requests: [], chat: [], lookup: 'committed', close: async () => {},
    reset() { turn = 0; prepared = 0; opened.clear(); this.requests.length = 0; this.chat = []; this.lookup = 'committed'; },
  };
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const path = (req.url ?? '').replace(/^\/v1/, '');
    const body = raw ? JSON.parse(raw) : undefined;
    mock.requests.push({ method: req.method ?? '', path, body, headers: req.headers });
    if (req.headers.authorization !== 'Bearer ' + TEST_KEY) return json(res, 401, { error: true, code: 'DEVELOPER_AUTHENTICATION_REQUIRED', message: 'Authentication required.', request_id: 'req_auth' });
    if (req.headers['x-assignment-id'] !== ASSIGNMENT) return json(res, 403, { error: true, code: 'DEVELOPER_OPERATION_REFUSED', message: 'Assignment required.', request_id: 'req_asg' });

    if (req.method === 'GET' && path.startsWith('/conversation/catalog')) {
      return json(res, 200, {
        schema: 'fl.conversation.catalog.v1', content_release: 'mock-content', next_cursor: null, request_id: 'req_cat',
        rooms: [
          { room_id: 'S01', title: 'Direct Feedback To A Report', category_id: 'work', description: 'x', modes: ['guided', 'simulation', 'freeform'], min_participants: 1, max_participants: 2, recommended_personas: ['jon_guarded_report'], coach_lenses: [], tiers: ['standard'], default_tier: 'standard', topic_consent_required: false },
          { room_id: 'S22', title: 'Interview Practice', category_id: 'work', description: 'x', modes: ['guided', 'simulation', 'freeform'], min_participants: 1, max_participants: 2, recommended_personas: ['riley_analyst'], coach_lenses: [], tiers: ['standard'], default_tier: 'standard', topic_consent_required: false },
          { room_id: 'S75', title: 'Telling Your Partner About A Diagnosis', category_id: 'relationships', description: 'x', modes: ['guided'], min_participants: 1, max_participants: 1, recommended_personas: ['sam_partner'], coach_lenses: [], tiers: ['standard', 'gentle'], default_tier: 'gentle', topic_consent_required: true },
        ],
        personas: [{ persona_id: 'jon_guarded_report', display_name: 'Jon', role: 'Your direct report', role_family: 'work' }, { persona_id: 'sam_partner', display_name: 'Sam', role: 'Your partner', role_family: 'relationships' }],
        categories: [], coach_lenses: [], languages: [], modes: [],
      });
    }
    if (req.method === 'POST' && path === '/conversation/sessions') {
      prepared += 1;
      return json(res, 200, { schema: 'fl.conversation.session.v1', session_id: 'sess_mock_' + prepared, state: 'prepared', mode: body.setup.mode, room_id: body.setup.room_id, cast: [{ speaker_id: 'spk_jon', persona_id: 'jon_guarded_report', display_name: 'Jon', role: 'Your direct report', seat: 1 }] });
    }
    if (req.method === 'POST' && path === '/chat') {
      // Since 2026.11.25.1: a learner turn before the opening is refused before admission, with no attempt used.
      if (body.conversation?.operation === 'turn' && !opened.has(body.session_id)) return json(res, 409, { error: true, code: 'CONVERSATION_OPENING_REQUIRED', message: 'The session has no opening yet.', request_id: 'req_refused' });
      const scenario = mock.chat.shift() ?? 'ok';
      if (scenario === 'refused-409-opening-required') return json(res, 409, { error: true, code: 'CONVERSATION_OPENING_REQUIRED', message: 'The session has no opening yet.', request_id: 'req_refused' });
      if (scenario === 'refused-409-in-progress') return json(res, 409, { error: true, code: 'REQUEST_IN_PROGRESS', message: 'A request is in progress for this session.', request_id: 'req_busy' });
      if (body.conversation?.operation === 'opening') opened.add(body.session_id);
      turn += 1;
      const requestId = 'req_mock_' + turn;
      const session = body.session_id;
      const opening = body.conversation?.operation === 'opening';
      const level = scenario === 'ok-critical' ? 'critical' : 'clear';
      const safety = { type: 'safety_status', schema_version: 1, evaluated: true, level, response_action: level === 'clear' ? 'none' : 'support', source: 'governed_turn' };
      const words = opening ? LINES.opening.replace(/^Jon: /, '') : LINES.reply;
      const saved = {
        schema: 'fl.conversation.turn.v1', turn_id: 'turn_' + turn, request_id: requestId, session_id: session, ordinal: turn - 1, operation: opening ? 'opening' : 'turn',
        created_at: new Date().toISOString(), learner_text: opening ? null : body.prompt,
        cast: scenario === 'unstructured' ? [] : [{ segment_id: 'seg_' + turn, speaker_id: 'spk_jon', display_name: 'Jon', order: 0, text: words, language: 'en-US' }],
        coach: { text: LINES.coach, language: 'en-US' }, text: 'Jon ' + words + '\n\n' + LINES.coach,
        applied_controls: { cast_language: 'en-US', cast_speech: 'natural', challenge: 'realistic', emotional_heat: 'calm', coach_lens_id: null },
        safety, structure: scenario === 'unstructured' ? 'unavailable' : 'available', state: 'active',
        characters: [{ speaker_id: 'spk_jon', persona_id: 'jon_guarded_report', expression: level === 'critical' ? null : 'guarded', expression_group: level === 'critical' ? null : 'more_careful', presence: 'present' }],
      };
      // Money: 3¢ on a live assignment; $0 with one unit on a test assignment (a free attempt); nothing at a critical turn.
      const testMode = scenario === 'ok-test-mode';
      const amount = level === 'critical' || testMode ? 0 : 30000;
      const units = level === 'critical' ? 0 : 1;
      const receipt = { request_id: requestId, session_id: session, content_release: 'mock-content', text: { unit: 'text_turn', units, amount_micro_usd: amount, currency: 'USD', rate_version: testMode ? 'rate_test' : 'rate_live', settlement: 'settled', charge_id: amount ? 'ch_' + turn : null }, audio: null };
      const head = [{ type: 'metadata', request_id: requestId, sessionId: session }, { type: 'content', part: 'conversation', text: words }, { type: 'content', part: 'display', text: LINES.coach }, { type: 'display_complete' }, safety];
      const done = { type: 'done', sessionId: session, receipt };
      switch (scenario) {
        case 'ok': case 'ok-critical': case 'ok-test-mode': case 'unstructured': return sse(res, [...head, { type: 'conversation_turn', turn: saved }, done], requestId);
        case 'error-event': return sse(res, [head[0], { type: 'error', error: true, code: 'GENERATION_FAILED', message: 'The reply failed its check twice.', request_id: requestId }], requestId);
        case 'no-done': return sse(res, [...head, { type: 'conversation_turn', turn: saved }], requestId);
        case 'mismatch': return sse(res, [...head, { type: 'conversation_turn', turn: saved }, { ...done, receipt: { ...receipt, request_id: 'req_other' } }], requestId);
        case 'refused-429': return json(res, 429, { error: true, code: 'DEVELOPER_CAPACITY_LIMIT', message: 'Request capacity reached.', request_id: requestId }, { 'Retry-After': '60' });
        case 'refused-401-echo-key': return json(res, 401, { error: true, code: 'DEVELOPER_AUTHENTICATION_REQUIRED', message: 'Key ' + TEST_KEY + ' was not accepted.', request_id: requestId });
        case 'refused-404-session': return json(res, 404, { error: true, code: 'SESSION_NOT_FOUND', message: 'No such session.', request_id: requestId });
      }
    }
    const lookup = /^\/requests\/(.+)$/.exec(path);
    if (req.method === 'GET' && lookup) {
      if (lookup[1] === 'req_unknown') return json(res, 404, { error: true, code: 'DEVELOPER_REQUEST_NOT_FOUND', message: 'No such request.', request_id: 'req_lookup' });
      if (mock.lookup === 'in_progress') return json(res, 200, { status: 'in_progress', request_id: lookup[1], session_id: 'sess_mock_1' });
      return json(res, 200, {
        status: 'committed', request_id: lookup[1], session_id: 'sess_mock_1',
        result: { parts: [{ part: 'conversation', text: LINES.reply }, { part: 'display', text: LINES.coach }], safety_status: { type: 'safety_status', schema_version: 1, evaluated: true, level: 'clear', response_action: 'none', source: 'governed_turn' }, stop_reason: 'end_turn', session_ended: false, commercial: { request_id: lookup[1], billable_units: 1, charge: { amount_micro_usd: 30000, currency: 'USD', charge_id: 'ch_lookup' }, settlement: 'settled' } },
      });
    }
    json(res, 404, { error: true, code: 'NOT_FOUND', message: 'No route ' + req.method + ' ' + path, request_id: 'req_404' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  mock.url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
  mock.close = () => new Promise<void>((r) => server.close(() => r()));
  return mock;
}
