---
description: 'How a workflow starts on its own: the triggers of its schedule, on an event, at set times or every so often, the input of a run they start, when they apply and their limits.'
---

<div v-pre>

# Triggers

A workflow whose document has a `schedule` starts on its own, as well as when a caller runs it. The schedule names up to three triggers: an event trigger, `on`, and two kinds of schedule trigger, `cron` and `every`. Each trigger is kept and matched on its own, so a workflow can start on an event and at its times.

| Trigger          | Starts a run                                                        | Input of the run                    |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `schedule.on`    | For each event of the playbook that one of its filters matches      | A list holding the event            |
| `schedule.cron`  | At each time its five fields name, in its time zone                 | `{ "schedule": { "due": <time> } }` |
| `schedule.every` | At each multiple of its period after the trigger was saved as it is | `{ "schedule": { "due": <time> } }` |

This schedule starts a run for each high-priority brief submitted. It also starts one at 09:00 UTC on working days, and one every fifteen minutes:

```yaml
schedule:
  on:
    one:
      with: { type: com.example.brief.submitted, data: '${ $data.priority === "high" }' }
  cron: '0 9 * * 1-5'
  every: PT15M
```

- A trigger is identified by its kind, `event`, `cron` or `every`, and its place in the document, `/schedule/on`, `/schedule/cron` or `/schedule/every`.
- `get_definition` of an active workflow with triggers also shows `triggers_since`, the id of the record that saved its current version. From that record on, what its triggers start is a run of that version.
- A run that a trigger started names its trigger on its `run_started` event, whose words say which kind started it, such as "was started by its cron schedule".
- No trigger has an input of its own. A run's input is the list holding the event, or the due time, so a workflow with both kinds tells them apart with `input.from` or a `switch`:

```yaml
input:
  from: '${ Array.isArray($data) ? { month: $data[0].data.month } : { due: $data.schedule.due } }'
```

## Event filters

`on.one` takes one filter, and `on.any` a list of 1 to 64 filters; a run starts when any of them matches. Each filter is written as [Events](events.md), the `events` guide, says, and takes the events it sets out:

- the playbook's facts about runs and definitions, such as `run_succeeded` and `definition_created`;
- the events published with `publish_event`, or emitted by workflows.

A filter names the `type` of its events, written out. It may name any other attribute, such as `source`, `subject` or `caller`, and `data`, as a value or as an expression over the event's data alone: `data: '${ $data.region === "eu" }'`. A run's fact never carries the run's input, and a filter that names an attribute the event does not have does not match it.

Each filter is held to its own bounds, and its failure affects no other workflow's filter. The bounds are 250 checkpoints of work for an expression, 500 for the filter, 200 milliseconds of the server's time and a sandbox of 64 MiB. An expression that raises on an event, or does more than its work, does not match that event. A filter stopped by its deadline or its memory leaves the event to be matched again later, and one stopped 3 times in a row is not evaluated again for that version. [When a filter goes past its bounds](../guides/triggers.md#when-a-filter-goes-past-its-bounds) says what the playbook records of each and what to do.

## Schedules

- `cron` has the five fields minute, hour, day of month, month and day of week, read in its time zone, and must name a time. When both day of month and day of week are restricted, a day that matches either is due.
- `time_zone`, the runtime's own beside the DSL's keys, names the time zone of `cron` by its IANA name, such as `America/New_York`; without it, `cron` is read in UTC. The five fields are matched against the time the clocks show there, through daylight saving, so `cron: '0 9 * * *'` with `time_zone: Europe/London` is due at 09:00 in London each day, 09:00 UTC in winter and 08:00 UTC in summer. A time the clocks skip when they go forward is due once, at the first instant after the skip; a time they show twice when they go back is due once, at the first.
- `every` is a [duration](workflow-format.md#durations) of at least a minute, counted from when the trigger was saved as it is.
- The due time a run gets, `schedule.due`, is an ISO 8601 instant in UTC, whatever the time zone of its schedule. It is all the run gets: the [`schedule` recipe](mcp.md#guides-and-prompts) shows how it finds what is new.

## When a trigger applies

- A trigger applies from the moment it is saved as it is: it matches what the playbook records from then on, whatever an event's `time` says.
- The saving itself is the first thing it can match. So a trigger that names `definition_created` also starts on its own workflow's definition being saved. To leave that out, name the definition it waits for by its `source`, such as `source: /definitions/reasoning/summarize`.
- A new version's triggers are compared with those of the version before, by kind and place. A trigger it leaves unchanged goes on as it was, with its times and its running run. From then on it starts the new version. A trigger it changes or adds applies from the new version's saving; a changed schedule counts its times from then. A trigger it removes stops.
- Saving a version without a schedule, or retiring the workflow, stops every trigger.
- A run that a trigger starts uses the version that was current when the event was recorded or the time came. Its `run_id` is derived from the workflow, that version, the trigger and the event or due time. So an event or a time starts it once. A run it started that is rejected or fails is not started again, and the same event published again records nothing; the [`schedule` recipe](mcp.md#guides-and-prompts) says how to catch up.
- The playbook itself starts a triggered run, which acts as the playbook. Its `started_by` has the `id` `playbook:` and the playbook's id, and the playbook's id as its `name`. Each step may read and write that playbook and nothing else, and no person's or key's permissions or revocation affect it.
- A triggered run names, as `acts_for`, the person it acts for, by id: whoever saved or restored the version it runs. It grants the run nothing. The runs its steps start carry it, and `get_run` and the run's events show it. A version a key saved or restored gives none, and so does one whose person has left the organization, where the runtime knows its members.

## Trigger limits

- A workflow does not start for what its own runs caused, whichever of its triggers started them. That covers a fact about one of its runs, a fact about a run that one of its runs started, and an event that one of its runs emitted.
- A chain of runs started by events stops at a depth of 8. An event published from outside has depth 1. An event or fact about a run has one more than the run. A run that a trigger starts takes the depth of what it matched. A match deeper than 8 starts nothing.
- A workflow's event trigger starts at most 60 runs of it a minute, across its filters. More wait for a later minute, up to 1,000 of them; one more is refused. The runs of its schedules are not counted.
- A schedule trigger has one run at a time. A time that comes due while the schedule's previous run is still running, of this version or an earlier one, is skipped. After the runtime was stopped, only the latest of the times it missed runs.
- An event and a due time in one moment start two runs, and so do a `cron` and an `every` due at the same time.
- A start that the playbook refuses, for example once the playbook is retired, or once the organization's credits or a self-hosted runtime's free runs are spent, is not tried again. An event trigger's start the playbook cannot take at that moment is tried again at each sweep, about twenty times, or for as long as stored content it needs cannot be read; a schedule records such a start as refused and moves on.

When a trigger does not start a run, the playbook records a `reaction_refused` event of its workflow, at most once a minute. The event counts the runs not started and gives the last reason, which names the trigger by its kind. `list_playbook_events` shows it beside the runs triggers started.

The runtime's meter counts every run, and each function or workflow a step calls is a run of its own. A step's call that the meter refuses waits and asks again; see [When the runtime will not start the run for now](workflow-format.md#when-the-runtime-will-not-start-the-run-for-now). [Pricing](https://on.auto/pricing) explains an organization's credits, and the [Self-hosted licensing reference](../self-host/licensing.md) gives the rules of a runtime you host.

</div>
