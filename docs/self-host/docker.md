# Run with Docker

This guide runs Auto Runtime with Docker, the tool that runs packaged programs in isolated environments called containers. You start Auto from its image (Auto Runtime packaged to run in a container) on Docker Hub, check that it responds, connect your agent and sign in through the Auto identity service. Then you add a model provider and give a machine or a pipeline an API key.

You need Docker Engine or Docker Desktop, a terminal, and a browser on the same machine to sign in with.

## Choose a variant

The ledger is Auto's record of every playbook, definition and run. The two variants keep it in different places:

| Variant                                          | Where the ledger is kept                                | Use it when                                                                   |
| ------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [One container with a volume](#start-the-server) | A SQLite file (a database in a single file) on a volume | You want the quickest start on one machine                                    |
| [Compose with PostgreSQL](#run-with-postgresql)  | A PostgreSQL database in a second container beside it   | You want the database to take the backups, and the container to keep no files |

A volume is storage that Docker keeps apart from any container, so the ledger survives when you replace the container. Compose is Docker's tool for starting several containers from one file.

Run one variant at a time. Both publish port `5555` on this machine, so a second one cannot start while the first runs. Steps 2 and 3 apply to both.

## The image

[`onauto/runtime`](https://hub.docker.com/r/onauto/runtime) is published for `linux/amd64` and `linux/arm64`. Each release is published under three tags, the names you pull an image by:

| Tag      | Points to                                                |
| -------- | -------------------------------------------------------- |
| `0.9.1`  | Exactly that release; it never changes                   |
| `0.9`    | The newest release of the 0.9 line, moving with each fix |
| `latest` | The newest release                                       |

Pin a full version, such as `0.9.1`, so you know what is running, and upgrade on purpose. Every example on this page reads the version from one line you write in [step 1](#start-the-server). `latest` moves to each new release; use it only when you mean to run whatever is newest each time you pull.

In the image, Auto:

- listens on port `5555`;
- runs as the unprivileged user `node`;
- keeps a SQLite ledger on the volume at `/data`, unless you give it a PostgreSQL database;
- checks its own health at `/health`;
- stops cleanly on `SIGTERM`, the signal Docker sends to ask a program to stop.

## 1. Start Auto {#start-the-server}

Make a folder for Auto Runtime's files and work in it. Then choose the release, and write it to `.env`, a file of settings for the Docker commands on this page:

```bash
mkdir auto-runtime && cd auto-runtime
echo 'IMAGE=onauto/runtime:0.9.1' > .env
```

Replace `0.9.1` with the newest version on the [releases page](https://github.com/BeOnAuto/runtime/releases). Every command below takes the image from this line, so an upgrade changes only this line.

People sign in through the Auto identity service. Auto needs the address at which people reach it, `PUBLIC_URL`, and a key to seal the secrets it keeps under, `SECRETS_KEY`, 32 random bytes in base64. Put both in `auto-runtime.env`, the file that holds Auto's own settings, one `NAME=value` per line. Later steps add to it. A container needs `PUBLIC_URL` or `API_KEYS`: it listens on every interface, so without either it stops at start ([Who can call a server](security.md#who-can-call-a-server)), unless you declare local mode for yourself alone, beside a `PUBLIC_URL` on `localhost` ([On your own machine](#on-your-own-machine)). Then create a volume for the ledger:

```bash
echo 'PUBLIC_URL=http://localhost:5555' > auto-runtime.env
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env
docker volume create auto-runtime-data
```

You will start the container again each time you add a setting or upgrade. Keep the command in a small script, so every restart carries every flag. The script stops and removes the previous container, if there is one, before it starts the new one:

```bash
cat > start-runtime.sh <<'EOF'
#!/bin/sh
cd "$(dirname "$0")" || exit 1
. ./.env
if docker container inspect auto-runtime >/dev/null 2>&1; then
  docker stop auto-runtime && docker rm auto-runtime
fi
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  "$IMAGE"
EOF
chmod +x start-runtime.sh
./start-runtime.sh
```

What the script does:

- `. ./.env` reads the release you chose, so `"$IMAGE"` names it.
- `--publish 127.0.0.1:5555:5555` makes port `5555` reachable from this machine only. It publishes the port on the loopback address `127.0.0.1`, the machine's own address, which other machines cannot reach. That suits an `http` `PUBLIC_URL` ([Let people sign in](security.md#let-people-sign-in) says why). To reach Auto from other machines, follow [Put HTTPS in front](production.md#put-https-in-front).
- `--volume auto-runtime-data:/data` keeps the ledger on the named volume when the container is replaced. Without it, Docker gives each container an empty anonymous volume, and its playbooks last only as long as that container.
- `--env-file auto-runtime.env` passes the settings and secrets. Docker reads the file when it creates the container, so `docker restart auto-runtime` does not pick up a change to it. Run `./start-runtime.sh` instead.

`SECRETS_KEY` stays out of the volume, so a copy of the volume holds no secret anyone can read without it. Without `SECRETS_KEY`, Auto would make a key itself, in `secrets.key` on the volume beside the ledger, where a copy of the volume would carry it. Keep a copy of the key with your other secrets: a secret sealed under a lost key cannot be read again. Where there is no `openssl`, `. ./.env && docker run --rm "$IMAGE" node --print "require('node:crypto').randomBytes(32).toString('base64')"` makes one too.

### On your own machine, without sign-in {#on-your-own-machine}

To run Auto in a container for yourself alone, as `npx @on.auto/runtime` runs it on your computer, declare local mode instead of signing in. `ACCESS_MODE=local` takes the place of the sign-in. In a container it needs `PUBLIC_URL=http://localhost:5555`, the address your browser reaches Auto at, which Auto's links point at: the container listens on `0.0.0.0`, which a request may not name in local mode. Beside the declaration, `PUBLIC_URL` signs no one in. Keep the `--publish 127.0.0.1:5555:5555` of the script:

```bash
echo 'ACCESS_MODE=local' > auto-runtime.env
echo 'PUBLIC_URL=http://localhost:5555' >> auto-runtime.env
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env
./start-runtime.sh
```

`ACCESS_MODE=local` trusts that Docker publishes the port on `127.0.0.1` alone, so never use it with a wider `--publish`, such as `5555:5555`, which would let every machine that reaches this one act as you. The publish does not hold back the other containers on the same Docker network as Auto's: they reach its port whatever the publish says, and act as you too, so run none there that you would not let act as you.

Auto then runs in [local mode](security.md#local-mode): every request acts as you, with no credential, in the org `local`, so the second check of step 2 answers `200` and step 3 needs no sign-in. Open Studio at `http://localhost:5555/studio/`, which Auto serves itself ([Studio served by the runtime](security.md#studio-served-by-the-runtime)). `ACCESS_MODE=local` stops the start beside `API_KEYS`, beside a `PUBLIC_URL` that is not on `localhost`, `127.0.0.1` or `[::1]`, and in a container without a `PUBLIC_URL`.

## 2. Check that it responds {#check-that-it-answers}

```bash
curl http://localhost:5555/health
curl --include http://localhost:5555/v1/orgs/acme/playbooks
```

- The first returns `{"status":"ok"}` and needs no credential.
- The second is refused with `401`, since it sends no credential. Its `WWW-Authenticate: Bearer resource_metadata="http://localhost:5555/.well-known/oauth-protected-resource", scope="user:org:read org:read org:write playbook:read playbook:write"` header tells an agent where to sign you in.

`docker logs auto-runtime`, or `docker compose logs runtime` with Compose, shows what Auto read when it started, one JSON object per line:

- where the ledger is kept;
- which model providers are configured;
- the identity service people sign in through, and the audience of their tokens;
- a warning for anything missing.

If the check fails, see [Troubleshooting](troubleshooting.md).

## 3. Connect your agent and sign in {#connect-your-agent}

Agents connect to Auto's MCP endpoint, the address `/mcp`. MCP is the protocol agents use to call tools. In Claude Code:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

In Codex:

```bash
codex mcp add auto-runtime --url http://localhost:5555/mcp
```

The first time your agent connects, it opens the Auto identity service in your browser. Sign in, choose your organization, and grant the permissions on the consent screen. [What signed-in people can do](security.md#what-signed-in-people-can-do) describes what you may then do. In Claude Code, `/mcp` shows whether `auto-runtime` is connected, and offers the sign-in while it is not.

Then ask your agent to create a playbook, as [Build your first playbook](../tutorials/first-playbook.md) does. The [MCP reference](../reference/mcp.md) lists the tools, and the [HTTP API](../reference/http.md) lists the same operations over HTTP.

## 4. Add a model provider {#add-a-model-provider}

Reasoning functions need a model. Add your provider's key to `auto-runtime.env`, then replace the container so it reads the file again:

```bash
echo 'ANTHROPIC_API_KEY=<your Anthropic key>' >> auto-runtime.env
./start-runtime.sh
```

`OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` work the same way. For Amazon Bedrock, Azure OpenAI, Google Vertex AI or a gateway of your own, see [Set up a model provider](models.md).

## Keys for machines and pipelines

A machine or a pipeline does not sign in, so it needs an API key. Create one, add it to `auto-runtime.env` and replace the container as [API keys](security.md#api-keys) describes, with the image of [step 1](#start-the-server) (`"$IMAGE"` after `. ./.env`).

## Run with PostgreSQL {#run-with-postgresql}

In this variant the database holds the ledger, and Auto's container keeps nothing of its own. A Compose file runs both, with the database's data on a volume.

1. If you started the single container, stop and remove it. It holds port `5555`:

   ```bash
   docker stop auto-runtime && docker rm auto-runtime
   ```

   The PostgreSQL ledger starts empty. Playbooks kept on the volume `auto-runtime-data` stay there and are not copied.

2. If you do not have `.env` and `auto-runtime.env` from [step 1](#start-the-server), create them in a new folder. Replace `0.9.1` with the newest version on the [releases page](https://github.com/BeOnAuto/runtime/releases):

   ```bash
   mkdir auto-runtime && cd auto-runtime
   echo 'IMAGE=onauto/runtime:0.9.1' > .env
   echo 'PUBLIC_URL=http://localhost:5555' > auto-runtime.env
   echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env
   ```

   Auto takes `SECRETS_KEY` from `auto-runtime.env`, as in [step 1](#start-the-server). A ledger in PostgreSQL needs it, and Auto stops at start without it.

3. Save this as `compose.yaml` beside `auto-runtime.env`:

   ```yaml
   services:
     postgres:
       image: postgres:18
       environment:
         POSTGRES_USER: auto_runtime
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
         POSTGRES_DB: auto_runtime
       volumes:
         - postgres-data:/var/lib/postgresql
       healthcheck:
         test: ['CMD-SHELL', 'pg_isready --username auto_runtime --dbname auto_runtime']
         interval: 5s
         retries: 12
       restart: unless-stopped

     runtime:
       image: ${IMAGE}
       depends_on:
         postgres:
           condition: service_healthy
       env_file: auto-runtime.env
       environment:
         DATABASE_URL: postgresql://auto_runtime:${POSTGRES_PASSWORD}@postgres:5432/auto_runtime
       ports:
         - '127.0.0.1:5555:5555'
       restart: unless-stopped

   volumes:
     postgres-data:
   ```

4. Compose reads `IMAGE` and `POSTGRES_PASSWORD` from `.env` in the same folder. Add a generated password to it, then start both:

   ```bash
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
   docker compose up --detach
   ```

Auto waits until PostgreSQL is ready and creates its tables when it starts. `docker compose logs runtime` shows `The ledger is kept in PostgreSQL, in the database auto_runtime on postgres:5432`. Check it as in [step 2](#check-that-it-answers) and connect your agent as in [step 3](#connect-your-agent).

The Compose file holds every setting of both containers, so you never retype flags. After you change `auto-runtime.env`, such as adding a model provider's key as in [step 4](#add-a-model-provider), replace Auto's container:

```bash
docker compose up --detach --force-recreate runtime
```

[Use PostgreSQL](postgresql.md) covers a managed database, a user with only the privileges it needs, and TLS.

## Use a configuration file {#use-a-configuration-file}

Some settings are lists or maps, such as the [tool servers](configuration.md#tool-servers) functions may call, model gateways and model aliases. They can go in a YAML file. The image reads one only when `CONFIG_FILE` names it, so mount the file read-only and name it.

For the single container, add two lines to the `docker run` command in `start-runtime.sh`. The whole script becomes:

```bash
#!/bin/sh
cd "$(dirname "$0")" || exit 1
. ./.env
if docker container inspect auto-runtime >/dev/null 2>&1; then
  docker stop auto-runtime && docker rm auto-runtime
fi
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  --volume "$PWD/auto-runtime.yaml:/etc/auto-runtime/auto-runtime.yaml:ro" \
  --env CONFIG_FILE=/etc/auto-runtime/auto-runtime.yaml \
  "$IMAGE"
```

Then run `./start-runtime.sh`.

With Compose, add `CONFIG_FILE` to the `environment` of the `runtime` service, and give the service a `volumes` entry for the file. The other lines of the service stay as they are:

```yaml
services:
  runtime:
    environment:
      DATABASE_URL: postgresql://auto_runtime:${POSTGRES_PASSWORD}@postgres:5432/auto_runtime
      CONFIG_FILE: /etc/auto-runtime/auto-runtime.yaml
    volumes:
      - ./auto-runtime.yaml:/etc/auto-runtime/auto-runtime.yaml:ro
```

Then run `docker compose up --detach`, which replaces Auto's container because its definition changed.

Rules for the file:

- Secrets stay in `auto-runtime.env`. The file refers to them by name, such as `${GATEWAY_API_KEY}`.
- An `openapi` tool server whose entry in `tool_servers` names its OpenAPI document by a path reads that document at start, from the directory of the file. Mount the document there too, as `--volume "$PWD/billing.json:/etc/auto-runtime/billing.json:ro"`, or name it by an https URL the container can reach.
- A document that Auto cannot read stops the start, and the error names the entry.

The [configuration reference](configuration.md) describes the file and every setting.

## Upgrade {#upgrade}

The ledger stays on its volume or in its database, and the new version migrates it when it starts.

1. Read the [release notes](https://github.com/BeOnAuto/runtime/releases) of the new version.
2. Change the version on the `IMAGE` line of `.env`, such as `IMAGE=onauto/runtime:0.9.2`.
3. Replace the container.

For the single container, pull the new release, then run the script. It replaces the container with every flag it had:

```bash
. ./.env
docker pull "$IMAGE"
./start-runtime.sh
```

With Compose:

```bash
docker compose pull
docker compose up --detach
```

After the upgrade:

- Workflows that were waiting go on once the new version starts.
- Calls cut off by the stop run again, as [Stop](#stop) describes.
- When several servers share a database, follow [Upgrade several servers](workflows.md#upgrade-several-servers).

## Rotate the secrets key {#rotate-the-secrets-key}

To replace `SECRETS_KEY`, move its value to `SECRETS_KEY_PREVIOUS` and add a new key:

```bash
sed 's/^SECRETS_KEY=/SECRETS_KEY_PREVIOUS=/' auto-runtime.env > auto-runtime.env.next
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env.next
mv auto-runtime.env.next auto-runtime.env
```

Then replace the container: `./start-runtime.sh` for the single container, or `docker compose up --detach --force-recreate runtime` with Compose. At start Auto seals again under the new key what the old one sealed, and `docker logs auto-runtime`, or `docker compose logs runtime`, says how many: `Secrets are kept sealed under the key <id>, and <count> sealed under the previous key were sealed again under it`. Then delete the `SECRETS_KEY_PREVIOUS` line from `auto-runtime.env` and replace the container once more. [Rotate the secrets key](production.md#rotate-the-secrets-key) covers several servers.

## Back up and restore {#back-up-and-restore}

For the single container, the ledger on the volume is three files that belong together: `ledger.db`, `ledger.db-wal` and `ledger.db-shm`. Stop Auto, copy the whole volume, and start it again:

```bash
docker stop auto-runtime
docker run --rm --volume auto-runtime-data:/data:ro --volume "$PWD/backup:/backup" alpine cp -a /data/. /backup/
docker start auto-runtime
```

`docker stop` and `docker start` keep the same container, with every flag it was created with.

To restore, stop Auto, replace the three files in the volume with the copies, and start it:

```bash
docker stop auto-runtime
docker run --rm --volume auto-runtime-data:/data --volume "$PWD/backup:/backup:ro" alpine \
  sh -c 'rm -f /data/ledger.db /data/ledger.db-wal /data/ledger.db-shm && cp -a /backup/. /data/'
docker start auto-runtime
```

With PostgreSQL, use your database's own backups, or `pg_dump`. The workflows are in the same database, so one backup holds everything except content kept on [object storage](object-storage.md#back-up), which you back up alongside it. For the Compose variant:

```bash
docker compose exec -T postgres pg_dump --username auto_runtime --format custom auto_runtime > ledger.dump
```

The secrets in a backup open only under the `SECRETS_KEY` that sealed them, so a restored ledger starts with that key, which you keep apart from the backups.

## Stop

`docker stop auto-runtime`, or `docker compose stop runtime` with Compose, sends `SIGTERM`. Auto finishes the work it already accepted, records where its workflows are, and exits, usually in well under a second. Calls it cut off run again when it next starts, except a function run that may have called tools ([Retrying under a run id](../reference/http.md#retrying-under-a-run-id)). [Starting, stopping and restarting](workflows.md#starting-stopping-and-restarting) describes the stop in detail.
