// The key-backed tools: one capped, confirmed test turn, and the free lookup of a request.
// The developer's key comes from their own environment (FOREVERLEARNING_API_KEY); it is sent
// only to the Learn API host and never appears in anything these tools return.
import { McpServer, acceptedContent, inputRequired, inputResponse, type ServerContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CONFIRM_TIMEOUT_MS, DEFAULT_BASE_URL, FREE_TEST_ATTEMPTS, PRICE_LINE, maxTurns } from '../config.ts';
import { LearnError, lookupRequest, prepareSession, readCatalog, redact, sendTurn, settings, type Catalog, type Kind, type Lookup, type TurnResult } from './client.ts';
import { loadProject, saveProject } from './state.ts';

// Turns this process has sent to Learn, whatever their outcome. Never reset while the process runs.
const budget = { sent: 0, busy: false };
export function resetBudgetForTests(): void {
  budget.sent = 0;
  budget.busy = false;
}

const STAGING_BASE = 'https://developers-api-staging.foreverlearning.ai/v1';
const SETUP = { task: { kind: 'homework' }, team_dialog: false };

const dollars = (micro: number) => '$' + (micro / 1_000_000).toFixed(2);

function result(key: string, t: string, isError = false, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: redact(t, key) }],
    ...(structured ? { structuredContent: JSON.parse(redact(JSON.stringify(structured), key)) as Record<string, unknown> } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

function noKey(): string {
  return 'No Learn API key is set, so no test turn can be sent. The docs tools (learn_guide, learn_contract, learn_kits, learn_kit) work without one.\n\n'
    + 'To send test turns, the developer puts their own server key (from My APIs in the developer console) in FOREVERLEARNING_API_KEY in the environment this server runs in, '
    + 'and the API host in FOREVERLEARNING_BASE_URL (production: ' + DEFAULT_BASE_URL + '; staging: ' + STAGING_BASE + '). '
    + 'If the key has more than one Learn assignment, also FOREVERLEARNING_ASSIGNMENT_ID. Then restart this server. Never paste the key into the conversation.';
}

export function costLine(catalog: Catalog): string {
  if (catalog.mode === 'live') {
    const price = catalog.price_micro_usd === null ? '5¢' : dollars(catalog.price_micro_usd);
    return 'This is a live key: the turn costs ' + price + ' from your workspace balance if it succeeds (' + PRICE_LINE + '). A turn that fails costs nothing.';
  }
  return 'In test mode this turn uses 1 of your workspace\'s ' + FREE_TEST_ATTEMPTS + ' free test attempts. They last for the life of the workspace, are shared by all its keys and never reset; '
    + 'a turn that fails after it is sent also uses one. Nothing is charged. An opening, when you ask for one, is a turn of its own; this tool never ends the session, so it never spends an attempt on a closeout.';
}

// What each refusal means, from the guide's "When a request is refused" and the developer lane.
export function explain(e: LearnError): string {
  const lines: string[] = [];
  const id = e.requestId ? ' Request id: ' + e.requestId + '.' : '';
  switch (e.kind) {
    case 'failed':
      lines.push('The turn ran and Learn reported that it failed (' + e.code + '). It was not charged; in test mode it used a free attempt.' + id);
      lines.push('Learn\'s message, for you (never show it to a learner): ' + e.message);
      break;
    case 'unconfirmed':
      lines.push(e.message);
      lines.push(e.requestId
        ? 'It may still have committed, and been charged. Look it up first, free: learn_lookup_request with request_id "' + e.requestId + '". Do not send the message again before the lookup answers.'
        : 'No request id arrived, so it cannot be looked up. It may have committed: check Usage in the developer console before sending anything again.');
      break;
    case 'network':
      lines.push('No answer reached this server (' + e.message + '). If the turn was sent, it may have committed: check Usage in the developer console before sending it again.');
      break;
    default: {
      const head = e.status + ' ' + e.code + ': ';
      const more: Record<string, string> = {
        DEVELOPER_INVALID_REQUEST: 'The request is not valid' + (e.field ? ': field ' + e.field + (e.issue ? ', ' + e.issue : '') : '') + '.',
        DIAGNOSTIC_SESSION_REQUIRED: 'Diagnostic needs a session prepared for it; this tool does not run Diagnostic.',
        DEVELOPER_AUTHENTICATION_REQUIRED: 'The key was not accepted. Check FOREVERLEARNING_API_KEY, and that FOREVERLEARNING_BASE_URL is the host of the same environment as the key (production ' + DEFAULT_BASE_URL + ', staging ' + STAGING_BASE + '), then restart this server.',
        DEVELOPER_BALANCE_EXHAUSTED: 'The workspace balance is used up, or below the 50¢ a new session needs. Add balance in the developer console.',
        KEY_BUDGET_EXHAUSTED: "The key's budget is used up. Raise it in the developer console.",
        DEVELOPER_OPERATION_REFUSED: "Learn refused the request. Many causes share this one answer on purpose: the key's scopes, the assignment (FOREVERLEARNING_ASSIGNMENT_ID), the session or the learner. If the saved test session was closed or belongs to another key, this tool has forgotten it: the next test turn prepares a new one, free.",
        DEVELOPER_POLICY_BLOCKED: 'The safety screening refused the message before it reached the tutor. Nothing was charged. In an app, show your own short message, such as "I can\'t help with that message. Try asking another way.", never the refusal\'s own text.',
        DEVELOPER_WORKLOAD_REVIEW_REQUIRED: "Every builder's free test turns on this environment draw on one shared pool, and the pool is spent, so test turns are refused for now. Nothing was charged.",
        REQUEST_IN_PROGRESS: 'The original request is still running. Look it up again shortly.',
        REQUEST_FAILED: 'The original request failed and was not charged.',
        IDEMPOTENCY_KEY_REUSED: 'The idempotency key was already used for a different request.',
        DEVELOPER_CAPACITY_LIMIT: 'A limit on requests was reached' + (e.reason ? ' (' + e.reason + ')' : '') + '. A key may send 10 new requests a minute and have one reply in progress at a time.',
        DEVELOPER_NEW_USER_LIMIT: 'The day\'s limit on new learners was reached. Learners already admitted are not affected; this tool keeps one test learner per project.',
        DEVELOPER_WORKSPACE_NOT_READY: 'The workspace is not ready to admit new learners. Contact ForeverLearning with the request id; sending it again does not help.',
        DEVELOPER_UNAVAILABLE: 'The service is temporarily unavailable.',
      };
      lines.push(head + (more[e.code] ?? 'Learn refused the request.') + id);
      if (e.retryAfterSeconds) lines.push('Learn says a retry can succeed after ' + e.retryAfterSeconds + ' seconds.');
      if (!more[e.code] || e.code === 'DEVELOPER_INVALID_REQUEST') lines.push('Learn\'s message: ' + e.message);
      lines.push('A refused request was not admitted: nothing was charged and no free attempt was used.');
    }
  }
  lines.push('This tool never sends a turn again on its own.');
  return lines.join('\n');
}

function replyText(r: { conversation: string; display: string; safety: { level: string; evaluated: boolean; response_action: string; source: string } }): string {
  return [
    "Learn's reply, word for word. Show both parts to the developer exactly as written: do not paraphrase, shorten, summarize or correct them.",
    '--- What the tutor says (the conversation part) ---',
    r.conversation,
    '--- The hint to work on (the display part, in Markdown) ---',
    r.display,
    '--- end of the reply ---',
    'Safety: ' + r.safety.level + ' (evaluated: ' + r.safety.evaluated + ', response action: ' + r.safety.response_action + ', source: ' + r.safety.source + ')'
      + (r.safety.level === 'unknown' ? '. Unknown is not an all-clear.' : ''),
  ].join('\n');
}

function clientConfirms(server: McpServer, env: NodeJS.ProcessEnv): boolean {
  if ((env.LEARN_MCP_CONFIRM_DIALOG ?? '').toLowerCase() === 'off') return false;
  const caps = server.server.getClientCapabilities() as { elicitation?: { form?: unknown; url?: unknown } } | undefined;
  const e = caps?.elicitation;
  return Boolean(e && (e.form !== undefined || e.url === undefined));
}

export function registerTurnTools(server: McpServer, env: NodeJS.ProcessEnv = process.env): void {
  // Every result passes through the key redaction, whatever produced its text.
  const out = (t: string, isError = false, structured?: Record<string, unknown>) => result(settings(env).key, t, isError, structured);
  server.registerTool('learn_test_turn', {
    title: 'Send one Learn test turn',
    description: 'Send ONE real test turn to the Learn API with the developer\'s own key (from this server\'s environment), as one stable test learner for this project, '
      + 'and return Learn\'s reply exactly as written (both parts), its safety status and its receipt. '
      + 'Cost: in test mode each turn uses 1 of the workspace\'s ' + FREE_TEST_ATTEMPTS + ' free test attempts (for the life of the workspace, never reset); '
      + 'with a live key, ' + PRICE_LINE + ', and a live key is refused unless allow_live is true. Preparing the session is free; the session is never ended by this tool. '
      + 'First call it without confirm to see the exact cost, tell the developer, and call again with confirm: true only after they agree in the conversation. '
      + 'At most ' + maxTurns(env).limit + ' turns per server run. It never retries: if a turn is not confirmed, use learn_lookup_request with the request id it returns. '
      + 'Show Learn\'s reply to the developer exactly as written; never paraphrase, summarize or correct it.',
    inputSchema: z.object({
      message: z.string().max(10000).optional().describe('The learner\'s message, as a learner would write it. Use made-up work, never real learner data.'),
      kind: z.enum(['guided', 'feedback', 'explain']).default('guided').describe('The kind of help: guided (a hint toward the next step; the default), feedback (a check of work included in the message), explain (an explanation of a solution included in the message).'),
      opening: z.boolean().default(false).describe('Ask for Learn\'s generated opening instead of sending a message. It is a turn of its own.'),
      confirm: z.boolean().default(false).describe('Set to true only after the developer has agreed to the cost in this conversation.'),
      allow_live: z.boolean().default(false).describe('Set to true only when the developer has said to use a live key, which spends real money.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ message, kind, opening, confirm, allow_live }, ctx: ServerContext) => {
    const s = settings(env);
    if (!s.key) return out(noKey());
    const cap = maxTurns(env);
    if (budget.sent >= cap.limit) {
      return out('Not sent: this server has already sent ' + budget.sent + ' test turn' + (budget.sent === 1 ? '' : 's') + ', its limit for one run (' + cap.limit + '). '
        + 'The limit protects the workspace\'s free test attempts. A developer who wants more sets LEARN_MCP_MAX_TURNS (up to 10) and restarts the server. ' + cap.note, true);
    }
    if (!opening && !(message ?? '').trim()) return out('Not sent: give the learner\'s message, or set opening to true for Learn\'s generated opening.', true);
    if (budget.busy) return out('Not sent: a test turn is already in progress. A key has one reply in progress at a time.', true);

    const { key: projectKey, state } = loadProject(s.base, s.assignment, env);
    let catalog: Catalog;
    try {
      catalog = await readCatalog(s, state.learner_id);
    } catch (error) {
      return out('Could not read the assignment\'s catalog (free), so nothing was sent.\n' + explain(error as LearnError), true);
    }
    if (catalog.mode === 'live' && !allow_live) {
      return out('Not sent: this key\'s assignment is live, so a turn spends real money (' + (catalog.price_micro_usd === null ? '5¢' : dollars(catalog.price_micro_usd)) + ' per turn that succeeds). '
        + 'This tool sends a live turn only when the developer says so and the call sets allow_live: true.', true);
    }
    const cost = costLine(catalog);
    const plan = [
      'Not sent yet. This would send one test turn to the Learn API:',
      '- ' + (opening ? 'Learn\'s generated opening (no learner message)' : 'message: "' + (message ?? '').trim() + '", kind of help: ' + kind),
      '- as test learner ' + state.learner_id + ', ' + (state.session_id ? 'in this project\'s open test session' : 'in a new test session for this project (preparing it is free)'),
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
        if (view.kind === 'elicit') return out('Not sent: the confirmation dialog was declined or closed, so nothing was sent and nothing was used. Do not call again unless the developer asks. Where no one can answer a dialog (a run with no person at the keyboard), the developer can set LEARN_MCP_CONFIRM_DIALOG=off for this server; the assistant still asks in the conversation first.');
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: 'Send one test turn to the Learn API? ' + cost,
              requestedSchema: schema,
            }),
          },
        });
      }
      if (answer.send !== true) return out('Not sent: the developer chose not to send the test turn.');
    }

    // Prepare the project's session once (free), and keep it.
    if (!state.session_id) {
      try {
        state.session_id = await prepareSession(s, state.learner_id, SETUP);
        state.session_prepared_at = new Date().toISOString();
        saveProject(projectKey, state, env);
      } catch (error) {
        return out('Could not prepare the test session (free), so no turn was sent.\n' + explain(error as LearnError), true);
      }
    }

    budget.sent += 1;
    budget.busy = true;
    state.turns_sent += 1;
    saveProject(projectKey, state, env);
    let result: TurnResult;
    try {
      result = await sendTurn(s, state.learner_id, { sessionId: state.session_id, prompt: (message ?? '').trim(), kind, opening });
    } catch (error) {
      const e = error instanceof LearnError ? error : new LearnError('unconfirmed', 0, 'CLIENT_ERROR', (error as Error).message);
      if (e.requestId) { state.last_request_id = e.requestId; state.last_request_at = new Date().toISOString(); }
      if (e.kind === 'refused' && e.code === 'DEVELOPER_OPERATION_REFUSED') state.session_id = '';
      saveProject(projectKey, state, env);
      return out('The test turn did not complete.\n' + explain(e) + '\nTest turns this server has sent: ' + budget.sent + ' of ' + cap.limit + '.', true,
        { outcome: e.kind, status: e.status, code: e.code, request_id: e.requestId, learner_id: state.learner_id, lookup: e.kind === 'unconfirmed' && e.requestId ? 'learn_lookup_request' : null });
    } finally {
      budget.busy = false;
    }
    state.last_request_id = result.request_id;
    state.last_request_at = new Date().toISOString();
    saveProject(projectKey, state, env);

    const c = result.commercial;
    const receipt = 'Receipt: ' + c.billable_units + ' turn · ' + dollars(c.charge_micro_usd) + ' · ' + c.settlement + ' · request ' + result.request_id
      + ' · session ' + result.session_id + ' · kind of help ' + result.receipt.posture + ' · turn ' + result.receipt.turn_index;
    const charge = catalog.mode === 'live'
      ? 'Charged: ' + dollars(c.charge_micro_usd) + '.'
      : 'Test mode: this turn used 1 of your workspace\'s free test attempts' + (c.billable_units === 0 ? ' unless the safety check made it free' : '') + '.';
    return out([replyText(result), receipt, charge, 'Test learner: ' + state.learner_id + '. Test turns this server has sent: ' + budget.sent + ' of ' + cap.limit + '.'].join('\n'), false, {
      outcome: 'confirmed',
      conversation: result.conversation,
      display: result.display,
      safety: result.safety,
      receipt: { request_id: result.request_id, session_id: result.session_id, learner_id: state.learner_id, posture: result.receipt.posture, turn_index: result.receipt.turn_index, billable_units: c.billable_units, charge_micro_usd: c.charge_micro_usd, settlement: c.settlement },
      mode: catalog.mode,
    });
  });

  server.registerTool('learn_lookup_request', {
    title: 'Look up a Learn request',
    description: 'Look up a Learn request by its request id (GET /v1/requests/<id>), as this project\'s test learner. Free: it never generates a reply. '
      + 'Use it after a test turn that was not confirmed, before sending anything again. It returns the committed reply word for word, or says the request is still running or unavailable. '
      + 'Show a committed reply exactly as written.',
    inputSchema: z.object({
      request_id: z.string().min(1).max(200).describe('The request id from the test turn (req_...).'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ request_id }) => {
    const s = settings(env);
    if (!s.key) return out(noKey());
    const { state } = loadProject(s.base, s.assignment, env);
    let r: Lookup;
    try {
      r = await lookupRequest(s, state.learner_id, request_id.trim());
    } catch (error) {
      const e = error as LearnError;
      if (e.status === 401) {
        return out('401: nothing to look up. A lookup finds only a request Learn accepted, read with the same key, assignment and test learner. A request refused at the door was never accepted: nothing was charged.', true);
      }
      if (e.code === 'REQUEST_FAILED') return out('409 REQUEST_FAILED: the request failed and was not charged. A new request for the same message is allowed; this tool does not send one on its own.', true);
      return out(explain(e), true);
    }
    if (r.status !== 'committed') {
      return out(r.status === 'in_progress'
        ? 'The request is still running (in_progress). Look it up again shortly. Do not send the message again.'
        : 'The result is unavailable. That is not a confirmed failure, and not permission to send the message again; check Usage in the developer console.');
    }
    const c = r.commercial;
    return out([replyText(r), 'Receipt: ' + c.billable_units + ' turn · ' + dollars(c.charge_micro_usd) + ' · ' + c.settlement + ' · request ' + r.request_id + ' · session ' + r.session_id + (r.receipt ? ' · kind of help ' + r.receipt.posture : ''),
      'This is the original result, read again: no new turn and no new charge.'].join('\n'), false, { outcome: 'committed', conversation: r.conversation, display: r.display, safety: r.safety, request_id: r.request_id, session_id: r.session_id, billable_units: c.billable_units, charge_micro_usd: c.charge_micro_usd, settlement: c.settlement });
  });
}
