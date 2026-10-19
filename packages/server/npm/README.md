# Auto Runtime

Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them. [Auto Studio](https://studio.on.auto) lets you inspect and manage them.

## Connect your agent

It needs Node.js 26.10 or later, with its `npx`, on macOS or Linux.

<!-- x-release-please-start-version -->

Add Auto Runtime to your agent as an MCP server that runs `npx -y @on.auto/runtime@0.12.0 mcp`, the release this README comes with, such as:

```bash
claude mcp add auto-runtime -- npx -y @on.auto/runtime@0.12.0 mcp
codex mcp add auto-runtime -- npx -y @on.auto/runtime@0.12.0 mcp
```

<!-- x-release-please-end -->

When your agent connects, the command starts Auto Runtime in the background if it is not running yet, and relays your agent to it. The runtime it starts keeps running after your agent leaves, so the workflows it runs carry on and other agents reach the same one. It reads its settings from `~/.auto-runtime/.env`, where you put a model provider's key, such as `ANTHROPIC_API_KEY`, and writes its log to `~/.auto-runtime/runtime.log`. When no model provider is set up, your agent is told which file the key goes in and how to restart the runtime once it is there.

## Start it yourself

```bash
npx @on.auto/runtime
```

The server starts at `http://localhost:5555` in local mode: no one signs in, and every request on your computer acts as you, the local developer, in the org `local`. Do not expose it through a tunnel or public proxy. Its MCP endpoint is `http://localhost:5555/mcp`; connect Claude Code with:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

To sign people in through the Auto identity service instead, set `PUBLIC_URL=http://localhost:5555`: the first time it connects, your agent then opens the sign-in page in your browser.

In local mode, `http://localhost:5555` shows which release runs, in which process, since when and from which directory, with buttons that restart and stop it, and `http://localhost:5555/studio/` is Studio, which the runtime serves itself, since a page on a public address may not reach an address on your machine: it fetches Studio from Auto's Studio host, `STUDIO_ORIGIN`, and keeps its files in `~/.auto-runtime/auto-runtime-studio`. `SERVE_STUDIO=false` turns it off.

## Configure it

Settings are environment variables. The command reads them from the shell and from a `.env` file in the current directory, and the shell wins. To run reasoning functions, give it a model provider's key, such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. Settings that are lists or maps, such as model gateways and tool servers, go in `auto-runtime.yaml` in the current directory; `auto-runtime.example.yaml` in this package shows every one.

The command shows only the server's errors; set `LOG_LEVEL=warn` to see its warnings too, or `LOG_LEVEL=info` to see everything it logs.

The ledger, where playbooks and their runs are kept, is the SQLite file `~/.auto-runtime/ledger.db` unless `LEDGER_FILE` names another file or `DATABASE_URL` names a PostgreSQL database. The secrets it keeps are sealed under the key in `secrets.key` beside the ledger file, which the command makes at its first start, unless `SECRETS_KEY` gives one, as a ledger in PostgreSQL needs. `PORT` changes the port.

## Commands

```bash
npx @on.auto/runtime                # start the server (also: start)
npx @on.auto/runtime mcp            # relay an agent over standard input and output, starting the server in the background
npx @on.auto/runtime status         # show the server running on this computer
npx @on.auto/runtime restart        # restart it
npx @on.auto/runtime stop           # stop it
npx @on.auto/runtime key --org acme # issue an API key for a machine or a pipeline
npx @on.auto/runtime --version
npx @on.auto/runtime --help
```

`status`, `restart` and `stop` control a server in local mode; one that signs people in or takes keys offers no control.

## Run it in a container

The same release is the image `onauto/runtime` on Docker Hub. See [Run with Docker](https://on.auto/docs/self-host/docker).

## License

Auto Runtime is source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE). [LICENSING.md](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md) explains the terms.
