# Conversations API for coding assistants (MCP server)

Put a conversation practice room inside your product with the **Conversations API**, with your coding assistant's help. This MCP server gives the assistant the API's own developer documentation: the integration guide and its runnable examples, the OpenAPI contract, and the **Build with Conversations** kits. Every answer is the published text itself, so the assistant builds from what the API actually does.

The Conversations API runs the practice room: one to five characters who respond in character and to the whole conversation, a Coach that answers with every turn in its own channel, a safety status on every turn, and a debrief and Insights after. The complete reply comes back to your application.

## Install

Any MCP client that starts a stdio server:

```sh
npx -y @foreverlearning/conversations-mcp
```

The docs tools need no key. To let your assistant send a test turn, give the server your own key in its environment:

| Setting | What it is |
| --- | --- |
| `FOREVERLEARNING_API_KEY` | Your Conversations API server key, from My APIs in the developer console. Never paste it into a conversation. |
| `FOREVERLEARNING_ASSIGNMENT_ID` | Your Conversations API assignment id, from My APIs. Every request names it. |
| `FOREVERLEARNING_BASE_URL` | The API host: production `https://developers-api.foreverlearning.ai/v1` (the default) or staging `https://developers-api-staging.foreverlearning.ai/v1`. |
| `CONVERSATIONS_MCP_MAX_TURNS` | Test turns per server run: 2 by default, 10 at most. |
| `CONVERSATIONS_MCP_CONFIRM_DIALOG` | `off` skips the confirmation dialog (the assistant still asks in the conversation). |

Run `conversations-mcp --docs-only` for the docs alone, with no key read at all.

## Tools

| Tool | What it does |
| --- | --- |
| `conversations_kits` | The Build with Conversations kits: verified prompts for coding assistants, from a first practice room to embedding one in your app. |
| `conversations_kit` | One kit: where to run it, its verified prompt word for word, what you should see, and its finished checkpoint folder. |
| `conversations_starter_file` | One file of a kit's finished checkpoint in `conversations-room-starter` (MIT). |
| `conversations_guide` | The integration guide, whole or by topic (`setup`, `turns`, `characters`, `reads`, `voice`, `privacy`, `pricing`), or a runnable example. |
| `conversations_contract` | The operations a Conversations integration uses, one operation or schema definition with its references filled in, or a whole contract file. |
| `conversations_test_turn` | One real test turn with your key: the room's opening, or one message. It states the cost first and sends only on your confirmation; on a production host it also needs `allow_live`, since it cannot tell a test key (free attempts) from a live one (real money). At most 2 a run. It never retries and never ends the session. The reply comes back exactly as written: each character's line, the Coach's note, the safety status and the receipt. |
| `conversations_lookup_request` | Look up a turn that was not confirmed, by its request id. No charge. |

Resources: `conversations://guide`, `conversations://guide/{topic}`, `conversations://contract/{file}`, `conversations://examples/{file}`, `conversations://snapshot`.

## Cost

The docs tools cost nothing. A test turn is a real turn. On a test assignment it uses one of your workspace's fifty free text attempts and no money; on a live assignment it is 3¢ per text turn from your workspace balance; on staging it uses staging credit, never real money. The app you build pays per turn too: 3¢ per text turn, with every character and the Coach included, and +5¢ for spoken responses. The opening and the closeout are billable turns, and a user's open session is closed, with its closeout, when their next session is opened. Preparing a room and reading saved practice, debriefs and Insights add no charge.

## Docs snapshot

The docs are bundled as a dated snapshot (`snapshot/conversations-docs.json`), read from https://developers.foreverlearning.ai. A kit is included only when it is verified on the release developers use and its page carries the same prompt word for word.

## License

MIT
