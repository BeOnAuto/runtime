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

- Check the agent's MCP entry. For a team's runtime, it is `/mcp` at the runtime's `PUBLIC_URL`, over HTTP, such as `https://auto.example.com/mcp`. For Auto on your computer, [Run Auto on your computer](../get-started/local.md#connect-your-agent) gives it: the `mcp` command of `@on.auto/runtime`, run by `npx`; an agent that connects over HTTP instead, as one that signs you in does, uses `http://localhost:5555/mcp`, or the port you set.
- Restart the agent session.
- For Auto on your computer, confirm that the agent runs on the same computer as Auto Runtime.

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

**Symptom.** A run is answered `409` with the kind `license_required`, its limit in `because`, `free_daily_limit` or `free_month_used`: `This runtime has used its 100 free runs. Without a license key, it runs at the free rate of 15 runs a UTC day and 75 a UTC month. It has used today's 15 free runs and can run again at 00:00 UTC on …. To run more, get a free key at …, then activate it on the runtime.`

**Cause.** A runtime without a key runs 100 free runs, then at most 15 a UTC day and 75 a UTC calendar month, and this one has used the day's or the month's.

**Fix.** Wait until the time the `detail` gives, or open the refusal's `resolve_at` while signed in to Studio as an owner of the org, register the runtime its `runtime_id` names, and activate the key Studio shows once. [Licenses](licenses.md#activate-the-key) gives the four ways to activate it. A workflow whose call was refused waits at that step and asks again.

## A runtime with a key runs at the free rate {#limited}

**Symptom.** `GET /v1/orgs/{org}/license` reads `state: "limited"`, and the runtime says so as it starts; once it has used the free rate, a run is answered `409` with the kind `credits_exhausted` or `license_invalid`, its limit in `because`, `free_daily_limit` or `free_month_used`, and its `detail` beginning with why it runs at the free rate.

**Cause and fix**, by the license's `limited_because` and the refusal's first words:

- `credits`, `This runtime's organization has no credits left`: the org is on the Free plan and has used its credits. An owner adds credits at `resolve_at`, Billing in Studio; the runtime takes them at its next report, within the hour.
- `cap`, `This runtime's organization has reached its overage cap`: the org owes as much overage as its plan allows. An owner adds credits at `resolve_at`, which repay what is owed first; the runtime takes them at its next report.
- `out_of_touch`, `This runtime hasn't reached Auto since` a date: the runtime has not reached `billing.on.auto` for 28 days since its last license. Check its egress; it goes back to its org's credits at its next report.
- `key_rotated`, `This runtime's key was replaced`: an owner rotated the key in Studio. Activate the new key they were shown; a key in `AUTO_RUNTIME_LICENSE_KEY` or the configuration file wins over one activated by the command or through the API, so replace it there. If the key is lost, an owner rotates it again at `resolve_at`.
- `key_revoked`, `This runtime was removed from its org` or `Auto no longer accepts this runtime's key`: an owner removed the runtime. An owner registers it again at `resolve_at`; activate the new key.
- `org_closed`, `This runtime's organization at Auto is closed`: the org was deleted. An owner can restore it, for a limited time only, and the runtime goes back to its credits at its next report; otherwise activate a key of another org.
- `not_activated`, `This runtime has a key it hasn't activated with Auto yet`: the runtime has not reached Auto since it was given the key. Check its egress; it activates the key at its next report, within the hour.

## Activating a key, or a run on offline credits, is refused as `license_invalid` {#license-invalid}

**Symptom.** An activation, or a run of a runtime on offline credits, is answered `409` with the kind `license_invalid`, its `resolve_at` the runtime's page in Studio and its `runtime_id` the runtime's id. Its `detail` says which case it is.

**Cause and fix.**

- `This runtime's key was replaced.`, with `because: "key_rotated"`: the key was rotated. Activate the new key an owner was shown, or have an owner rotate it again at `resolve_at`.
- `This runtime was removed from its org.`, with `because: "installation_revoked"`: an owner registers the runtime again at `resolve_at`; activate the new key.
- `This offline allocation expired on` a date: offline credits last 30 days from when they were issued or last refreshed, or 90 under an Enterprise order. An owner requests new credits at `resolve_at`, or the runtime refreshes them with Auto.
- `This runtime's license is invalid`, followed by why: a key for another runtime is refused before the runtime asks Auto, so register this runtime, which `runtime_id` names, rather than reuse another's key; a license not signed by Auto is refused whatever key brought it.

## A run on offline credits is refused as `credits_exhausted` {#credits-exhausted}

**Symptom.** A run is answered `409` with the kind `credits_exhausted` and `because: "none_left"`: `This runtime has used all … offline credits`.

**Cause.** A [runtime on offline credits](licenses.md#offline-runtimes) has spent them. A run asked again under the id of a run that already started counts nothing more, and is not refused.

**Fix.** An owner of the org requests more offline credits at `resolve_at`.

## Activating a key is refused as `account_closed` {#account-closed}

**Symptom.** An activation of the license is answered `409` with the kind `account_closed`, in the words of the org's account, its case in `because`, `org_deleted` or `org_purged`, and, where the account gives one, the page to restore the org in `resolve_at`.

**Cause.** The org's account at Auto is closed. With `org_deleted`, the org was deleted and can still be restored, but only for a limited time; after it, the org is purged. With `org_purged`, it was, and cannot be restored.

**Fix.** For `org_deleted`, an owner of the org restores it at `resolve_at`, which says until when it can be. For `org_purged`, register the runtime with another org and activate its key. Meanwhile the runtime runs at the free rate.

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
