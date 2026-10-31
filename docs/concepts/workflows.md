# Workflows and runs

A workflow puts a playbook's functions to work in steps. A workflow can:

- call functions in order, and choose a path from their results;
- repeat a step for each item in a list, or run branches side by side;
- wait for a person, an event or a set time;
- try a failed step again, and give up after a time limit.

Each time a workflow is carried out, that is a run. A run keeps its place when Auto restarts, and goes on from where it was.

## Steps

A step is one place where a workflow uses a function. The step refers to the function rather than copying it. So "Review campaign brief" can be a step in several workflows and still be called directly by your agent. Other steps decide what happens next, wait, repeat work or handle errors without calling a function.

A workflow can call any function in its own playbook. It can also call another workflow, which is then a subworkflow. The workflow itself reaches nothing outside the playbook: it does that only through its functions.

For example, [Build your first workflow](../tutorials/first-workflow.md) builds a workflow with two steps. It reviews a campaign brief with one reasoning function, then passes that review to a second function that drafts feedback. The run keeps both answers.

## Versions and runs

Saving a workflow creates version 1, and each change saves a new version. A run uses the version that was the latest when it started, and keeps it to the end. So changing a workflow never changes a run that is already under way, and no one can start a run on an older version. A step that calls a function uses that function's latest version at the moment of the call.

Each function a step calls has a run of its own, with its own id, so you can inspect it separately. A step that is tried again starts a fresh run of the function. A restart of Auto does not repeat a function run that already finished.

[Terminology](terminology.md#definitions-and-runs) defines definition, version, run, step run and attempt.

## Starting a run

What you ask the playbook to do is a workflow, its functions the steps, run and shown as one result: your agent writes it, a later ask changes it, a one-step workflow is still a workflow, and a function runs on its own only to test it. Your agent starts a run and gives it the workflow's input. The run then goes on by itself, and your agent can check on it later. Every step acts for whoever started the run, with the permissions they had when it started.

[Starting and cancelling a run](../reference/workflow-format.md#starting-and-cancelling-a-run) gives the details, including how to repeat a start safely and how to cancel a run.

## Triggers

A trigger starts a run without anyone asking for it. A workflow can have two kinds:

- An event trigger starts a run for each matching event in the playbook. The event can come from another system or another workflow. It can also be one of the playbook's own records, such as a review that succeeded.
- A schedule trigger starts a run at set times, such as 09:00 UTC on working days, or once every fifteen minutes.

A run that a trigger starts acts for the playbook itself, not for a person. A trigger applies from the moment it is saved; it never reacts to what the playbook recorded before. Limits stop triggers from starting runs without end. A workflow can also record an event of its own. Another workflow's trigger can react to it, and so can a run that waits for that event.

[Run a workflow on a schedule or event](../guides/triggers.md) shows how to add a trigger, and [Triggers](../reference/workflow-format.md#triggers) in the workflow format gives the rules and limits.

## How a run waits

A run can wait for a function that takes time, for a timer or for an event. It can wait for days without tying up Auto, and a restart does not lose its place.

Two kinds of input reach a run that is already waiting, and neither starts a new run:

- an answer to a request that one of its steps made;
- an event sent to the run, for input that is not an answer, such as a revised brief.

An approval is an interaction function. The workflow calls it as it calls any function. The function asks the person through a connection they chose, such as a chat message, or holds the request for an agent they answer through, and the workflow waits. The person's answer is the result of that step. If nobody answers before the request expires, the workflow can catch that and take another path.

[Waiting for events](../reference/workflow-format.md#waiting-for-events) gives the rules for events.

## Inspecting a run

A run ends when its last step completes, or earlier if an error stops it, someone cancels it or it runs too long. [How a run ends](../reference/workflow-format.md#how-a-run-ends) gives each status and its reasons.

Each run has a record of where it stands. It shows the workflow version, who started the run and, once it ends, its result or why it did not succeed. Its history shows what happened, oldest first: each input the run took and the steps that input moved. Each event names the one that led to it, so the history shows the run's branches, retries and waits. The latest event shows what the run is waiting for. The history shows how the run moved, not the data it holds.

Each function a step called has its own run and history. The playbook's events show the workflow run together with every run it started. [History and events](history-and-dream.md) explains what a playbook records, and [Run history and playbook events](../reference/http.md#run-history-and-playbook-events) lists the reads and their fields.

The [workflow format](../reference/workflow-format.md) describes the workflow document itself.
