---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Troubleshooting

Each problem below gives the symptom, its usual cause and the fix. The first four are the ones people meet when they first start the server on their own computer.

Never paste an API key into a prompt to fix a connection. The server reads keys from its own settings.

## The health check fails or port 5555 is busy {#health-check-fails}

**Symptom.** `curl http://localhost:5555/health` does not return `{"status":"ok"}`.

**Cause.** The server did not start, or another process holds port `5555`. A server that cannot start prints `Auto Runtime could not start:` and the reason, such as `EADDRINUSE` for a port in use. In Docker, a second container on the same port fails with `port is already allocated`, and a second container with the same name fails with `is already in use`.

**Fix.**

- When your agent started Auto Runtime through its MCP entry, read `~/.auto-runtime/runtime.log` for startup errors, since the server has no terminal. Stop whatever else listens on port `5555`, or set `PORT` in `~/.auto-runtime/.env` to a free port; the entry reads it too.
- With `npx @on.auto/runtime` in a terminal, read that terminal for startup errors. Stop whatever else listens on port `5555`, or set `PORT` in the `.env` of the directory you start it in to a free port, and give your agent that port: the command the server shows when it is ready carries it.
- With Docker, run `docker logs auto-runtime` to read the startup errors. Stop and remove the earlier container before you start another with the same name or port: `docker stop auto-runtime && docker rm auto-runtime`. [Run with Docker](docker.md#start-the-server) keeps the command in a script that does this for you.

## The agent cannot connect, though `/health` responds {#agent-cannot-connect}

**Symptom.** The health check returns `{"status":"ok"}`, but your agent shows `auto-runtime` as not connected.

**Cause.** The agent has the wrong MCP entry or address, has not reloaded its connections, or runs somewhere that cannot reach your computer. A web-based connector running in the cloud cannot reach your `localhost`.

**Fix.**

- Check the agent's MCP entry. The [quick start](../get-started/local.md#connect-your-agent) gives it: the `mcp` command of `@on.auto/runtime`, run by `npx`. An agent that connects over HTTP instead, as one that signs you in does, uses `http://localhost:5555/mcp`, or the port you set.
- Restart the agent session.
- Confirm that the agent runs on the same computer as Auto Runtime.

## A call answers that Auto Runtime stopped or does not answer {#runtime-stopped-answering}

**Symptom.** Your agent's call is answered with `Auto Runtime stopped while it handled this request`, `Auto Runtime stopped answering while it handled this request`, `Auto Runtime on port 5555 does not answer`, or `Another Auto Runtime took port 5555 first`.

**Cause.** The runtime on the port ended, froze or was replaced while the call ran. The `mcp` command of the MCP entry watches each call: while the runtime works on one, it sends a heartbeat every 5 seconds, and when 15 seconds pass with none, the command pings it three times before it gives the call up.

**Fix.**

- A call answered with `may or may not have taken effect` was not sent again, so a definition never runs twice. Look at the playbook, its definitions and its runs to see whether it took effect before you repeat it. The same answer says whether Auto Runtime runs again, or why it does not.
- When the MCP entry started the runtime, it stops one that does not answer, with `SIGTERM` and then `SIGKILL`, and starts another. `~/.auto-runtime/runtime.log` says what it did.
- When the runtime was started in a terminal, or by another agent's connection, the entry leaves it alone. Stop it there, or end the process the answer names, then send the request again. The answer names a process only when the runtime still told the entry who it is after the call was lost; otherwise it says that the runtime on the port does not answer and that the entry did not start it, and you stop the program that holds the port.
- When another Auto Runtime took the port first, the one the entry started ended because the port was taken. A request that never reached a runtime, or one that is safe to send twice, goes to the runtime on the port. A call that may have taken effect is answered that another Auto Runtime took the port first: check it as above, then send it again, and it goes to the runtime on the port.
- When the answer says the runtime stopped soon after each of its last three starts, read `~/.auto-runtime/runtime.log`, fix what it says, and start your agent session again.

## A reasoning function reports `provider_not_configured` {#provider-not-configured}

**Symptom.** A run of a reasoning function fails with `provider_not_configured`, or is rejected as `unavailable` of the kind `model_not_offered` with `because: "provider_not_configured"`.

**Cause.** The definition names a provider whose settings the server did not find. The API hides missing settings and secrets from callers on purpose; the detail names only the providers that are configured.

**Fix.**

- Check which providers the server's startup log names.
- With `npx`, check the setting in `~/.auto-runtime/.env` when your agent started Auto Runtime, or in `.env` in the directory you started it in from a terminal. With Docker, check `auto-runtime.env`.
- Restart the server after you change a setting. With Docker, replace the container, since `docker restart` does not read the file again.
- Confirm the provider prefix in the definition, and that the model id is available to your account.

[Choose a provider](models.md#choose-a-provider) lists each provider's settings.

## The list of models is incomplete {#incomplete-model-list}

**Symptom.** `list_models` does not show the model you want, or shows only a wildcard such as `bedrock/*`.

**Cause.** Some providers list no models of their own, an alias can hide the models it sends elsewhere, and `allowed_models` hides every model it does not allow, which the list shows as `narrowed: true`.

**Fix.** Use a concrete model reference that your configured provider supports, such as a model id from the provider's own documentation. A wildcard such as `provider/*` is not a model to run. When the list says `narrowed: true`, a model it leaves out may be one that [`allowed_models`](../reference/model-settings.md#allowed-models) does not allow, and a definition can name it only once the setting allows it. [Listing the models](../reference/model-settings.md#listing-the-models) explains where each list comes from.

## The server says the identity service cannot be used {#identity-service}

**Symptom.** The server stops at start with an `UnusableIdentityServiceError`, naming the Auto identity service and each address it read.

**Cause.** A runtime that signs people in reads the metadata and the key set of the Auto identity service, `https://clerk.on.auto`, as it starts. It could not reach them.

**Fix.**

- Check that the machine reaches `https://clerk.on.auto`. Where the machine has an outbound proxy, the server must go through it, as [Set up a model provider](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) sets out.
- For development on a machine that cannot reach the service, remove `PUBLIC_URL` from `.env` and start the server again. A server on a loopback address without `API_KEYS` then runs in [local mode](security.md#local-mode), which signs no one in.

## The server stops at start, naming `PUBLIC_URL` and `API_KEYS` {#reachable-without-credentials}

**Symptom.** The server stops before it listens, with a `ReachableWithoutCredentialsError`: `A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST 0.0.0.0; where only this computer reaches its port, ACCESS_MODE=local with a PUBLIC_URL on the loopback declares local mode instead`.

**Cause.** The server listens beyond loopback, as the Docker image does on `0.0.0.0`, neither `PUBLIC_URL` nor `API_KEYS` is set, and no `ACCESS_MODE=local` declares local mode. Anyone who reached it could otherwise act without a credential.

**Fix.**

- To sign people in, set `PUBLIC_URL`, as [Run with Docker](docker.md) does.
- For machines and pipelines, set `API_KEYS` ([API keys](security.md#api-keys)).
- For one person on their own computer, outside a container, set `HOST=127.0.0.1` instead. The server then runs in [local mode](security.md#local-mode).
- For one person on their own computer in a container whose port Docker publishes on `127.0.0.1` alone, set `ACCESS_MODE=local` and `PUBLIC_URL=http://localhost:5555` ([On your own machine](docker.md#on-your-own-machine)).

## A run is refused as `license_required` {#license-required}

**Symptom.** A run is answered `409` with the kind `license_required`: `This runtime has used its 100 free runs. Get a free key at …, then activate it on the runtime and run this again.`

**Cause.** A runtime runs 100 actions before it is registered, and this one holds no license.

**Fix.** Open the refusal's `resolve_at` while signed in to Studio as an owner of the org, register the installation its `runtime_id` names, and activate the key Studio shows once. [Register and license a runtime](licenses.md) gives the four ways to activate it.

## A run is refused as `license_invalid` {#license-invalid}

**Symptom.** A run, or an activation, is answered `409` with the kind `license_invalid`, its `resolve_at` the installation's page in Studio and its `runtime_id` the runtime's id. Its `detail` says which case it is, and `GET /v1/orgs/{org}/license` answers the same words in `invalid_because`.

**Cause and fix.**

- `This runtime's key was replaced.`, with `because: "key_rotated"`: an owner rotated the key in Studio. Activate the new key they were shown; a key in `AUTO_RUNTIME_LICENSE_KEY` or the configuration file wins over one activated by the command or through the API, so replace it there. If the key is lost, an owner rotates it again at `resolve_at`.
- `This runtime was removed from its org.`, with `because: "installation_revoked"`: an owner revoked the installation. An owner registers it again at `resolve_at`; activate the new key.
- `This runtime's license wasn't renewed by` a date: an entitlement lasts seven days and is renewed every day, and this one could not be for a week. It renews as soon as the runtime reaches `billing.on.auto`; check the runtime's egress.
- `These offline credits stopped on` a date: an offline installation's allocation has seven days of grace from its last refresh. An owner requests new credits at `resolve_at`, or the runtime refreshes it with Auto.
- `This runtime's license does not stand`, followed by why: a key for another installation is refused before the runtime asks Auto, so register this runtime's installation, which `runtime_id` names, rather than reuse another's key; an entitlement not signed by Auto is refused whatever key brought it.

## A run is refused as `credits_exhausted` {#credits-exhausted}

**Symptom.** A run is answered `409` with the kind `credits_exhausted`, in the words of the org's account, its case in `because`, `none_left`, `free_daily_limit` or `free_month_used`, and where an owner gets more in `resolve_at`; or, on an offline installation, `This runtime has used all … offline credits`, with `because: "none_left"`.

**Cause.** The org's account at Auto has no credit left for the action, or an [offline installation](licenses.md#offline-installations) has spent the credits of its allocation. A run asked again under the id of a run that already started is not charged again, and is not refused.

**Fix.** An owner of the org gets more credits at `resolve_at`, in Studio, with a plan or a top-up, or, for an offline installation, requests more there. Ask for the run again once they are added.

## Every run is refused as `metering_fault` {#metering-fault}

**Symptom.** Every new run is answered `409` with the kind `metering_fault`: `This runtime stopped starting runs because`, what the runtime found, then `We need to repair it; see https://studio.on.auto/support (runtime id …). Reading, editing and exporting still work.`, with Studio's support page in `resolve_at` and the runtime's id in `runtime_id`.

**Cause.** The runtime found its ledger changed under the count it keeps: an event it counted is gone, another stands where it counted its last, or an event can no longer be read. Restoring an older backup of the ledger under a newer count, or editing the ledger's database by hand, does this.

**Fix.** Reach Auto at [Studio's support page](https://studio.on.auto/support) with the runtime id and what changed the ledger. Auto issues a repair for that installation, which the runtime takes when it next renews its license, at its start or within a day; a restart takes it at once. See [Faults and repairs](licenses.md#faults-and-repairs).

## Error responses

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document (`application/problem+json`) with a machine-readable `reason`, such as:

- `bad_request`;
- `invalid_input`, with an `errors` list of JSON pointers, and the kind `input_schema` when an input schema refused the input a run was given;
- `forbidden`;
- `not_found`;
- `conflict`.

[Responses and errors](../reference/http.md#responses-and-errors) lists every reason.

A `500` says nothing about the cause. To find it in the log:

1. Read the response's `instance`, which is `urn:uuid:<id>`, or its `x-request-id` header.
2. Search the server's stderr. The server logs the error under `"incident":"<id>"`, together with `"requestId"`, the value of `x-request-id`. Either id finds the line.

A request that Node's HTTP parser rejects before the API sees it gets a bare status line, such as `431` or `400`, and no problem document. Oversized headers and invalid framing are rejected this way.

## The browser receives 403

**Cause.** The page's origin is not allowed, or, in local mode, the request's Host is not local.

**Fix.**

- Add the exact page origin to `ALLOWED_ORIGINS`.
- Local mode also checks the request's Host. Never bypass these protections to expose local mode through a proxy.

See [Authentication and security](security.md).

## Data disappeared after replacing a container

**Cause.** The ledger lives on `/data`. A container started without a named volume gets an empty anonymous volume, and its playbooks last only as long as that container.

**Fix.** Reuse the same named volume across container replacements. An anonymous volume is not a persistence plan. See [Back up and restore](docker.md#back-up-and-restore).

## Workflows are missing or unavailable

Every server offers workflows and `send_run_event`, with nothing to configure.

| Symptom                                             | Cause and fix                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A workflow does not go on                           | It is usually waiting: for an event, a timer or a function it called. Its history shows which                                                                                                                                                                                    |
| The log warns about the runs                        | The server cannot do the work of its runs, and says what failed, such as `A sweep of the runs failed; the next sweep tries again`. [What the logs say](workflows.md#what-the-logs-say) lists them                                                                                |
| Workflow starts and run events return `unavailable` | Several servers share a database, and the request reached one that stands by. Its detail says another server runs the workflows, and each server's log says which it is. Route these operations as [Choose one server or a standby](production.md#run-several-servers) describes |

## A run stays started

**Cause.** A waiting workflow can legitimately remain `started`. A run whose end the ledger could not record also stays `started` until a later attempt records it.

**Fix.**

- Read the run's history with `list_playbook_events`, given its `run_id`. It shows the run's steps, and the last one shows what the run waits for.
- Check the log. The server warns once when such a run backs off to an attempt a minute, and once when it is settled.

[Workflow storage and failover](workflows.md#how-a-run-ends) explains how a run ends.
