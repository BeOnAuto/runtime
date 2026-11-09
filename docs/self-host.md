---
title: Self-host the source-available Auto Runtime
description: Run Auto Runtime, source-available under the Elastic License 2.0, on your own infrastructure from its container image or npm package. See what runs where.
---

# Self-host Auto Runtime

Auto Runtime is the software that stores and runs playbooks, with their functions and workflows, and keeps the record of every run. It is source-available under the Elastic License 2.0, and it can run on infrastructure your organization controls, including on-premises.

Self-hosting is for an organization that wants its playbooks and runs on its own systems. Its team operates the deployment and manages its storage, model providers, upgrades and backups. If you would rather not operate it, hosted Auto (Auto Cloud) runs Auto Runtime for you. [Connect your agent](get-started/cloud.md) to start, with nothing to install and no model key.

## What runs where

| Part                        | Where it is                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto Runtime and its ledger | Your infrastructure. The ledger, the record of every playbook, definition and run, is a SQLite file or a PostgreSQL database                                  |
| Model providers             | Your own provider accounts or gateways, which reasoning functions call                                                                                        |
| Auto Studio                 | `https://studio.on.auto`, which calls your runtime from your browser, as you                                                                                  |
| Sign-in                     | The Auto identity service, the same one Studio uses. Machines and pipelines use API keys instead                                                              |
| License reporting           | With a key, the runtime reports its id and how many runs it admitted, every hour, and never what a run or a playbook holds. Without a key, it reports nothing |

Each time it starts, the runtime also sends an anonymous [usage ping](self-host/configuration.md#usage-ping), which `DO_NOT_TRACK=1` turns off.

## Install Auto Runtime

Every release ships in two forms, and both run the same server:

- **The container image** `docker.on.auto/onauto/runtime`, from Docker Hub, for `linux/amd64` and `linux/arm64`. Each release is tagged with its exact version, so you can pin one and upgrade on purpose. [Run with Docker](self-host/docker.md) starts it.
- **The npm package** `@on.auto/runtime`, whose command is `auto-runtime`. It needs Node.js 26.10 or later, on macOS or Linux. It runs Auto Runtime on a server for your team or on your own computer. On your own computer it can run in local mode, where nobody signs in; [Run Auto on your computer](get-started/local.md) sets that up.

A deployment for a team adds HTTPS in front, a durable ledger, keys for machines and a plan for upgrades. [Deploy for your team](self-host/production.md) covers each one.

## Settings and `auto-runtime.yaml`

Every setting is an environment variable. Lists and maps, such as model gateways and tool servers, can also go in the configuration file `auto-runtime.yaml`. The npm package reads it from the folder it starts in, and the image reads it when `CONFIG_FILE` names it. The [configuration reference](self-host/configuration.md) lists every setting.

## What the license allows

Auto Runtime is source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE) (ELv2). It is not open source in the OSI sense, because ELv2 restricts offering the software as a managed service. You can:

- read, build and modify the source;
- run it on your own infrastructure, in development and in production;
- create playbooks with it for your own business, or for clients who run them in their own environments;
- redistribute it, modified or not, with the license terms and a note of what you changed.

You can't offer it to third parties as a hosted or managed service, get around its license key, or remove its notices. [LICENSING.md](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md) explains the terms in plain language, beside the source in [BeOnAuto/runtime](https://github.com/BeOnAuto/runtime).

A self-hosted runtime counts runs and nothing else. Without a key it runs 100 free runs, then up to 15 a UTC day and 75 a UTC month. With a free license key, which an admin of an organization gets in Auto Studio, each run spends one of the organization's credits. When it has no credits to spend, or loses touch with Auto for four weeks, it runs at the free rate again. [License a self-hosted runtime](self-host/licenses.md) gives the steps, and [Pricing](https://on.auto/pricing) lists each plan's credits.

## Plan a deployment with Auto

[Get in touch](https://on.auto/contact-us) to discuss your requirements and plan the deployment. Tell us where it needs to run, which systems it must reach, and any requirements for data handling or network access. We can work through licensing, support and Enterprise terms with you.

## Self-hosting guides

| Guide                                                                                                          | What it covers                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [Run with Docker](self-host/docker.md)                                                                         | Start the image, connect your agent and sign in        |
| [Deploy for your team](self-host/production.md)                                                                | HTTPS, a durable ledger, keys, a standby and upgrades  |
| [Configuration reference](self-host/configuration.md)                                                          | Every setting and the configuration file               |
| [Authentication and security](self-host/security.md)                                                           | Sign-in, API keys, local mode and opening Studio       |
| [License a self-hosted runtime](self-host/licenses.md)                                                         | Register a runtime and activate its key                |
| [Self-hosted licensing reference](self-host/licensing.md)                                                      | What is counted, the free rate and offline credits     |
| [Set up a model provider](self-host/models.md) and the [model settings reference](reference/model-settings.md) | Providers, gateways, aliases and allowed models        |
| [Use PostgreSQL](self-host/postgresql.md)                                                                      | The ledger in PostgreSQL, for one server or several    |
| [Keep content on object storage](self-host/object-storage.md)                                                  | Large content, such as tool results, in an S3 bucket   |
| [Keep secrets in your secret manager](self-host/secret-manager.md)                                             | Secrets in AWS Systems Manager Parameter Store         |
| [Workflow storage and failover](self-host/workflows.md)                                                        | How workflows run, and how a standby takes them over   |
| [Add a tool server](self-host/tool-servers.md)                                                                 | The tools of a server you set up                       |
| [Let people add connections](self-host/connections.md)                                                         | Connections people add, and the rules you set for them |
| [Send telemetry](self-host/telemetry.md)                                                                       | Traces, metrics and logs over OpenTelemetry            |
| [Troubleshooting](self-host/troubleshooting.md)                                                                | Symptoms, causes and fixes                             |
