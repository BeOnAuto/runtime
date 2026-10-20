# Deploy for your team

Auto Runtime is in early development and is not ready for production use; see [Availability](../concepts/functions.md#availability). Your team can still run it today, and you can rely on these behaviors:

- Auto keeps every playbook, definition, run and its history in its ledger, with the workflows that wait on timers and events. On a durable volume or database, all of it survives a restart, and a new version migrates it when it starts.
- Backups are yours to run: copy the volume, or rely on your database's own backups.
- One server runs the workflows at a time. If it stops or dies, a standby that shares its database takes them over within about three seconds.

A deployment for a team is the container from [Run with Docker](docker.md), with the additions below.

| Add                                    | Section                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| HTTPS in front, and `PUBLIC_URL`       | [Put HTTPS in front](#put-https-in-front)                                                   |
| A key for each machine                 | [Give every client its own key](#give-every-client-its-own-key)                             |
| A durable ledger                       | [Keep the ledger durable](#keep-the-ledger-durable)                                         |
| A key that seals the secrets           | [Keep the secrets key](#keep-the-secrets-key)                                               |
| An always-on service                   | [Run it as an always-on service](#run-it-as-an-always-on-service)                           |
| Enough memory                          | [Plan memory](#plan-memory)                                                                 |
| One server, or a standby               | [Choose one server or a standby](#run-several-servers)                                      |
| A plan for logs                        | [Read the logs](#read-the-logs)                                                             |
| A plan for upgrades                    | [Upgrades](#upgrades)                                                                       |
| A route to models and tools, if needed | [Reach models and tools through your network](#reach-models-and-tools-through-your-network) |
| A way for people to inspect runs       | [Inspect runs on a team runtime](#inspect-runs-on-a-team-runtime)                           |

## Put HTTPS in front

The server speaks plain HTTP on `PORT` (`5555` unless set), on every interface, since `HOST` is `0.0.0.0` in the image.

1. Put a reverse proxy or a load balancer in front of it to end TLS, such as nginx, Caddy, Traefik, an ingress controller or your cloud's load balancer.
2. Keep port `5555` itself off the internet.
3. Set `PUBLIC_URL` to the proxy's public `https` address, such as `https://runtime.example.com`. [Let people sign in](security.md#let-people-sign-in) has the rules for it.

Never run a server in [local mode](security.md#local-mode) behind a proxy, which makes remote requests look local. The image runs in local mode only where you declare it with `ACCESS_MODE=local`, which belongs on your own machine alone: it listens on every interface, so without `PUBLIC_URL` or `API_KEYS` it stops at start. A web page may call the API only from Auto Studio or from an origin you list in `ALLOWED_ORIGINS`, and the runtime serves no Studio of its own, which works in local mode alone; see [Calling from a browser](security.md#calling-from-a-browser).

## Give every client its own key

People sign in and need no key. Give each machine, pipeline or agent that does not sign in its own [API key](security.md#api-keys), and keep the keys in your platform's secret store. [Revoke or rotate a key](security.md#revoke-or-rotate-a-key) covers replacing one.

## Keep the ledger durable

The ledger holds every playbook, definition, run and its history, and the workflows waiting on timers and events.

| Store                                         | Use it for                                                              | Back it up                                          |
| --------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| SQLite on a volume                            | One server. Keep the volume on durable storage                          | [Copy the volume](docker.md#back-up-and-restore)    |
| [PostgreSQL](postgresql.md)                   | A managed database with automated backups. Required for several servers | With the database's own backups                     |
| [Object storage](object-storage.md), optional | Content such as datasets and model files, kept out of the database      | [Alongside the database](object-storage.md#back-up) |

Whoever can read the database can read what the runtime recorded:

- the inputs and outputs of runs;
- the documents of workflows;
- the arguments and results of tool calls, unless a tool server's entry sets `record_content: false`.

Restrict access to the database, and to its backups, accordingly.

## Keep the secrets key

The runtime seals the secrets it keeps in the ledger's database under the secrets key, as [Secrets at rest](security.md#secrets-at-rest) describes. A container takes it from your platform's secret store, as it does the other secrets: in `SECRETS_KEY`, or in a file the platform mounts into the container, whose path `SECRETS_KEY_FILE` names; or the key stays in AWS KMS, as [Hold the secrets key in a KMS](#hold-the-secrets-key-in-a-kms) sets out. A file a setting names is read as the platform mounts it, and the file the server makes beside a SQLite ledger is its owner's alone. Either way the key is on no disk the ledger is on and in no backup of it; a ledger in PostgreSQL cannot start without one of them, and every server that shares the database takes the same key. Make one with either command, and keep a copy where your other secrets are kept. A secret sealed under a lost key cannot be read again, and the runtime keeps a key of its own under it, so a server started with another key does not start on that ledger:

```bash
openssl rand -base64 32
docker run --rm docker.on.auto/onauto/runtime:0.9.1 node --print "require('node:crypto').randomBytes(32).toString('base64')"
```

### Rotate the secrets key

To replace the key, give the old key to `SECRETS_KEY_PREVIOUS`, or the path of its file to `SECRETS_KEY_FILE_PREVIOUS`, the new key to `SECRETS_KEY` or the path of its file to `SECRETS_KEY_FILE`, and restart the server. At start it unwraps with the old key the key of each secret the old key wrapped, wraps it again under the new one, leaving the secrets themselves as they are, and logs `Secrets are kept in the ledger's database, sealed under the key <id> that SECRETS_KEY holds, and <count> sealed under the previous key were sealed again under it`, or `that the file <path> holds` for a key in a file, where the id is the new key's, the first 16 hex characters of its SHA-256. Then remove the previous key's setting and restart it again: nothing is sealed under the old key any more. With several servers, stop them all and start them with both keys, as for an [upgrade](#upgrades), since a server that still runs with the old key alone cannot read what the new key seals.

### Hold the secrets key in a KMS

The secrets key can be a key in AWS KMS instead, which wraps the key of each secret itself, so no process of yours ever holds it and every use of it is an entry in your account's trail. Set `SECRETS_KEY_KMS`, in place of `SECRETS_KEY` and `SECRETS_KEY_FILE`, to the ARN of a symmetric KMS key, or of an alias of one:

```bash
SECRETS_KEY_KMS=arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab
```

```bash
SECRETS_KEY_KMS=arn:aws:kms:eu-west-1:111122223333:alias/auto-runtime
```

The runtime asks KMS in the region the ARN names, with the credentials of the AWS default credential chain, the role of the task, the pod or the instance it runs as, as it does for [object storage](object-storage.md), and through your proxy where `NODE_USE_ENV_PROXY=1` is set. Where the setting names an alias, the server asks `DescribeKey` once at start for the key the alias names, and holds to that key until it starts again. It wraps with `Encrypt` and unwraps with `Decrypt`, each under that key and the encryption context `on.auto/runtime: secret data key`, which your trail records beside each request. The identity the container runs as needs those two actions on the key, the key itself where the setting names an alias, and `kms:DescribeKey` on it too where it names an alias:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:Decrypt"],
      "Resource": "arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab"
    }
  ]
}
```

At start, before it reads any secret, the server wraps and unwraps one key of its own with KMS and forgets it, so a key that does not exist, one that is disabled or pending deletion, and one the identity may not use stop the start, naming the setting, the key's id and the answer of KMS and never a credential, as an alias KMS does not know or will not describe does, naming the alias, such as `The secrets settings are invalid. SECRETS_KEY_KMS: The KMS key 1234abcd-12ab-34cd-56ef-1234567890ab it names could not wrap and unwrap a data key at start: The custodian of the key 1234abcd-12ab-34cd-56ef-1234567890ab refused to wrap a data key: DisabledException: key/1234abcd-12ab-34cd-56ef-1234567890ab is disabled.`; a KMS that does not answer within 10 seconds stops it too. Once started, it logs `Secrets are kept in the ledger's database, sealed under the key <id> that the KMS key <arn> holds, and 0 sealed under the previous key were sealed again under it`.

The runtime keeps no key unwrapped: it asks KMS for the key of a secret at each read, when a connection is first used in a server's process and when its tokens are renewed, and waits 10 seconds for the answer. So disabling the key, scheduling its deletion or taking the permission away ends the runtime's reading at the next read KMS refuses: a connection's first read in a process fails the call as `connection_unavailable` in KMS's words, a renewal of its tokens fails the call in the same words, both leave the connection connected, and once the key is enabled again the next call reads it. A process that already uses a connection keeps the credential it read until it stops, and a server does not start while the key is disabled.

To move secrets from a key in the environment or in a file to a key in KMS, set `SECRETS_KEY_KMS`, give the key it replaces to `SECRETS_KEY_PREVIOUS` or the path of its file to `SECRETS_KEY_FILE_PREVIOUS`, and restart once: at start the server unwraps with the old key the key of each secret, wraps it again with KMS, leaving the secrets themselves as they are, and logs how many, after which the previous setting can go:

```bash
SECRETS_KEY_KMS=arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab
SECRETS_KEY_FILE_PREVIOUS=/run/secrets/secrets-key
```

Moving back is the same with `SECRETS_KEY` or `SECRETS_KEY_FILE` and the ARN in `SECRETS_KEY_KMS_PREVIOUS`, for which the identity needs `kms:Decrypt` alone. To move to another key in KMS, restart once with the new key's ARN, or the alias once you have pointed it at the new key, in `SECRETS_KEY_KMS`, and the old key's ARN in `SECRETS_KEY_KMS_PREVIOUS`. The rotation of a key's material that KMS makes itself, on its schedule or on demand, needs nothing of the runtime, since KMS decrypts with the material that encrypted.

## Run it as an always-on service

These all run inside the server: workflows, their timers and retries, the deliveries of interaction functions, and the folding of recall views.

- Run the server as a long-lived service with a restart policy.
- Do not let your platform scale it to zero or pause it between requests. Waiting workflows stop moving until it wakes.

Health checks:

- `/health` returns `{"status":"ok"}` without a key while the server is up.
- The image declares a Docker health check on it every 30 seconds.
- On Kubernetes, point the liveness and readiness probes at `GET /health` on port `5555`.

The server stops cleanly on `SIGTERM`, usually within a second. It finishes the work it already accepted, records where its workflows are, releases its claim on them and exits. A call cut off by the stop runs again when a server next starts, except a function run that may have called tools ([Retrying under a run id](../reference/http.md#retrying-under-a-run-id)). A second `SIGTERM` or `SIGINT` ends the server at once. [Starting, stopping and restarting](workflows.md#starting-stopping-and-restarting) has the details.

## Plan memory

Size the container's memory limit from the parts you use:

| Part                                    | Memory                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The server                              | About 180 MiB idle, measured once with the arm64 image and no memory limit                                                                                                                                                                                                                                     |
| Computation and recall workers          | Up to `COMPUTATION_WORKERS` threads, 4 unless set. Each is stopped past a 256 MiB heap and has a 64 MiB stack: about 320 MiB each, 1.25 GiB for four at once                                                                                                                                                   |
| Model processes of prediction functions | Up to `PREDICTION_PROCESSES`, 4 unless set, started only when needed. Each is ended if it reserves more than `PREDICTION_PROCESS_MEMORY`, 1,280 MiB unless set. Each stays far below that: about 160 MiB before it loads a model, and about 650 MiB at the peak of walking a 64 MiB model over the widest rows |

Reasoning functions and workflows run in the server itself. Computation, recall and prediction functions add their workers and processes while they run. Watch the container's memory under your own load, and set the limit with room above the peak. The [configuration reference](configuration.md#settings) lists the settings that bound each part, with their defaults.

## Choose one server or a standby {#run-several-servers}

Run one server. With a restart policy and a durable ledger, one server is the simplest shape that keeps every operation working, since it both runs the workflows and serves every request.

Several servers can share one PostgreSQL database and one bucket, but only one of them runs the workflows at a time. The others stand by, and one takes the workflows over within about three seconds if that server stops or dies. A server standing by refuses workflow starts and `send_run_event` as `unavailable` (`503`), and nothing outside the logs says which server holds the claim. [How several servers share the workflows](workflows.md#how-several-servers-share-the-workflows) describes the claim.

So a load balancer cannot route those operations to the right server. Choose the shape by what your callers do:

| Shape                           | How to route                                                                                                    | What callers see                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One server (recommended)        | Every request to the one server                                                                                 | Every operation works while it is up. After a crash, requests fail until the restart policy brings it back                                                                                    |
| One active server and a standby | Every request to the active server. Fail over to the standby only when the active server fails its health check | Workflow starts and run events may be refused for a few seconds during a takeover, so callers retry on `503`. Everything else works on the standby at once                                    |
| Several active servers          | Requests spread over every server                                                                               | Only for callers that never start workflow runs or send run events themselves. Any other operation works on any server, but a workflow start or a run event that reaches a standby is refused |

With a standby:

- Turn off automatic failback. A server that comes back after a failover finds the claim held by the other server, and stands by, so requests routed back to it would refuse every workflow start.
- Watch the active server's log. If it warns that it is standing by, for example after it lost the database for longer than a claim lasts, the standby holds the claim. Stop the standby: the active server takes the workflows back within about a second, since it checks the claim every second by default. Then start the standby again.

## Read the logs

In the image, the server writes one JSON object per line to stderr. Each has a `level`, a `message` and the annotations of what it describes.

- Collect stderr with your platform's log driver.
- `LOG_LEVEL` sets the least level written: `debug`, `info`, `warn` or `error`. The image writes `info` and above unless set.

What to look for:

- At start, the server logs where the ledger and content are kept, the id of the key its secrets are sealed under, which model providers are configured, and the limits it runs with. It warns about anything missing.
- A setting it cannot read stops it at start, naming the setting and never its value.
- An error response with status `500` carries an incident id. The server logs that id with the error and the request's `x-request-id`, so either id finds the line; see [Troubleshooting](troubleshooting.md#error-responses).
- Workflow trouble is logged as warnings, each saying what failed and what happens next; [What the logs say](workflows.md#what-the-logs-say) lists them.

To see where requests, runs and calls of models and tools spent their time, [send telemetry to OpenTelemetry](telemetry.md). With telemetry on:

- every response carries its trace's id in `x-trace-id`;
- a line the server logs while it handles a request names that trace in `trace_id`.

## Upgrades

Pin a full version, such as `docker.on.auto/onauto/runtime:0.9.1`, and upgrade on purpose:

1. Read the [release notes](https://github.com/BeOnAuto/runtime/releases).
2. Pull the new tag. With the files from [Run with Docker](docker.md#upgrade), change the `IMAGE` line of `.env`.
3. Replace the container. The new server migrates the ledger at start.

Servers of different versions never share a database at the same time. With several servers, follow [Upgrade several servers](workflows.md#upgrade-several-servers): stop every old server before you start a new one.

## Reach models and tools through your network

The server calls model providers and the tool servers you configure.

- Behind an outbound proxy, set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`. Set `NO_PROXY` to the hosts to reach directly.
- For a private certificate authority, mount its certificate and name it with `NODE_EXTRA_CA_CERTS`.
- At each start the server also sends one anonymous [usage ping](configuration.md#usage-ping) to `get.on.auto`. Where your network blocks it, the server gives up after 3 seconds and runs on. `DO_NOT_TRACK=1` stops it.

[Set up a model provider](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) has an example.

## Inspect runs on a team runtime

People inspect the runs of a deployed runtime through their agent or in Auto Studio.

- An agent connects with sign-in, which needs `PUBLIC_URL`, or with an [API key](security.md#api-keys) that has `playbook:read`. `get_run` returns a run's status and result with its detailed record, and `list_playbook_events`, given its `run_id`, returns its steps; see [Runs](../reference/mcp.md#runs) in the MCP reference.
- In Auto Studio, each person enters the runtime's `https` address, which needs `PUBLIC_URL` set; see [Open Studio on a runtime](security.md#open-studio-on-a-runtime).

## The image

- It is built on `node:slim` for `linux/amd64` and `linux/arm64`.
- It runs as the user `node`. That user can read but not change the runtime's code. It may write only to `/data`, `/tmp`, `/var/tmp`, `/run/lock` and its home, `/home/node`.
- `tini` runs as process 1 and passes signals to the server.
- It carries no npm or npx, which the server never runs.
- Each release is built in GitHub Actions, with a software bill of materials and provenance attached.
- An [OpenVEX](https://openvex.dev) document in the image, `packages/server/container.vex.json`, names the scanner findings that do not apply to it, with the reason for each.
