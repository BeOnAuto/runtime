# Auto Runtime

Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them. [Auto Studio](https://studio.on.auto) lets you inspect and manage them.

## Connect your agent

It needs Node.js 26.10 or later, with its `npx`, on macOS or Linux.

<!-- x-release-please-start-version -->

Add Auto Runtime to your agent as an MCP server that runs `npx -y @on.auto/runtime@0.21.1 mcp`, the release this README comes with, such as:

```bash
claude mcp add auto-runtime -- npx -y @on.auto/runtime@0.21.1 mcp
codex mcp add auto-runtime -- npx -y @on.auto/runtime@0.21.1 mcp
```

<!-- x-release-please-end -->

When your agent connects, the command starts Auto Runtime in the background if it is not running yet, and relays your agent to it. The runtime it starts keeps running after your agent leaves, so the workflows it runs carry on and other agents reach the same one. It reads its settings from `~/.auto-runtime/.env`, where you put a model provider's key, such as `ANTHROPIC_API_KEY`, and writes its log to `~/.auto-runtime/runtime.log`. When no model provider is set up, your agent is told which file the key goes in and how to restart the runtime once it is there.

While your agent is connected, the command watches each call: the runtime sends a heartbeat every 5 seconds while it works on one, and the command pings it when 15 seconds pass with none. When Auto Runtime stops, for example when you close the terminal it runs in, the next request waits up to 5 seconds for it to come back, then starts one in the background. When the runtime the command started stops answering, the command stops it and starts another, and `~/.auto-runtime/runtime.log` says what it did. A request that never reached the runtime is sent again. A tool call that may have reached it is never sent twice: once the command has made sure the runtime runs, your agent is told to look at the playbook, its definitions and its runs for whether it took effect, and whether Auto Runtime runs again or why it does not. A runtime started in a terminal or by another agent's connection, one that asks for a credential, and another program on the port are left alone, and your agent is told what to do. Your agent hears back within 45 seconds of a request the command holds, and a request it cancels meanwhile is never sent.

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

Each time it starts, Auto Runtime sends one anonymous usage ping: its version, the operating system, the processor, the version of Node.js, how it was installed and a random id for this copy, kept in `~/.auto-runtime/install-id`, never anything of your work or your keys. `DO_NOT_TRACK=1` or `USAGE_PING=false` turns it off. [Usage ping](https://on.auto/docs/self-host/configuration#usage-ping) says exactly what it sends.

The ledger, where playbooks and their runs are kept, is the SQLite file `~/.auto-runtime/ledger.db` unless `LEDGER_FILE` names another file or `DATABASE_URL` names a PostgreSQL database. The secrets it keeps are sealed under the key in `secrets.key` beside the ledger file, which the command makes at its first start, unless `SECRETS_KEY` gives one, `SECRETS_KEY_FILE` names another file or `SECRETS_KEY_KMS` names a key in AWS KMS, as a ledger in PostgreSQL needs. `PORT` changes the port.

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

The same release is the image `docker.on.auto/onauto/runtime`, from Docker Hub. See [Run with Docker](https://on.auto/docs/self-host/docker).

## Compose it in your own program

The package carries each of the runtime's packages as a subpath, so a program can compose the core itself rather than run the server. `@on.auto/runtime/ledger` is the ledger, `@on.auto/runtime/ledger/sqlite3` one of the subpaths the ledger names, and `@on.auto/runtime/ledger/testing` its testing entry. A testing entry is for your tests as it is for the runtime's: `recordedContentBehaviour` of `@on.auto/runtime/operations/testing`, the behaviour suite of the content port, runs against a store of your own. The test tools a testing entry imports are your tests' to provide.

The subpaths are the `.ts` sources the server runs, and they import one another by the packages' own names, such as `@on.auto/operations`. Where your bundler must resolve those names, alias each of them, with its subpaths, to the same subpath of `@on.auto/runtime`:

<!-- npm/pack.ts writes the alias here -->

## License

Auto Runtime is source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE). [LICENSING.md](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md) explains the terms.

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.on.auto/a.png?x-pxid=75073a78-866c-42e4-b35f-8399450f7916&page=npm-readme" alt="" width="1" height="1" />
