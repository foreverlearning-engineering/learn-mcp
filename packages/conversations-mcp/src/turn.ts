// The key-backed tools: one capped, confirmed test turn, and the lookup of a request (no charge).
// The developer's key comes from their own environment (FOREVERLEARNING_API_KEY); it is sent only
// to the configured API host and never appears in anything these tools return.
//
// The rules (the Learn server's, for an API where every turn spends money or a free attempt):
//   - the cost is stated first; nothing is sent without confirm: true (and a dialog where the
//     client offers one);
//   - on a production host the key's assignment may be live (real money), and the catalog cannot say
//     which, so a production turn is refused unless the call sets allow_live;
//   - at most 2 turns per server run by default, 10 at most;
//   - never a retry, and never a closeout call: this tool has no way to end a session. The API itself
//     closes an open session when the user's next session is opened, and charges that closeout;
//   - the reply is shown exactly as written;
//   - the key never appears in any output.
import { McpServer, acceptedContent, inputRequired, inputResponse, type ServerContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DEFAULT_BASE_URL, DEFAULT_ROOM_TITLE, PRICE_LINE, STAGING_BASE_URL, TEXT_TURN_MICRO_USD, maxTurns } from './config.ts';
import {
  ConversationsError, environmentOf, lookupRequest, prepareRoom, readCatalog, redact, sendTurn, settings,
  type Catalog, type Environment, type Lookup, type Meter, type TurnResult,
} from './client.ts';
import { loadProject, saveProject } from './state.ts';

// Turns this process has sent, whatever their outcome. Never reset while the process runs.
const budget = { sent: 0, busy: false };
export function resetBudgetForTests(): void {
  budget.sent = 0;
  budget.busy = false;
}

const dollars = (micro: number) => '$' + (micro / 1_000_000).toFixed(2);
const asError = (error: unknown) => (error instanceof ConversationsError ? error : new ConversationsError('network', 0, 'CLIENT_ERROR', String((error as Error)?.message ?? error)));

function result(key: string, t: string, isError = false, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: redact(t, key) }],
    ...(structured ? { structuredContent: JSON.parse(redact(JSON.stringify(structured), key)) as Record<string, unknown> } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

// How to add a key. A host that starts this server its own way (an editor extension that keeps the
// key in its secret storage) can replace this paragraph with CONVERSATIONS_MCP_KEY_HELP.
export function keyHelp(env: NodeJS.ProcessEnv): string {
  const own = (env.CONVERSATIONS_MCP_KEY_HELP ?? '').trim();
  if (own) return own.slice(0, 1000);
  return 'To send test turns, the developer puts their own Conversations API server key (from My APIs in the developer console) in FOREVERLEARNING_API_KEY, '
    + 'its assignment id in FOREVERLEARNING_ASSIGNMENT_ID, and the API host in FOREVERLEARNING_BASE_URL (production: ' + DEFAULT_BASE_URL + '; staging: ' + STAGING_BASE_URL + '), '
    + 'in the environment this server runs in. Then restart this server.';
}

function noKey(env: NodeJS.ProcessEnv, missing: string): string {
  return 'No test turn can be sent: ' + missing + ' is not set. The docs tools (conversations_guide, conversations_contract, conversations_kits, conversations_kit) work without it.\n\n'
    + keyHelp(env) + ' Never paste the key into the conversation.';
}

// What a turn costs, before it is sent. The catalog does not say whether a key's assignment is in
// test mode (free attempts) or live (real money), so on a production host both are named.
export function costLine(where: Environment): string {
  const money = where === 'live'
    ? 'On this host (production, or any host but staging) the cost depends on the key\'s assignment, which this tool cannot read: '
      + 'a test assignment uses one of the workspace\'s fifty free text attempts and spends no money; a live assignment spends real money, ' + dollars(TEXT_TURN_MICRO_USD) + ' (' + PRICE_LINE + '). '
      + 'The developer sees which theirs is under My APIs in the developer console.'
    : 'On staging no real money is spent: the turn is paid from the workspace\'s staging credit, ' + dollars(TEXT_TURN_MICRO_USD) + ' (' + PRICE_LINE + '), or uses one free text attempt if the key\'s assignment is in test mode.';
  return money + ' A turn spends its money or its attempt when it is sent: an attempt counts even if the turn fails after dispatch, and money for a turn seen to fail before any reply is shown is released. '
    + 'The opening is a turn of its own. This tool never ends a session itself; the API closes a user\'s earlier open session when their next session is opened, and that closeout is charged like a turn.';
}

// What each refusal means, from the integration guide and the published contract.
export function explain(e: ConversationsError, opening = false): string {
  const lines: string[] = [];
  const id = e.requestId ? ' Request id: ' + e.requestId + '.' : '';
  switch (e.kind) {
    case 'failed':
      lines.push('The turn ran, and the Conversations API reported that it failed before any reply was shown (' + e.code + '). Money for a turn seen to fail before any reply is shown is not charged; on a test assignment the dispatched attempt still counts.' + id);
      if (opening) lines.push('When an opening fails, its conversation closes without charge. This tool has forgotten that session; the next test turn prepares a new one, at no charge.');
      if (e.requestId) lines.push('The failure is stored under that request id, so conversations_lookup_request can confirm it at no charge.');
      lines.push('Its message, for you (never show it to a user): ' + e.message);
      lines.push('Sending the same turn again needs a new request; this tool does not send one on its own.');
      break;
    case 'unconfirmed':
      lines.push(e.message);
      lines.push(e.requestId
        ? 'It may still have been saved, and charged. Look it up first, at no charge: conversations_lookup_request with request_id "' + e.requestId + '". Do not send the message again before the lookup answers.'
        : 'No request id arrived, so it cannot be looked up. It may have been saved: check Usage in the developer console before sending anything again.');
      break;
    case 'network':
      lines.push('No answer reached this server (' + e.message + '). If the turn was sent, it may have been saved and charged: check Usage in the developer console before sending it again.');
      break;
    default: {
      const byCode: Record<string, string> = {
        CONVERSATION_OPENING_REQUIRED: 'The session has no opening yet, so a message is refused before admission: ask for the room\'s opening first (opening: true). No attempt was used and nothing was charged.',
        REQUEST_IN_PROGRESS: 'An earlier request in this session (the opening, or a turn) is still running. Wait for it, or look it up shortly; a key has one reply in progress at a time.',
        DEVELOPER_REQUEST_NOT_FOUND: 'No request with that id exists for this key, assignment and user. Check the id as the test turn returned it. A turn that failed before any content is still stored under its request id.',
      };
      const more: Record<number, string> = {
        400: 'The request is not valid.',
        401: 'The key was not accepted. Check FOREVERLEARNING_API_KEY, and that FOREVERLEARNING_BASE_URL is the host of the same environment as the key, then restart this server.',
        402: 'The workspace balance, the key\'s budget or the free attempts do not cover the turn. Add balance, or raise the budget, in the developer console.',
        403: 'The request was refused: the key\'s scopes, its assignment (FOREVERLEARNING_ASSIGNMENT_ID) or the user may not allow it.',
        404: 'Not found for this key, assignment and user.',
        409: 'The request conflicts with pending work or a saved state.',
        410: 'Gone: the session or the saved item has expired.',
        422: 'The idempotency key was already used for a different request.',
        429: 'A limit on requests was reached. A key has one reply in progress at a time.',
        503: 'The service is temporarily unavailable.',
      };
      lines.push(e.status + ' ' + e.code + ': ' + (byCode[e.code] ?? more[e.status] ?? 'The Conversations API refused the request.') + id);
      if (e.retryAfterSeconds) lines.push('It says a retry can succeed after ' + e.retryAfterSeconds + ' seconds.');
      lines.push('Its message: ' + e.message);
      lines.push('A refused request was not admitted: nothing was charged and no attempt was used.');
    }
  }
  lines.push('This tool never sends a turn again on its own.');
  return lines.join('\n');
}

const RESPONSE_WORDS: Record<string, string> = { steady_and_engaged: 'steady and engaged', more_open: 'more open', more_careful: 'more careful', more_strained: 'more strained', participating_less: 'participating less' };

export function replyText(r: TurnResult, names: Map<string, string>): string {
  const t = r.turn;
  const cast = t.structure === 'available' && t.cast.length
    ? [...t.cast].sort((a, b) => a.order - b.order).map((s) => s.display_name + ': ' + s.text)
    : ['(No speaker labels on this turn: the saved text, as it is. Never invent a speaker for it.)', t.text];
  const faces = (t.characters ?? []).map((c) => (names.get(c.speaker_id) ?? 'A character') + ': ' + (c.expression_group ? RESPONSE_WORDS[c.expression_group] ?? c.expression_group : 'no expression reported (show the neutral face)') + ', ' + c.presence.replace('_', ' '));
  return [
    'The Conversations API\'s reply, word for word. Show every line to the developer exactly as written: do not paraphrase, shorten, summarize or correct it.',
    '--- The characters ---',
    ...cast,
    '--- The Coach (its own channel, in English) ---',
    t.coach?.text?.trim() ? t.coach.text : '(No Coach note on this turn: show nothing.)',
    '--- end of the reply ---',
    'Safety: ' + r.safety.level + ' (evaluated: ' + r.safety.evaluated + ', response action: ' + r.safety.response_action + ', source: ' + r.safety.source + ')'
      + (r.safety.level === 'unknown' ? '. Unknown is not an all-clear.' : ''),
    ...(faces.length ? ['Faces and presence (simulated responses, optional for an app to show): ' + faces.join('; ') + '.'] : []),
  ].join('\n');
}

// The receipt's meaning: money charged, a free attempt used, or nothing at a critical turn.
export function receiptLines(m: Meter | null, where: Environment, requestId: string, sessionId: string, operation: string): { receipt: string; charged: string } {
  const units = m?.units ?? 0;
  const amount = m?.amount_micro_usd ?? 0;
  const receipt = 'Receipt: ' + units + ' text turn · ' + dollars(amount) + ' · ' + (m?.settlement ?? 'unknown') + (m?.charge_id ? ' · charge ' + m.charge_id : '') + ' · request ' + requestId + ' · session ' + sessionId + ' · ' + operation;
  const charged = amount > 0
    ? (where === 'live' ? 'Charged: ' + dollars(amount) + ' from your workspace balance (real money).' : 'Charged: ' + dollars(amount) + ' to the workspace\'s staging credit (no real money).')
    : units > 0
      ? 'No money charged: this key\'s assignment is in test mode, so the turn used one of the workspace\'s free text attempts (fifty per workspace; they never reset).'
      : 'Not charged (a turn at the critical safety level is not charged).';
  return { receipt, charged };
}

function clientConfirms(server: McpServer, env: NodeJS.ProcessEnv): boolean {
  if ((env.CONVERSATIONS_MCP_CONFIRM_DIALOG ?? '').toLowerCase() === 'off') return false;
  const caps = server.server.getClientCapabilities() as { elicitation?: { form?: unknown; url?: unknown } } | undefined;
  const e = caps?.elicitation;
  return Boolean(e && (e.form !== undefined || e.url === undefined));
}

// Forget a session the API no longer accepts, so the next turn prepares a new one (no charge).
const sessionGone = (e: ConversationsError) => e.kind === 'refused' && (e.status === 404 || e.status === 410 || /SESSION/i.test(e.code));

export function registerTurnTools(server: McpServer, env: NodeJS.ProcessEnv = process.env): void {
  const out = (t: string, isError = false, structured?: Record<string, unknown>) => result(settings(env).key, t, isError, structured);

  server.registerTool('conversations_test_turn', {
    title: 'Send one Conversations test turn',
    description: 'Send ONE real test turn to the Conversations API with the developer\'s own key (from this server\'s environment): the room\'s opening, or one message from the user. '
      + 'It uses one stable test user and one practice session for this project, in a ready-made room (default "' + DEFAULT_ROOM_TITLE + '"), and returns each character\'s line, the Coach\'s note, the safety status and the receipt exactly as written. '
      + 'A session starts with the room\'s opening (opening: true); a message is sent only after it. '
      + 'Cost: on a test assignment, one of the workspace\'s fifty free text attempts and no money; on a live assignment, real money at ' + PRICE_LINE + '; on staging, staging credit and no real money. The opening is a turn. '
      + 'On a production host this tool cannot tell a test key from a live one, so it refuses to send unless allow_live is true. '
      + 'Preparing the session adds no charge. This tool never ends a session; opening a second session for the same test user closes the first with a closeout, charged like a turn. '
      + 'First call it without confirm to see the exact cost, tell the developer, and call again with confirm: true only after they agree in the conversation. '
      + 'At most ' + maxTurns(env).limit + ' turns per server run. It never retries: if a turn is not confirmed, use conversations_lookup_request with the request id it returns. '
      + 'Show the reply to the developer exactly as written; never paraphrase, summarize or correct it.',
    inputSchema: z.object({
      message: z.string().max(10000).optional().describe('What the user says in the room, as they would say it. Use a made-up situation, never real personal data.'),
      opening: z.boolean().default(false).describe('Ask for the room\'s opening (the characters speak first) instead of sending a message. It is a turn of its own, once per session.'),
      room: z.string().max(200).optional().describe('The title of a ready-made room (default "' + DEFAULT_ROOM_TITLE + '", or the room of this project\'s open session). A different room prepares a new session there at no charge; its opening then closes the earlier open session with a charged closeout. Rooms that need the user\'s consent are not used.'),
      confirm: z.boolean().default(false).describe('Set to true only after the developer has agreed to the cost in this conversation.'),
      allow_live: z.boolean().default(false).describe('Required on a production host. Set to true only after the developer has said which their key\'s assignment is (test: free attempts; live: real money) and agreed to send.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ message, opening, room, confirm, allow_live }, ctx: ServerContext) => {
    const s = settings(env);
    if (!s.key) return out(noKey(env, 'FOREVERLEARNING_API_KEY'));
    if (!s.assignment) return out(noKey(env, 'FOREVERLEARNING_ASSIGNMENT_ID (every Conversations request names its assignment)'));
    const cap = maxTurns(env);
    if (budget.sent >= cap.limit) {
      return out('Not sent: this server has already sent ' + budget.sent + ' test turn' + (budget.sent === 1 ? '' : 's') + ', its limit for one run (' + cap.limit + '). '
        + 'Every Conversations turn spends money or a free attempt, so the limit keeps test spending small. A developer who wants more sets CONVERSATIONS_MCP_MAX_TURNS (up to 10) and restarts the server. ' + cap.note, true);
    }
    if (!opening && !(message ?? '').trim()) return out('Not sent: give the user\'s message, or set opening to true for the room\'s opening.', true);
    if (budget.busy) return out('Not sent: a test turn is already in progress. A key has one reply in progress at a time.', true);

    // A production key may be live (real money) and the catalog cannot say: refused before anything is sent, even a read.
    const where = environmentOf(s.base);
    if (where === 'live' && !allow_live) {
      return out('Not sent: FOREVERLEARNING_BASE_URL is not the staging host, and this tool cannot tell whether the key\'s assignment is in test mode (free attempts) or live (real money, ' + dollars(TEXT_TURN_MICRO_USD) + ', ' + PRICE_LINE + '). '
        + 'Ask the developer which it is (My APIs in the developer console); this tool sends on a production host only when they say so and the call sets allow_live: true. To test with staging credit instead, use a staging key with FOREVERLEARNING_BASE_URL=' + STAGING_BASE_URL + '.', true);
    }

    const { key: projectKey, state } = loadProject(s.base, s.assignment, env);
    const roomTitle = (room ?? '').trim() || state.room_title || DEFAULT_ROOM_TITLE;
    // A different room means a new session. Preparing one closes nothing; the new session's opening
    // closes the earlier open session with a charged closeout (the guide's one-active-session rule).
    const newRoom = Boolean(state.session_id && state.room_title && roomTitle.toLowerCase() !== state.room_title.toLowerCase());
    const sessionOpen = Boolean(state.session_id) && !newRoom;
    const earlierOpened = newRoom && state.opened;
    if (opening && sessionOpen && state.opened) return out('Not sent: this project\'s test session already has its opening. Send a message instead.', true);
    // The opening comes first: a message before it is refused (409 CONVERSATION_OPENING_REQUIRED), so it is not sent at all.
    if (!opening && !(sessionOpen && state.opened)) {
      return out('Not sent: ' + (sessionOpen ? 'this project\'s test session' : 'a new test session') + ' has no opening yet, and a message before the opening is refused. Send the room\'s opening first (opening: true).', true);
    }

    const cost = costLine(where);
    const plan = [
      'Not sent yet. This would send one test turn to the Conversations API:',
      '- ' + (opening ? 'the room\'s opening (the characters speak first; no message from the user)' : 'the user\'s message: "' + (message ?? '').trim() + '"'),
      '- as test user ' + state.user_id + ', ' + (sessionOpen ? 'in this project\'s open test session, room "' + state.room_title + '"' : 'in a new test session in the room "' + roomTitle + '" (reading the catalog and preparing the session add no charge)'),
      ...(newRoom ? [earlierOpened
        ? '- this project\'s earlier session, in the room "' + state.room_title + '", is still open: preparing the new one closes nothing, but requesting the new opening closes the earlier session with a closeout, charged like a turn (' + dollars(TEXT_TURN_MICRO_USD) + ', or one free attempt on a test assignment)'
        : '- this project\'s earlier session, in the room "' + state.room_title + '", was never opened, so nothing closes and nothing extra is charged'] : []),
      '- ' + cost,
      '- test turns this server has sent: ' + budget.sent + ' of ' + cap.limit,
      'Tell the developer this and ask whether to send it. Call again with confirm: true only after they agree.',
    ].join('\n');
    if (!confirm) return out(plan);

    if (clientConfirms(server, env)) {
      const schema = z.object({ send: z.boolean().describe('Send it') });
      const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', schema);
      if (!answer) {
        const view = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
        if (view.kind === 'elicit') return out('Not sent: the confirmation dialog was declined or closed, so nothing was sent and nothing was charged. Do not call again unless the developer asks. Where no one can answer a dialog, the developer can set CONVERSATIONS_MCP_CONFIRM_DIALOG=off for this server; the assistant still asks in the conversation first.');
        return inputRequired({ inputRequests: { confirm: inputRequired.elicit({ message: 'Send one test turn to the Conversations API? ' + cost, requestedSchema: schema }) } });
      }
      if (answer.send !== true) return out('Not sent: the developer chose not to send the test turn.');
    }

    // Prepare the project's session once per room (no charge), in a ready-made room that needs no consent.
    if (!sessionOpen) {
      let catalog: Catalog;
      try {
        catalog = await readCatalog(s, state.user_id);
      } catch (error) {
        return out('Could not read the catalog (no charge), so nothing was sent.\n' + explain(asError(error)), true);
      }
      const found = catalog.rooms.find((r) => r.title.toLowerCase() === roomTitle.toLowerCase());
      if (!found) return out('Not sent: no ready-made room titled "' + roomTitle + '" in this key\'s catalog. Rooms include: ' + catalog.rooms.slice(0, 12).map((r) => r.title).join('; ') + '.', true);
      if (found.topic_consent_required) return out('Not sent: the room "' + found.title + '" needs the user\'s consent first, and this tool uses only rooms that need none. Choose another room.', true);
      const persona = found.recommended_personas[0] ?? catalog.personas[0]?.persona_id;
      if (!persona) return out('Not sent: the catalog lists no persona for the room "' + found.title + '".', true);
      const mode = found.modes.includes('guided') ? 'guided' : found.modes[0];
      try {
        const prepared = await prepareRoom(s, state.user_id, { room_id: found.room_id, mode, persona_id: persona });
        state.session_id = prepared.session_id;
        state.room_title = found.title;
        state.opened = false;
        state.session_prepared_at = new Date().toISOString();
        saveProject(projectKey, state, env);
      } catch (error) {
        return out('Could not prepare the test session (no charge), so no turn was sent.\n' + explain(asError(error)), true);
      }
    }

    budget.sent += 1;
    budget.busy = true;
    state.turns_sent += 1;
    saveProject(projectKey, state, env);
    let r: TurnResult;
    try {
      r = await sendTurn(s, state.user_id, { sessionId: state.session_id, prompt: (message ?? '').trim(), opening });
    } catch (error) {
      const e = error instanceof ConversationsError ? error : new ConversationsError('unconfirmed', 0, 'CLIENT_ERROR', String((error as Error)?.message ?? error));
      if (e.requestId) { state.last_request_id = e.requestId; state.last_request_at = new Date().toISOString(); }
      if ((opening && e.kind === 'failed') || sessionGone(e)) { state.session_id = ''; state.opened = false; }
      // The API says the session has no opening: this tool's record was wrong, so the next call sends the opening.
      if (e.kind === 'refused' && e.code === 'CONVERSATION_OPENING_REQUIRED') state.opened = false;
      saveProject(projectKey, state, env);
      return out('The test turn did not complete.\n' + explain(e, opening) + '\nTest turns this server has sent: ' + budget.sent + ' of ' + cap.limit + '.', true,
        { outcome: e.kind, status: e.status, code: e.code, request_id: e.requestId, user_id: state.user_id, lookup: e.requestId && (e.kind === 'unconfirmed' || e.kind === 'failed') ? 'conversations_lookup_request' : null });
    } finally {
      budget.busy = false;
    }
    if (opening) state.opened = true;
    state.last_request_id = r.request_id;
    state.last_request_at = new Date().toISOString();
    saveProject(projectKey, state, env);

    const names = new Map((r.turn.cast ?? []).map((c) => [c.speaker_id, c.display_name]));
    const m = r.receipt.text;
    const { receipt, charged } = receiptLines(m, where, r.request_id, r.session_id, r.turn.operation);
    const closed = earlierOpened && opening ? ' The earlier session was closed by this opening, with its closeout charged like a turn.' : '';
    return out([replyText(r, names), receipt, charged, 'Test user: ' + state.user_id + '. Room: ' + state.room_title + '. Test turns this server has sent: ' + budget.sent + ' of ' + cap.limit + '. The session stays open; this tool never ends it.' + closed].join('\n'), false, {
      outcome: 'confirmed',
      operation: r.turn.operation,
      cast: r.turn.structure === 'available' ? r.turn.cast.map((c) => ({ speaker: c.display_name, text: c.text })) : [],
      text: r.turn.structure === 'available' ? null : r.turn.text,
      coach: r.turn.coach?.text ?? null,
      safety: r.safety,
      characters: r.turn.characters,
      receipt: { request_id: r.request_id, session_id: r.session_id, user_id: state.user_id, units: m?.units ?? 0, amount_micro_usd: m?.amount_micro_usd ?? 0, settlement: m?.settlement ?? null, charge_id: m?.charge_id ?? null, rate_version: m?.rate_version ?? null },
      environment: where,
    });
  });

  server.registerTool('conversations_lookup_request', {
    title: 'Look up a Conversations request',
    description: 'Look up a Conversations API request by its request id (GET /v1/requests/<id>), as this project\'s test user. No charge: it never generates a reply. '
      + 'Use it after a test turn that was not confirmed, before sending anything again. It returns the saved reply word for word, or says the request is still running or unavailable. '
      + 'Show a saved reply exactly as written.',
    inputSchema: z.object({
      request_id: z.string().min(1).max(200).describe('The request id from the test turn.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ request_id }) => {
    const s = settings(env);
    if (!s.key) return out(noKey(env, 'FOREVERLEARNING_API_KEY'));
    if (!s.assignment) return out(noKey(env, 'FOREVERLEARNING_ASSIGNMENT_ID'));
    const { state } = loadProject(s.base, s.assignment, env);
    let r: Lookup;
    try {
      r = await lookupRequest(s, state.user_id, request_id.trim());
    } catch (error) {
      const e = asError(error);
      if (e.code === 'REQUEST_FAILED') return out('409 REQUEST_FAILED: the request failed and was not charged. A new request for the same turn is allowed; this tool does not send one on its own.', true);
      return out(explain(e), true);
    }
    if (r.status !== 'committed') {
      return out(r.status === 'in_progress'
        ? 'The request is still running (in_progress). Look it up again shortly. Do not send the message again.'
        : 'The result is unavailable. That is not a confirmed failure, and not permission to send the message again; check Usage in the developer console.');
    }
    return out([
      'The saved reply, word for word. Show it to the developer exactly as written.',
      '--- The characters (the conversation part) ---',
      r.conversation,
      '--- The Coach (the display part) ---',
      r.display || '(No Coach note on this turn.)',
      '--- end of the reply ---',
      'Safety: ' + r.safety?.level + ' (response action: ' + r.safety?.response_action + ')' + (r.safety?.level === 'unknown' ? '. Unknown is not an all-clear.' : ''),
      'Receipt: ' + r.units + ' text turn · ' + dollars(r.amount_micro_usd) + ' · ' + r.settlement + (r.charge_id ? ' · charge ' + r.charge_id : '') + ' · request ' + r.request_id + ' · session ' + r.session_id,
      'This is the original result, read again: no new turn and no new charge.',
    ].join('\n'), false, { outcome: 'committed', conversation: r.conversation, display: r.display, safety: r.safety, request_id: r.request_id, session_id: r.session_id, units: r.units, amount_micro_usd: r.amount_micro_usd, settlement: r.settlement, charge_id: r.charge_id });
  });
}
