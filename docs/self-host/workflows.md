# Workflow storage and failover

The server runs its workflows itself, in its own process, and keeps their state in the ledger's database. Nothing runs beside the server, in development or in a container.

Every server, whether started with npx or Docker, runs workflows and serves `send_run_event`, with nothing to configure. When several servers share a database, one of them runs the workflows and the others stand by, ready to take over.

## What you need to do

- Install nothing more. The workflows run in the server you already run.
- Run the server as an always-on service. A server that is paused or scaled to zero stops waiting workflows until it wakes; see [Run it as an always-on service](production.md#run-it-as-an-always-on-service).
- Back up the ledger's database. It holds the workflows too.
- Restrict who can read the database. A run's log holds what the run was given and what it did; see [Who a run acts for](#who-a-run-acts-for).
- With several servers, share one PostgreSQL database, and never run two versions at once; see [How several servers share the workflows](#how-several-servers-share-the-workflows).
- Watch the warnings in [What the logs say](#what-the-logs-say). `/health` says only whether the server is alive.

## Where a run is kept

Workflow state lives in the ledger's database, beside the playbook's records: the SQLite file of `LEDGER_FILE`, or the PostgreSQL database of `DATABASE_URL`. Back it up together with the rest of the ledger. The server creates the tables it needs there when it starts. A run's log is part of the ledger, and a run's history and the playbook's events read it.

For internals, the [workflow host's README](https://github.com/BeOnAuto/runtime/blob/main/packages/workflow-host/README.md#where-a-run-is-kept) lists the tables, and the [engine's README](https://github.com/BeOnAuto/runtime/blob/main/packages/workflow-engine/README.md#due-runs-and-the-sweep) describes the sweep.

## Sweeps

The server checks its waiting runs at a fixed interval, `WORKFLOW_SWEEP_INTERVAL`, one second unless set. Each check is a sweep. A sweep picks up work that stalled, such as a run overdue by more than a minute or a call that nothing is running. A timer fires when it is due, without waiting for a sweep.

## How several servers share the workflows

Several servers may share a database. One of them runs its workflows at a time.

The claim:

- The server that runs the workflows holds a claim on them, kept in the database.
- It renews the claim at every sweep.
- The claim lapses three sweeps, and at least three seconds, after it was last renewed. A shorter pause of that server, such as for garbage collection, does not hand its workflows to another server.
- On PostgreSQL, the database's own clock takes, renews and judges the claim, so the servers' clocks need not agree. On SQLite, one server holds the file, and that server's clock is used.

A server that finds the claim held by another stands by:

- It serves every other operation: runs of functions, reads, answers to requests and `cancel_run`.
- It refuses two operations as `unavailable`: starting a workflow run with `run_definition`, and `send_run_event`. The detail reads `The workflows of this database run in another server; ...`. Over HTTP the response is `503`, with `Retry-After`.
- A start it refuses leaves nothing behind that blocks a retry: the same request under the same `run_id` starts the run once it reaches the server that holds the claim.
- It warns once when it starts standing by, such as at start-up, and names the holder.
- It tries the claim at every sweep.

Taking over:

- A server standing by takes the workflows over, with a warning, once the claim has lapsed or been released. A claim lapses, for example, when the server that held it dies. It is released when that server stops.
- After a server that held the claim dies, another takes the workflows over within about three seconds and a sweep. After it stops cleanly, another takes them over at its next sweep.
- A server that cannot renew its claim for as long as a claim lasts stops running workflows and stands by, since another may then hold it.

Only the logs say which server holds the claim. `/health` responds the same on every server. Each server names itself by a random id that changes at every start: a server standing by names the holder's id in its warning, and a server that takes over names its own. So a load balancer cannot route workflow operations to the holder. [Choose one server or a standby](production.md#run-several-servers) sets out the deployment shapes that work.

### Upgrade several servers

Servers of different versions never share a database at the same time:

1. Stop every server of the old version.
2. Start one server of the new version. A version that adds a table fills it from the ledger's history at its first start, before it accepts requests, under the database's migration lock.
3. Start the others once the first is ready. A server that starts meanwhile waits for that lock for up to 60 seconds, then stops if it is still held. Start it again.

## Starting, stopping and restarting

At start-up every server logs one line with the values of the [settings](#settings), whether it runs the workflows or stands by:

```text
Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms
```

When it stops, the server:

1. finishes the starts and events it already accepted, and the step each run is taking, and records them;
2. cuts off the calls in flight, without waiting for a call to end;
3. releases its claim on the workflows, so a server standing by takes them over at its next sweep;
4. closes the database.

What happens to the work it stopped:

- A call cut off stays recorded. It runs again under the same run id when the server next starts, except an interaction function's run that may have called its tool; a reasoning function's run goes on from what it recorded ([Retrying under a run id](../reference/http.md#retrying-under-a-run-id)). A nested run that already has a final result returns it from the ledger.
- A call that waits for a run that finishes later, such as another workflow's, is not cut off. It keeps waiting without taking one of the calls that run at once. The end of that run completes the call whenever it is recorded, on whichever server.
- The first sweep after a start fires the timers that came due while the server was stopped. It also carries out what a run had decided but not yet done, and resumes the calls.

## Settings

Four settings bound the workflows: `WORKFLOW_MAX_DURATION`, `WORKFLOW_NESTED_RUNS`, `WORKFLOW_MAX_OPEN_CALLS` and `WORKFLOW_SWEEP_INTERVAL`. [Workflows](configuration.md#workflows) in the configuration reference lists their defaults and ranges. What each does to running workflows:

| Setting                   | Effect                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `WORKFLOW_MAX_DURATION`   | A run that lasts this long ends; see [How a run ends](#how-a-run-ends)                                                 |
| `WORKFLOW_NESTED_RUNS`    | The calls the server runs at once, shared by every org; see [Limits and sharing](#limits-and-sharing)                  |
| `WORKFLOW_MAX_OPEN_CALLS` | The calls that may wait under one run at the top of a tree. A call beyond it is rejected as `conflict` and not started |
| `WORKFLOW_SWEEP_INTERVAL` | How often the server [sweeps](#sweeps). A claim lasts three sweeps, and at least three seconds                         |

A setting the server cannot read stops it at start-up, naming the setting and what it expects, never its value.

## Who a run acts for

- A run acts for the caller who started it, with the permissions that caller had then, for as long as it runs. That is at most `WORKFLOW_MAX_DURATION`.
- Revoking the caller's key, or the person's sign-in, does not stop the run; `cancel_run` does. See [What happens when access is revoked](../reference/authentication.md#what-happens-when-access-is-revoked).
- A run's log holds its document, its input, the outputs of the functions it calls, the events sent to it and the identity of the caller who started it. It is in the ledger's database like the playbook's other records, and whoever can read the database can read it.

## How a run ends

A run ends in one of these ways:

- by itself;
- by a `timeout` its document sets;
- when it has run `WORKFLOW_MAX_DURATION`, which ends it `rejected` as `cancelled` of the kind `overrun`;
- by `cancel_run`.

`cancel_run` cancels a run that has not ended. The request is recorded on whichever server receives it. The server that holds the claim on the workflows then stops the run, which cancels the runs it waits for. [Workflow format](../reference/workflow-format.md) lists the statuses and rejection kinds.

### Settling a run

When a run ends, the server records its end in the ledger. Until then, `get_run` shows the run as `started`.

- If the ledger cannot record the end, for example while it cannot be reached, the server tries again at every sweep.
- After 20 attempts, it tries once a minute until the end is recorded.
- The server warns once when it starts trying once a minute, and once when the end is recorded.
- A run the ledger does not have, or one whose end was already recorded otherwise, is logged as an error with its org, playbook, run id and reason.

See [A run stays started](troubleshooting.md#a-run-stays-started).

## Limits and sharing

- There are no limits for one org and no fairness between orgs. Every org's runs share the server's thread and its `WORKFLOW_NESTED_RUNS` calls at a time.
- The server keeps at most 1,024 runs loaded in memory, and 64 MiB of the data they hold.
- A run holds at most 4 MiB.
- [Plan memory](production.md#plan-memory) has the memory the server takes.

The [engine's README](https://github.com/BeOnAuto/runtime/blob/main/packages/workflow-engine/README.md#limits) lists the limits of a run. The [host's README](https://github.com/BeOnAuto/runtime/blob/main/packages/workflow-host/README.md#measurements) shows how late timers fire and how fast runs go on each store.

## What the logs say

`/health` says whether the server is alive, not whether its workflows move. The server logs workflow trouble as warnings, each saying what failed and what happens next. The cause is in the line's `error`, cut at 2,000 characters.

| Message                                                                                                                                                          | Level   | What it means                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `Workflows run in this server: ...`                                                                                                                              | info    | The server started, with the workflow settings it read                             |
| `The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops renewing its claim` | warning | This server stands by; `holder` names the server that runs them                    |
| `This server took over the workflows of its database, since the server that ran them stopped renewing its claim`                                                 | warning | This server now runs the workflows; `holder` is its own id                         |
| `The claim of this server on the workflows of its database could not be renewed`                                                                                 | warning | It stands by if this lasts as long as a claim                                      |
| `A sweep of the runs failed; the next sweep tries again`                                                                                                         | warning | The next sweep tries again                                                         |
| `A timer of a run could not fire; it fires again at the next sweep`                                                                                              | warning | The timer fires late                                                               |
| `An answer of a call could not be recorded; it is written again until it is`                                                                                     | warning | The server keeps writing the call's result                                         |
| `A call could not record its answer`                                                                                                                             | warning | A call's result was not recorded                                                   |
| `An answer of a call could not be given to its run`                                                                                                              | warning | A recorded result did not reach its run                                            |
| `A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one`                                                     | warning | PostgreSQL only; the workflows share the ledger's connections, and it reconnects   |
| `A run could not be settled in <n> attempts; it is tried again once a minute until it is`                                                                        | warning | The end of the run is retried once a minute; see [Settling a run](#settling-a-run) |
| `A run that could not be settled was settled at attempt <n>`                                                                                                     | warning | The end of the run was recorded                                                    |
| `A run stays started because settling it failed`                                                                                                                 | error   | `reason` is `The ledger has no such run` or `The run was settled otherwise before` |

Other warnings, about triggers, listeners and the views of recall functions, follow the same form: what failed, then what the server does next.
