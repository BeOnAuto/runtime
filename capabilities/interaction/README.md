# @on.auto/interaction

Interaction functions: a playbook asks a system and answers at once, or asks a person and takes the answer later. An interaction function is a definition, saved and versioned as every function is. One that asks a system names one tool of a tool server in `call`; its run makes one recorded call and answers with the part of the tool's answer that `read` points at. One that asks a person renders a request from its input, sends it through the tool of a tool server its document names or leaves it in the playbook's inbox, and waits, with nothing in memory, until the request is answered, expires or is cancelled. A function that sends through a tool may also read the replies to its message and take its party's reply as the answer. The answer is the run's output, checked against the answer schema the definition gives.

## The document

```markdown
---
description: Send the draft to its owner in the chat and take their approval
to: '{{ input.owner }}'
expires: P2D
deliver:
  server: chat
  tool: post_message
  with:
    channel: '{{ to }}'
    text: '{{ message }}'
  sent:
    conversation: /channel
    id: /ts
replies:
  conversation: '{{ sent.conversation }}/{{ sent.id }}'
  tool: thread_replies
  with:
    channel: '{{ sent.conversation }}'
    ts: '{{ sent.id }}'
    oldest: '{{ since | default: "0" }}'
  read:
    list: /messages
    order: oldest_first
    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }
input:
  schema:
    type: object
    required: [owner, draft]
    properties: { owner: { type: string }, draft: { type: string } }
output:
  schema:
    type: object
    required: [choice]
    properties:
      choice: { type: string, enum: [approve, reject] }
---

Here is the draft: {{ input.draft }}
```

A function that asks a system names the tool in `call` and has no body:

```markdown
---
description: Read the replies of a thread in the team chat, oldest first
call:
  server: chat
  tool: thread_replies
  with:
    channel: '{{ input.channel }}'
    ts: '{{ input.thread }}'
  read: /messages
input:
  schema:
    { type: object, required: [channel, thread], properties: { channel: { type: string }, thread: { type: string } } }
output:
  schema:
    type: array
    items:
      {
        type: object,
        required: [user, ts],
        properties: { user: { type: string }, text: { type: string }, ts: { type: string } },
      }
---
```

`parseInteractionDocument(source)` reads it with the shared document reader of `@on.auto/definitions/document` (`src/document`). The front matter takes `description`, `to`, a Liquid template that names the party, `from`, one that names the answerer, `expires`, an ISO 8601 duration from one minute to thirty days read by `readDuration` of `@on.auto/workflow-engine/dsl`, `deliver` and `replies`, `input` and `output`, each with a `schema`, and `reply`, the reply rule. Every other key, `model` and `tools` among them, is refused with its line, within the nested blocks too. Without `output.schema` the function is a notification: it takes no answer, and its run succeeds, with the output `{}`, once its delivery lands, at once without `deliver`. The body is the message, a Liquid template. A document is one of two shapes, `{ shape: 'call' }` or `{ shape: 'request' }` (`interaction-document.ts`): with `call`, `output.schema` is required and `to`, `expires`, `deliver`, `replies`, `from`, `reply` and a body are refused with their line (`call-parts.ts`); without it, `to` and `expires` are required (`request-parts.ts`). `to`, `from` and the message read `input`, `today` and `now` alone, through an instance of the engine of `@on.auto/definitions/template` with no registrations of its own, and a template that does not compile, reads another name, or a property a closed input schema does not have, is refused with its line.

`src/tool-blocks` holds the blocks, written once as effect schemas on one `ToolUseSchema`, `{ server, tool, with }`: `DeliverBlockSchema`, which adds `sent`, `CallBlockSchema`, which adds `read`, and `RepliesSchema`; `compiledToolBlock(written, lines, inputSchema)` checks a delivery and its reading at save, and `compiledCallBlock` a call: the server and tool names by their shapes, `isServerName` and `isToolName` of `@on.auto/tool-servers`; every template of `call.with`, `deliver.with`, `replies.conversation`, `replies.with` and `tell.with` against the names its place reads, with no `${`; arguments of a call that read no `input` within 16 KiB as JSON; each pointer of `call.read`, `deliver.sent` and `replies.read` a JSON Pointer that starts with a slash, refused in one sentence; `read.order`; `wait` from `PT5S` to `PT1H`. `replies` needs `deliver`, its `sent` and `output.schema`. Arguments are typed as written (`renderedArguments`): a number, boolean, null, list or object is sent as written with the templates in its strings rendered, a string that is one `{{ expression }}` alone is sent as the value it reads, and any other string is rendered as text, so a structure inside a longer text is refused at save; `momentVariables(input, at)` gives a call and a request the same `input`, `today` and `now`. `routeOf(blocks)` answers what an attempt, a read or a telling works with, `{ kind: 'inbox' }` or `{ kind: 'tool', delivery, replies? }`, and `throughWords` says it, the same sentence the capability's own `deliveryStarted` says (`src/facts/fact-words.ts`).

The reply rule (`src/replies/reply-rule.ts`, checked by `rule-checks.ts`) maps a top-level string property of the answer to `word`, the first word with the `words` that mean each value, `rest` or `text`; left out, it is derived for an answer whose one required property is a string, and is none otherwise. At most 16 values, 16 words a value, 64 bytes a word.

## A run

`makeInteractionFunctionAdapter({ tools, openRequests, mostOpenRequests })` is the capability (`src/capability`, `src/run`, `src/call`), which runs a call or a request by the document's shape. A request's prepared definition finishes later, but for a notification without `deliver`, and its longest run is its `expires`, so a workflow step that calls it waits that long and a minute more. It reaches outside while any tool server is configured or people may add connections, `tools.configured`. A run validates its input, checks by name alone that every tool its route names is offered to the playbook, `tools.named`, the words that name `search` and `unavailable`, kind `tool_not_offered`, otherwise; counts the playbook's open requests through `openRequests` and refuses a run past `mostOpenRequests` as `requests_full`. It renders the party, the answerer and the message as text, and the arguments of `deliver` once to check them: an empty party or one with a control character or past 256 bytes, a message past 8 KiB, arguments past 16 KiB as JSON or one that renders no text, end the run `conflict`, kind `unworkable`, with the place in its record. The run then defers, and the deferral's record is the request, in the one shape every request has, `RequestRecordSchema` of `@on.auto/definitions`: `{ to, message, answer_schema, answerer, reply, expires_at, requested_at, deliver, replies }`, the answering fields left out of a notification and the blocks out of a request in the inbox, with `deliver`, `replies` and `reply` typed by the capability's own schemas where it reads them (`src/run/request-record.ts`). A run that is cancelled ends `rejected` as `cancelled`, unless the run took an answer first, which settles it. Its declarations of whether a run finishes later and how long it runs at most answer the same for every input.

## The facts it declares

The capability declares its own facts on its declaration, `interactionFacts` (`src/facts`): on a run, `delivery_started`, `delivery_succeeded`, `delivery_failed`, `delivery_refused` and `reply_refused`, each with its schema and the words the playbook shows it in; and the stream kind it owns, `conversation-calls`, with the presenter of `@on.auto/tool-servers`, `conversationCallPresenter`. The playbook builds from them, beside those of every other capability it composes, the run decider's facts, the names a business cannot publish and the history's words, so none of them sits in the playbook's own union. A fact is recorded through the run's `work` command, by the `record` port its due work is given, the `workRecorder` of `@on.auto/definitions` the server makes over the facts of every capability it composes, so the due work records on a run of any type whatever facts that run's own capability holds on it; the capability's own rule reads the run as it stands first (`src/facts/work-rules.ts`), and the record is conditional on the version it read: attempts in order, each ended once while in flight, none started once a cancel is asked or the request was answered; a reply refused once, ten at most a request, none once the run took an answer, and none once a cancel is asked, so the party is not told then. The answer itself is the playbook's fact, `request_answered`, since every request takes one, and the run decider refuses it once a cancel is asked, for an answer given through the API and a reply alike.

## A call

A run of a function with `call` (`src/call`) validates its input, renders the arguments over `momentVariables`, and calls once through `tools.callOnce` of `@on.auto/tool-servers`, with the run's id as the call's id and as `auto.on/run_id` in its metadata, the run's journal, which records `tool_call_started` once the tool is found listed and before it is sent and `tool_call_answered`, or `tool_call_failed` when the tool never answered, after, and `toolBounds.longestRetryWaitMs` as the longest wait for a 429. `endingOf` (`call-endings.ts`) reads what the call answered. A result's document, `answerDocument`, at `read`, checked against `output.schema`, at most what a run may record, 1 MiB as JSON with the record, `mostResultBytes` of `@on.auto/definitions`, and 512 levels, is the output, and `{ server, tool, read }` the record; the 64 KiB of a person's answer, `interactionBounds.answerBytes`, bounds `answer_interaction` alone. Nothing to read, nothing at `read`, a value the schema refuses, and arguments the tool refused end `conflict`, kind `unworkable`; when the tool that answered is not marked read-only, the detail of an answer the run cannot use ends "The tool ran and may have changed something; a run again calls it again". A tool not offered, or a server that could not be opened or did not list the tool, ends `unavailable`, kind `tool_not_offered` or `tool_server_failed`, before anything is sent. A tool error, a server failure or no answer after sending ends `unavailable`, kind `tools_unfinished`, when the server marks the tool `readOnlyHint`, and `conflict`, kind `effect_unknown`, otherwise, with `because` `tool_error` or `server_failed` and the wait a 429 asked for as `retry_after_ms` in the record. Its prepared definition calls tools and finishes within its call, and its longest run is 70 seconds, `longestCallRunMs`: 10 to open, 10 to list, 10 to restart a process that exited, 30 to call and 10 to reopen a session the server forgot. A call makes no request, so the open requests never hold it and `answer_interaction` and `cancel_run` refuse its run.

## The open requests

`openRequests` is a keyed projection of runs the server registers with the ledger (`src/requests/open-requests.ts`), table `open_requests_7`, kept in the transaction of every append. A deferral of any function whose record is a request in the playbook's shape, `isRequestRecord` of `@on.auto/definitions`, makes a row, whatever the definition type, which the row keeps as `type`: the request's message id, the type, the function and its version, read from the deferral's context, a `RunContext` of `@on.auto/operations`, which every run fact carries, the party, the server and tool its `deliver` names, as JSON text, null for the inbox and for a `deliver` that names no server and tool, which the row keeps in the inbox, the `replies` and the reply rule it recorded, as JSON text, read only where a reading acts on them, the message, whether it takes an answer, the answer schema, the answerer, when it was asked and expires, the attempts made, when the next is due, the delivery's standing, `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, `answered`, once its run took an answer, or `cancelling`, whether it is open, how it ended, the conversation it is read in and what its message was delivered as, the replies refused and told, and two due times while its run has not ended and it is not `cancelling`: `attempt_due_at`, while it is open and stands `to_deliver` or `retrying`, and `ending_due_at`, the earlier of its expiry and the bound of an attempt in flight while it is open, or when it was asked for a row that settles now. Each `delivery_started` moves the next attempt a minute past it; `delivery_failed` schedules the next attempt, or none once spent, `delivery_succeeded` and `delivery_refused` schedule none, and `delivery_succeeded` keeps `delivered_as` and `replies_in`; each reads the time of its fact and the run from the message's context, and none moves a row that stands `answered` or `cancelling`; `reply_refused` counts. `request_answered` makes the row stand `answered` and closes it, so the request leaves the list and its place among the open requests at once; a row of an interaction function that stands `answered`, or a notification of one that stands `delivered` or `undelivered`, is due at once and settled from the recorded answer, `settledAnswered`, as whoever answered, from the delivery, `settledDelivered`, or as undelivered. A row of another type is left to its run's capability: one that took an answer is closed and never expires, and only an open row of another type expires, delivered or undelivered, so a delivered notification of another type that its capability never settles expires as unanswered, kind `expired`. `run_cancel_requested` makes an open row stand `cancelling`, unless what was brought back came first; the run's ending sets how the request ended and closes the row. Its indexes serve each read of open rows and its order: on whether a row is open, then the party, the function, the type or the conversation, or none, then the time it was asked and the row's key, so a list of one type, or of one function with or without its type, walks an index in its order with no sort; and a partial one across playbooks on each due time.

## Delivering

`requestsDue({ ledger, tools, record })` is the due work of the open requests (`src/schedule`), `record` the work recorder the server makes over every capability it composes: the rows whose next attempt is due when `callsOut` is true, or whose ending is when it is false, so an ending never waits behind an attempt.

- A request of any type past its expiry is settled `rejected`, reason `unanswered`, kind `expired`, as the playbook; a notification of an interaction function whose delivery ended undelivered is settled `unanswered`, kind `undelivered`.
- An attempt still in flight a minute after it started is ended as failed, `lost`.
- Otherwise the next attempt (`src/delivery`): the arguments are rendered from the request's record, `deliveryVariablesOf`, so every attempt sends the same; `delivery_started` is recorded through the run's `work` command as the next attempt of the run, with the fields `tools.preparedCall` gives, the server, the tool, the size of the arguments and, unless the server's `record_content` is `false`, their digest, the key under which the ledger's recorded content keeps them; a second host's start is refused and it sends nothing. Then one call, the `called` of the same `preparedCall`, which read the org's tool servers once for the start and the call, answers the call whole: not offered, a failed attempt `tool_not_offered`, the request staying open; not opened, `server_failure`; or answered, with the call's fields, and for a result the message the tool names at the `sent` pointers, `delivered_as`, and where replies are read, `replies_in` (`sent-messages.ts`). Its end follows, caused by the start, as one fact for each outcome (`src/delivery/attempt-facts.ts`): `delivery_succeeded`, `delivery_failed` with `because`, `tool_error`, `arguments_refused`, `server_failure`, `timed_out`, `too_large` for an answer past what the transport reads, `tool_not_offered` or `lost`, or `delivery_refused` with `because` `too_large` or `unworkable`.

Attempts follow `attemptSchedule` (`src/schedule/attempt-schedule.ts`): five, the first at once and the others 1, 2, 4 and 8 minutes after the one before, a server's `Retry-After` honoured up to 8 minutes. Arguments past 16 KiB are refused and not tried again. A request whose attempts are spent stays open until it is answered or expires; a notification ends `undelivered`.

## Reading replies

`conversations` is the second projection (`src/conversations`), table `conversations_3`, one row per playbook, server, reading tool and conversation key, keyed `server/tool/key`: made or woken by a `delivery_succeeded` with `replies_in`, its cursor moved by a `replies_read` on the playbook's `conversation-calls` stream and `last_fact` advanced by a `reading_failed` too, and its cadence, `open`, `active_at`, `reads` and `next_read_at`, advanced by its reader through the ledger's `advanceRow`, a compare-and-set on `joined_by`, the id of the delivery that last joined the row, so a read never rests a conversation a request joined while it was in flight. `conversationsDue({ ledger, tools, record })` is its due work, in the outbound lane. A read advances the row a minute ahead, reads the open requests of the conversation, at most 100, and keeps those that stand `delivered` or `retrying`; with none it rests the row. Otherwise it reads the replies once for all of them, through the reading of the oldest, its recorded `replies`: the arguments rendered over its `to`, its `sent` and the cursor `since`, one `callOnce` of `replies.tool`, the list at `read.list` and each reply at the `each` pointers. A reply belongs to the request whose message it answers, or to the one open request of a conversation, and is refused as `ambiguous` when several are open; a reply from anyone but the answerer is passed over. Its words are mapped by the request's rule and checked against its answer schema (`src/replies`): an answer is recorded as `request_answered`, with the reply's identity as evidence, by the playbook, `playbook:<playbook>`, and the open requests' due work settles the run from it, as it does an answer given through the API; a reply that is no answer, does not fit, or is past 8 KiB is `reply_refused`, ten at most a request, and the party is told how to answer through `tell`, after the first five sentences of the issues of a reply that does not fit, three times at most, a telling recorded as `telling_started` before it is sent and `telling_succeeded` or `telling_failed`, with `because`, after, each with the run and the definition of the request in its context, which the request's row holds. A read that found a reply is one `replies_read`, with the call's fields and the cursor, and a read that failed one `reading_failed`, with `because`, the call's fields and the conversation it read; a read that found nothing writes nothing. A reading serves a conversation and no run, so its facts carry no run in their context. The cadence is 5 seconds after a request joins, then 10, 20 and 40, every minute to the eighteenth read and every 5 minutes after, never sooner than `wait`, and as long as a `Retry-After` asks, an hour at most.

## Answering and listing

`answerInteraction` is `answer_interaction`, `POST /runs/{run_id}/answer` under `playbook:write`, for a request a function's run waits on. The answer is checked against the answer schema the request recorded, 64 KiB as JSON and 512 levels at most, its issues in the words of `wordedIssuesOf` of `@on.auto/definitions` with pointers under `/answer` (`src/requests/answer-check.ts`), and recorded on the run as one fact, `request_answered { answer, claimed_for? }`, its actor the caller and its time its own, through `playbookBoundAnswerer` of `@on.auto/definitions`; `claimed_for` is what the caller says it answers for, at most 256 bytes and never checked. The operation answers the recorded fact, `{ run_id, answer_id, answer, claimed_for?, reply?, answered_by, answered_at }`, `answered_by` the caller who answered, by `id` and `name`, which `request_answered` holds beside the context's `by`, the id alone, and for a reply the playbook acting as itself. The run decider takes one answer: the same answer again records nothing and answers the fact the run took, and another one is `conflict`, as is an answer to a request that has ended or whose run was asked to cancel. The run is settled from the fact by the open requests' due work within the host's sweep, a second by default, `succeeded` with the answer as its output and an empty record, as the caller that answered; a settlement that says nobody answered is refused once the run took an answer, and a cancel settles with it. `listInteractions` is `list_interactions`, `GET /interactions` under `playbook:read`: the open requests of the playbook, newest first, filtered by `to`, `type` and `function`, the last naming one function with `type`, since a name is unique within its type, in pages, each with the `type` of the function that asked, its `delivery`, its `answer_schema`, and for a request whose function reads replies its `conversation`, `answerer` and `reply_refusals`.

## Words

`describeAnswer(output, record)` says what a call answered from the record, and that a notification was delivered where the record is a request that takes no answer or a delivery's `{ delivered_at }`, "It asked the thread replies tool of chat; its answer: …", or how many items there are when the words would be too long, and what a request was answered with otherwise. The capability's run words show the deferral as `interaction_requested`, a type the playbook reserves, "A request is waiting for an answer, through the post message tool of chat, until …", or "… in the inbox …", with the delivery, the party, the answerer where it differs, the size of the message, whether it takes an answer and the expiry, and never the message.

## Bounds

| Bound                                       | Value                                                                                           | When it is reached                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The rendered party, and the answerer        | 256 bytes, no control character                                                                 | `conflict`, `unworkable`                                                                                                           |
| The rendered message                        | 8 KiB                                                                                           | `conflict`, `unworkable`                                                                                                           |
| The arguments of a call                     | 16 KiB as JSON                                                                                  | refused at save for a call that reads no `input`; otherwise `conflict`, `unworkable` at the start; a refused attempt at a delivery |
| A function's call of its tool               | 10 seconds to open and 10 to list, 30 seconds to answer, a 429 of at most 10 seconds waited out | `tool_server_failed` before sending; `tools_unfinished` or `effect_unknown` after                                                  |
| What a call's `read` takes                  | 1 MiB as JSON with the record, 512 levels                                                       | `conflict`, `unworkable`                                                                                                           |
| The longest run of a call                   | 70 seconds                                                                                      | a workflow step waits 70 seconds and a minute                                                                                      |
| What `sent` reads, and the conversation key | 256 bytes each, no control character                                                            | delivered without `delivered_as`; the request takes no reply                                                                       |
| A read's answer                             | 64 KiB                                                                                          | a failed read                                                                                                                      |
| A reply's words                             | 8 KiB                                                                                           | `reply_refused`, `too_long`                                                                                                        |
| Refused replies of a request                | 10 recorded, 3 told                                                                             | no trace, or nobody told                                                                                                           |
| Open requests read in a conversation        | 100, oldest first                                                                               | later ones are read for once earlier ones end                                                                                      |
| `expires`                                   | 1 minute to 30 days                                                                             | refused at save                                                                                                                    |
| An answer                                   | 64 KiB as JSON, 512 levels                                                                      | `invalid_input`                                                                                                                    |
| `claimed_for`                               | 256 bytes, event text                                                                           | `invalid_input`                                                                                                                    |
| Attempts                                    | 5, at once and after 1, 2, 4 and 8 minutes                                                      | a question stays open; a notification ends `undelivered`                                                                           |
| Open requests of a playbook                 | 10,000 unless the server sets another                                                           | `unavailable`, `requests_full`                                                                                                     |

`interactionBounds` holds those of the run.

## Measured

10,000 requests made due at one moment, as a server stopped past their expiry finds them, were all settled `unanswered` as `expired` within 7.5 and 7.8 seconds on SQLite and 8.7 and 8.8 seconds on PostgreSQL, 1,142 to 1,336 a second, at one-minute load averages of 1.6 to 8.2 on 16 cores; workflow timers due in those seconds fired up to 0.55 s late, and those due after them 5 to 63 ms late, as with no request due. The workflow host's README, under its measurements, gives the method, `pnpm --filter @on.auto/server measure`, and every figure; the measurement also has a round of 1,000 conversations read at one moment after a restart, `MEASURE_ONLY=conversations`.

## Testing

`@on.auto/interaction/testing` holds a harness over the in-memory ledger with the projections, the operations of the playbook and the due work, whose effects run on `standingClock` of `@on.auto/definitions/testing`, the real time of day on a monotonic time that stands still, so a render, counted on the run's clock as every render of the capability is, is never stopped by a slow machine (`interactionHarness`, and `chatHarness` with the reading), which composes the facts of the interaction and of any other capability it is given, `others`, into the work recorder its due work takes, `record`, and defines and runs a definition of any of them (`defineAs`, `askAs`); a capability of another type that asks through a request the interaction delivers and declares a fact of its own (`nudging`); fake tool access over a chat board that posts, lists a thread and takes replies (`fakeTools`), documents of a question, a notification and one read in a thread, a request asked through the chat, and documents of a call with runs of it against the fake MCP server of `@on.auto/tool-servers/served-fakes` (`callDocument`, `call-runs.ts`).

`src/call/call-endings.test.ts` gives the call that must take too long 300 ms against a tool that sleeps 5 s, on the real clock on purpose, since the MCP client keeps that bound and takes no clock, and a slow machine only lengthens the sleep the bound cuts; the 429 beside it runs on `patientTiming` of `@on.auto/tool-servers/testing`.

## Source

`src/document` reads the definition, `src/tool-blocks` the call, the delivery and the reading, `src/call` runs a call and reads its endings, `src/run` renders and defers a request, `src/requests` holds the projection of open requests and the two operations, `src/facts` the facts the capability declares, their words and the rules it records them by, `src/delivery` the attempt as a recorded call, `src/schedule` the due work and its schedule, `src/conversations` the projection of conversations and the reading, `src/replies` the reply rule, the taking and the tellings, `src/capability` the capability, its guide, the public reference page served to agents as `interaction-function`, and its words, and `src/testing` what the tests share.
