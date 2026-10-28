---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Licenses

Auto Runtime counts the actions it runs: each run of a workflow or a function is one action, counted once by its run id however often it is asked again, retried or resumed. A function or workflow a workflow calls is a run of its own, so it is an action too, as [What counts as a run](#what-counts-as-a-run) works through. Nothing else is counted, neither a model call nor the compute a function takes. The count comes from the runtime's own ledger, and the runtime keeps it there.

A runtime that holds no key starts 100 runs. After them it needs a license: a key Studio gives the org that registers the runtime's installation. A licensed runtime asks the org's account at Auto to admit each new run as it starts, which charges one credit for it, and refuses the run while the account cannot be asked. A key costs nothing, and every org's account gets free credits, as [Free runs, welcome credits and Free-plan credits](#free-runs-welcome-credits-and-free-plan-credits) sets out; paid plans and top-ups add more.

What the key protects is starting new runs beyond those first 100. Everything else the runtime does, reading, editing and cancelling, goes on whatever it holds.

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

You can register an installation before its 100 free runs run out, from Studio's Licenses page, by the runtime id that [its license](#see-what-the-runtime-holds) gives. Once the runtime holds the key, every new run is charged a credit, and the free runs it had not used are not used while it holds a key; registering early does not add them to the org's account. A runtime whose ledger is new takes the installation of the first key it activates.

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
- `free_runs.used` is the actions the runtime counted from its ledger, at most the 100 it runs before it is registered. It counts every run in the ledger, those charged to credits included, since the 100 are counted over the whole ledger.
- `org`, `plan`, `expires_at` and `renewed_at` are those of the entitlement of the key in force, and `null` without one.
- `org_name` is the name of that org at Auto, as Auto signed it into the entitlement and renewed with it every day, kept on one line of at most 80 characters, its control and format characters taken out, and `null` without one or where Auto named none or a blank one.
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
| `metering_fault`    | The runtime's ledger no longer holds what its meter counted, for example after events were deleted or part of a backup was restored                    | [Ask Auto for a repair](#faults-and-repairs) at `resolve_at`, Studio's support page, naming the `runtime_id`                                                                                                   |
| `meter_unavailable` | The runtime could not read its ledger, or reach the account service, to admit the run                                                                  | Ask again shortly; check that the runtime reaches `billing.on.auto`. A workflow that was refused a call this way has ended, so start it again                                                                  |

An org's account can also be closed: its runs are then refused as `account_closed`, with `because: "org_deleted"` until an owner restores the org, which they can do only for a limited time, until the date at the `resolve_at` Auto gives, after which the org is purged and its runs, with `because: "org_purged"`, never run again.

The `detail` of a `license_invalid` refusal says which case it is:

| Case                            | `detail`                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The key was rotated             | `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at {resolve_at}.` |
| The runtime was removed         | `This runtime was removed from its org. To use it again, an owner can register it again at {resolve_at}, then activate the new key and run this again.`                                 |
| The license was not renewed     | `This runtime's license wasn't renewed by {date}. Check that it can reach billing.on.auto (it renews every day), then run this again.`                                                  |
| Offline credits past their date | `These offline credits stopped on {date}. An owner can request new ones at {resolve_at}.`                                                                                               |
| Any other                       | `This runtime's license does not stand:` and why, such as a key for another installation or an entitlement not signed by Auto, then where an owner registers the installation           |

A run asked again under the run id of one that already started is never refused, and counts nothing more. Whatever the license says, and while a fault stands, the runtime still answers every other call: reading playbooks, definitions, runs, their history and events, which is how you export what it holds, creating, changing and retiring definitions, cancelling runs, and reading and activating its license. Your ledger's database stays yours to read and back up directly.

### A workflow whose next call is refused

A workflow is admitted once, as it starts. Each function or workflow it calls is admitted as that call starts. When a call is refused, for any of the reasons above, the call is never started and counts nothing, and the workflow takes the refusal as an error at that step: a `try` in the workflow can catch it, and otherwise the workflow ends `rejected`, with the refusal's words in its `detail` and its `kind`, except that one refused as `meter_unavailable` ends with the reason `unavailable` alone. The calls it made before go on to their end, and stay counted. A workflow that ended does not continue, and asking it again under its run id answers the run that ended, so once the refusal is resolved, start a new run.

## Offline installations

An installation that never reaches Auto, behind an air gap or a network that lets nothing out, cannot ask its account to admit each action. For it, an operator of Auto issues an allocation: credits moved out of the org's account for that installation alone, which the runtime spends itself, signed by Auto like every answer the runtime takes. Ask for one through [Studio's support page](https://studio.on.auto/support), naming the installation.

An allocation is the only way to run without asking Auto at each run, and it is not a grace period for an online runtime: a runtime that reaches Auto, but not at the moment a run starts, refuses that run as `meter_unavailable`.

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

While an allocation stands, the runtime admits each new action against it and asks Auto nothing. It counts what it spent from its ledger, as it counts every action, and admits while fewer actions than the allocation's credits were counted since it took it; replicas of one ledger admit exactly that many between them. The allocation has seven days of grace from when it was issued or last refreshed, or 30 or 90 days where Auto issued it so under an Enterprise order, and never lasts past the earliest expiry of the credits it holds. Auto signs that moment into the allocation as `refresh_by`, in UTC, and the runtime compares it with its own clock, so a runtime whose clock is wrong stops early or late by as much. `GET /v1/orgs/{org}/license` gives it as `offline.usable_until`; the refusal names its day. Past that day the runtime refuses new runs as `license_invalid`, `These offline credits stopped on 2026-11-03. An owner can request new ones at https://studio.on.auto/licenses?installation=…`, and once its credits are spent as `credits_exhausted` with `because: "none_left"`, `This runtime has used all 50 offline credits. An owner can request more at https://studio.on.auto/licenses?installation=…`, each with that page in `resolve_at`.

A runtime that does reach Auto now and then refreshes its allocation every day, which gives it seven more days of grace, and sends Auto a report of what it spent every hour. One that never does needs an owner to carry its reports to Studio:

1. Make the next report on the runtime: `npx -y @on.auto/runtime license report`, or `POST /v1/orgs/{org}/license/allocation/report`. It prints `{"report":{"allocation":…,"installation":…,"sequence":…,"spent":…,"at":…},"signature":…}`: all the runtime spent under the allocation so far, under the next number, signed with the key of its installation.
2. Upload it in Studio, on the installation's page under Licenses.

When the allocation stops, the credits it did not spend are not spent and are not lost by it: they stay reserved at Auto until an operator closes the allocation, which gives each one back to the credits it came from, which keep their own expiry, so a credit whose own expiry passed meanwhile counts as expired. To run on, ask for new offline credits on the installation in Studio's Self-hosted page, download what Auto issues, and give it to the runtime as above. A runtime that reaches Auto now and then renews its allocation itself.

Each report counts everything spent, so a later report replaces an earlier one, and a lost report costs nothing. Auto freezes an allocation whose report counts fewer actions than one before it, or comes under a number it already took, as a ledger restored from an older copy does; reach Auto through support to have it looked at. When Auto closes the allocation, the runtime gives it up at its next refresh and asks its account to admit each action from then on.

## Faults and repairs

The runtime keeps its count as a checkpoint in its ledger, with the point and the id of the last event it counted. When an event it counted is gone, when another stands where it counted its last, when it cannot read one, or when it counts fewer runs than its checkpoint holds, it records a fault and refuses every new run as `metering_fault`, through restarts, until Auto repairs it. A fault says only that the runtime can no longer show that its count matches its ledger. It is not a finding that anyone did anything wrong, and ordinary maintenance can cause one:

- deleting runs or events from the database, for example to keep less history or to honour a request to delete someone's data;
- restoring some of the ledger's tables, or a backup of the events beside a newer `meter` stream;
- a migration that renumbers or drops rows;
- a disk or database error that leaves an event unreadable.

Copying and restoring the whole ledger together, the SQLite file with its `-wal` file or the whole PostgreSQL database, causes no fault: the restored ledger counts what it held when it was copied. The runtime has no operation that deletes or redacts runs, so any deletion is made in the database itself, and deleting a run that was counted faults the meter.

The refusal says what the runtime found, with Studio's support page in `resolve_at` and the runtime's id in `runtime_id`:

```text
This runtime stopped starting runs because the event its meter counted last is no longer in its ledger. We need to repair it; see https://studio.on.auto/support (runtime id 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a). Reading, editing and exporting still work.
```

Reach Auto at [Studio's support page](https://studio.on.auto/support) with the runtime id, and say what was done to the ledger, if you know. Never send the key. An operator issues a repair, which Auto signs for that installation alone; the runtime receives it when it next renews its license, at its start or within a day, so restarting it once the repair is issued takes it at once. It counts its ledger again from the first event and goes on from that count, so nothing is charged twice and nothing refused during the fault was charged. A faulted runtime still activates and renews its license, so it can receive its repair; a runtime nobody registered is registered first.

While the fault stands, the runtime starts no new run, a workflow that reaches its next call ends as [above](#a-workflow-whose-next-call-is-refused), and everything else goes on. [Starting again with an empty ledger](#starting-again-with-an-empty-ledger) clears a fault too, with everything else the ledger held.

## What counts as a run

Each run of a workflow or a function, started by a person, an agent, a schedule, an event or another workflow, is one action, counted once by its run id within its org and playbook. A run counts as it starts, not as it ends, so a run that fails, is cancelled or is rejected still counts. A run that is refused before it starts counts nothing.

For example, the workflow `nesting` calls the workflow `asking`, which calls the reasoning function `summary`:

| What happens                                                                            | Actions |
| --------------------------------------------------------------------------------------- | ------- |
| `nesting` starts                                                                        | 1       |
| `nesting` calls `asking`, a run of its own                                              | 2       |
| `asking` calls `summary`, a run of its own                                              | 3       |
| The model `summary` asks fails and is asked again                                       | 3       |
| The server stops while `summary` waits for its model, starts again and resumes the runs | 3       |
| `nesting` is asked again under its run id                                               | 3       |

A call's run id is made from its workflow's run id, the step that calls it and how many times that step has called, so a workflow that resumes calls the same run again rather than a new one. Had the org's account run out of credits after `asking` started, `summary` would have been refused and counted nothing, and `asking` and `nesting` would have ended rejected, still counted, as [A workflow whose next call is refused](#a-workflow-whose-next-call-is-refused) says.

## Free runs, welcome credits and Free-plan credits

Three free allowances apply, and they do not add up to one number:

- **100 free runs for each installation**, kept by the runtime in its ledger, used only while the runtime holds no key and counted over every run in the ledger. They never reach the org's account.
- **100 welcome credits for each org**, once, as its account at Auto opens, which last 14 days.
- **75 Free-plan credits each UTC month**, while the org is on the Free plan, which last to the end of the month and do not roll over, and of which at most 15 are spent a UTC day.

The welcome credits, the Free-plan credits and every credit bought belong to the org's account, which every installation of the org and Auto's cloud hosting share; the earliest to expire are spent first. A new org on Free holds 175 credits and may spend 115 of them on its first day.

An installation that runs its 100 free runs before it is registered, and is then registered by a new org, can start 100 runs free and then spend the org's 175 credits. An installation registered before its first run spends credits from its first run, and its 100 free runs are not used while it holds the key.

## When Auto is unreachable

A licensed runtime asks Auto's account service at each new run and waits up to 10 seconds for the answer. While the service cannot be reached, whether the runtime's network is down or Auto's service is, each new run, and each call a running workflow makes, is refused as `meter_unavailable`, however long the runtime's license still has to run. Runs that already started go on, a workflow ends at its next call as [above](#a-workflow-whose-next-call-is-refused), reading, editing and cancelling go on, and new runs start again as soon as the service answers. Nothing is charged for a refused run.

The license itself lasts seven days and renews as the runtime starts and every day after. A runtime that cannot renew it by its `expires_at` refuses new runs as `license_invalid` until it can. A runtime that never reaches Auto needs [offline credits](#offline-installations) instead.

## Starting again with an empty ledger

You may delete the runtime's whole ledger and start it again with an empty one: the SQLite file with its `-wal` and `-shm` files, or the PostgreSQL database. Everything the old ledger held is gone: playbooks, definitions, runs, their history and events, the secrets and connections it kept, its count, its license and any fault.

- Started without a key, the empty ledger is a new installation, with a new runtime id and 100 free runs. A key of the old installation activated later is refused as a key of another installation, so it is registered again for a key.
- Started with the old installation's key in hand, the empty ledger takes that installation again and stays licensed by it, charging each run a credit as before; it reports a count that starts again from nothing, which Auto notes for its operators.

Restoring a backup of the whole ledger is not a new installation: the restored runtime keeps its runtime id, holds the count it had when the backup was made, and goes on from there. A licensed runtime then reports a lower count than before, which Auto notes for its operators; an offline one reports under a number it already used, which pauses its allocation until Auto looks at it through support.

## If you installed an early release

Auto Runtime 0.27.0 to 0.32.0 were published on 27 October 2026, and limit runs as this page says. When 0.27.0, 0.28.0 and 0.29.0 were published, the licensing page their package links to said that no release limited usage; it was corrected after them (BeOnAuto/runtime#350). They also ask for Auto's account service at `https://accounts.on.auto`, where it never ran, so they cannot activate a key: each run with a key in hand is refused as `meter_unavailable`, however often it is asked again.

To license such an installation, upgrade it to 0.32.1 or later, which asks `https://billing.on.auto`; its ledger, its runtime id and its count of runs carry over as they are. An installation that only needs its free runs needs nothing. If your installation was affected in a way this does not resolve, reach Auto through [Studio's support page](https://studio.on.auto/support) with its runtime id.
