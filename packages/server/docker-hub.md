# Auto Runtime

Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them. Your coding agent connects over MCP to build and run them, and [Auto Studio](https://studio.on.auto) lets you inspect and manage what it built.

**[Documentation](https://on.auto/docs/)** · **[Self-hosting guides](https://on.auto/docs/self-host)** · **[Source on GitHub](https://github.com/BeOnAuto/runtime)** · **[Release notes](https://github.com/BeOnAuto/runtime/releases)**

## Quick start

A person signs in through the Auto identity service, and the runtime needs only the address it is reached at, `PUBLIC_URL`. Put it in a file of settings, and start the server with its port published on this machine's loopback address and a volume for its ledger:

```bash
echo 'PUBLIC_URL=http://localhost:5555' > auto-runtime.env
docker volume create auto-runtime-data
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  docker.on.auto/onauto/runtime:latest
curl http://localhost:5555/health
```

Then connect your agent to `/mcp`, for example in Claude Code, and sign in when it opens the Auto identity service in your browser:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

**[Run with Docker](https://on.auto/docs/self-host/docker)** walks through each step, adds a model provider, gives a machine or a pipeline an API key and has a Compose file that runs the runtime beside PostgreSQL.

## What a deployment needs

| Need           | What to use                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ledger     | A volume on `/data`, where it keeps a SQLite file, or a PostgreSQL database named by `DATABASE_URL`: [Use PostgreSQL](https://on.auto/docs/self-host/postgresql) |
| Secrets key    | `SECRETS_KEY`, 32 random bytes in base64 that seal the secrets kept in the ledger: [Deploy for your team](https://on.auto/docs/self-host/production)             |
| Sign-in        | `PUBLIC_URL`, the public `https` address people reach the runtime at: [Deploy for your team](https://on.auto/docs/self-host/production)                          |
| API keys       | `API_KEYS`, for machines and pipelines, with an entry for each key the key command makes: [Authentication and security](https://on.auto/docs/self-host/security) |
| A model        | Anthropic, OpenAI, Google, Amazon Bedrock, Azure OpenAI, Vertex AI or your own gateway: [Model providers and gateways](https://on.auto/docs/self-host/models)    |
| HTTPS          | A reverse proxy or load balancer in front of port `5555`: [Deploy for your team](https://on.auto/docs/self-host/production)                                      |
| Object storage | Optional, an S3-compatible bucket for large content: [Keep content on object storage](https://on.auto/docs/self-host/object-storage)                             |

Every setting is an environment variable; The [configuration reference](https://on.auto/docs/self-host/configuration) lists them all, with the configuration file for tool servers, gateways and model aliases. [Troubleshooting](https://on.auto/docs/self-host/troubleshooting) covers the common problems.

Pull the image through `docker.on.auto/onauto/runtime`: it is this same image, and [Scarf](https://scarf.sh) counts each pull for Auto. When it starts, the runtime sends one anonymous usage ping: its version, platform, processor, Node.js version, that it runs from the image, and a random install id kept on the `/data` volume, never anything of its work. `DO_NOT_TRACK=1` turns it off. [Usage ping](https://on.auto/docs/self-host/configuration#usage-ping) lists exactly what it sends.

## Tags

| Tag                      | Points to                              |
| ------------------------ | -------------------------------------- |
| `X.Y.Z`, such as `0.9.1` | Exactly that release; it never changes |
| `X.Y`, such as `0.9`     | The newest release of that line        |
| `latest`                 | The newest release                     |

Every tag is published for `linux/amd64` and `linux/arm64`, built in GitHub Actions with a software bill of materials and provenance. The image runs as the unprivileged user `node`, checks its health at `/health` and stops cleanly on `SIGTERM`.

## Without Docker

`npx @on.auto/runtime` runs the same server on macOS or Linux with Node.js 26.10 or later, on `http://localhost:5555`, in local mode, where every request on that computer acts as you, with no sign-in. See the [local quick start](https://on.auto/docs/get-started/local).

## License

Source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE).

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.on.auto/a.png?x-pxid=0d7debcd-ffc1-4bad-8a19-78a38c6bcd57&page=dockerhub-description" alt="" width="1" height="1" />
