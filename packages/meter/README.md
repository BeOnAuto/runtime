# @on.auto/meter

The meter of the runtime: it counts the actions a ledger holds and admits each new run against what the runtime may run. An action is a run of a workflow or a function, counted once by its `run_id`, however often it is run again under that id, retried or resumed. Nothing else is metered: no model call, compute or training costs anything here. The runtime is source-available under the Elastic License 2.0, and its meter is part of it. The server composes `ledgerMeter()` into every runtime it starts, and no setting, environment variable or command removes it; `@on.auto/definitions` refuses every run of a runtime composed without a `RunMeter` as a `metering_fault`. Only a test composes another meter, `recordingMeter` or `admittingMeter` of `@on.auto/definitions/testing`.

## The count is a projection of the ledger

An action is the first `run_started` of a run's stream, `playbook/<org>/<playbook>/runs/<id>`, in the ledger's global order, which `LedgerLog` of `@on.auto/ledger` reads. The count lives in the stream `meter` as `actions_counted` checkpoints, each with the number of actions, the point of the last event counted, that event's id, and a SHA-256 digest of the three. A checkpoint is a cache of the projection, never its source: the ledger is.

At each admission the meter loads the stream `meter` and checks its checkpoint:

- A stream with no checkpoint is counted from the first event of the ledger. One whose digest does not match its checkpoint was edited, and is counted again from the first event, with a warning logged.
- The event at the checkpoint's point must still be the event whose id it holds. When no event stands there, history was removed; when another does, it was rewritten. Either records `metering_faulted`.
- Otherwise the meter counts the run starts after the checkpoint, each the first of its stream when its version is that of the stream's first `run_started`, and reads only the events since the checkpoint.

At its start, and at every 1,000th admission, it counts the whole ledger again and compares: a count lower than the checkpoint's means events it counted were removed, and records `metering_faulted`; a higher one means the checkpoint was forged with its digest, and replaces it, with a warning logged. An event the log cannot read in that range records `metering_faulted` too, rather than be skipped.

## Faults

A fault is the event `metering_faulted` on the stream `meter`, with its reason, `history_removed`, `history_rewritten` or `unreadable`. While it stands, every run is refused as a `conflict` of the kind `metering_fault`, whose words link to the support page of Studio, at the origin `STUDIO_ORIGIN` names. It survives restarts; reading, editing and exporting go on. A ledger the meter cannot reach refuses the run as `unavailable` of the kind `meter_unavailable`, which the caller may ask again.

## Unregistered runtimes

A runtime nobody registered admits 100 actions. An admission appends `action_admitted`, which holds a place for the run until its `run_started` is counted, or for ten minutes, with the stream's expected version: of two admissions that read the same version, one appends and the other reads again, so replicas of one ledger admit exactly 100 between them. The 101st is refused as a `conflict` of the kind `license_required`, whose words link to the page of Studio that registers the installation, by the id `installation_identified` records on the stream `meter` at its first admission. A fresh ledger is a new installation, and counts again from nothing.

## Testing

`src/testing/meter-behaviour.ts` runs on SQLite and on PostgreSQL, in `src/admission/ledger-meter.test.ts`, each test on a database of its own: counting once per run id across orgs and playbooks, incremental counts equal to counts from the first event over random ledgers, what was started before the ledger was metered, the checkpoint's fields and digest, a catch-up over 100,000 events that reads only the six appended since, verification at the start and at the interval, rebuilds, the faults and their restarts, a ledger that cannot be read, the allowance with its link, holds that lapse, exactly 100 of 200 admissions asked at once on two replicas, and admissions, starts and catch-ups racing on two replicas. Its tests change the stored events as an operator could, through `tamperingOn` of `src/testing/ledgers.ts`; the meter itself runs no SQL. `src/counting/run-starts.test.ts` checks over 2,000 random logs in memory that a count from any checkpoint equals a count from the first event. Run it with PostgreSQL as the ledger's README says, with `LEDGER_TEST_POSTGRESQL_URL` set.
