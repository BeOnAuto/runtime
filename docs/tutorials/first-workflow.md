<div v-pre>

# Build your first workflow

In this tutorial you turn the brief review from [Build your first playbook](first-playbook.md) into a small process: Auto reviews a brief, asks the brief's owner to approve it, waits for the answer and records both. A process like this is called a workflow. As before, everything you do is a message to your agent.

The campaign and figures below are sample data. Nothing here touches an advertising account or a budget.

You describe each part in plain words, and your agent writes the definition behind it. You never need to read or edit those definitions: your agent explains each one before it saves it. If you are curious, this page shows what your agent writes in collapsed sections.

## Before you start

Finish [Build your first playbook](first-playbook.md) first. This tutorial uses its "Campaign review tutorial" playbook and its "Review campaign brief" function. Leave Auto running.

## 1. Check the review function

Send your agent this message:

> In my "Campaign review tutorial" playbook, show me the "Review campaign brief" function and what it needs as input. Don't change it.

Your agent should show the function, saved under a name like `review-campaign-brief`, and say that it needs one input: the brief. If the function is missing, do the first tutorial again.

## 2. Save the approval question

The workflow will ask the brief's owner to approve the review. Asking a person something is the job of an interaction function: it leaves a question in the playbook's inbox and waits for the answer. This one gives the owner two days, and accepts only "approve" or "revise", with an optional note.

Send this message:

> In my "Campaign review tutorial" playbook, create an interaction function called "Approve campaign brief". It asks the brief's owner, whose email address it is given, to approve a review or ask for a revision, with an optional note. It leaves the question in the playbook's inbox and waits up to two days. Before you save it, tell me in plain words what it asks, who it asks, which answers it accepts and how long it waits.

Your agent explains the function: it asks the owner to approve or ask for a revision, leaves the question in the inbox, accepts "approve" or "revise" with an optional note, and waits two days.

::: details What your agent writes

The part between the `---` lines describes the inputs and the answers the function accepts; the part after it is the message the owner reads.

<!-- prettier-ignore -->
```markdown
---
description: Asks the campaign owner to approve a reviewed brief
to: '{{ input.owner }}'
expires: P2D
input:
  schema:
    type: object
    required: [owner, review]
    properties:
      owner: { type: string }
      review: { type: string }
output:
  schema:
    type: object
    required: [verdict]
    properties:
      verdict: { type: string, enum: [approve, revise] }
      note: { type: string, maxLength: 2000 }
---
The review of your campaign brief is ready:

{{ input.review }}

Approve the brief as it stands, or ask for a revision.
```

:::

When it sounds right, tell your agent to save it. It is saved under a name like `approve-campaign-brief`, at version 1.

## 3. Save the workflow

The workflow has two steps. First it runs "Review campaign brief" on the brief. Then it runs "Approve campaign brief" with the owner's address and the review, and waits for the owner's answer. When the run finishes, it keeps the review and the answer together.

Send this message:

> In my "Campaign review tutorial" playbook, create a workflow called "Review and approve". It takes a brief and the email address of the brief's owner. First it runs "Review campaign brief" on the brief. Then it runs "Approve campaign brief" with the owner and the review, and waits for the answer. When it finishes, it keeps the review and the answer. Before you save it, tell me in plain words what it needs and what it does, step by step.

Your agent explains the workflow: it needs a brief and the owner's email address; first it reviews the brief, then it asks the owner and waits; at the end it keeps the review and the answer.

::: details What your agent writes

Each named step under `do` calls one of your functions.

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-review-tutorial
  name: review-and-approve
  version: '1.0.0'
  summary: Reviews a campaign brief, then asks its owner to approve it.
input:
  schema:
    document:
      type: object
      properties:
        brief: { type: string }
        owner: { type: string }
      required: [brief, owner]
do:
  - review-brief:
      call: run_definition
      with:
        type: reasoning
        name: review-campaign-brief
        input:
          brief: ${ $data.brief }
      output:
        as: '${ ({ owner: $input.owner, review: $data }) }'
  - ask-for-approval:
      call: run_definition
      with:
        type: interaction
        name: approve-campaign-brief
        input:
          owner: ${ $data.owner }
          review: ${ $data.review }
      output:
        as: '${ ({ review: $input.review, approval: $data }) }'
```

:::

When it sounds right, tell your agent to save it. It is saved under a name like `review-and-approve`, at version 1. If Auto finds a problem in what your agent wrote, your agent sees exactly where and fixes it.

## 4. Start the workflow

Send this message, followed by the brief:

> Run the "Review and approve" workflow on the brief below, with ada@example.com as the brief's owner. Tell me its status, and keep track of the run for later.

The address is only a label for whoever should answer; Auto sends no email. The question waits in the playbook's inbox.

```text
Campaign: Autumn reporting trial
Audience: Businesses that need better reporting
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: Generate interest in the product
```

The workflow starts and then carries on by itself. Your agent gets back the run's id (`run_id`) and the status `started` right away. It reviews the brief, asks for the approval and then waits, so if you ask for its status now it still says `started`.

## 5. Find the question in the inbox

> Show me the open requests in my "Campaign review tutorial" playbook: who each is for, the message, and when it expires.

Your agent should show one request for ada@example.com, waiting in the inbox (`in_inbox`) and expiring in two days. The message contains the review from step 4.

## 6. Answer it

In real use, the owner would answer. Here you answer for them. Auto does not check who answers: anyone allowed to change the playbook can answer its requests, so the email address is a label, not a lock.

> Answer that request: approve, with the note "Approved for the autumn launch."

Your agent records your answer and shows it, with who answered and when. Within about a second, the workflow takes the answer and carries on.

An answer the function doesn't accept, such as "maybe", is refused, and the request stays open.

## 7. See how it ended

> Show me how the "Review and approve" run ended: its status, when it finished, and what it kept.

The run should show `status: succeeded`, version 1 of the workflow (`definition_version: 1`), and a finish time. It keeps two things:

- The review from "Review campaign brief". It comes from your model, so the wording varies, but for this brief it should recommend Revise: the audience lacks a job role and type of company, and the success measure lacks a number.
- Your answer: `{ "verdict": "approve", "note": "Approved for the autumn launch." }`.

The approval is the decision of whoever answered. The workflow records both, so you can see later what the review said and who approved the brief anyway.

To see how the run got there, ask:

> Show me the history of that run, step by step.

Your agent walks you through it: the run started, the review step waited for its function and finished, the approval step waited for the answer and finished, and the run succeeded. Auto records each of these as an event, and each event points to the one that led to it.

## 8. Check that the question is closed

> Answer the same request again, this time with revise. Then show me the open requests.

The second answer is refused, because the request already has an answer, and the inbox is now empty. To ask again, you start the workflow again. Each start is a new run with its own id.

## If something goes wrong

- **Your agent can't save a function or a workflow.** Its connection to Auto isn't allowed to make changes. Connect it again as the [quick start](../get-started/local.md#connect-your-agent) shows.
- **No question appears in the inbox.** Ask your agent to show you the run's history. If the review step failed, the run stopped before it could ask. Check that "Review campaign brief" still works on its own.
- **Your agent tries to send your approval some other way.** Tell it to answer the request in the inbox.
- **The workflow your agent wrote looks different from the one on this page.** That's fine as long as it has the same two steps in the same order and keeps the review and the answer.

::: details For developers

- Your agent answers a request with the MCP tool `answer_interaction`. `send_run_event` is for other input that a waiting workflow listens for, not for answers.
- A connection that has no `create_definition` tool either uses an organization endpoint or holds a key that may only read; [Endpoints](../reference/mcp.md#endpoint-scope) explains both.
- The run's history records each step as events that point to the event that caused them; [Workflow format](../reference/workflow-format.md) describes the document and how runs end.

:::

## What you built

The playbook now holds a workflow that reviews a brief and asks for an approval, plus one recorded run. The review criteria live in "Review campaign brief". The question and the answers it accepts live in "Approve campaign brief". The workflow decides when each one runs.

Next:

- An interaction function can also send its question through a tool, such as a chat message, and take the person's reply as the answer. [Interaction function format](../reference/interaction-format.md) shows how.
- [Run a workflow on a schedule or event](../guides/triggers.md) starts a workflow without anyone asking. A new playbook can start that way from the beginning: when you ask your agent for one, it asks how the work starts, unless your words already say so, such as "every morning" or "whenever a brief arrives". Where the work should start on its own, it writes the workflow that runs your first function, once you have seen that function answer.
- [Workflows and runs](../concepts/workflows.md) explains how runs start, wait and end.

</div>
