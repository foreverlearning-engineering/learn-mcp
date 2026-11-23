# Learn API for coding assistants

Give your coding assistant the Learn API's own guide, contract and verified Build with Learn kits, plus a test turn with your own key.

`@foreverlearning/learn-mcp` is an MCP server. Ask your assistant to "add a tutor to this app", and it can read how the Learn API works, follow a kit whose prompt we verify before we publish it, and send one test turn with your key to show you Learn's reply.

## What your assistant gets

| Tool | Needs your key | What it does |
| --- | --- | --- |
| `learn_kits`, `learn_kit` | no | The Build with Learn kits: each kit's prompt word for word, what the finished app should show, and its finished checkpoint folder. |
| `learn_guide` | no | The Learn integration guide, whole or by topic, and its runnable examples. |
| `learn_contract` | no | The OpenAPI contract: every operation, or one operation with its schemas filled in. |
| `learn_starter_file` | no | One file of a kit's checkpoint folder in `learn-tutor-starter` (MIT). |
| `learn_test_turn` | yes | One real test turn, with the cost stated first and your agreement required. |
| `learn_lookup_request` | yes | Looks up a turn by its request id. Free. |

It also offers two prompts, `first-tutor` and `embed-learn` (the verified prompts for "Your first tutor in ten minutes" and "Embed Learn in your app"), and the guide, contract, examples and kit files as resources.

## Before you start

- Node 24 or later.
- For test turns: a developer workspace with Learn and a server key from **My APIs** in the [developer console](https://developers.foreverlearning.ai/console). The docs tools need no key.

Put your key in your environment, not in a config file you commit:

```sh
export FOREVERLEARNING_API_KEY=...        # your server key
export FOREVERLEARNING_BASE_URL=https://developers-api.foreverlearning.ai/v1
# export FOREVERLEARNING_ASSIGNMENT_ID=... # only if your key has more than one Learn assignment
```

To test on staging, set `FOREVERLEARNING_BASE_URL=https://developers-api-staging.foreverlearning.ai/v1`.

## Install

The server reads the key from the environment it starts in. Each tool below passes your environment's variables through to it.

### Claude Code

```sh
claude mcp add learn -- npx -y @foreverlearning/learn-mcp
```

On Windows (not WSL), wrap `npx`: `claude mcp add learn -- cmd /c npx -y @foreverlearning/learn-mcp`.

To share it with your team in the project's `.mcp.json`, without the key:

```json
{
  "mcpServers": {
    "learn": {
      "command": "npx",
      "args": ["-y", "@foreverlearning/learn-mcp"],
      "env": {
        "FOREVERLEARNING_API_KEY": "${FOREVERLEARNING_API_KEY}",
        "FOREVERLEARNING_BASE_URL": "${FOREVERLEARNING_BASE_URL:-https://developers-api.foreverlearning.ai/v1}"
      }
    }
  }
}
```

### Codex

```sh
codex mcp add learn -- npx -y @foreverlearning/learn-mcp
```

Then let the variables through, in `~/.codex/config.toml`:

```toml
[mcp_servers.learn]
command = "npx"
args = ["-y", "@foreverlearning/learn-mcp"]
env_vars = ["FOREVERLEARNING_API_KEY", "FOREVERLEARNING_BASE_URL", "FOREVERLEARNING_ASSIGNMENT_ID"]
```

### Cursor

In `.cursor/mcp.json` (this project) or `~/.cursor/mcp.json` (every project):

```json
{
  "mcpServers": {
    "learn": {
      "command": "npx",
      "args": ["-y", "@foreverlearning/learn-mcp"],
      "env": {
        "FOREVERLEARNING_API_KEY": "${env:FOREVERLEARNING_API_KEY}",
        "FOREVERLEARNING_BASE_URL": "${env:FOREVERLEARNING_BASE_URL}"
      }
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`, VS Code asks for the key once and keeps it out of the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "learn-key", "description": "Learn API server key", "password": true }
  ],
  "servers": {
    "learn": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@foreverlearning/learn-mcp"],
      "env": {
        "FOREVERLEARNING_API_KEY": "${input:learn-key}",
        "FOREVERLEARNING_BASE_URL": "https://developers-api.foreverlearning.ai/v1"
      }
    }
  }
}
```

### Any other MCP client

Run `npx -y @foreverlearning/learn-mcp` as a stdio server, with `FOREVERLEARNING_API_KEY` and `FOREVERLEARNING_BASE_URL` in its environment.

### Docs only, no key

`npx -y @foreverlearning/learn-mcp --docs-only` serves the docs tools and sends no turns. `learn-mcp --http --port 8787` serves the same over Streamable HTTP at `http://127.0.0.1:8787/mcp`.

## Test turns: what they cost

- **Test mode:** each test turn uses one of your workspace's 20 free test attempts. They last for the life of the workspace, are shared by all its keys, and never reset. A turn that fails after it is sent also uses one.
- **Live mode:** 5¢ per turn that succeeds, from your balance. A turn that fails costs nothing. The server refuses a live key unless you tell your assistant to use it.
- **Before every turn**, your assistant shows you the cost and asks. Where your coding tool supports it, you also confirm in a dialog.
- **At most 2 test turns** each time the server starts. Set `LEARN_MCP_MAX_TURNS` (up to 10) for more.
- **One test learner per project.** The server keeps one pseudonymous learner and one session for each project folder, so repeated testing adds no new learners and opens no new sessions. It never ends the session and never sends a turn twice. If a turn is not confirmed, it gives you the request id to look up, free.

Preparing a session, looking up a request and every docs tool are free.

Your assistant shows Learn's reply exactly as written: what the tutor says, and the hint to work on.

## Your key

Your key stays in your environment. The server sends it only to the Learn API, never shows it in a reply or an error, and never writes it to a file. Never paste it into a conversation.

The server keeps its test learner and session ids (never the key) in `~/.foreverlearning/learn-mcp/state.json`.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `FOREVERLEARNING_API_KEY` | none | Your server key. Without it, only the docs tools work. |
| `FOREVERLEARNING_BASE_URL` | `https://developers-api.foreverlearning.ai/v1` | The API host. |
| `FOREVERLEARNING_ASSIGNMENT_ID` | none | Your Learn assignment, if your key has more than one. |
| `LEARN_MCP_MAX_TURNS` | `2` | Test turns per server start, at most 10. |
| `LEARN_MCP_CONFIRM_DIALOG` | on | `off` skips the confirmation dialog; your assistant still asks first. |
| `LEARN_MCP_STATE_DIR` | `~/.foreverlearning/learn-mcp` | Where the test learner and session ids are kept. |
| `LEARN_MCP_PROJECT` | the folder the server starts in | Which project the test learner belongs to. |

## The docs inside

The guide, contract, examples and kits are a dated snapshot of the developer site, bundled with each release of this package. The `learn://snapshot` resource says when it was taken. The live guide is always at https://developers.foreverlearning.ai/docs/learn/.

## Develop

```sh
npm ci
npm test          # unit tests against a mocked Learn API
npm run build
node scripts/snapshot.mjs --kits <kits folder>   # refresh the docs snapshot
```

## License

MIT. See [LICENSE](LICENSE).
