---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Licenses

Auto Runtime counts the runs it starts: each run of a workflow or a function counts once by its run id, however often it is asked again, retried or resumed. Nothing else is counted, neither a model call nor the compute a function takes. The runtime counts from its own record of the runs it admitted, which it keeps in its ledger, never by counting your run history again, so deleting, redacting or restoring the history of your runs never stops it.

A runtime without a key runs 100 free runs, then at most 15 a UTC day and 75 a UTC calendar month, for as long as you like, and never calls Auto. With a key, it runs on the credits of the org that registered it: it starts each run itself against a license Auto signed, and reports what it started every hour. A key costs nothing, and every org has a free plan.

## Without a key

A runtime nobody registered runs its first 100 runs, then at the free rate of 15 runs a UTC day and 75 a UTC calendar month. It counts both itself, from the runs it admitted. The run past the free rate is refused with `license_required`, whose `detail` says which limit it reached, when it lifts and where to get a key, with that page of Studio in `resolve_at`, the limit in `because`, `free_daily_limit` or `free_month_used`, and the runtime's id in `runtime_id`:

```json
{
  "type": "https://on.auto/problems/license_required",
  "title": "License required",
  "status": 409,
  "detail": "This runtime has used its 100 free runs. Without a license key, it runs at the free rate of 15 runs a UTC day and 75 a UTC month. It has used today's 15 free runs and can run again at 00:00 UTC on 2026-10-29. To run more, get a free key at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a, then activate it on the runtime.",
  "reason": "conflict",
  "kind": "license_required",
  "because": "free_daily_limit",
  "resolve_at": "https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "runtime_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"
}
```

A workflow whose call is refused this way waits at that step and asks again, so it goes on once the limit lifts.

## Register the runtime in Studio

Open the refusal's `resolve_at`, or Studio's Licenses page with the runtime id that [its license](#see-where-the-runtime-stands) gives, while signed in to Studio as an owner of the org whose credits the runtime should run on, and register the runtime under a name. Studio shows the key once, `alk.<org>.<runtime id>.<secret>`. Keep it where you keep your other secrets; an owner can rotate it, which retires the old key, or remove the runtime from the org.

You can register a runtime before its free runs run out. A runtime whose ledger is new takes the id of the first key it holds.

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
  npx -y @on.auto/runtime license activate alk.<org>.<runtime id>.<secret>
  ```

  It asks the runtime running on this computer to activate the key, and says where the runtime stands, the org by its name at Auto, or by its id where Auto names none:

  ```text
  Licensed to Acme Corporation (free plan): 1000 runs left. Runtime id 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.
  ```

- **Studio, or any client of the API.** `POST /v1/orgs/{org}/license` with `{ "key": "<the key>" }`, or the MCP tool `activate_license`, activates the key for the whole runtime and answers where it stands, as [`GET /v1/orgs/{org}/license`](#see-where-the-runtime-stands) does. It takes the permission to change the org, as adding a connection does.

A key activated by the command or through the API is kept in the runtime's secret store, as the credentials of connections are, so it stands after a restart. A key given in the environment or the file is activated as the runtime starts; until Auto has answered for a new key, the runtime runs as it would without one.

## How a licensed runtime runs

The runtime activates its key by asking Auto's account service at `https://billing.on.auto`, which answers a license Auto signs: the org, its name at Auto, its plan and how its credits stand, and `admits_through`, the count of licensed runs the runtime may reach on them. The runtime ships Auto's public key and checks every license against it; no setting adds or replaces a key, and a license not signed by Auto is refused.

From then on the runtime starts each run itself while its count of licensed runs is below `admits_through`, and asks Auto nothing for the run. Every hour, and sooner once it has used half of what its license left it (at most once a minute), and as it stops, it reports two numbers: the runs it admitted in all, and those it admitted on its license. Auto takes credits for the licensed runs it has not charged before, and answers a fresh license. Runs admitted without a key, or at the free rate, are never charged.

A paid plan may go into overage up to its cap, a quarter of its monthly credits, which the org's next credits repay first. Past the cap, or out of credits on the Free plan, the runtime runs at the free rate until credits arrive, and takes them at its next report.

When the runtime cannot reach Auto, it goes on with its last license. Fourteen days after Auto signed that license it says it is out of touch, and from 28 days it runs at the free rate until it reaches Auto again. Time alone never stops it.

When an owner rotates the key or removes the runtime from its org, the runtime runs at the free rate until a valid key is activated. It never stops outright.

A runtime that held a key once runs no new first 100 runs: whenever it is without a usable license, it runs at the free rate. A ledger wiped, or restored from an older copy, and started again with the same key gains nothing either: whenever the runtime takes a license, as it activates its key or as Auto answers a report, it takes what Auto already charged as the least of its licensed count. A restored ledger reports a lower count once, which Auto charges nothing for, and counts on from what Auto charged after that.

The runtime reaches `billing.on.auto` over HTTPS; allow it in your egress rules beside `studio.on.auto`.

## See where the runtime stands

`GET /v1/orgs/{org}/license` answers where the runtime stands. Every member of an org may read it, and it covers the whole runtime, whatever org the route names; Studio reads it to show the runtime's license.

```json
{
  "state": "licensed",
  "limited_because": null,
  "runtime_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "free_runs": null,
  "org": "acme",
  "org_name": "Acme Corporation",
  "plan": "team",
  "standing": "overage",
  "licensed": 2430,
  "runs_left": 570,
  "credits": { "available": 0, "owed": 30, "overage_cap": 600 },
  "issued_at": "2026-10-28T12:00:00.000Z",
  "warn_at": "2026-11-11T12:00:00.000Z",
  "limit_at": "2026-11-25T12:00:00.000Z",
  "last_report_at": "2026-10-28T12:00:00.000Z",
  "fallback": null,
  "key_source": "environment",
  "offline": null,
  "invalid_because": null,
  "summary": "Licensed to Acme Corporation (team plan): 570 runs left. It is in overage: the org owes 30 of at most 600 credits, which its next credits repay."
}
```

- `state` is `unregistered` while the runtime holds no key; `licensed` while it runs on its license; `out_of_touch` from the license's `warn_at` while it has not reached Auto, still running on that license; `limited` while it runs at the free rate though it holds a key; `offline` while it spends [offline credits](#offline-runtimes); and `invalid` once those credits have stopped.
- `limited_because` says why a limited runtime runs at the free rate: `credits`, its org has none left on the Free plan; `cap`, its org owes as much overage as its plan allows; `out_of_touch`, it has not reached Auto since the license's `limit_at`; `key_rotated`, its key was replaced; `key_revoked`, it was removed from its org or Auto no longer accepts its key; `org_closed`, its org was closed; `not_activated`, it holds a key Auto has not answered for yet. It is `null` otherwise.
- `runtime_id` is the id an owner registers in Studio. A runtime that has no id yet takes one as it is first read, the id its first run would have taken.
- `free_runs` is `{ used, of }`, the first runs the runtime used of its 100, while it has never held a license, and `null` once it has.
- `org`, `org_name`, `plan`, `standing`, `credits`, `issued_at`, `warn_at` and `limit_at` are those of the license of the key in force, `standing` being `ok`, `low`, `empty`, `overage`, `near_cap` or `capped`, and all `null` without one. `org_name` is kept on one line of at most 80 characters, its control and format characters taken out, and is `null` where Auto named none or a blank one.
- `licensed` is the runs the runtime started on a license, in all, and `runs_left` the runs it may still start on its license, `0` while it is limited, `null` without a license.
- `last_report_at` is when the runtime last took a license from Auto, as it activated its key or reported.
- `fallback` is the free rate it runs at, `{ per_day, per_month, used_today, used_this_month, lifts_at }`, while it runs at it, `lifts_at` being when it can run again once it has used what the rate allows; `null` otherwise.
- `key_source` says where the key in force came from: `environment`, `configuration` or `activated`, by the command or the API; `null` without a key.
- `offline` is `{ credits, spent, usable_until }` while the runtime holds offline credits, and `invalid_because` the words a run is refused in once they have stopped.
- `summary` says all of it in plain words, with how to put it right.

Started by `npx @on.auto/runtime`, the runtime says its `summary` in its terminal and on the page it serves at its root, such as `12 of 100 free runs used. After that, it runs at the free rate of 15 runs a UTC day and 75 a UTC month without a license key. Get a free key at https://studio.on.auto/licenses?installation=….` without a key, `Licensed to Acme Corporation (free plan): 940 runs left.` once it is licensed, or, while it runs at the free rate, why, what it has used and how to put it right.

## When a run is refused

Each refusal is a problem document with the status `409`, the reason `conflict` and one of these kinds, or with `503` and the kind `meter_unavailable`. Beside its `detail`, a refusal that a person resolves somewhere gives that page's absolute URL in `resolve_at`, the runtime's id in `runtime_id`, and its case in `because`, so Studio and an agent can offer the way out. A workflow whose call is refused with one of these kinds waits at that step and asks again.

| Kind                | Means                                                                                                                                                                                                                                                                                            | What to do                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `license_required`  | The runtime holds no key and has used the free rate, `because` `free_daily_limit` or `free_month_used`                                                                                                                                                                                           | Wait until the time its `detail` gives, or get a free key at `resolve_at` and [activate it](#activate-the-key)                         |
| `credits_exhausted` | The runtime runs at the free rate since its org has no credits or owes its cap, and has used the rate, `because` `free_daily_limit` or `free_month_used`; or its offline credits are spent, `because: "none_left"`                                                                               | An owner adds credits at `resolve_at`, Billing in Studio, which the runtime takes at its next report; or requests more offline credits |
| `license_invalid`   | The runtime runs at the free rate since its key was rotated or removed, its organization is closed, it has been out of touch since its license's `limit_at` or it has not activated its key, and has used the rate; or its offline credits stopped; or a key it was given to activate is invalid | Its `detail` says which, and how to put it right at `resolve_at`                                                                       |
| `meter_unavailable` | The runtime could not read or write its own ledger to admit the run, or could not reach Auto to activate a key                                                                                                                                                                                   | Ask again shortly                                                                                                                      |

The `detail` of a refusal at the free rate says why the runtime runs at it, which limit it reached and when it lifts, and how to put it right:

| Case                    | Kind and `detail`                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No key                  | `license_required`: `This runtime has used its 100 free runs. Without a license key, it runs at the free rate of 15 runs a UTC day and 75 a UTC month.`, or `This runtime has no license key, so it runs at …` for one that held a key once, then the limit, then `To run more, get a free key at {resolve_at}, then activate it on the runtime.` |
| No credits              | `credits_exhausted`: `This runtime's organization has no credits left, so it runs at the free rate of …`, the limit, `The account holder or an organization admin can add credits at {resolve_at}. The runtime picks them up at its next report, within the hour.`                                                                                |
| The overage cap         | `credits_exhausted`: `This runtime's organization has reached its overage cap of {cap} credits, so it runs at …`, the limit, `The account holder or an organization admin can add credits at {resolve_at}; they repay what's owed first. The runtime picks them up at its next report, within the hour.`                                          |
| Out of touch            | `license_invalid`: `This runtime hasn't reached Auto since {date}, so it has run at … since {date}.`, the limit, `Check that it can reach billing.on.auto. It returns to its organization's credits at its next report.`                                                                                                                          |
| The key was rotated     | `license_invalid`: `This runtime's key was replaced, so it runs at …`, the limit, `Activate the new key shown when it was rotated. If that key is lost, the account holder or an organization admin can rotate it again at {resolve_at}.`                                                                                                         |
| The runtime was removed | `license_invalid`: `This runtime was removed from its organization, so it runs at …`, the limit, `To use its organization's credits again, the account holder or an organization admin can register it again at {resolve_at}. Then activate the new key.`                                                                                         |
| The org was closed      | `license_invalid`: `This runtime's organization at Auto is closed, so it runs at …`, the limit, then how to restore the organization or activate a key from another                                                                                                                                                                               |
| A key not yet activated | `license_invalid`: `This runtime has a key it hasn't activated with Auto yet, so it runs at …`, the limit, `Check that it can reach billing.on.auto. It activates the key at its next report, within the hour.`                                                                                                                                   |

The limit reads `It has used today's 15 free runs and can run again at 00:00 UTC on {date}.` or `It has used this month's 75 free runs and can run again at 00:00 UTC on {date}.`

Activating a key can be refused too: as `license_invalid` for a key that is not one of Studio's, one Auto does not know, one for another runtime, one that was rotated (`because: "key_rotated"`) or removed (`because: "installation_revoked"`), or a license not signed by Auto; and as `account_closed` for a key of an org whose account is closed, `because: "org_deleted"` while an owner can still restore it, until the date at the `resolve_at` Auto gives, or `"org_purged"` once it is gone for good.

A run asked again under the run id of one that already started is never refused, and counts nothing more. Reading runs and events, editing definitions and exporting go on whatever the license says.

A workflow is not stopped by these refusals at once. When a step calls a function or a workflow the runtime refuses as `license_required`, `license_invalid`, `credits_exhausted` or `meter_unavailable`, the step waits, says in the run's history what it waits for and where to put it right, and asks again: after a minute, then twice as long each time up to an hour, for 24 hours. Once the free rate lifts, a key is activated or the runtime takes credits at its next report, the workflow goes on from that step, and the steps before it are neither run nor counted again. [When the runtime will not start the run for now](../reference/workflow-format.md#when-the-runtime-will-not-start-the-run-for-now) gives the details.

## Offline runtimes

A runtime that never reaches Auto, behind an air gap or a network that lets nothing out, cannot report to its org. For it, an operator of Auto issues offline credits: credits moved out of the org's account for that runtime alone, which it spends itself, signed by Auto like every answer the runtime takes, and usable for 30 days from when they were issued or last refreshed, or 90 under an Enterprise order. Ask for them through [Studio's support page](https://studio.on.auto/support), naming the runtime id.

Give the runtime its offline credits, and its key, which signs its reports, in any of these ways. None of them needs Auto: the runtime checks the credits against Auto's public key, which it ships, and keeps them in its ledger.

- **The environment.** Set `AUTO_RUNTIME_ALLOCATION` to their JSON, `{"payload":"…","signature":"…","kid":"…"}`, and `AUTO_RUNTIME_LICENSE_KEY` to the key.
- **The configuration file.** Write references to the variables that hold them:

  ```yaml
  license:
    key: ${ACME_LICENSE_KEY}
    allocation: ${ACME_ALLOCATION}
  ```

- **The command.** With Auto Runtime running on your computer, `npx -y @on.auto/runtime license allocation '<their JSON>'`, which says what the runtime holds: `Offline credits: 0 of 50 used, usable until 2026-11-27.`
- **The API.** `POST /v1/orgs/{org}/license/allocation` with `{ "allocation": { "payload": "…", "signature": "…", "kid": "…" } }`.

While it holds offline credits, the runtime starts each new run against them and asks Auto nothing. It counts what it spent from its own record of the runs it admitted since it took them; replicas of one ledger admit exactly that many between them. Past the date Auto signed into them the runtime refuses new runs as `license_invalid`, `This offline allocation expired on 2026-11-27. The account holder or an organization admin can request a new allocation at https://studio.on.auto/licenses?installation=…`, and once they are spent as `credits_exhausted` with `because: "none_left"`, `This runtime has used all 50 offline credits. The account holder or an organization admin can request more at https://studio.on.auto/licenses?installation=…`, each with that page in `resolve_at`.

A runtime that does reach Auto now and then refreshes its offline credits every day, which gives them their days again, and sends Auto a report of what it spent every hour. One that never does needs an owner to carry its reports to Studio:

1. Make the next report on the runtime: `npx -y @on.auto/runtime license report`, or `POST /v1/orgs/{org}/license/allocation/report`. It prints `{"report":{"allocation":…,"installation":…,"sequence":…,"spent":…,"at":…},"signature":…}`: all the runtime spent of them so far, under the next number, signed with its key.
2. Upload it in Studio, on the runtime's page under Licenses.

Each report counts everything spent, so a later report replaces an earlier one, and a lost report costs nothing. Auto freezes offline credits whose report counts fewer runs than one before it, or comes under a number it already took, as a ledger restored from an older copy does; reach Auto through support to have it looked at. When Auto closes them, the runtime gives them up at its next refresh and runs by its key, or without one, from then on.
