---
description: "The events of a playbook that a workflow's trigger, a page and a prediction function take: what each event holds, and how a filter names the events it takes."
---

<div v-pre>

# Events

A playbook records events: what happens in it, such as a run that starts or ends, and the events published to it. A workflow's trigger, a page and a prediction function each take some of those events, and each names the events it takes with filters written the same way:

| What takes the events                                      | Its filters          | Its own rules                                                         |
| ---------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| A workflow's event trigger, which starts a run on each one | `schedule.on`        | [Event filters](triggers.md#event-filters)                            |
| A page, whose views are a fold of them                     | `data.source.events` | [The filters of the events](page-format.md#the-filters-of-the-events) |
| A prediction function, whose dataset counts them by period | `data.events`        | [The dataset](prediction-format.md#the-dataset)                       |

This guide says which events they are, what each holds, and how a filter names them. Each format guide says how many filters its definition takes, and the bounds an expression in them keeps. A workflow's `listen` task hears these events too, through a filter whose `type` is written out, as [Waiting for events](workflow-format.md#waiting-for-events) says.

## The events a filter takes

A filter takes the events of its own playbook:

- the start and the end of every run of each function and workflow, with the output of each run that succeeded and fit its event, and the reason and kind of each run that was rejected;
- the definitions saved, updated, paused, resumed and retired;
- every event published to the playbook with `publish_event`, or emitted by its workflows.

These events are not the whole of the playbook's history:

| What                    | The events a filter takes                                                                           | The playbook's history                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Who reads them          | A workflow's event triggers and `listen` filters, a page's fold and a prediction function's dataset | A person or an agent, with `list_playbook_events` and `get_event`                                                                             |
| What they hold          | The facts in the table below, and the events published to the playbook or emitted by its workflows  | Everything recorded: those facts and events, each run's input on its `run_started`, tool calls, workflow steps, requests, answers, deliveries |
| The shape of each event | A CloudEvent, with the attributes below                                                             | `id`, `type`, `summary`, `data` and `metadata`                                                                                                |

So `run_started` is in both, with the run's input in the history and with no data for a filter. A tool call, a step or an answer is in the history alone, and no filter takes it. The events a filter takes:

| Events                                                                                                      | `source`                     | `subject`       | `data`                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `run_started`, `run_failed`                                                                                 | `/runs/<run id>`             | `<type>/<name>` | none                                                                                            |
| `run_succeeded`                                                                                             | `/runs/<run id>`             | `<type>/<name>` | `output`; or `output_bytes`, its size, when the output would make the event larger than 240 KiB |
| `run_rejected`                                                                                              | `/runs/<run id>`             | `<type>/<name>` | `reason`, and `kind` where the rejection has one                                                |
| `definition_created`, `definition_updated`, `definition_retired`, `definition_paused`, `definition_resumed` | `/definitions/<type>/<name>` | none            | none                                                                                            |
| An event published to the playbook, of any other type                                                       | as its publisher gave it     | as given        | as given; see [Publishing events](http.md#publishing-events)                                    |

A run's `subject` names its definition, such as `reasoning/summarize`. A filter never sees a run's input. An output the playbook stores apart from the run's record is read for the event, so triggers, listeners and pages see it as they see any other; while it cannot be read, the event waits for it.

## What an event holds

Each event is a CloudEvent with its `id`, `type`, `source`, `time` and `data`. Its `time` is when it happened, as the playbook recorded it. An event the playbook recorded as the effect of another names that one in `causationid`, and the run at the top of its chain in `correlationid`. The playbook's own events also carry extension attributes that say how they came about, each where the playbook has it:

| Attribute           | Holds                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `caller`            | Who acted: a caller's id; or `playbook:` and the playbook's id, for a run a trigger started and the runs it calls |
| `definitionversion` | The version of the definition the run runs or the event is about, a whole number from 1                           |
| `depth`             | On a run a reaction started, how many reactions are above it, a whole number from 1                               |
| `calldepth`         | On a run a workflow's call started, how many calls are above it, a whole number from 1                            |
| `calledby`          | The id of the run whose call started the run                                                                      |
| `triggerkind`       | The kind of the trigger that started the run: `event`, `cron` or `every`                                          |
| `triggerreference`  | Where that trigger is in its workflow's document                                                                  |

No published event carries one of these attributes, nor `causationid` or `correlationid`, since `publish_event` refuses them. So a published event cannot claim a cause, a caller or a depth it does not have.

## Filters

A filter names the events it takes. Every value except `data` is written out, never computed:

| Key                 | What an event must have                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | Required; exactly this type                                                                                                                                                              |
| `source`            | Optional; exactly this source                                                                                                                                                            |
| `subject`           | Optional; exactly this subject, such as `workflow/morning-social-content` for the runs of one workflow                                                                                   |
| Any other attribute | Optional; exactly this value, such as `triggerkind: event` or `caller: playbook:finance`: a whole number from 1 for `depth`, `calldepth` and `definitionversion`, and text for any other |
| `data`              | Optional; data equal to this value, or data for which an expression such as `'${ $data.revenue > 100 }'` holds; the expression reads the event's data as `$data` and nothing else        |

- An event is taken when it matches any of the filters, and once only, however many it matches.
- A filter that names an attribute the event does not have does not match it. A run no reaction started carries no `depth`, and a run no call started no `calldepth`, so a filter for such runs leaves the attribute out.
- A filter that names `depth`, `calldepth` or `definitionversion` as 0 is refused when its definition is saved.
- An expression holds unless it returns `false` or `null`.
- An attribute is named as CloudEvents names it, in at most 20 lowercase letters and digits. Any other key is refused, and so is a computed attribute.
- A `data` expression that names anything but `$data` is refused when its definition is saved, with the compiler's `Cannot find name`.

</div>
