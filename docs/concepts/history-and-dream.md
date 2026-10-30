# History and events

A playbook records what happens in it: the definitions it saves, the runs it carries out and the events it takes in from elsewhere. You read that history to see what a run did and why. Recall functions and event triggers read it too, so what the playbook recorded can shape later work.

## What a playbook records

A playbook records:

- each version of each definition, and when it was created, updated or retired;
- each run: its start and input, what it did, and how it ended;
- each tool call a run makes, and each step a workflow run takes;
- the events published to it, and the events its workflows emit.

For example, after a campaign review you can go back to the review the run produced. You can also see the prompt it filled in, the version of "Review campaign brief" it used and the model's usage.

History holds only what was recorded in it. Conversations with your agent and data in other systems are not kept, unless they reach the playbook as a run's input or as an event. Recorded history needs persistent storage and tested backups, so include both when you plan how to run Auto; see the [self-hosting overview](../self-host.md).

## Reading the history

Your agent can read where a run stands, the history of one run, the events of the whole playbook or one event in full. The same reads work over HTTP. Long histories come a page at a time, and a playbook stays readable after it is retired. The playbook's analytics sum up its runs over recent days, and they are current as soon as each run is recorded.

A run's record holds its result. What the run was given is on the first event of its history. The history keeps each event small, so a large value appears as its size until you read that one event in full.

[Inspecting a run](workflows.md#inspecting-a-run) says what a workflow run's history shows. [Run history and playbook events](../reference/http.md#run-history-and-playbook-events) lists the reads and every event field, and the [MCP reference](../reference/mcp.md#events-and-history) lists the tools your agent uses.

## Publishing events

A playbook's history can also hold what happened elsewhere, such as a month closed in the accounts or a deal won in a CRM. Your agent or another system publishes such an event, in the CloudEvents shape that many systems already send. The event then appears among the playbook's events, beside its definitions and runs.

An event is known by where it came from and its id. Publishing the same event again records nothing new, so a sender can safely try again. A published event cannot pass for one of the playbook's own records, such as a run that finished. [Publishing events](../reference/http.md#publishing-events) gives the details.

## How events start work

What the playbook records can start work:

- A workflow with an event trigger starts a run for each event that matches it. That can be a published event or one that another workflow recorded. It can also be one of the playbook's own records, such as a review that succeeded.
- A run waiting for an event takes a matching one while it waits.

The playbook matches events in the order it recorded them. So the history explains each reaction: first the event, then the run it started, which names that event as its cause. When a trigger does not start a run, as when it reaches one of its limits, the playbook records that too. [Triggers](workflows.md#triggers) describes triggers.

Triggers, waiting runs and recall functions see a run only as the fact that it started and how it ended, with its result when it succeeded. They never see the run's input or its tool calls; those stay in the run's own history. [The events](../reference/recall-format.md#the-events) lists what each of these facts carries.

## Using history in later runs

A new run does not see earlier results by itself. Give a function what it needs as input, or use a recall function to look it up in the history.

Every runtime runs recall functions over a playbook's own history. A recall function names the events it cares about, such as every review that succeeded. It keeps a view of them up to date as the playbook records them. A run reads the view as it stands, without waiting for it to catch up. So it may not yet show an event recorded a moment ago.

See [Recall](functions.md#recall) for when to choose one, and [Make a playbook remember](../guides/remember.md) to add one. The [Recall function format](../reference/recall-format.md) describes the document.

## Dream (planned)

Dream is a planned feature, not available yet. It would revisit what a playbook has recorded and suggest ideas worth testing, such as a change to a method, for you to review. [Availability](functions.md#availability) lists it with the other planned features, and [Terminology](terminology.md) defines it.
