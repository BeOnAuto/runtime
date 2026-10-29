---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# License a self-hosted runtime

Give a runtime you host a free license key, so it runs on your organization's credits instead of the free rate. This guide registers the runtime in Studio, activates its key and checks where it stands. It also covers rotating or revoking a key and running a runtime that can't reach Auto.

Without a key, a runtime runs its first 100 runs, then at most 15 a UTC day and 75 a UTC month, and never uses credits. The [self-hosted licensing reference](licensing.md) sets out every rule, limit and refusal.

## Before you start

- Be an admin of the organization whose credits the runtime should use. In your personal organization, you are.
- Find the runtime's id. It is in the link the runtime prints as it starts, `Get a free key at https://studio.on.auto/licenses?installation=<runtime id>`, in the `runtime_id` of a refusal, and in `GET /v1/orgs/{org}/license`.
- Let the runtime reach `https://billing.on.auto` over HTTPS. Allow it in your egress rules beside `studio.on.auto`.

## 1. Register the runtime {#register-the-runtime}

1. Open the link the runtime printed, or a refusal's `resolve_at`. You can also open Settings, Self-hosted in [Studio](https://studio.on.auto).
2. Choose the organization whose credits the runtime should use.
3. Give the runtime a name, such as "Build server". Keep the runtime id the link filled in. Leave it blank only for a runtime that has never run, and Studio makes one.
4. Choose Register.

Studio shows the key once, `alk.<org>.<runtime id>.<secret>`. Copy it to where you keep your other secrets. You can register a runtime before its free runs run out.

## 2. Activate the key {#activate-the-key}

Give the runtime its key in one of these ways:

| Way                    | How                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The environment        | Set `AUTO_RUNTIME_LICENSE_KEY` to the key, in the `.env` the runtime reads or its container's environment, and restart the runtime          |
| The configuration file | Set `license.key` to a reference to the variable that holds the key, since the file never holds a secret itself, and restart the runtime    |
| The command            | With the runtime running on this computer, started by `npx @on.auto/runtime`, run `npx -y @on.auto/runtime license activate <key>`          |
| Studio                 | Connect Studio to the runtime, open Settings, Runtime, paste the key under License and choose Activate                                      |
| The API                | `POST /v1/orgs/{org}/license` with `{ "key": "<key>" }`, or the MCP tool `activate_license`. It needs permission to change the organization |

In the configuration file, the key reads like this:

```yaml
license:
  key: ${ACME_LICENSE_KEY}
```

A key activated by the command, Studio or the API is kept in the runtime's secret store, so it stays after a restart. A key in the environment or the configuration file is read at every start, and wins over one activated any other way. The key covers the whole runtime, whichever organization the route names.

## 3. Check where it stands {#check-where-it-stands}

The command answers in one line, such as:

```text
Licensed to Acme Corporation on the team plan, with 570 runs left. Runtime id 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.
```

The runtime says the same as it starts, in its terminal and on the page it serves at its root. `GET /v1/orgs/{org}/license` answers it as `summary`, beside `state` and the license's dates; the [HTTP reference](../reference/http.md#license) describes each field.

In Studio, Settings, Self-hosted lists each runtime with its state, its last report and when it would warn and fall back. Settings, Runtime shows the same for the runtime Studio is connected to.

| Studio shows                | `state`                                       | What to do                                                                                                                 |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Licensed                    | `licensed`                                    | Nothing. It reports every hour                                                                                             |
| Registered, not activated   | `unregistered` or `limited`                   | Activate the key on the runtime                                                                                            |
| Out of touch                | `out_of_touch`                                | Check that it can reach `billing.on.auto`                                                                                  |
| Limited to the free rate    | `limited`                                     | Follow the reason Studio gives. [Falling back to the free rate](licensing.md#falling-back-to-the-free-rate) lists each one |
| Revoked                     | `limited`                                     | Register it again to use credits                                                                                           |
| Offline, or Offline, paused | `offline`, or `invalid` once its credits stop | Upload its reports, and request new credits before these run out                                                           |

## Rotate a key

Rotate a key when it may have leaked, or when it is lost.

1. In Self-hosted, choose Rotate key on the runtime, and confirm.
2. Copy the new key Studio shows once.
3. [Activate it](#activate-the-key) on the runtime. If the old key is in the environment or the configuration file, replace it there.

The old key stops working at once. Until the new one is active, the runtime runs at the free rate. A workflow that goes over that rate waits at its next call for up to 24 hours. Every admin of the organization gets an email about the change.

## Revoke a runtime

Revoke a runtime that should no longer use the organization's credits. In Self-hosted, choose Revoke on the runtime, and confirm.

Its key stops working, and the runtime runs at the free rate. Its run history stays. To use credits again, register it again with the same runtime id and activate the new key.

## Run a runtime that can't reach Auto {#offline}

A runtime behind an air gap can't report to Auto, so it spends offline credits that Auto signs for it.

1. In Self-hosted, choose Request offline credits on the runtime. Enter how many credits, and why you need them, then choose Send request.
2. When Auto has sent them, choose Download on the runtime. You can download them only once, so keep the file until the runtime has them.
3. Give them to the runtime, with its key, which signs its reports. Run the command Studio shows on the runtime's computer, `npx @on.auto/runtime license allocation '<what you downloaded>'`. Or set `AUTO_RUNTIME_ALLOCATION` to what you downloaded, or `license.allocation` in the configuration file, and restart the runtime.

The command answers what the runtime holds, such as `This runtime uses offline credits: 0 of 50 used, usable until 2026-11-27.` The API takes them too, as `POST /v1/orgs/{org}/license/allocation`.

To report what the runtime spent:

1. On the runtime's computer, run `npx @on.auto/runtime license report`, or `POST /v1/orgs/{org}/license/allocation/report`.
2. In Self-hosted, choose Upload report on the runtime, and paste the whole output or upload the saved file.

[Offline credits](licensing.md#offline-credits) gives how long they last and how a runtime that reaches Auto now and then refreshes them.

## If something goes wrong

[Troubleshooting](troubleshooting.md#license-required) covers the refusals people meet most, with their fixes. [Refusals](licensing.md#refusals) lists every kind and its words.
