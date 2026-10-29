---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Self-hosted licensing reference

The rules a runtime you host follows: what it runs without a key and with one, how it reports to Auto, when it falls back to the free rate, how offline credits work, what it sends Auto and every refusal of its meter. [License a self-hosted runtime](licenses.md) gives the steps. [How billing works](https://on.auto/docs/cloud/billing) explains an organization's credits, which hosted Auto and its runtimes share.

## What is counted

| Rule                   | Detail                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A run                  | A run of a workflow or a function. A workflow's call to a function or another workflow is a run of its own                                                                         |
| Once by its run id     | A run asked again under its id, retried or resumed counts nothing more. A run asked again before it starts is held for ten minutes, and counts once                                |
| Nothing else           | Model calls, tools, computing and storage are never counted                                                                                                                        |
| The meter's own record | The runtime counts from its record of the runs it admitted, kept in its ledger. It never counts your run history again, so deleting, redacting or restoring history never stops it |
| The whole runtime      | One key licenses every organization and playbook the runtime holds. All its licensed runs are charged to the organization the key names                                            |

A fresh ledger is a new runtime, and counts again from nothing.

## Without a key

A runtime without a key never calls Auto's account service. It counts its runs itself:

| Runs          | Rule                                                         |
| ------------- | ------------------------------------------------------------ |
| The first 100 | Admitted, once per runtime                                   |
| After that    | The free rate: 15 runs a UTC day and 75 a UTC calendar month |

Only runs at the free rate count toward its daily and monthly limits. The daily limit lifts at 00:00 UTC, and the monthly one at 00:00 UTC on the first of the next month. Runs at the free rate never use credits.

## With a key

A key is `alk.<org>.<runtime id>.<secret>`, made in Studio when an admin registers the runtime. With it, the runtime starts runs on its organization's credits against a license Auto signs.

### Activation

The runtime activates a key it holds no license for: as it starts, and as soon as the key is activated by the command, Studio or the API. It sends Auto its runtime id and its counts, and Auto answers a license. The runtime checks the license against Auto's public key, which it ships. No setting adds or replaces that key, and a license not signed by Auto, or signed for another runtime, is refused as `license_invalid`.

Until Auto has answered for a key, the runtime runs at the free rate. One that has never held a license still runs its first 100 runs.

Whenever it takes a license, the runtime raises its licensed count to the license's `charged_through` where it is lower. A ledger wiped, or restored from an older copy, and started again with the same key gains no runs back.

### The license

| Field                     | Meaning                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org`, `org_name`, `plan` | The organization the key names, its name at Auto and its plan: `free`, `starter`, `team`, `custom`, or `enterprise` while an Enterprise order is in force |
| `policy`                  | The version of the plan's numbers, such as `2026-10-28`                                                                                                   |
| `issued_at`               | When Auto signed the license                                                                                                                              |
| `warn_at`                 | 14 days after `issued_at`, or what an Enterprise order sets                                                                                               |
| `limit_at`                | 28 days after `issued_at`, or what an Enterprise order sets                                                                                               |
| `charged_through`         | The licensed runs Auto has taken credits for, in all                                                                                                      |
| `admits_through`          | The runtime may start runs on the license while its licensed count is below this                                                                          |
| `standing`                | Where the organization's credits stood: `ok`, `low`, `empty`, `overage`, `near_cap` or `capped`                                                           |
| `credits`                 | `{ available, owed, overage_cap }`: what the organization could spend, what it owed in overage and the most it may owe                                    |
| `fallback`                | `{ per_day, per_month }`: the free rate the runtime falls back to                                                                                         |
| `features`                | The [features](#features) the organization's agreement includes, such as `prediction-onnx`; none where the license lists none                             |

`admits_through` is the higher of `charged_through` and the licensed count the runtime reported, plus what the organization may still spend. On a paid plan, that is its available credits plus its overage cap, less what it owes. On Free, it is its available credits, counting Free plan credits only up to what is left of the day's 15.

| `standing` | The organization                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`       | Holds enough credits                                                                                                                                                                                      |
| `low`      | Holds less than a fifth of its plan's monthly credits                                                                                                                                                     |
| `empty`    | Has no credits left, on a plan that may still go into overage                                                                                                                                             |
| `overage`  | Owes overage                                                                                                                                                                                              |
| `near_cap` | Owes four fifths of its overage cap or more                                                                                                                                                               |
| `capped`   | Can spend and owe nothing more, so its runtimes fall back to the free rate. On Free, it has no credits it can spend now, which includes a day whose 15 Free plan credits are spent with nothing else left |

### Admission

The runtime asks Auto nothing for a run. It starts a run on its license while all of these hold:

- Auto has not refused the key in force;
- the time is before the license's `limit_at`;
- its licensed count is below the license's `admits_through`.

Otherwise it starts the run at the free rate the last license carried. A runtime that has held a license once gets no new first 100 runs.

### Reports

| When                  | What the runtime does                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| As it starts          | Reports, or activates a key it holds no license for                                                                                                        |
| Every hour            | Reports                                                                                                                                                    |
| Early                 | Reports once it has used half of what its last license left it. It checks every minute, at most one report a minute, and only while it runs on its license |
| As it stops           | Reports once more, within five seconds                                                                                                                     |
| After a failed report | Asks again 15 minutes later                                                                                                                                |

Each report sends the runtime's counts. Auto takes credits for the licensed runs it has not charged before, never twice for the same count, and answers a fresh license. It takes the credits that expire soonest first, and Free plan credits only up to what is left of the day's 15. What credits can't cover is owed as overage on a plan that has it, and written off on Free.

A count lower than what Auto already charged takes nothing. Auto flags it for its operators, and the runtime keeps running. A ledger restored from an older copy reports the lower count once, and counts on from `charged_through` after that.

When Auto can't be reached, or answers with something it did not sign for this runtime, the runtime keeps its last license.

## Overage

| Plan                      | Overage cap                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Free                      | None                                                                                                             |
| Starter, Team and Custom  | A quarter of the plan's monthly credits: 125 on Starter, 600 on Team                                             |
| Under an Enterprise order | The order's own cap, or else a quarter of a month of the order's credits, or the plan's cap where that is larger |

- On a plan with a cap, a licensed runtime keeps starting runs after the credits are gone, and the organization owes them.
- Once the organization owes its cap, its runtimes fall back to the free rate.
- Every runtime of the organization is allowed all the overage that is left until it reports. Several runtimes can go past the cap between reports. The early report keeps this small, and runs past the cap are owed too.
- The organization's next credits repay what it owes first. Auto never bills for overage.

[Overage](https://on.auto/docs/cloud/billing#overage) explains it for the whole organization.

## Falling back to the free rate

A runtime with a key never stops for time alone, and never stops outright. When it can't use its license, it runs at the free rate the last license carried, 15 runs a UTC day and 75 a UTC month, and uses no credits. `limited_because` in [`GET /v1/orgs/{org}/license`](../reference/http.md#license) says why:

| `limited_because` | When                                                                                                                     | Back on its license                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `credits`         | The organization is on Free and has no credits it can spend now, including once the day's 15 Free plan credits are spent | At its first report after credits arrive, or after the next UTC day begins, within the hour               |
| `cap`             | The organization owes its overage cap                                                                                    | At its first report after credits arrive, which repay what is owed first                                  |
| `out_of_touch`    | It hasn't reached Auto since its license's `limit_at`, 28 days after the license was issued                              | At its next report that reaches Auto                                                                      |
| `key_rotated`     | An admin rotated its key                                                                                                 | Once the new key is activated                                                                             |
| `key_revoked`     | An admin removed the runtime from its organization, or Auto no longer accepts its key                                    | Once it is registered again and its new key activated                                                     |
| `org_closed`      | Its organization at Auto was deleted                                                                                     | At its next report after the organization is restored, or once a key of another organization is activated |
| `not_activated`   | It holds a key Auto hasn't answered for yet                                                                              | At its next report, which activates the key                                                               |

From its license's `warn_at`, 14 days after the license was issued, a runtime that hasn't reached Auto says it is out of touch, and keeps running on its license until `limit_at`. Its state then reads `out_of_touch`.

Without a key, a runtime runs at the built-in free rate of 15 runs a UTC day and 75 a UTC month.

## Offline credits {#offline-credits}

Offline credits serve a runtime that can't reach Auto. Auto moves them out of the organization's credits for that runtime alone, and signs them. The runtime spends them itself and asks Auto nothing for a run. An admin requests them in Studio's Self-hosted page; [Run a runtime that can't reach Auto](licenses.md#offline) gives the steps.

| Rule               | Detail                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How long they last | 30 days from when they were issued or last refreshed, or 90 where Auto chooses it under an Enterprise order. Never past the earliest expiry of the credits they took |
| Which credits      | Any of the organization's credits except Free plan credits, the soonest to expire first                                                                              |
| Admission          | While they stand, they decide before a license or the first 100 runs                                                                                                 |
| Past their date    | A new run is refused as `license_invalid`                                                                                                                            |
| Once spent         | A new run is refused as `credits_exhausted` with `because: "none_left"`                                                                                              |
| Refresh            | A runtime that reaches Auto now and then refreshes them every day, which gives them their days again                                                                 |
| Reports            | A runtime that reaches Auto reports what it spent every hour. For one that never does, an admin carries its reports to Studio                                        |

Each report counts everything spent so far, under the next number. A later report replaces an earlier one, so a lost report costs nothing. Auto pauses offline credits whose report counts fewer runs than one before it, or reuses a number, as a ledger restored from an older copy does, until its operators have looked at them.

When Auto closes offline credits, what they didn't spend goes back to the credits it came from. A runtime that reaches Auto gives up closed or paused offline credits at its next refresh, and from then on runs by its key, or without one.

## Features {#features}

A feature is a part of Auto Runtime licensed on its own, beyond the runs a license admits. A license lists the features its organization's agreement includes, and a license that lists none includes none. Each is a name of lower-case letters, digits and hyphens; a name of another shape is left out, and the rest of the license stands. The ONNX model runtime, `@on.auto/prediction-onnx`, which is licensed separately and is not part of this repository, needs the feature `prediction-onnx`. The release's own model runtime, `series`, needs none, so it always runs.

The features in force are those of the license of the key in force: the license holds them until its `limit_at`, and past it while live offline credits stand. A license whose organization has run out of credits, or reached its overage cap, is still in force, so its features stand while its runs are limited to the free rate. Without a key, before the key is activated, once the license lapses at its `limit_at`, once its key is rotated or revoked or its organization closed, and once offline credits stop, no feature is in force. `GET /v1/orgs/{org}/license` lists them as `features`, and the command that activates a key ends with them, `Features: none.` where there are none.

A [model runtime](../reference/model-runtimes.md) that names a feature does its work only while the features in force include it. Every piece of its work is checked as it starts, so nothing it executes can run without the feature:

- A build offers a trainer none of its formats, and a candidate uploaded in one is refused `409` with the kind `feature_unlicensed`. Its `detail` says which feature the license does not include, which format it executes and where to add it, `This runtime's license does not include prediction-onnx, which executes onnx models. The account holder or an organization admin can add it at https://studio.on.auto/licenses?installation=….`, with that page in `resolve_at`.
- A candidate in one of its formats that a build has not scored yet is disqualified `feature_unlicensed`, and a model a build fits itself in one of them is refused `feature_unlicensed`, each in those words.
- A version in one of its formats is not walked in a shadow, which records why. A close at which either version was not walked decides nothing and uses up none of the shadow's closes, so a lapse never changes which version is active; the shadow goes on once the feature is back, within its most of 52 closes. A lapse that outlasts those 52 closes ends the shadow as failed for the challenger, which is not activated, and the active version stays active.
- A prediction function whose active version is in one of its formats answers from the runtime's own models, the [default forecast](../reference/prediction-format.md#the-default-forecast), and its record says why, `because: "feature_unlicensed"` and the `feature`. A default forecast whose model is in one of its formats is refused `feature_unlicensed`.
- A runtime that names a feature fits neither a build's candidates nor the default forecast while the license lacks it; the next runtime that fits does, as the release's `series` does.

When a feature stops being in force, nothing stops: each prediction function goes on answering, from the runtime's own models where its active version needs the feature, and candidates in those formats are refused until a license that lists the feature is in force again. The function's active version answers again from then on, with nothing to rebuild.

## What a runtime sends Auto

A runtime with a key, or with offline credits, calls Auto's account service at `https://billing.on.auto` (`ACCOUNTS_ORIGIN` in [Configuration](configuration.md)), over HTTPS. Each call carries the license key as its bearer token and gives up after 10 seconds.

| Call                                         | When                                       | It sends                                                                                                               |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/installations/activate`            | As it activates a key                      | `installation`, the runtime id; `actions`, every run its meter admitted; `licensed`, the runs it admitted on a license |
| `POST /v1/installations/reports`             | Each [report](#reports)                    | `actions` and `licensed`                                                                                               |
| `POST /v1/installations/allocations/refresh` | Every day, while it holds offline credits  | `allocation`, their id                                                                                                 |
| `POST /v1/installations/allocations/report`  | Every hour, while it holds offline credits | Their id, the runtime id, the report's number, the runs spent and when, with a signature made with the key             |

It never sends a run's id, a definition, an input or a result, or anything else a playbook holds. A runtime with neither a key nor offline credits makes none of these calls. The anonymous [usage ping](configuration.md#usage-ping) a runtime sends as it starts is separate, and can be turned off.

## Refusals

Each refusal of the meter is a problem document with the status 409, or 503 for `meter_unavailable`. Beside its `detail`, it gives `because`, its case; `resolve_at`, the page where a person puts it right; and `runtime_id`, the runtime's id. A refusal at the free rate also gives `lifts_at`, when the limit lifts, and, for a runtime that holds a key, `limited_because`, why it runs at the free rate, as in [Falling back](#falling-back-to-the-free-rate). [The refusals of the meter](../reference/http.md#the-refusals-of-the-meter) gives where each member appears.

| Kind                | When                                                                                                                                                         | `because`                                                                   | What puts it right                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `license_required`  | The runtime holds no key and has used the free rate                                                                                                          | `free_daily_limit` or `free_month_used`                                     | Wait until `lifts_at`, or get a free key at `resolve_at` and [activate it](licenses.md#activate-the-key) |
| `credits_exhausted` | The runtime runs at the free rate because its organization has no credits or owes its cap, and has used the rate. `limited_because` is `credits` or `cap`    | `free_daily_limit` or `free_month_used`                                     | An admin adds credits at `resolve_at`, Billing in Studio. The runtime takes them at its next report      |
| `credits_exhausted` | Its offline credits are spent                                                                                                                                | `none_left`                                                                 | An admin requests more at `resolve_at`                                                                   |
| `license_invalid`   | The runtime runs at the free rate for another reason in [Falling back](#falling-back-to-the-free-rate), which `limited_because` names, and has used the rate | `free_daily_limit` or `free_month_used`                                     | Its `detail` says what to do at `resolve_at`                                                             |
| `license_invalid`   | A key it was given to activate is refused                                                                                                                    | `key_rotated`, `installation_revoked`, or none                              | Its `detail` says why                                                                                    |
| `license_invalid`   | Its offline credits are past their date                                                                                                                      | None                                                                        | An admin requests new ones at `resolve_at`                                                               |
| `account_closed`    | A key it was given to activate belongs to a closed organization                                                                                              | `org_deleted` while the organization can still be restored, or `org_purged` | Its `detail` is in the account's words, and `resolve_at` is the page for restoring the organization      |
| `meter_unavailable` | The runtime couldn't read or write its ledger, or couldn't reach Auto to activate a key                                                                      | None                                                                        | Ask again shortly                                                                                        |

`lifts_at` is in ISO 8601 UTC: 00:00 UTC the next day for `free_daily_limit`, and 00:00 UTC on the first of the next month for `free_month_used`.

A run asked again under the id of a run that already started is never refused, and counts nothing more. Reading runs and events, editing definitions and exporting carry on whatever the license says.

A workflow whose call is refused with `license_required`, `license_invalid`, `credits_exhausted` or `meter_unavailable` waits at that step for up to 24 hours and tries again. [When the runtime will not start the run for now](../reference/workflow-format.md#when-the-runtime-will-not-start-the-run-for-now) gives the details.

### The words of a refusal at the free rate

Its `detail` says why the runtime runs at the free rate, which limit it reached and when it lifts, then how to put it right. In the words below, `{rate}` is `the free rate of 15 runs a UTC day and 75 a UTC month`, with the numbers the last license carried. `{limit}` is `It has used all of today's free runs, so it can start runs again at 00:00 UTC on {date}.` or `It has used all of this month's free runs, so it can start runs again at 00:00 UTC on {date}.`, the same time as `lifts_at`.

| Case                                                         | `detail`                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No key, never licensed: `license_required`                   | `This runtime has used its 100 free runs. Without a license key, it's limited to {rate}. {limit} To run more, get a free license key at {resolve_at} and activate it on this runtime.`                                                                                                                                                            |
| No key, licensed before: `license_required`                  | `This runtime has no license key, so it's limited to {rate}. {limit} To run more, get a free license key at {resolve_at} and activate it on this runtime.`                                                                                                                                                                                        |
| No credits: `credits_exhausted`, `credits`                   | `This runtime's organization is out of credits, so the runtime is limited to {rate}. {limit} The account holder or an organization admin can add credits at {resolve_at}; the runtime picks them up within the hour.`                                                                                                                             |
| The overage cap: `credits_exhausted`, `cap`                  | `This runtime's organization has reached its overage cap of {cap} credits, so the runtime is limited to {rate}. {limit} The account holder or an organization admin can add credits at {resolve_at}. New credits repay the overage first, and the runtime picks them up within the hour.`                                                         |
| Out of touch: `license_invalid`, `out_of_touch`              | `This runtime hasn't reached Auto since {date}, so it has been limited to {rate} since {date}. {limit} Make sure it can reach billing.on.auto. It goes back to its organization's credits at its next report, within the hour.`                                                                                                                   |
| The key was rotated: `license_invalid`, `key_rotated`        | `This runtime's license key was replaced, so it's limited to {rate}. {limit} Activate the new key that was shown when the key was rotated. If that key is lost, the account holder or an organization admin can rotate it again at {resolve_at}.`                                                                                                 |
| The runtime was removed: `license_invalid`, `key_revoked`    | `This runtime was removed from its organization, so it's limited to {rate}. {limit} To use the organization's credits again, the account holder or an organization admin can register it again at {resolve_at}, then activate the new key.`                                                                                                       |
| The key isn't accepted: `license_invalid`, `key_revoked`     | `Auto no longer accepts this runtime's license key, so it's limited to {rate}. {limit} The account holder or an organization admin can register this runtime at {resolve_at}, then activate the new key.`                                                                                                                                         |
| The organization was closed: `license_invalid`, `org_closed` | `This runtime's organization at Auto is closed, so it's limited to {rate}. {limit}`, then how to have the organization restored, or to register the runtime with another organization                                                                                                                                                             |
| A key not yet activated: `license_invalid`, `not_activated`  | `This runtime's license key isn't activated yet, so it's limited to {rate}. {limit} Make sure it can reach billing.on.auto. It activates the key at its next report, within the hour.` A runtime that never held a license starts with `This runtime has used its 100 free runs. Its license key isn't activated yet, so it's limited to {rate}.` |

### The words of other refusals

| Case                                                         | `detail`                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activating a rotated key: `license_invalid`                  | `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at {resolve_at}.`                                                       |
| Activating the key of a removed runtime: `license_invalid`   | `This runtime was removed from its org. To use it again, an owner can register it again at {resolve_at}, then activate the new key and run this again.`                                                                                       |
| Activating any other key Auto refuses: `license_invalid`     | `This runtime's license is invalid:` and why, such as a key for another runtime or a license not signed by Auto, then `Activate a license key for this runtime. The account holder or an organization admin can register it at {resolve_at}.` |
| Offline credits past their date: `license_invalid`           | `This runtime's offline credits expired on {date}, so it can't start runs. The account holder or an organization admin can request new offline credits at {resolve_at}.`                                                                      |
| Offline credits spent: `credits_exhausted`                   | `This runtime has used its {credits} offline credits, so it can't start more runs. The account holder or an organization admin can request more offline credits at {resolve_at}.`                                                             |
| The ledger can't be read: `meter_unavailable`                | `The run could not start because the runtime could not read its ledger. Try again shortly.`                                                                                                                                                   |
| Auto can't be reached to activate a key: `meter_unavailable` | `The license could not be activated because the runtime could not contact Auto. Try again shortly.`                                                                                                                                           |
