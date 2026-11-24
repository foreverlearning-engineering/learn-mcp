# Conversations API for coding assistants (MCP server)

Put a conversation practice room inside your product with the **Conversations API**, with your coding assistant's help. This MCP server gives the assistant the API's own developer documentation: the integration guide and its runnable examples, the OpenAPI contract, and the **Build with Conversations** kits. Every answer is the published text itself, so the assistant builds from what the API actually does.

The Conversations API runs the practice room: one to five characters who respond in character and to the whole conversation, a Coach that answers with every turn in its own channel, a safety status on every turn, and a debrief and Insights after. The complete reply comes back to your application.

## Install

Any MCP client that starts a stdio server:

```sh
npx -y @foreverlearning/conversations-mcp
```

This version needs no key: it serves the docs only. Your app keeps its own key on its server.

## Tools

| Tool | What it does |
| --- | --- |
| `conversations_kits` | The Build with Conversations kits: verified prompts for coding assistants, from a first practice room to embedding one in your app. |
| `conversations_kit` | One kit: where to run it, its verified prompt word for word, what you should see, and its finished checkpoint folder. |
| `conversations_starter_file` | One file of a kit's finished checkpoint in `conversations-room-starter` (MIT). |
| `conversations_guide` | The integration guide, whole or by topic (`setup`, `turns`, `characters`, `reads`, `voice`, `privacy`, `pricing`), or a runnable example. |
| `conversations_contract` | The operations a Conversations integration uses, one operation or schema definition with its references filled in, or a whole contract file. |

Resources: `conversations://guide`, `conversations://guide/{topic}`, `conversations://contract/{file}`, `conversations://examples/{file}`, `conversations://snapshot`.

## Cost

The server itself costs nothing. The app you build pays per turn: 3¢ per text turn, with every character and the Coach included, and +5¢ for spoken responses. The opening and the closeout are billable turns. Preparing a room and reading saved practice, debriefs and Insights add no charge.

## Docs snapshot

The docs are bundled as a dated snapshot (`snapshot/conversations-docs.json`), read from https://developers.foreverlearning.ai. A kit is included only when it is verified on the release developers use and its page carries the same prompt word for word.

## License

MIT
