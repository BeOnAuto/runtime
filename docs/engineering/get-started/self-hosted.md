# Build your first playbook with your agent

This guide uses a local checkout. You need a terminal to start the runtime, but your agent creates the definitions and runs them through MCP.

You need [pnpm](https://pnpm.io/installation), for example from `curl -fsSL https://get.pnpm.io/install.sh | sh -`. In this repository pnpm switches itself to the version the repository pins, 12.11.2, and runs every script on the Node.js it pins, 26.11.1, which it downloads on the first `pnpm install`; the Node.js on your machine does not matter.

```bash
git clone https://github.com/BeOnAuto/runtime.git
cd runtime
pnpm install
cp .env.example .env
```

Before `pnpm dev`, uncomment one line of `.env` and put your key in it:

| Provider                     | In `.env`                                 | A model to name               |
| ---------------------------- | ----------------------------------------- | ----------------------------- |
| Anthropic                    | `ANTHROPIC_API_KEY=<your key>`            | `anthropic/claude-sonnet-4-5` |
| OpenAI                       | `OPENAI_API_KEY=<your key>`               | `openai/gpt-5`                |
| Google                       | `GOOGLE_GENERATIVE_AI_API_KEY=<your key>` | `google/gemini-2.5-flash`     |
| An OpenAI-compatible gateway | `GATEWAY_API_KEY=<your key>`              | `gateway/<model>`             |

A gateway also needs its address, which goes in the [configuration file](../../self-host/configuration.md):

```bash
cp auto-runtime.example.yaml auto-runtime.yaml
```

Then put your gateway's `base_url` in `auto-runtime.yaml`. Start the configured runtime:

```sh
pnpm dev
```

`pnpm dev` starts the server, which runs workflows itself, on `http://localhost:5555`, in local mode, with nothing to set. Once it is up, it says so:

```text
10:42:44.130 INFO  [dev] Auto Runtime is ready
  server     http://localhost:5555
  models     anthropic
  MCP        http://localhost:5555/mcp
```

Next, connect your AI assistant to `http://localhost:5555/mcp`. The server is in [local mode](../../self-host/security.md#local-mode), so it connects without signing in:

- **Claude Code**: `claude mcp add --transport http auto-runtime http://localhost:5555/mcp`
- **Cursor**, in `.cursor/mcp.json` or `~/.cursor/mcp.json`: `{"mcpServers": {"auto-runtime": {"url": "http://localhost:5555/mcp"}}}`
- **VS Code**, in `.vscode/mcp.json`: `{"servers": {"auto-runtime": {"type": "http", "url": "http://localhost:5555/mcp"}}}`
- **Other assistants** take the entry under [Connecting an agent over MCP](../reference/mcp.md), without its header.

Local mode trusts every request on your machine as the local developer, needs no key, and keeps the playbooks an agent makes in the org `local`; the scripts and the HTTP walkthrough below use it. To sign people in through the Auto identity service instead, put `PUBLIC_URL=http://localhost:5555` in `.env`: the server restarts, and the first time your assistant connects it opens the identity service in your browser, where you sign in and choose your organization.

You can begin by asking: "Given what you know about my work, suggest a small reusable function we could build in Auto. Tell me what information it needs before creating anything." For a concrete first run, follow the example below.

Name a model your provider serves, such as `anthropic/claude-sonnet-4-5` or `gateway/<a model id your gateway serves>`. The assistant learns which providers the server has, but not which models your account offers.

1. "Create a playbook called support for our customer support team."
2. "In support, create a reasoning function that classifies a support ticket by category (billing, bug, account or other) and urgency (low, normal or high), answering in JSON. Configure its prompt to follow those criteria, and run it on: I was charged twice for March and nobody has answered for three days."
3. "How many tokens did that run use, and what exactly was sent to the model?"
4. "Change the prompt so that anything about money is billing and at least normal urgency, then run it on the same ticket again."
5. "Build a workflow that classifies a ticket and, only when it is urgent, drafts a two-sentence note for the on-call lead. Run it on that ticket and on: How do I export my invoices as CSV?"
6. "Create a demonstration workflow that waits for an approval event. Run it and send it a sample approval. Do not issue a refund or contact anyone."

Each tool's description explains the supported definition format. This example drafts outputs and tests a waiting workflow; it does not install a support-system connector or execute a refund.

To reuse your first function, ask another question in a new conversation connected to the same runtime. For a shared deployment, use a persistent container and scoped API keys. Local mode is only for your own machine; do not expose it to colleagues through a proxy. See [Run with Docker](../../self-host/docker.md) and [Authentication and security](../../self-host/security.md).

To try it without an assistant, in local mode, `scripts/try-reasoning.sh http://localhost:5555 <provider/model>` and `scripts/try-workflows.sh http://localhost:5555 <provider/model>` run a reasoning function and a workflow over HTTP and print what happened. [How it works](../reference/http-tutorial.md) walks through the same steps.
