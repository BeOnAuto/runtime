---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Licenses

Auto Runtime counts the actions it runs: each run of a workflow or a function is one action, counted once by its run id however often it is asked again, retried or resumed. Nothing else is counted, neither a model call nor the compute a function takes. The count comes from the runtime's own ledger, and the runtime keeps it there.

A runtime runs 100 actions before it is registered. After them it needs a license: a key Studio gives the org that registers the runtime's installation. A licensed runtime asks the org's account at Auto to admit each new action, which charges one credit for it. Every org has a free allowance, so a key costs nothing.

## Register the installation in Studio

The 101st action of a runtime nobody registered is refused with `license_required`. Its `detail` says where to get the key, and its `resolve_at` is that page of Studio, with the runtime's id in `runtime_id`:

```json
{
  "type": "https://on.auto/problems/license_required",
  "title": "License required",
  "status": 409,
  "detail": "This runtime has used its 100 free runs. Get a free key at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a, then activate it on the runtime and run this again.",
  "reason": "conflict",
  "kind": "license_required",
  "resolve_at": "https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "runtime_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"
}
```

The runtime id is the runtime's installation, its id in the ledger. Open the link while signed in to Studio as an owner of the org whose account the runtime should use, and register the installation under a name. Studio shows the key once, `alk.<org>.<installation>.<secret>`. Keep it where you keep your other secrets; an owner can rotate it, which retires the old key, or revoke the installation, which stops it.

You can register an installation before its 100 free runs run out, from Studio's Licenses page, by the runtime id that [its license](#see-what-the-runtime-holds) gives. A runtime whose ledger is new takes the installation of the first key it activates.

## Activate the key

Give the runtime its key in one of four ways. A key in the environment or the configuration file is activated each time the runtime starts and wins over one activated by the command or through the API.

- **The environment.** Set `AUTO_RUNTIME_LICENSE_KEY` to the key, in the `.env` the runtime reads or the environment of its container, and restart the runtime.
- **The configuration file.** Write a reference to the variable that holds the key under `license.key`, since the file never holds a secret itself:

  ```yaml
  license:
    key: ${ACME_LICENSE_KEY}
  ```

- **The command.** With Auto Runtime running on your computer, started by `npx @on.auto/runtime`, run:

  ```sh
  npx -y @on.auto/runtime license activate alk.<org>.<installation>.<secret>
  ```

  It asks the runtime running on this computer to activate the key, and says what the runtime is licensed to, the org by its name at Auto, or by its id where Auto names none:

  ```text
  Licensed to Acme Corporation (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.
  ```

- **Studio, or any client of the API.** `POST /v1/orgs/{org}/license` with `{ "key": "<the key>" }`, or the MCP tool `activate_license`, activates the key for the whole runtime. It takes the permission to change the org, as adding a connection does.

A key activated by the command or through the API is kept in the runtime's secret store, as the credentials of connections are, so it stands after a restart.

The runtime activates a key by asking Auto's account service at `https://billing.on.auto`, which answers an entitlement Auto signs, naming the org, its name at Auto where Auto knows it, and its plan. The runtime ships Auto's public key and checks every answer against it; no setting adds or replaces a key. The entitlement lasts seven days, and the runtime renews it as it starts and every day after. Every hour, and as it stops, the runtime counts its ledger again from the first event and reports its count of actions to the account, which compares it with what it charged.

The runtime reaches `billing.on.auto` over HTTPS; allow it in your egress rules beside `studio.on.auto`.

## See what the runtime holds

`GET /v1/orgs/{org}/license` answers what the runtime holds to run. Every member of an org may read it, and it covers the whole runtime, whatever org the route names; Studio reads it to show the runtime's license.

```json
{
  "state": "licensed",
  "runtime_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "free_runs": { "used": 100, "of": 100 },
  "org": "acme",
  "org_name": "Acme Corporation",
  "plan": "free",
  "expires_at": "2026-11-03T12:00:00.000Z",
  "renewed_at": "2026-10-27T12:00:00.000Z",
  "key_source": "environment",
  "offline": null,
  "invalid_because": null
}
```

- `state` is `unregistered` while the runtime holds no key, `licensed` while an entitlement Auto signed stands, `offline` while it spends an [allocation](#offline-installations), and `invalid` while what it holds does not stand, which `invalid_because` gives in the words a run is refused in.
- `runtime_id` is the installation an owner registers in Studio. A runtime that has no id yet takes one as it is first read, the id its first run would have taken.
- `free_runs.used` is the actions the runtime counted from its ledger, at most the 100 it runs before it is registered.
- `org`, `plan`, `expires_at` and `renewed_at` are those of the entitlement of the key in force, and `null` without one.
- `org_name` is the name of that org at Auto, as Auto signed it into the entitlement and renewed with it every day, and `null` without one or where Auto named none.
- `key_source` says where the key in force came from: `environment`, `configuration` or `activated`, by the command or the API; `null` without a key. A key in the environment or the configuration file wins over an activated one at each start.
- `offline` is `{ credits, spent, usable_until }` while the runtime holds an allocation, and `null` otherwise.

Started by `npx @on.auto/runtime`, the runtime says the same in its terminal and on the page it serves at its root: `12 of 100 free runs used, then a free key from Studio` while it is unregistered, and `Licensed to Acme Corporation (free plan)` once it is licensed, with the org's id in place of its name where Auto named none.

## When a run is refused

Each refusal is a problem document with the status `409`, the reason `conflict` and one of these kinds, or with `503` and the kind `meter_unavailable`. Beside its `detail`, a refusal that a person resolves somewhere gives that page's absolute URL in `resolve_at`, a refusal of the license or the meter gives the runtime's id in `runtime_id`, and a refusal for credits says its case in `because`, so Studio and an agent can offer the way out.

| Kind                | Means                                                                                                                                                  | What to do                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `license_required`  | The runtime has used its 100 free runs and holds no license                                                                                            | Get a free key at `resolve_at`, the installation's page in Studio, and [activate it](#activate-the-key)                                                                                                        |
| `license_invalid`   | The key was rotated (`because: "key_rotated"`), the runtime was removed from its org (`because: "installation_revoked"`), or its license lapsed        | Activate the new key, or register the runtime again, at `resolve_at`; a license not renewed since its `expires_at` needs the runtime to reach `billing.on.auto`; offline credits past their date need new ones |
| `credits_exhausted` | The org's account has no credit left for the action (`because` `none_left`, `free_daily_limit` or `free_month_used`), or the offline credits are spent | An owner gets more credits at `resolve_at`, in the words of the org's account, or requests more offline credits; the run starts when it is asked again                                                         |
| `metering_fault`    | The runtime found its ledger changed under its count                                                                                                   | [Ask Auto for a repair](#faults-and-repairs) at `resolve_at`, Studio's support page, naming the `runtime_id`                                                                                                   |
| `meter_unavailable` | The runtime could not read its ledger, or reach the account service, to admit the run                                                                  | Ask again shortly; check that the runtime reaches `billing.on.auto`                                                                                                                                            |

The `detail` of a `license_invalid` refusal says which case it is:

| Case                            | `detail`                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The key was rotated             | `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at {resolve_at}.` |
| The runtime was removed         | `This runtime was removed from its org. To use it again, an owner can register it again at {resolve_at}, then activate the new key and run this again.`                                 |
| The license was not renewed     | `This runtime's license wasn't renewed by {date}. Check that it can reach billing.on.auto (it renews every day), then run this again.`                                                  |
| Offline credits past their date | `These offline credits stopped on {date}. An owner can request new ones at {resolve_at}.`                                                                                               |
| Any other                       | `This runtime's license does not stand:` and why, such as a key for another installation or an entitlement not signed by Auto, then where an owner registers the installation           |

A run asked again under the run id of one that already started is never refused, and counts nothing more. Reading runs and events, editing definitions and exporting go on whatever the license says.

## Offline installations

An installation that never reaches Auto, behind an air gap or a network that lets nothing out, cannot ask its account to admit each action. For it, an operator of Auto issues an allocation: credits moved out of the org's account for that installation alone, which the runtime spends itself, signed by Auto like every answer the runtime takes. Ask for one through [Studio's support page](https://studio.on.auto/support), naming the installation.

Give the runtime its allocation, and the key of its installation, which signs its reports, in any of these ways. None of them needs Auto: the runtime checks the allocation against Auto's public key, which it ships, and keeps it in its ledger.

- **The environment.** Set `AUTO_RUNTIME_ALLOCATION` to the allocation's JSON, `{"payload":"…","signature":"…","kid":"…"}`, and `AUTO_RUNTIME_LICENSE_KEY` to the key.
- **The configuration file.** Write references to the variables that hold them:

  ```yaml
  license:
    key: ${ACME_LICENSE_KEY}
    allocation: ${ACME_ALLOCATION}
  ```

- **The command.** With Auto Runtime running on your computer, `npx -y @on.auto/runtime license allocation '<the allocation's JSON>'`, which says what the runtime holds: `Offline credits: 0 of 50 used, usable until 2026-11-03.`
- **The API.** `POST /v1/orgs/{org}/license/allocation` with `{ "allocation": { "payload": "…", "signature": "…", "kid": "…" } }`.

While an allocation stands, the runtime admits each new action against it and asks Auto nothing. It counts what it spent from its ledger, as it counts every action, and admits while fewer actions than the allocation's credits were counted since it took it; replicas of one ledger admit exactly that many between them. The allocation has seven days of grace from when it was last refreshed. Past that day the runtime refuses new runs as `license_invalid`, `These offline credits stopped on 2026-11-03. An owner can request new ones at https://studio.on.auto/licenses?installation=…`, and once its credits are spent as `credits_exhausted` with `because: "none_left"`, `This runtime has used all 50 offline credits. An owner can request more at https://studio.on.auto/licenses?installation=…`, each with that page in `resolve_at`.

A runtime that does reach Auto now and then refreshes its allocation every day, which gives it seven more days of grace, and sends Auto a report of what it spent every hour. One that never does needs an owner to carry its reports to Studio:

1. Make the next report on the runtime: `npx -y @on.auto/runtime license report`, or `POST /v1/orgs/{org}/license/allocation/report`. It prints `{"report":{"allocation":…,"installation":…,"sequence":…,"spent":…,"at":…},"signature":…}`: all the runtime spent under the allocation so far, under the next number, signed with the key of its installation.
2. Upload it in Studio, on the installation's page under Licenses.

Each report counts everything spent, so a later report replaces an earlier one, and a lost report costs nothing. Auto freezes an allocation whose report counts fewer actions than one before it, or comes under a number it already took, as a ledger restored from an older copy does; reach Auto through support to have it looked at. When Auto closes the allocation, the runtime gives it up at its next refresh and asks its account to admit each action from then on.

## Faults and repairs

The runtime keeps its count as a checkpoint in its ledger, with the point and the id of the last event it counted. When an event it counted is gone, when another stands where it counted its last, or when it cannot read one, it records a fault and refuses every new run as `metering_fault`, through restarts, until Auto repairs it. Restoring an older backup of the ledger under a newer count does the same. The refusal says what the runtime found, with Studio's support page in `resolve_at` and the runtime's id in `runtime_id`:

```text
This runtime stopped starting runs because the event its meter counted last is no longer in its ledger. We need to repair it; see https://studio.on.auto/support (runtime id 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a). Reading, editing and exporting still work.
```

Reach Auto at [Studio's support page](https://studio.on.auto/support) with the runtime id. An operator issues a repair, which Auto signs for that installation alone; the runtime receives it when it next renews its license, at its start or within a day, counts its ledger again from the first event and goes on from that count. A faulted runtime still activates and renews its license, so it can receive its repair; a runtime nobody registered is registered first.
