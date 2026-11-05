# Approving an action during a run

This is the design of how a reasoning run waits for a person to approve an action that a tool takes only once someone approves it, and then sends that call once. It was agreed before the code and built in the same change, except for a call made by hand, which is [planned](#a-call-made-by-hand). Every part this page marks **new** was new when it was agreed. The public reference pages describe what the runtime does today; [Reference pages it changes](#reference-pages-it-changes) lists them.

## What it is for

Some calls change something a person cares about: paying, buying, sending a message, posting, deleting, changing an account's settings or accepting terms. A tool server can decline to act on such a call until a person has approved it. Hosted Auto's browser connection does this for every high-impact action. Three rules hold for every approval:

- A person approves, never the model and never an agent. A page the model reads can steer the model, and an agent too, so nothing either writes can approve an action.
- An approval covers one call, sent once: the same tool, the same arguments, in the same run.
- A run that needs an approval asks the person it acts for and waits, the way an interaction function asks a person and waits for the answer.

So a reasoning run whose tool answers that it needs an approval stops, asks the person, and goes on once they answer. When they approve, the run sends the same call again, carrying the approval, and the model reads what the tool answers then. When they decline, or nobody answers in time, the model is told so and goes on without it.

## What exists today and what is new

| Concept                                       | Today                                                                                                        | This design                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Which runs wait for a person                  | An interaction function's                                                                                    | **New**: a reasoning run waits for a person to approve an action                                                 |
| A tool that will not act until someone agrees | Its answer is a tool error the model reads                                                                   | **New**: an answer that asks for an approval, `auto.on/confirmation_needed`, which the runtime takes to a person |
| How many requests a run makes                 | One                                                                                                          | **New**: a reasoning run makes one approval request at a time, at most three in a run                            |
| Whom a request waits on                       | A member by email address, any member, or, for a sign-in, a person by id                                     | An approval request waits on a person by id, as a sign-in request does                                           |
| Who may answer a request                      | Any caller who may write to the playbook; a sign-in request only the person it waits on                      | **New** for an approval request: only the person it waits on, and a yes only from their own session              |
| What follows an answer                        | The run of an interaction function ends with it                                                              | **New**: the reasoning run goes on, and sends the approved call once                                             |
| A request nobody answers                      | The run ends `rejected` as `unanswered`, kind `expired`                                                      | **New** for an approval request: the run goes on, and the model is told that nobody approved the action          |
| How long a run that calls tools may take      | 10 minutes from its start                                                                                    | The same 10 minutes of work: **new**, the time it waits for a person is not counted                              |
| A tool call's metadata                        | `auto.on/run_id`                                                                                             | **New**: the approved call also carries `auto.on/approval`                                                       |
| The run's history                             | `tool_call_started`, `tool_call_answered`, `interaction_requested`, `request_answered`, `attempt_resumed`, … | The same facts, in a new order: the request, its answer, the run going on, and the call sent again. No new type  |

The existing concepts this design leans on are set out in [Reasoning function format](../../reference/reasoning-format.md#tools), [Interaction function format](../../reference/interaction-format.md#answering-a-request), [A run performed again](../../reference/reasoning-format.md#a-run-performed-again) and [Signing in during a run](sign-in-during-a-run.md#whom-a-run-acts-for).

## The answer that asks for an approval (new)

A tool asks for an approval by answering a result marked `isError: true` whose metadata holds `auto.on/confirmation_needed`. Hosted Auto's browser connection answers it in place of acting on a high-impact action:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Clicking \"Pay now\" on shop.example needs the person's approval" }],
  "_meta": {
    "auto.on/confirmation_needed": {
      "request": "apr_01JD5T8RZ3",
      "tool": "browser_click",
      "digest": "sha256:4c1f…",
      "kind": "pay",
      "action": "Click \"Pay now\"",
      "site": "shop.example",
      "person": "person:user_7kLm2",
      "expires_at": "2026-11-05T10:10:00Z"
    }
  }
}
```

| Field        | Holds                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`    | The server's id of the approval it waits for, or `null` when nobody can approve this call, such as a call that acts for no person                       |
| `tool`       | The tool the call names, as the server names it                                                                                                         |
| `digest`     | The server's digest of the call's arguments, which the approval names so that it covers this call alone                                                 |
| `action`     | What the call would do, in words for the person. The runtime shows its first 300 characters                                                             |
| `expires_at` | When the server stops holding what the call would act on, in ISO 8601. The request expires then, or 10 minutes after it is asked, whichever comes first |
| `kind`       | Optional. The kind of action, such as `pay` or `send`                                                                                                   |
| `site`       | Optional. The site the action is on                                                                                                                     |
| `person`     | Optional. The person the server will take an approval from                                                                                              |

Every text is 1 to 1,024 bytes with no control character. An answer without `isError: true`, or whose `auto.on/confirmation_needed` lacks a field it requires, is an ordinary answer, which the model reads as it reads any. The tool did nothing, so nothing has changed outside the playbook yet. The runtime reads the metadata from the answer as the server sent it, scrubbed of the run's secrets, at the moment it answers; a run that goes on later reads the request it recorded.

What a server that asks for approvals holds to:

- It performs nothing when it asks. The call that asked has ended, within the 30 seconds a call may take.
- It holds what the call would act on, such as the page of a browser, until `expires_at`, whatever happens to the session the runtime called it in. A run ends its sessions with every server while it waits, and opens new ones to send the call again. Hosted Auto's browser holds the run's page for at most its `keep_alive` window, about 10 minutes, also after the person declines.
- It performs the call it asked about once when the identical call comes again, the same tool and arguments with the same `auto.on/run_id`, carrying the approval in `auto.on/approval`, before `expires_at`. It refuses an approval used a second time, given for another call, or past its expiry.
- When the call would now act differently, such as on a page that changed, it asks again.

## Whom the run asks

The run asks the person it acts for, as [Signing in during a run](sign-in-during-a-run.md#whom-a-run-acts-for) sets out: its caller where that is a person, `person:` and an id or the local developer, and otherwise the person a triggered run acts for, its `acts_for`, while they are still a member of the organization. A run that goes on after it waited acts as the caller who started it and for the person it acts for, whoever asks the runtime to go on with it.

## A run that meets one

A run of a reasoning function, while it calls tools:

1. Sends the calls the model asked for in a step, as it does today, and records each `tool_call_started` and `tool_call_answered`.
2. Takes the first answer of the step that asks for an approval. An answer of another call of the same step that asks for one too reaches the model as a tool error that says the run asks for one approval at a time, so the model can make that call again later.
3. Checks that it can wait:
   - the server named someone who can approve the call: `request` is not `null`;
   - its host passes approvals on to servers, as Auto Cloud does; a runtime whose host signs no approval cannot;
   - every server of the run keeps content, so the run can go on from what it recorded;
   - it has asked fewer than three times;
   - it acts for a person who is still a member of the organization.
4. When it cannot wait, the model reads why, in place of that call's answer, and the run goes on to its next step.
5. When it can, once every call of the step has ended, it defers with an approval request, and ends its sessions with the servers. Its run stays `started`.

The run waits without using server resources: its attempt has ended, and the server holds what the call would act on.

## The request

The run defers with its request, in the one shape every request has, with these values:

| Field of the request | Value                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to` and `answerer`  | The person the run acts for, by id, such as `person:user_7kLm2`                                                                                         |
| `message`            | What the run asks the person to approve: the function, the tool, its server and the site, then the action, then that they approve it once or decline it |
| `answer_schema`      | `{ approved: boolean, reason?: string }`, `reason` at most 500 characters, and nothing else                                                             |
| `expires_at`         | The earlier of the server's `expires_at` and 10 minutes after the request is asked                                                                      |
| `deliver`            | None: the request is held for the person's agent, and Studio lists it                                                                                   |
| `approval`           | **New**: `{ server, tool, action, site?, kind? }`                                                                                                       |

The deferral's record also keeps what the run needs to go on: the call that asked, by its number and the id the model gave it, the numbers of the last calls the run had made, the server's answer, and the spending of the run's model calls so far, which a cancel keeps.

While it waits:

- `list_interactions` lists the request, with its `approval`, and the organization's activity lists it as a `needs_you` row that waits on the person, with the same `approval`.
- A workflow's step that called the function waits for it, up to the longest the function may run, which now includes three waits.
- `cancel_run` cancels it, and the run ends `rejected` as `cancelled`, keeping the spending of its model calls.

## How it is answered

`answer_interaction` answers an approval request as it answers any request, with two rules more (**new**):

- Only the person the request waits on may answer it. Any other caller is refused `forbidden`, so a colleague, a key or a playbook cannot approve an action for someone else.
- `{ "approved": true }` is taken only from that person's own session, the one Studio signs in with, which names no client. Through an agent's token, which names its client, it is refused `forbidden`. Their agent may answer `{ "approved": false }`, with a `reason`, when the person declines. This is the rule a sign-in request follows, for the same reason: an approval is what keeps instructions hidden in a page from acting, and a page can steer an agent as well as a model. In local mode no token names a client, so the local developer may give either answer.

Every other rule of an answer holds: the same answer again returns the fact the run took, and a different one is `conflict`. Auto Cloud signs the approval it passes on to the server only for an answer the runtime took, so this check is the runtime's.

## How the run goes on (new)

Once the request is answered, or once it expires, the server goes on with the run within about a second, as it takes any answer: it makes the run's next attempt from what the run recorded, as [A run performed again](../../reference/reasoning-format.md#a-run-performed-again) does, as the caller who started the run, acting for the person the run acts for, so a run a trigger started asks the same person for a second approval. Its claim of the run is the `attempt_resumed` the run records, so two servers that go on at once make one attempt, and the open request closes with it.

The attempt rebuilds the conversation from the content the run kept, and then:

- **Approved**: it sends the call that asked once more, with the same tool and the same arguments, carrying the approval its host gives. That call is recorded as any call is, with the next number and the id the model gave the first, and what the tool answers now is what the model reads as the answer to its call. The model never reads the answer that asked. When the server asks again, the run asks again, within its three.
- **Declined**: the model reads, as the answer to its call, that the person declined the action, with their reason when they gave one, so it was not done.
- **Expired**: the model reads that nobody approved the action before the approval expired, so it was not done, and that the server no longer holds the page it would have acted on: the task starts again from its first step, and the action asks for approval again when it is reached.

Then the run goes on to its next step, and ends as any run that calls tools ends. A call sent with the approval that does not answer ends as any call that does not answer: a run that goes on again never sends it a third time.

## The approval the call carries

The call sent again carries `auto.on/approval` in its metadata, beside `auto.on/run_id`. It holds what the runtime's host gives for the approval, through a port of the reasoning capability (**new**), given the organization, the playbook, the run, the person who approved and when, the server, the tool, the arguments and the server's answer that asked, `request` and `digest` among it. Auto Cloud signs a single-use approval, naming the organization, the person, the request, the tool and the digest, which its browser connection checks before it acts. A host that gives none for an answer gives the model words that say the approval could not be passed on, and the call is not sent. A runtime with no such port asks nobody: the model reads that this runtime has no way to pass an approval on.

## Bounds

| Bound                              | Value                                                         | When it is reached                                                        |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| How long a request waits           | 10 minutes, or less when the server holds the action for less | The run goes on, and the model reads that nobody approved the action      |
| Approval requests in one run       | 3, one at a time                                              | The model reads that the run cannot ask again; the action is not done     |
| The work of a run that calls tools | 10 minutes, not counting the time it waits                    | The run ends as it does today, with `because: "run_bound"`                |
| The longest a run may take         | Its longest today, and three waits of 10 minutes              | A workflow's step waits that long, and a minute more                      |
| The `reason` of an answer          | 500 characters                                                | `invalid_input`                                                           |
| A text of the server's answer      | 1,024 bytes, no control character                             | The answer is an ordinary answer                                          |
| The `action` the request shows     | The first 300 characters of what the server wrote             | Not applicable                                                            |
| Calls of one run                   | 25, and a third identical call refused, as today              | The call sent again counts as the call the model asked for, not once more |

## What the history records

The run's history holds the facts every run that calls tools holds, and no new type:

1. `tool_call_started` and `tool_call_answered` for the call that asked, with `is_error: true` and the answer kept as every answer is.
2. `interaction_requested`, the request: the person, the size of the message, the expiry and the `approval`.
3. `request_answered`, with the answer, `answered_by`, the person, and `answered_at`. That is the record that the person approved or declined the action, and when.
4. `attempt_resumed`, the run going on.
5. When approved, `tool_call_started` and `tool_call_answered` for the call sent again, under the same call id.
6. The next model call, and the run's end.

An expired request has no `request_answered`: the run goes on from step 4, and the model call that follows holds what the model read.

## A call made by hand

An agent's own call through `execute_connection` meets the same answer and reads it as a tool error today, with the action in its words. Approving such a call is planned, and is not part of this design's first part: the call has no run to defer, and the agent that made the call is what a page can steer. Two ways are open, and the owner chooses between them:

- The runtime asks the person by form elicitation within the call, which they answer in their client, and sends the call again once they approve.
- The call records a request on its own stream, `tool-calls/<call_id>`, which Studio lists for the person to approve, and the agent calls again once they have.

## Decided

- **An approval is a request of the run.** It is listed, counted and answered where every request is, and Studio and the person's agent find it there. No new way to reach the person is added: the request is held for their agent and listed in Studio.
- **Only the person approves, from their own session.** Their agent may decline for them, never approve, as for a sign-in.
- **Nobody answering is not an ending.** The model is told, and the run goes on, so a playbook decides what follows, as it does when a tool refuses.
- **One request at a time, three in a run.** A run may need more than one approval, such as paying and then sending a receipt. Three keeps the longest a run may take within 30 minutes beyond its own.
- **A runtime that cannot pass approvals on asks nobody.** Asking a person for an approval the server would refuse wastes their time.

## Where each part is built

| Part                                                                                              | Where                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading the answer that asks, and sending a call with `auto.on/approval`                          | `@on.auto/tool-servers`                                                                                                                                                    |
| The run that defers, goes on and sends the call again; the words the model reads; the host's port | `@on.auto/reasoning`                                                                                                                                                       |
| A deferred run that goes on after its request; the time it waited; the request's `approval`       | `@on.auto/definitions`, whose next attempt goes on with a deferred run once its request was answered or has expired, and whose run state takes one answer for each request |
| The listing, the due work that asks the host to go on, and the rules of who answers               | `@on.auto/interaction`                                                                                                                                                     |
| `approval` on the activity's rows                                                                 | `@on.auto/activity`                                                                                                                                                        |
| Going on with a run once its request ends                                                         | `@on.auto/server`, by an operation in no catalog that the due work dispatches                                                                                              |
| The answer that asks, the page held, and the approval checked once                                | Hosted Auto's browser connection, outside this repository                                                                                                                  |
| Signing the approval, and going on with a run on Auto Cloud                                       | Hosted Auto, outside this repository                                                                                                                                       |
| Approve and Decline                                                                               | Studio, outside this repository                                                                                                                                            |

A change to a table ships with its layout step, as [the ledger's rule](../../../packages/ledger/README.md#the-layout-of-the-ledger) requires: the open requests and the activity's request rows gain `approval`, each a projection refilled from the history under a new table name. No fact changes its shape: the request's `approval` and the record's other fields are optional, so a deferral recorded before them reads as having none.

## Reference pages it changes

| Page                                                             | What it says                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Reasoning function format](../../reference/reasoning-format.md) | A tool that asks for a person's approval, how the run waits and goes on, and the bounds |
| [HTTP API](../../reference/http.md)                              | `approval` on a request and an activity row, and who may answer an approval request     |
| [Terminology](../../concepts/terminology.md)                     | The approval request                                                                    |
