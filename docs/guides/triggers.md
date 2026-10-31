---
description: Give a workflow a schedule or an event trigger so it starts on its own, test the trigger, and stop it when you no longer need it.
---

# Run a workflow on a schedule or event

Make a saved workflow start on its own: at set times, every so often, or whenever its playbook records an event.

## Before you start

- Your agent is connected to Auto. The [quick start](../get-started/cloud.md) sets this up. Hosted Auto keeps scheduled work running after you close your agent.
- You have a playbook with a saved workflow that does the work, and it succeeds when your agent runs it. [Workflow format](../reference/workflow-format.md) describes the document.
- To start a workflow on an event, you know which event. An event is a record that something happened, such as a brief being submitted. It may be one your systems publish to the playbook, or one of the playbook's own, such as a function's run succeeding.

## Decide how the workflow starts

### Schedule or event

A trigger is part of the workflow's document, under `schedule`. There are three kinds:

| Trigger | Starts a run                                           | Use it for                                                  |
| ------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `cron`  | At the times its five fields name, in its time zone    | Fixed times, such as 09:00 every Monday                     |
| `every` | Once every period, counted from when it was saved      | A steady pace, such as every 15 minutes                     |
| `on`    | For each event of the playbook that its filter matches | Work that follows an event, such as a brief being submitted |

A workflow may have one trigger of each kind, and each starts its own runs. Your agent can still run the workflow itself.

- `cron` reads five fields: minute, hour, day of month, month and day of week. `'0 9 * * 1'` is minute 0 of hour 9 on Mondays. When both day of month and day of week are restricted, a day that matches either is due.
- `time_zone` beside `cron` names the time zone its times are in, by its IANA name, such as `America/New_York` or `Europe/London`. The times then follow the clocks there through daylight saving: `cron: '0 9 * * 1'` with `time_zone: America/New_York` is 09:00 in New York every Monday, summer and winter. Without `time_zone`, the times are in UTC.
- When the clocks go forward, a time they skip runs once, at the first moment after the skip. When they go back, a time they show twice runs once, the first time.
- `time_zone` goes with `cron` only. `every` counts a period, which has no time zone.
- `every` takes a duration of at least a minute, such as `PT15M` (15 minutes) or `PT1H` (one hour). Its times are counted from when the trigger was saved.

### What a triggered run gets

No trigger has an input of its own. A run that a schedule starts gets only `{ "schedule": { "due": "<time>" } }`, and a run that an event starts gets a list holding the event. Neither gets the input your agent passes, and the workflow's input schema, which checks what your agent passes, does not check what a trigger gives. So decide where the workflow's data comes from:

- A workflow on a schedule must find its input on its own. Step 1 below sets that up before you add the schedule.
- A workflow started by an event takes its data from the event. `input.from` shapes the run's input before the first step.
- A workflow that your agent also runs tells the two apart in `input.from`, as steps 1 and 6 show.

A run that a trigger starts acts as the playbook itself, not as you. Its `started_by` names the playbook: its `id` is `playbook:` followed by the playbook's id, and its `name` the playbook's id, and its steps can read and write that playbook and nothing else. It is kept in the playbook's history like any other run.

### Overlap and cost

- A schedule has one run at a time. A time that falls due while its previous run still runs is skipped.
- Each run may call models and send requests to people. Test with a short schedule, and replace it once it has started a run.
- Event triggers have limits on how many runs they start, how many filters they take and how long a chain of runs may grow. [Trigger limits](../reference/workflow-format.md#trigger-limits) lists them.

What a trigger did not start is recorded as a `reaction_refused` event of the workflow, which `list_playbook_events` shows.

## Add a schedule

### 1. Give the workflow its input

A run that a schedule starts gets only the time it was due. A workflow that needs a campaign, a brief or a date range would start without it, and the first step that needs the value would fail. So before you add a schedule, make the workflow get its input on its own. There are three ways:

| Way                            | How it works                                                                                                                                             | Good when                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Fill in the input              | The workflow's `input.from` puts fixed values in place of the schedule's input. Any other input passes through, so your agent can still run it as before | The workflow runs with the same input each time |
| Add a small scheduled workflow | A new workflow holds the input and runs yours with it. The schedule goes on the new workflow, and yours stays as it is                                   | You want to leave the workflow unchanged        |
| Read the data when it runs     | A step reads the data from a [recall function](remember.md), or through a function's [tools](tools.md)                                                   | The data changes between runs                   |

Ask your agent:

```text
In my "<playbook name>" playbook, I want the "<workflow name>" workflow to run
on a schedule with this input: <the input it needs>. A scheduled run gets only
the time it was due. Either have the workflow fill in that input when a
schedule starts it, or prepare a small workflow that runs it with that input;
if its input schema requires a field the schedule's input lacks, prepare the
small workflow. Tell me which you chose, and show me the document before
saving it.
```

For example, a workflow that takes a campaign can fill in a fixed one when a schedule starts it. If the workflow already has an input schema, one that requires no field the schedule's input lacks, `from` goes beside its `schema`:

```yaml
input:
  from: '${ $data.schedule ? { campaign: "autumn-reporting-trial" } : $data }'
```

A workflow whose input schema requires a field the schedule's input lacks takes a small scheduled workflow instead. The schema checks the input of every run your agent or another workflow starts, so the test in step 2, which gives the schedule's input, would be refused before it starts, while the call the small workflow makes gives the fields the schema requires. [Example: review a standing brief every Monday](#example-review-a-standing-brief-every-monday) shows a small scheduled workflow.

### 2. Test it with a schedule's input

Before you turn on a schedule, run the workflow once with the input a schedule would give it. If you added a small scheduled workflow, run that one: its call of your workflow is checked against your workflow's input schema exactly as the call it makes when the schedule starts it will be. Ask:

```text
Run the "<workflow name>" workflow in my "<playbook name>" playbook with the
input {"schedule": {"due": "2026-10-19T09:00:00Z"}}, as a schedule would start
it. Show me its status and its output.
```

Check that the run ends `succeeded`, with the output you expect from the input you chose in step 1. If it is rejected, or its output is built from missing values, go back to step 1: a schedule would start it the same way.

### 3. Test with a one-minute schedule

Before you set the real time, test the trigger with one that fires every minute. Add it to the workflow you tested in step 2. Ask your agent:

```text
In my "<playbook name>" playbook, add a schedule to the "<workflow name>"
workflow that starts it every minute (every: PT1M). Keep everything else and
raise its version number. Show me the document before saving it, then show me
the saved version and its triggers.
```

The document gains these lines:

```yaml
schedule:
  every: PT1M
```

The agent saves it with `update_definition`. Check that the saved workflow shows one trigger, with the kind `every`, the place `/schedule/every` and `milliseconds: 60000`, which is one minute.

### 4. Check the run it starts

Wait a minute, then ask:

```text
List the workflow runs of my "<playbook name>" playbook. For the newest run of
the "<workflow name>" workflow, show who started it, its status and its history.
```

Check that:

- the run was started by the playbook itself: the `id` of its `started_by` is `playbook:` followed by your playbook's id;
- the first event of its history, `run_started`, reads `A run of the workflow “<name>” was started by its every schedule.`, with the name your workflow is saved under;
- it ended as the test in step 2 did, with the output you expect.

While that run still runs, the trigger starts no other. The playbook records each time it skips as a `reaction_refused` event.

### 5. Set the real schedule

Ask:

```text
Update the "<workflow name>" workflow: replace its one-minute schedule with a
cron schedule that starts it at <the time and days, such as 09:00 every Monday,
New York time>. Name the time zone with time_zone, and raise its version
number. Show me the document before saving it, then the saved version and its
triggers.
```

Check that the saved workflow shows one trigger, with the kind `cron`, the place `/schedule/cron`, an expression for your time and your time zone as `time_zone`. [Schedule or event](#schedule-or-event) explains the five fields. The `every` trigger is gone, so it starts no more runs. Auto does not list the times ahead, so the agent works out the next one from the expression.

Then cancel the test runs that still wait:

```text
Cancel the runs of the "<workflow name>" workflow that are still waiting, with
the reason "Test of the one-minute trigger".
```

Check that each ends `rejected` with the reason `cancelled`, and so do the runs it started.

## Start on an event

### 6. Add an event filter

An event filter names the event's `type`, the name of what happened, written out in full. For example, a workflow that should start each time your campaign tool publishes a `com.acme.campaigns.brief-submitted` event gains these lines:

```yaml
schedule:
  on:
    one:
      with: { type: com.acme.campaigns.brief-submitted }
input:
  from: '${ Array.isArray($data) ? $data[0].data : $data }'
```

If the workflow already has an `input`, `from` goes beside its `schema`.

- A filter can also name other attributes of the event, such as `source` or `subject`, and test its data with an expression, such as `data: '${ $data.priority === "high" }'`. `on.any` takes a list of filters, and a run starts when any of them matches.
- `input.from` takes the first event's `data` when an event started the run. Any other input, such as the one your agent passes, is used as it is.

Ask your agent:

```text
In my "<playbook name>" playbook, update the "<workflow name>" workflow so that
it starts on each event of the type <event type>. When an event starts it, it
should take the event's data as its input (with input.from). Keep everything
else and raise its version number. Show me the document before saving it, then
the saved version and its triggers.
```

Check that the saved workflow shows a trigger with the kind `event`, the place `/schedule/on` and your filter.

### 7. Publish a test event

Ask:

```text
Publish a test event to my "<playbook name>" playbook, with the type <event
type>, the source <where it comes from, such as /campaigns> and this data:
<data>. Then show me the newest run of the "<workflow name>" workflow and its
history.
```

Check that:

- the agent reports the event's `id`, `time` and `recorded_at`;
- a new run appears within a few seconds, started by the playbook itself (the `id` of its `started_by` is `playbook:` followed by your playbook's id);
- the first event of its history, `run_started`, reads `A run of the workflow “<name>” was started by its event trigger.`

A filter matches more than published events. It also matches an event another workflow emits, or one of the playbook's own facts, such as `run_succeeded` with the `subject` `reasoning/<name>` when that function's run succeeds. Events recorded before the trigger was saved never start it.

::: details Publishing an event again, and from other systems

An event's `id` and `source` together name it:

- Publishing the same event again, with the same `source`, `id` and data, records nothing more and starts no second run.
- The same `source` and `id` with other data is refused as a conflict.
- Leave out `id` to record a new event each time; Auto then makes one.

Other systems publish events over HTTP with `POST /v1/orgs/{org}/playbooks/{playbook}/events`, using a key that may write to the playbook. [Publishing events](../reference/http.md#publishing-events) lists the attributes and limits of an event.

:::

## Stop a trigger

### 8. Save a version without it

To stop a trigger, save a new version of the workflow without it:

- Remove `schedule.on`, `schedule.cron` or `schedule.every` to stop that one trigger, and `schedule.time_zone` with `schedule.cron`. A trigger the new version leaves unchanged goes on as it was.
- Remove `schedule` altogether, or retire the workflow, to stop every trigger.

For example, ask:

```text
Update the "<workflow name>" workflow: remove its schedule, keep everything
else, and raise its version number. Then show me its triggers.
```

Check that the saved workflow shows no `triggers`. A stopped trigger starts nothing more, but the runs it already started go on. Cancel any that still wait, as in step 5.

A trigger you change or add applies from the version that saves it, never to anything recorded earlier. A changed schedule counts its times from then.

## Example: review each submitted brief

This workflow starts each time the campaign tool publishes a `com.acme.campaigns.brief-submitted` event with the brief in its data. Your agent can also run it with the input `{"brief": "..."}`. It passes the brief to `review-campaign-brief`, a reasoning function in the same playbook that takes a `brief`. A workflow names a function by the name it is saved under.

The workflow's `namespace` is the id of the "Marketing" playbook it is saved in, `marketing`; your agent fills in your own.

::: details The "Review submitted brief" workflow

```yaml
document:
  dsl: '1.0.3'
  namespace: marketing
  name: review-submitted-brief
  version: '1.0.0'
  summary: Reviews a campaign brief. Starts by itself when a brief is submitted.
schedule:
  on:
    one:
      with: { type: com.acme.campaigns.brief-submitted }
input:
  schema:
    document:
      type: object
      properties:
        brief: { type: string }
      required: [brief]
  from: '${ Array.isArray($data) ? $data[0].data : $data }'
do:
  - review:
      call: run_definition
      with:
        type: reasoning
        name: review-campaign-brief
        input:
          brief: ${ $data.brief }
```

:::

To test it, ask your agent:

```text
Publish a test event to my "Marketing" playbook, as the campaign tool would,
with the source /campaigns, the type com.acme.campaigns.brief-submitted and this data:
{"brief": "Campaign: Winter webinar series\nAudience: Businesses that need better reporting\nOffer: Two live webinars\nChannel: Email to our customer list\nTotal budget: USD 4,000\nSuccess measure: Generate interest in the product"}
Then show me the newest run of the "Review submitted brief" workflow and its output.
```

A run of the workflow starts within a few seconds, and its output is the review.

## Example: review a standing brief every Monday

An always-on campaign runs from one brief, and its owner wants it reviewed every Monday. The "Review submitted brief" workflow above reviews the brief it is given, but a scheduled run would give it none. So this small workflow, saved as `weekly-brief-check` in the same playbook, holds the brief and runs "Review submitted brief" with it.

::: details The "Weekly brief check" workflow

```yaml
document:
  dsl: '1.0.3'
  namespace: marketing
  name: weekly-brief-check
  version: '1.0.0'
  summary: Every Monday at 09:00 London time, runs the review of the always-on campaign's brief.
schedule:
  cron: '0 9 * * 1'
  time_zone: Europe/London
do:
  - review:
      call: run_definition
      with:
        type: workflow
        name: review-submitted-brief
        input:
          brief: |
            Campaign: Always-on reporting trial
            Audience: Finance directors at UK manufacturing companies with 50 to 250 employees
            Offer: A 30-day trial
            Channel: Paid LinkedIn ads
            Total budget: USD 8,000
            Success measure: 100 trial registrations
```

- `cron: '0 9 * * 1'` with `time_zone: Europe/London` starts a run at 09:00 London time every Monday, in summer and in winter. To test it, save it first without `schedule` and run it with a schedule's input, as in step 2. Then put `every: PT1M` in place of the `cron` and `time_zone` lines, as in step 3.
- The run's input is the due time, which the step does not read. `type: workflow` runs the other workflow, and the `|` keeps the brief's lines as written.
- The run's output is the review. The run of "Review submitted brief" that it starts acts as the playbook too.

:::

## If something goes wrong

- **No run at the time you expected.** Check that the schedule names your `time_zone`, since without one its times are in UTC, and that Auto was running then. A time that falls due while the trigger's previous run still runs is skipped. After Auto was stopped, only the latest of the times it missed runs.
- **No run after you published an event.** The filter's `type` must match the event's type exactly, and events recorded before the trigger was saved never start it. Ask the agent to list the playbook's events of the type `reaction_refused` with `list_playbook_events`. They say what a trigger did not start and why, such as "the run its every schedule started before still runs".
- **A run started and was rejected.** Ask the agent for the run's rejection. A rejection for its input means the steps did not get what they expect. A scheduled run gets only its due time, and a run an event started gets a list holding the event. Give it its input as in step 1, or shape it with `input.from` as in step 6.
- **A workflow does not start for its own events.** That is by design. A workflow does not start for its own runs, for runs they started, or for events its runs emit.
- **Requests pile up.** Each run of a workflow that asks for an approval sends a request, which `list_interactions` shows while it is open. Replace a test trigger once it has started its first run, and cancel the runs you do not need.

## Next

- [Make a playbook remember](remember.md) gives later runs what the playbook decided before.
- [Workflow format](../reference/workflow-format.md#triggers) has the filters, the trigger limits and the rules for new versions.
- [Workflows and runs](../concepts/workflows.md) explains how runs start, wait and end.
