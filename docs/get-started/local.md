---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
description: Add Auto Runtime to your agent as an MCP server, and let your agent set up the rest.
---

# Run Auto on your computer

For hosted Auto, follow the [quick start](cloud.md). This page is for people maintaining a local runtime.

Add Auto to your agent as an MCP server. Your agent starts Auto on your computer when it connects, and guides you through the rest.

## Before you start

You need `npx`, which comes with [Node.js](https://nodejs.org/en/download) 26.10 or later, on macOS or Linux, and an agent that runs on your computer, such as Claude Code, Codex, Gemini CLI, Grok, Cursor or Claude Desktop.

## 1. Add Auto to your agent {#connect-your-agent}

<!-- x-release-please-start-version -->

Tell your agent:

```text
Add Auto as an MCP server named auto-runtime that runs this command:
npx -y @on.auto/runtime@0.46.0 mcp
Then reload your MCP servers.
```

Or add it yourself:

::: code-group

```bash [Claude Code]
claude mcp add -s user auto-runtime -- npx -y @on.auto/runtime@0.46.0 mcp
```

```bash [Codex]
codex mcp add auto-runtime -- npx -y @on.auto/runtime@0.46.0 mcp
```

```bash [Gemini CLI]
gemini mcp add -s user auto-runtime npx -y @on.auto/runtime@0.46.0 mcp
```

```bash [Grok]
grok mcp add -s user auto-runtime npx -- -y @on.auto/runtime@0.46.0 mcp
```

```json [Cursor, Claude Desktop]
{
  "mcpServers": {
    "auto-runtime": {
      "command": "npx",
      "args": ["-y", "@on.auto/runtime@0.46.0", "mcp"]
    }
  }
}
```

:::

<!-- x-release-please-end -->

The entry names a release of Auto. The first time your agent runs it, `npx` downloads that release from npm, and your agent keeps to it until you change the version in the entry.

Cursor reads the JSON from `~/.cursor/mcp.json`, and Claude Desktop from **Settings → Developer → Edit Config**; keep any servers already there. Then restart your agent, or start a new session, so it loads Auto.

## 2. Let your agent take it from there

Ask your agent:

```text
Use auto-runtime to list my playbooks and the models it can use.
```

The first time, Auto starts in the background. It keeps running after your agent closes, so your workflows carry on and your next session finds it ready.

Auto runs your work with an AI model of its own, so it needs an API key from a model provider: [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys) or [Google](https://aistudio.google.com/app/apikey). Your agent's subscription does not cover it. Until there is a key, your agent tells you to put one line such as `ANTHROPIC_API_KEY=` followed by your key in `~/.auto-runtime/.env`, and restarts Auto once you have saved it. Never paste the key into the conversation. For Amazon Bedrock, Azure OpenAI, Google Vertex AI or your own gateway, see [Set up a model provider](../self-host/models.md).

Once Auto lists your models, your agent offers to create your first function. Continue with [Build your first playbook](../tutorials/first-playbook.md), and later [Build your first workflow](../tutorials/first-workflow.md). To let a function look things up while it runs, see [Give a function tools](../guides/tools.md).

## See and control Auto

Open `http://localhost:5555/studio/` to see and manage your playbooks in Studio. A page on a public address may not reach an address on your computer, so Auto serves Studio itself there: it fetches Studio from Auto's Studio host and keeps it in `~/.auto-runtime/auto-runtime-studio`. [Studio served by the runtime](../self-host/security.md#studio-served-by-the-runtime) sets out how.

Open `http://localhost:5555` to see which release of Auto runs, since when and from which folder, with buttons that restart and stop it. From a terminal, `npx @on.auto/runtime status`, `restart` and `stop` do the same. Both control Auto only in local mode, which is how your agent starts it. Your work is saved in `~/.auto-runtime/ledger.db`, and Auto writes its log to `~/.auto-runtime/runtime.log`.

Each time it starts, Auto sends one anonymous usage ping to the people who make it: its version, your operating system, how you installed it and a random id for this copy, never your work, your prompts or your keys. To turn it off, put `DO_NOT_TRACK=1` in `~/.auto-runtime/.env` and restart Auto. [Usage ping](../self-host/configuration.md#usage-ping) lists exactly what it sends.

## Other ways to run Auto

- **In a terminal.** `npx @on.auto/runtime` starts Auto in the window you run it in, reading its settings from a `.env` in that folder, and shows how to connect your agent. An agent with the entry above uses it while it runs.
- **Signed in with your Auto account.** Auto on your computer runs in [local mode](../self-host/security.md#local-mode): nobody signs in, and what you make belongs to an organization called `local`. To sign in instead, start Auto in a terminal with `PUBLIC_URL=http://localhost:5555` in that folder's `.env`, and connect your agent over HTTP, such as `claude mcp add --transport http auto-runtime http://localhost:5555/mcp`. Auto then offers no restart or stop: press Ctrl+C in its terminal to stop it.
- **Your team's Auto.** Connect your agent to its address, such as `claude mcp add --transport http auto-runtime https://auto.example.com/mcp`.
- **On a server for your team.** See [Self-hosting](../self-host.md). Do not expose Auto on your computer through a tunnel or public proxy.

## If something does not work

- **Your agent cannot start Auto.** Ask it to run the entry's command with `--version` in place of `mcp`, and show you what it prints. On a Node.js older than 26.10, Auto says which version it needs: install Node.js 26.10 or later. If Claude Desktop cannot find `npx`, set `command` to its full path, which `which npx` prints.
- **No models appear.** Check the line in `~/.auto-runtime/.env`, then restart Auto. A model name that ends in `*`, such as `anthropic/*`, stands for a family of models: it is not a model to run.
- **Another program uses port 5555.** Set `PORT` to a free port in `~/.auto-runtime/.env`; both Auto and the MCP entry read it.

[Troubleshooting](../self-host/troubleshooting.md) covers more.
