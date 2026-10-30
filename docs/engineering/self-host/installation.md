# Install and run from source

Clone the public repository, then follow the [first-playbook guide](../get-started/self-hosted.md) to install dependencies, configure a model and connect your agent.

```sh
git clone https://github.com/BeOnAuto/runtime.git
cd runtime
pnpm install
cp .env.example .env
```

The repository pins pnpm and Node in `package.json`; pnpm downloads the required Node runtime during installation. The contributor setup and runtime use those pinned versions.

## Development server

`pnpm dev` starts the server, which runs workflows itself, and nothing else. It listens on `127.0.0.1` with neither `PUBLIC_URL` nor `API_KEYS`, so it is in [local mode](../../self-host/security.md#local-mode): every request on your machine acts as the local developer, with no sign-in. `PUBLIC_URL=http://localhost:5555` in `.env` signs people in through the Auto identity service instead. The ledger, and with it the workflows, lives in `packages/server/.data/ledger.db`, so playbooks, definitions and waiting workflows are still there after a restart; delete that directory to start over.

Saving a `.ts` file other than a test under the `src` of any package of the repository, or `packages/server/dev.env`, `.env` or the configuration file, restarts the server through its clean shutdown; a workflow waiting for an event or a timer goes on after the restart, and a call cut off by it runs again. A server that does not start says why and starts again on the next save. Ctrl-C stops it.

`pnpm dev` signals only the server it started, through that process's own handle, never a process group or a process number, and waits for it to end. When `pnpm dev` itself is killed, the server sees the pipe from it close and stops the same way. Two things follow: the processes the server starts, such as the processes of its `stdio` tool servers, are stopped by the server as it shuts down, not by `pnpm dev`; and a `pnpm dev` killed while the server is still loading, before it listens for stop signals, leaves that server running.

`packages/server/dev.env` sets `LOG_FORMAT=pretty`, so the logs read as lines of text; lines from `pnpm dev` itself are marked `[dev]`.

For a packaged deployment, see [Run with Docker](../../self-host/docker.md).
