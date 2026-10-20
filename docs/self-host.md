# Self-hosting overview

Auto Runtime is the software that runs your playbooks. It is one program, and every release is published in two forms:

- the container image `docker.on.auto/onauto/runtime`, from [Docker Hub](https://hub.docker.com/r/onauto/runtime), for `linux/amd64` and `linux/arm64`. An image is Auto Runtime packaged with everything it needs, which Docker or another container platform runs;
- the npm package `@on.auto/runtime`, which you start with `npx @on.auto/runtime` on a computer that has Node.js.

Both are the same software, and both run every function type and workflows. Run it on one machine with Docker, or on any platform that runs Linux containers. Auto keeps its records in a SQLite file (a database held in a single file) or in a PostgreSQL database.

Someone comfortable with a terminal installs and starts Auto Runtime once. After that, people work through their agent.

## Choose your path

1. Try it on your computer with the [local quick start](get-started/local.md). It starts Auto with `npx @on.auto/runtime` and needs no deployment plan.
2. Run one container with [Run with Docker](self-host/docker.md). It starts the image with its records on a Docker volume, connects your agent and signs you in. It also has a Compose file that runs Auto Runtime beside PostgreSQL.
3. Prepare a deployment that other people use with [Deploy for your team](self-host/production.md). It adds HTTPS, durable records, a key for each machine, memory limits, logs, upgrades and backups.

## What you need

| Need                               | Required                                                                                     | Options                                                                 | Guide                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| A place to run it                  | Yes                                                                                          | Docker, Kubernetes, Amazon ECS or another platform for Linux containers | [Run with Docker](self-host/docker.md)                        |
| Storage for the ledger             | Yes                                                                                          | A volume for a SQLite file, or a PostgreSQL database                    | [Use PostgreSQL](self-host/postgresql.md)                     |
| Sign-in, and API keys for machines | For a container: `PUBLIC_URL`, `API_KEYS` or both. `npx` runs in local mode until one is set | `PUBLIC_URL` for people, and one key for each machine or pipeline       | [Authentication and security](self-host/security.md)          |
| A model provider                   | For reasoning functions                                                                      | A provider's API key, a cloud provider, or your own gateway             | [Set up a model provider](self-host/models.md)                |
| HTTPS                              | Before anything outside the machine connects                                                 | A reverse proxy or load balancer in front of port `5555`                | [Deploy for your team](self-host/production.md)               |
| Object storage                     | No                                                                                           | An S3-compatible bucket                                                 | [Keep content on object storage](self-host/object-storage.md) |

What each row means:

- **A place to run it.** Without containers, Node.js 26.10 or later on macOS or Linux runs `npx @on.auto/runtime`.
- **Storage for the ledger.** The ledger is Auto's record of everything: playbooks, definitions, runs, their history and the workflows waiting on timers and events. A volume, storage that Docker keeps apart from the container, suits one server. PostgreSQL suits managed backups or a standby server. Back the ledger up as you would any database that people rely on.
- **Sign-in.** People sign in through the Auto identity service, the service that also signs them in to Auto Studio. `PUBLIC_URL` is the address at which they reach Auto. Machines and pipelines that sign in nowhere use an API key each, which the key command makes. With neither `PUBLIC_URL` nor `API_KEYS`, `npx @on.auto/runtime` runs in local mode: no one signs in, and every request on your computer acts as you.
- **A model provider.** Reasoning functions call a language model through a provider: Anthropic, OpenAI or Google with an API key; Amazon Bedrock; Azure OpenAI; Google Vertex AI; or a gateway of your own, a service that passes model calls on and speaks OpenAI's API.
- **HTTPS.** A reverse proxy is a web server, such as nginx or Caddy, that takes HTTPS requests and passes them on to Auto.
- **Object storage.** A bucket in Amazon S3, or in a store that works like it, keeps uploaded datasets, model files and tool content out of the database.

## Choose a setup

| Setup                      | Where the ledger is kept         | Who backs it up            | Guide                                                                                                       |
| -------------------------- | -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| One server with a volume   | A SQLite file on a Docker volume | You, by copying the volume | [Run with Docker](self-host/docker.md), the quickest start                                                  |
| One server with PostgreSQL | PostgreSQL                       | Your database service      | [Run with PostgreSQL](self-host/docker.md#run-with-postgresql) or [Use PostgreSQL](self-host/postgresql.md) |
| A server and a standby     | One shared PostgreSQL database   | Your database service      | [Choose one server or a standby](self-host/production.md#run-several-servers)                               |

One server is the recommended shape. A standby is a second server that waits and takes over the workflows if the first one stops. With several servers, only one runs the workflows, and [Choose one server or a standby](self-host/production.md#run-several-servers) explains how to route requests to it.

With PostgreSQL, the container keeps nothing of its own. [Run with PostgreSQL](self-host/docker.md#run-with-postgresql) uses Compose to run the database beside Auto Runtime; [Use PostgreSQL](self-host/postgresql.md) covers a managed database. Add [object storage](self-host/object-storage.md) when playbooks keep large datasets or model files.

## Guides

- [Run with Docker](self-host/docker.md): a first container, an agent connected and signed in, keys for machines and pipelines, and a Compose file with PostgreSQL
- [Use PostgreSQL](self-host/postgresql.md): get a database, create its user, connect over TLS, and sign in without a password on Amazon RDS
- [Keep content on object storage](self-host/object-storage.md): Amazon S3 or any S3-compatible store
- [Deploy for your team](self-host/production.md): HTTPS and the public address, keys, memory, health checks, one server or a standby, logs and upgrades
- [Authentication and security](self-host/security.md): sign-in, API keys, local mode and calls from a browser
- [Set up a model provider](self-host/models.md): choose a provider, set its credentials, and check that Auto can call a model
- [Add a tool server](self-host/tool-servers.md): give functions the tools of a business system, a program or an HTTP API, and check that Auto lists them
- [Let people add connections](self-host/connections.md): the tool servers people add to an org through their agents and approve in Studio, their credentials, and the rules you set for them
- [Workflow storage and failover](self-host/workflows.md): where runs are kept, how a server stops and restarts, and how several servers share the workflows
- [Send telemetry](self-host/telemetry.md): traces, metrics and logs over OTLP, what they record and leave out, and Grafana on your machine to read them
- [Troubleshooting](self-host/troubleshooting.md): common problems, from a busy port to error responses

The [configuration reference](self-host/configuration.md) lists every setting, the configuration file, and the tool servers functions may call. The [model settings reference](reference/model-settings.md) holds aliases, allowed and declared models, and what happens when a model call fails. The [sign-in and token reference](reference/authentication.md) sets out how Auto checks tokens and what a refused client is told.

## Plan your deployment with Xolvio

[Xolvio Professional Services](https://www.xolv.io/contact-us) can help you assess the deployment, connect your systems and establish an operating plan. Bring your requirements for data location, access, model providers and availability.

Your team will need to own:

- infrastructure and updates;
- credentials and access controls;
- persistent storage and tested backups;
- monitoring and recovery.

Workflows run inside Auto and keep their state in its database, so the database's backups cover them. Decide who can read recorded inputs and results, and which information can be sent to model providers.

Before other people rely on your deployment:

- Review [Availability](concepts/functions.md#availability).
- Agree the support requirements of the version you plan to deploy.
- Review the repository's [licensing terms](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md). Auto Runtime is source-available under the Elastic License 2.0.
