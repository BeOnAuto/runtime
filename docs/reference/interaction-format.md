<div v-pre>

# Interaction function format

An interaction function is a definition of the type `interaction`. It takes one of three shapes:

| Shape                           | What a run does                                                                                       | Use it for                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Asks a system                   | Calls the tool named in `call` once, and returns part of the tool's result at once                    | What a system returns now, such as the replies of a thread |
| Asks a person through the inbox | Renders a request to a party, with an expiry, and leaves it in the playbook's inbox                   | An approval, a choice, or a figure only someone else has   |
| Asks a person through a tool    | Renders the same request and sends it through the tool named in `deliver`, such as a chat's post tool | The same, reaching the person where they already work      |

A run that asks a person renders the message from its input. Then it waits until the request is answered, expires or is cancelled, without using server resources. The answer is checked against the document's answer schema, and becomes the run's output. A function without an answer schema sends a **notification**, which needs no answer.

## A function document

The source is Markdown with YAML front matter followed by the message. This example, `approve-campaign-brief`, asks a campaign's owner to approve the review of their brief. Its answer is `{ verdict: approve | revise, note? }`:

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

To save it, call `create_definition` with `type: "interaction"`, the `name` `approve-campaign-brief`, and the document as `source`. To run it, call `run_definition` with the same type and name, and with `owner` and `review` in the `input` object. Both operations also take the playbook id, unless the MCP connection is scoped to that playbook.

The run returns `status: started` with its `run_id`. The function names no `deliver`, so the request waits in the playbook's inbox until it is answered.

## Asking a system

A function that asks a system names a tool in `call`, with the arguments the call takes. Its run makes one call and takes the part of the tool's answer that `read` points at. It checks that part against `output.schema` and ends with it as its output.

Such a function makes no request, sends no message and asks no model. So it has no `to`, `expires`, `deliver`, `replies` or body.

Write a call from what the tool returns, not from memory:

1. Call `search` to see the tool servers this playbook may use, the tools each offers and whether its server marks each read-only. Call `introspect` for the `input_schema` a tool takes.
2. Call the tool with `execute`, with the arguments its `input_schema` takes, and read its `answer`. That is the document `read` points into: the tool's structured content, else its first text block parsed as JSON, else that text. For example, a chat's tool that lists the replies of a thread returns the replies and a cursor to the next page.
3. Write `call`:
   - `server` and `tool`, as `search` names them;
   - `with`, the arguments;
   - `read`, a JSON Pointer to the part of the answer the function returns, such as `/messages`. Leave `read` out to return the whole answer.

   Then write `output.schema`: the shape that part has in the answer `execute` gave.

4. Show the person the whole document. Once they agree, save it with `create_definition`, `type` interaction. `run_definition` runs it and returns its output at once.

The arguments in `with` are the tool's own, named as its `input_schema` names them, and may nest:

- A number, `true`, `false`, `null`, or a list or an object of them, is sent as written.
- A text is a Liquid template that reads `input`, `today` and `now`, and is sent as the text it renders.
- A text that is one `{{ }}` and nothing else sends the value it reads, as that value is. So `'{{ input.limit }}'` sends a number when the input's `limit` is a number.

`read` names a place in the answer and nothing more. To reshape what a call returns, use the workflow's `output.as`, or a computation function.

How a call ends when it goes wrong:

- Before anything is sent: the playbook may not use the tool server, the operator does not allow the tool, the server does not list it, or the server cannot be reached. The run ends `unavailable`, in words that name `search`, and can be run again.
- Once the call is sent, it is in the run's history. When the tool server fails on it, or the tool returns an error:
  - a tool its server marks read-only ends the run `unavailable` as `tools_unfinished`, status 503. A workflow may try it again.
  - any other tool may have changed something, so the run ends `conflict` as `effect_unknown`, status 409. A workflow's retry on status 503 does not match it.
- The tool refused the arguments, or the answer holds nothing where `read` points, or does not match `output.schema`. The run ends `conflict` as `unworkable`, which trying again does not change.

A tool that pages returns one page for each run. Point `read` at the part that holds both the items and the cursor, and have the workflow call again with the cursor while there is one.

A run that called its tool and did not succeed is never run again under its run id, since the tool may have changed something. A request with that id returns `conflict` with the kind `tools_called`. Check the run's history, then start a new run under a new id. [Retrying under a run id](http.md#retrying-under-a-run-id) gives every case.

## Sending through a tool

A function sends its request through a tool by naming the tool in `deliver`, with the arguments the call takes. It needs nothing set up beyond the tool server itself. A function without `deliver` waits in the playbook's inbox.

Write a delivery from what the tool returns, not from memory:

1. Call `search` to see the servers this playbook may use and the tools each offers, and `introspect` for the `input_schema` a tool takes.
2. The sending tool sends a message, so wait until the person agrees. Then call it with `execute`, with the arguments its `input_schema` takes, and read its answer. That is the document `deliver.sent` points into. `sent` holds two JSON Pointers: to the conversation the message landed in, and to the message's identity. A chat's tool that posts a message returns the conversation it posted in and the message's timestamp or id.
3. If the person will answer where the message reached them, call the tool that reads what came since a point with `execute`. Then write `replies`:
   - `conversation`, the key the playbook reads the conversation by;
   - `tool` and `with`, the reading tool and its arguments, over `sent` and the cursor `since`;
   - `read`, the pointers to the list of replies and, within each, to its id, its sender, its words and the message it answers;
   - `wait`, the floor of the reading cadence;
   - `tell`, how the party is told when a reply was not an answer.

   The `reply` rule maps the words of a reply to the answer; see [Answering by reply](#answering-by-reply). [Tool blocks](#tool-blocks) gives each key, whether it is required and its default.

4. Write `deliver` with `server`, `tool`, `with` and `sent`. Show the person the whole document, and save it with `create_definition`, `type` interaction, once they agree. A run refuses a server this playbook may not use, or a tool its operator does not allow, in words that name `search`.

The arguments of `deliver.with`, `replies.with` and `tell.with` are typed as written:

- A number, boolean, null, list or object is sent as written, with the templates inside its strings rendered.
- A string that is exactly one `{{ expression }}` is sent as the value the expression reads. A number stays a number and an object stays an object, so `'{{ answer_schema }}'` sends the schema itself.
- Any other string is rendered as text. Use `| json` to embed a structured value in it.

The templates of `deliver.with` read:

- `input`, `today` and `now`, as the message does. Here `today` and `now` are the request's own moment, so every attempt sends the same arguments.
- The request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`. `to` is the party the request goes to, which the templates may use as the tool's address or not.

A template holds no `${`, since a document is never filled from the environment.

This function sends a draft to its owner in a chat, and takes their approval from the replies in the thread of the message:

<!-- prettier-ignore -->
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
    limit: 15
  read:
    list: /messages
    order: oldest_first
    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }
  wait: PT1M
  tell:
    with:
      channel: '{{ sent.conversation }}'
      thread_ts: '{{ sent.id }}'
      text: '{{ message }}'
reply: { verdict: word, note: rest }
input:
  schema:
    type: object
    required: [owner, draft]
    properties:
      owner: { type: string }
      draft: { type: string, maxLength: 4000 }
output:
  schema:
    type: object
    required: [verdict]
    properties:
      verdict: { type: string, enum: [approve, revise] }
      note: { type: string, maxLength: 2000 }
---
Here is the draft:

{{ input.draft }}

Reply **approve**, or **revise** with a note of what to change.
```

Every name in it is the chat's own, learned by testing its two tools. Testing shows what the sending tool takes, where its result names the message, and what the reading tool lists. `channel` is the chat's word for a conversation; the playbook passes it on as it passes any argument.

- `tell` names no `tool`, so a party whose reply was not an answer is told through `post_message`, the sending tool, in the thread of the message.
- `reply` takes the verdict from the first word of a reply and the note from the rest. Without it, the rule made from the schema would read the verdict alone and drop the note.

[Tool blocks](#tool-blocks) gives every key of `deliver` and `replies`, with its default.

### Attempts

A request sent through a tool is attempted at once. After a failed attempt it is tried again 1, 2, 4 and 8 minutes after the one before: five attempts in all.

- A server that responds with `Retry-After` is waited for as long as it asks, up to 8 minutes.
- Each attempt is one call of the tool. It is recorded in the run's history before it is sent, with the size and digest of its arguments. So two servers never make the same attempt. Its end records what the tool returned.
- These are failed attempts, tried again: a tool error, a server failure, no response within 30 seconds, and a connection not opened within 10 seconds.
- Arguments past 16 KiB are refused and not tried again.
- A tool the server no longer offers to the playbook fails the attempt. The request stays open, to be answered through the inbox.
- An attempt cut off by a restart counts as failed a minute after it started, and the next one follows. So a tool may be called twice for one request.
- A question whose attempts are spent stays open until someone answers it or it expires. A notification whose attempts are spent ends `unanswered` as `undelivered`.

## Fields

| Field           | Purpose                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                                                                                                                                                       |
| `about`         | Optional Markdown of 1 to 4,000 characters, without headings, for a business reader; the [overview](#the-overview) shows it after the `description`                                                                                                                                               |
| `call`          | The tool the function asks: `server`, `tool`, `with` and `read`; see [`call`](#call). With it, `output.schema` is required and `to`, `expires`, `deliver`, `replies`, `from`, `reply` and the body are refused                                                                                    |
| `to`            | Required without `call`, refused with it. A template that renders the party the request goes to: a name the playbook's readers filter by, which a delivery's templates may use as the tool's address                                                                                              |
| `from`          | Optional. A template, as `to` is, that renders the party whose reply counts, the answerer; `to` when left out. A request sent to a room names the person here                                                                                                                                     |
| `expires`       | Required without `call`, refused with it. An ISO 8601 duration from one minute to thirty days, such as `PT4H` or `P2D`, after which a request nobody answered ends                                                                                                                                |
| `deliver`       | The tool the request is sent through: `server` and `tool` as `search` names them, and `with`, the call's arguments. `sent` holds two JSON Pointers into the tool's answer, to the conversation and to the message's identity; see [`deliver`](#deliver). Left out, the request waits in the inbox |
| `replies`       | Only with `deliver`, its `sent` and `output.schema`: how the replies to the message are read, with `conversation`, `tool`, `with`, `read`, `wait` and `tell`; see [`replies`](#replies)                                                                                                           |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                                                                                                                                                 |
| `output.schema` | Optional JSON Schema of the answer. The answer must match it and is the run's output. A function without it is a notification: it takes no answer and succeeds once its request is delivered                                                                                                      |
| `reply`         | Optional, only with `output.schema`: the reply rule; see [Answering by reply](#answering-by-reply)                                                                                                                                                                                                |

`model`, `config`, `tools`, `language` and every other field are rejected with their line. The body after the front matter is the message. The saved function has the `media_type` `text/markdown`.

### Fields by shape

| Field                                  | Asks a system | Asks through the inbox                           | Asks through a tool                                              |
| -------------------------------------- | ------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `call`                                 | Required      | Refused                                          | Refused                                                          |
| `to`, `expires`, the message           | Refused       | Required                                         | Required                                                         |
| `from`                                 | Refused       | Optional                                         | Optional                                                         |
| `deliver`                              | Refused       | Left out                                         | Required                                                         |
| `replies`                              | Refused       | Refused                                          | Optional; needs `deliver.sent`, `output.schema` and a reply rule |
| `output.schema`                        | Required      | Optional; without it, a notification             | Optional; without it, a notification                             |
| `reply`                                | Refused       | Optional, with `output.schema`; nothing reads it | Optional, with `output.schema`; read only with `replies`         |
| `description`, `about`, `input.schema` | Optional      | Optional                                         | Optional                                                         |

A function that reads replies needs a reply rule: the one `reply` writes, or one made from the answer schema. Without either, it is refused when saved.

### Templates and pointers

`to`, `from` and the message are Liquid templates that read `input`, `today` and `now` and nothing else. A rendered value is text and is never read again as a template.

Every template is checked when the document is saved, against the names its place reads:

| Place                                  | Names it reads                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `to`, `from`, the message, `call.with` | `input`, `today`, `now`                                                                                            |
| `deliver.with`                         | `input`, `today`, `now`, and the request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema` |
| `replies.conversation`                 | `to`, `sent.conversation`, `sent.id`                                                                               |
| `replies.with`                         | `to`, `sent.conversation`, `sent.id`, `conversation`, `since`                                                      |
| `tell.with`                            | `to`, `sent.conversation`, `sent.id`, `message`                                                                    |

A template is rejected with its line when it does not compile, names another value, or names a property the input schema does not allow. So is a structure inside a longer text.

Other rules checked when saved:

- Each pointer of `call.read`, `deliver.sent` and `replies.read` is a JSON Pointer such as `/messages`. It starts with a slash, writes `~` as `~0`, and writes a slash within a name as `~1`.
- `read.order` is `oldest_first` or `newest_first`.
- `wait` lies between `PT5S` and `PT1H`, and is `PT5S` when left out.
- The server and the tool are not checked when the document is saved. A run whose server does not serve the playbook, or whose tool its operator does not allow, is `unavailable` with the kind `tool_not_offered`.

## Tool blocks

### Which tool each step uses

A request uses the tools of one server, `deliver.server`:

| Step                         | Tool                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| Send the message             | `deliver.tool`                                                |
| Read the replies             | `replies.tool`                                                |
| Tell the party how to answer | `replies.tell.tool`, or `deliver.tool` when `tell` names none |

A function with `call` uses `call.tool` on `call.server`. A run checks every tool its function names before it sends anything: the server must serve the playbook, and the operator must allow the tool. Otherwise the run is `unavailable` with the kind `tool_not_offered`.

### `call`

| Key      | Required                           | What it holds                                                                                                     |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server` | Yes                                | The tool server, as `search` names it: 1 to 32 lowercase letters, digits and hyphens, starting with a letter      |
| `tool`   | Yes                                | The tool, as `search` lists it: 1 to 128 letters, digits, underscores, hyphens and dots. The server must list it  |
| `with`   | No; `{}` when left out             | The tool's arguments, named as its `input_schema` names them. Their templates read `input`, `today` and `now`     |
| `read`   | No; the whole answer when left out | A JSON Pointer to the part of the tool's answer the run returns, such as `/messages`. An empty pointer is refused |

The answer is the tool's structured content, else its first text block parsed as JSON, else that text.

### `deliver`

| Key      | Required                     | What it holds                                                                                                                                                        |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server` | Yes                          | The tool server, as `search` names it. Reading replies and telling use it too                                                                                        |
| `tool`   | Yes                          | The tool that sends the message                                                                                                                                      |
| `with`   | Yes                          | The sending tool's arguments. Their templates read `input`, `today`, `now` and the request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema` |
| `sent`   | With `replies`; otherwise no | Where the tool's answer names the message it sent; see [`deliver.sent`](#deliver-sent). Without it, the history does not say what the message was delivered as       |

### `deliver.sent`

| Key            | Required | What it holds                                                                |
| -------------- | -------- | ---------------------------------------------------------------------------- |
| `conversation` | Yes      | A JSON Pointer to the conversation the message landed in, such as `/channel` |
| `id`           | Yes      | A JSON Pointer to the message's identity, such as `/ts`                      |

- Each must point to a text or a whole number of at most 256 bytes, with no control character.
- When one does not, the request is still delivered, without what it was delivered as. A function that reads replies then takes no reply, and the request waits for `answer_interaction`.
- The templates of `replies` and `tell` read the two values as `sent.conversation` and `sent.id`.

### `replies`

| Key            | Required                                      | What it holds                                                                                                                                                                           |
| -------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation` | No; `'{{ sent.conversation }}'` when left out | A template over `to`, `sent.conversation` and `sent.id` that renders the key the playbook reads the conversation by. Open requests with the same reading tool and key share one reading |
| `tool`         | Yes                                           | The tool of `deliver.server` that lists the messages of a conversation since a point                                                                                                    |
| `with`         | Yes                                           | The reading tool's arguments. Their templates read `to`, `sent.conversation`, `sent.id`, `conversation` and `since`                                                                     |
| `read`         | Yes                                           | Where the replies are in the reading tool's answer; see [`replies.read`](#replies-read)                                                                                                 |
| `wait`         | No; `PT5S` when left out                      | The shortest time between two reads, from `PT5S` to `PT1H`                                                                                                                              |
| `tell`         | No; nobody is told when left out              | How the party is told that a reply was not an answer; see [`replies.tell`](#replies-tell)                                                                                               |

- A key that renders empty, past 256 bytes or with a control character leaves the request to `answer_interaction`.
- In `with`, `conversation` is the rendered key. `since` is the id of the newest message an earlier read listed, and empty text before any. Write `'{{ since | default: "0" }}'` where the tool needs a value.
- A conversation that several open requests share is read with the `to` and `sent` of the oldest of them.

### `replies.read`

| Key     | Required | What it holds                                                                                   |
| ------- | -------- | ----------------------------------------------------------------------------------------------- |
| `list`  | Yes      | A JSON Pointer to the list of messages in the reading tool's answer, such as `/messages`        |
| `order` | Yes      | `oldest_first` or `newest_first`: the order the tool lists them in, which tells which is newest |
| `each`  | Yes      | Pointers within each message; see [`replies.read.each`](#replies-read-each)                     |

An answer with no list at `list`, or larger than 64 KiB, is a failed read. The reading goes on.

### `replies.read.each`

| Key      | Required | What it points to, within each message                                                            |
| -------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`     | Yes      | The message's identity. The newest message's becomes `since`                                      |
| `sender` | Yes      | Who wrote it. Only a message from the answerer counts                                             |
| `text`   | Yes      | Its words, which the reply rule reads. A message with nothing there reads as empty and is refused |
| `to`     | No       | The message it replies to, such as the first message of its thread                                |

- A message whose `id` or `sender` is not a text or a whole number of at most 256 bytes, without a control character, is passed over.
- A message whose `id` is one the playbook sent in the conversation, such as the first message of a thread it started, is the playbook's own and not a reply. It is passed over and not counted, so a read that finds nothing else has found nothing and records no `replies_read`.
- With `to`, a message answers the open request whose `sent.id` it names. It is passed over when it names none of them.
- A message with nothing at `to`, or any message when `each` has no `to`, answers the conversation's one open request. It is refused when several are open.

### `replies.tell`

| Key    | Required                         | What it holds                                                                          |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| `tool` | No; `deliver.tool` when left out | The tool of `deliver.server` that sends the telling                                    |
| `with` | Yes                              | Its arguments. Their templates read `to`, `sent.conversation`, `sent.id` and `message` |

- Here `message` is the telling, not the request's message. It says how to answer, such as `To answer, reply with one of approve, revise; what follows is kept as the note.` After a reply the answer schema refuses, it names the problems first. After a reply that answers no single request, it asks the party to reply to the message of the one they answer. After a reply past 8 KiB, it gives the limit.
- A request is told at most three times. Arguments that do not render are not sent; the reply is still refused.

## Answering a request

`answer_interaction` answers a request over MCP. Over HTTP it is `POST /v1/orgs/{org}/playbooks/{playbook}/runs/{run_id}/answer`. It takes the `run_id` of the interaction function's run, which `list_interactions` shows, and the `answer`:

```json
{ "answer": { "verdict": "approve", "note": "Ready to launch." }, "claimed_for": "the campaign team" }
```

A person often answers in a conversation with their agent: they approve, reject, ask for changes, or say it in other words. The agent then calls `answer_interaction` on the request's `run_id`, with the answer in the shape of the request's `answer_schema`:

- `list_interactions` shows the `answer_schema` beside the `run_id`. It is the function's `output.schema` as it stood when the request was asked. Once the function has changed, `get_definition` no longer shows it.
- For the document above, the person's "approve" is `{ "verdict": "approve" }`, and "revise: name the job role" is `{ "verdict": "revise", "note": "Name the job role." }`. A function with another `output.schema` takes its own shape, whatever words the person used: for a function whose answer has a `decision` of `approve`, `revise` or `skip` and an optional `note`, it is `{ "decision": "approve" }`.
- This holds wherever the request reached the person, in the inbox or through a tool such as a chat's.
- Running the function or its workflow again answers nothing: it makes a new request, the first stays open until it expires, and the run that waits for it goes on waiting.

Rules of an answer:

- A caller that may write to the playbook can answer.
- The answer is checked against the answer schema the request recorded, and takes at most 64 KiB as JSON.
- It is recorded on the run as one fact, `request_answered`, with the answer and `claimed_for`. `claimed_for` is whom the caller says it answers for: a claim the runtime keeps and never checks. The fact records the caller and the time itself.
- `answer_interaction` returns that fact: the `run_id`, the `answer_id` of the fact (which `get_event` reads), the `answer`, `claimed_for`, `answered_by` (the caller's id) and `answered_at`.
- The request leaves the inbox at once. The run takes the answer within about a second (the server checks waiting runs every second by default). It succeeds with the answer as its output, settled as the caller that answered.
- An answer that does not match is `invalid_input`, with a pointer under `/answer` for each problem, and leaves the request open.
- The same answer sent again returns the fact the run took. A different answer is `conflict`, since a run takes one answer.
- An answer to a request that has ended, or whose run was asked to cancel, is `conflict`, and so is an answer to a notification.

### Listing requests

`list_interactions`, or `GET /v1/orgs/{org}/playbooks/{playbook}/interactions` over HTTP, lists the playbook's open requests, newest first. An answered request leaves the list. Each request shows:

- the `run_id`, and the `type`, the name and the version of the function that asked;
- `to`, and the `delivery`: the tool the request is sent through, or `null` for the inbox;
- the message, whether it takes an answer, and when it was asked and expires;
- the attempts made, and how its delivery stands: `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, or `cancelling` once a cancel of its run was asked;
- its `answer_schema`, the JSON Schema an answer is checked against as the request recorded it, or `null` for a notification;
- for a request answered by reply, the `conversation` the playbook reads, its `answerer` and how many of its replies were refused.

Filters:

- `to` keeps the requests to one party;
- `type` keeps those of one type of function;
- `function` keeps those of functions of one name. A name is unique within its type, so `function` with `type` names one function.

The list pages with `limit` and `cursor`. Every reader of the playbook sees each party and message, as a run's input is seen.

### Answering by reply

Where a function reads replies, the person answers by replying to the message the playbook sent, in the chat where it reached them. While the request stands open, the playbook reads the conversation's new replies:

- every few seconds at first, and every five minutes at most, never more often than the function's `wait`;
- taking a reply only from the answerer: the function's `from`, or `to` when it gives no `from`. A reply from anyone else is passed over and kept nowhere.

The `reply` rule reads the answer from a reply. It maps each top-level string property of `output.schema` to where in the reply its value comes from:

| Part   | The value is                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------- |
| `word` | The reply's first word: one of the property's `enum` values, or a word that `words` lists for one |
| `rest` | What follows the first word, such as a note                                                       |
| `text` | The whole reply                                                                                   |

A part is written as `word`, `rest` or `text`, or as an object with `from` and, for `word`, `words`. For example, `reply: { verdict: { from: word, words: { approve: [yes, ok] } }, note: rest }` takes `verdict` from the first word and `note` from the rest. There "yes" also means `approve`. Words are compared without case and without punctuation around them. A word means one value only, and only `word` takes `words`. A notification takes no reply rule.

Left out, the rule is made from the schema when the answer has one required property that is a string. That property comes from the first word when it has an `enum`, and from the whole reply when it has none. The rule made this way reads no other property, so write `reply` to keep a note.

How replies are taken:

- A reply the rule cannot read is refused. Where the function writes `tell`, the party is told how to answer, three times at most.
- A reply in a thread answers the question the thread began with. A reply outside a thread answers the conversation's one open request, and is refused when several are open.
- The answer is recorded as any answer is, as `request_answered`. It carries `reply`, the identity of the message that answered. It names the playbook (`playbook:` and its id) as the one that answered. The run takes it at once.
- A reply taken once is never taken twice, and a request already answered takes no further reply.
- A request whose function reads no replies is answered with `answer_interaction` alone. A function that reads replies always has a reply rule, since one without is refused when saved.

## How a run ends

| Ending                                         | When                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                    | The request was answered, and the answer is the output                                                                                                                                                |
| `succeeded`                                    | A notification was delivered, with the output `{}`. One without `deliver` succeeds at once                                                                                                            |
| `succeeded`                                    | A function with `call`: the tool returned a result and the part `read` points at matched `output.schema`; that part is the output                                                                     |
| `invalid_input`                                | The input does not match the input schema, or a template names a value the input lacks                                                                                                                |
| `conflict`, kind `unworkable`                  | `to` or `from` rendered empty, as something that is not text, with a control character, or longer than 256 bytes                                                                                      |
| `conflict`, kind `unworkable`                  | The message is longer than 8 KiB, or the arguments of `deliver` pass 16 KiB or one renders no text                                                                                                    |
| `conflict`, kind `unworkable`                  | A function with `call`: an argument renders a structure among text, or the arguments pass 16 KiB                                                                                                      |
| `conflict`, kind `unworkable`                  | A function with `call`: the tool refused the arguments                                                                                                                                                |
| `conflict`, kind `unworkable`                  | A function with `call`: the answer has nothing to read, or nothing where `read` points                                                                                                                |
| `conflict`, kind `unworkable`                  | A function with `call`: the part at `read` is more than a run may record (1 MiB with its record), or holds a value `output.schema` refuses                                                            |
| `unavailable`, kind `tool_not_offered`         | A server the function names does not serve the playbook, or its operator does not allow a tool the function names. For a function with `call`, also a tool the server does not list. Nothing was sent |
| `unavailable`, kind `tool_server_failed`       | A function with `call`: the tool server could not be reached, or refused the connection or the listing of its tools. Nothing was sent                                                                 |
| `unavailable`, kind `tools_unfinished`         | A function with `call`: the call was sent and then failed, and the server marks the tool read-only. Trying again under a new run id is safe                                                           |
| `conflict`, kind `effect_unknown`              | The same, for a tool not marked read-only, which may have changed something. No retry on status 503 matches it; a person, or a workflow rule that names the kind, decides                             |
| `unavailable`, kind `requests_full`            | The playbook already has as many open requests as the runtime allows: 10,000 unless its operator sets another number with `INTERACTION_OPEN_REQUESTS`                                                 |
| `rejected` as `unanswered`, kind `expired`     | Nobody answered the request before it expired                                                                                                                                                         |
| `rejected` as `unanswered`, kind `undelivered` | Every attempt to deliver a notification failed                                                                                                                                                        |
| `rejected` as `cancelled`                      | `cancel_run` cancelled the run, or the workflow that waited for it ran out of time or ended first                                                                                                     |
| `failed`                                       | The runtime itself broke down                                                                                                                                                                         |

More rules:

- A failed call has a `because`. It is `server_failed` when the server failed on the call or did not respond within 30 seconds. It is `tool_error` when the tool returned an error. Both `tools_unfinished` and `effect_unknown` carry it.
- After a call of a tool that may change something, an answer the run cannot use still ends `unworkable`. Its detail says that running again calls the tool again.
- A request that has ended is final for its run id. Answering it is `conflict`, and running the function again starts a new request under a new id.

### The run's history

The run's history shows, in order:

1. `interaction_requested`: the delivery, the party, the size of the message, whether it takes an answer, and the expiry.
2. Each delivery attempt as `delivery_started`, with the tool and the size and digest of its arguments, and then how it ended:
   - `delivery_succeeded`, with the size and digest of what the tool returned. Where the delivery writes `sent`, it also shows what the message was delivered as and where its replies are read.
   - `delivery_failed`, with `because` (`tool_error`, `arguments_refused`, `server_failure`, `timed_out`, `tool_not_offered` or `lost`), its words, and the wait a server asked for as `retry_after_ms`.
   - `delivery_refused`, with `because` `too_large` or `unworkable`.
3. The answer as `request_answered`, with the answer, the claim and, for a reply, its identity.
4. Each refused reply as `reply_refused`, with the reply's identity and never its words.
5. The run's end.

A function with `call` shows its call as `tool_call_started` and `tool_call_answered`, or `tool_call_failed` when the tool never returned a result.

What is kept and shown:

- The playbook keeps the arguments, the message among them, and the tool's whole result, scrubbed of secrets. The operator can turn this off for a server with `record_content`.
- The history shows each where it takes at most 2 KiB, and its size beyond. `get_event` reads one event with both whole.
- An answer is the run's output. Its `run_succeeded` shows it where it takes at most 2 KiB, and `get_run` returns it whole.
- `list_playbook_events` shows the playbook's reads of a conversation, `replies_read` or `reading_failed`, and its tellings: `telling_started`, then `telling_succeeded` or `telling_failed`.

## Bounds

| Bound                                         | Value                                                                                                                      | When it is reached                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The rendered party, and the answerer          | 256 bytes, no control character                                                                                            | `conflict`, `unworkable`                                                         |
| The rendered message                          | 8 KiB                                                                                                                      | `conflict`, `unworkable`                                                         |
| The arguments of a call                       | 16 KiB as JSON                                                                                                             | `conflict`, `unworkable` at the start; a read or telling is not sent             |
| The arguments of a call that reads no `input` | 16 KiB as JSON                                                                                                             | Refused when saved                                                               |
| A call of the tool                            | 10 seconds to open, 30 seconds to respond                                                                                  | A failed attempt or read                                                         |
| A function's call of its tool                 | 10 seconds to open, 10 to list the tools, 30 to respond                                                                    | `tool_server_failed` before sending; then `tools_unfinished` or `effect_unknown` |
| What a function's `read` takes                | 1 MiB as JSON with the run's record, 512 levels                                                                            | `conflict`, `unworkable`                                                         |
| Calls in one run of a function with `call`    | 1, within 70 seconds                                                                                                       | Not applicable                                                                   |
| What `sent` reads, and the conversation key   | 256 bytes of text each, no control character                                                                               | Delivered without what it was delivered as; the request takes no reply           |
| A read's result                               | 64 KiB                                                                                                                     | A failed read; the reading goes on                                               |
| A reply's words                               | 8 KiB                                                                                                                      | The reply is refused                                                             |
| A reply rule                                  | 16 values, 16 words a value, 64 bytes a word                                                                               | Refused when saved                                                               |
| Refused replies of a request                  | 10 recorded, 3 told                                                                                                        | Further ones leave no trace, or are recorded and nobody is told                  |
| Reads of a conversation                       | 5 seconds after a request joins, then 10, 20 and 40 seconds, then every minute through the 18th read, then every 5 minutes | Not applicable                                                                   |
| `expires`                                     | 1 minute to 30 days                                                                                                        | Refused when saved                                                               |
| An answer                                     | 64 KiB as JSON, 512 levels                                                                                                 | `invalid_input`                                                                  |
| `claimed_for`                                 | 256 bytes                                                                                                                  | `invalid_input`                                                                  |
| Attempts                                      | 5: at once, then after 1, 2, 4 and 8 minutes                                                                               | A question stays open; a notification ends `unanswered` as `undelivered`         |
| Open requests of a playbook                   | 10,000 unless the operator sets another number                                                                             | `unavailable`, `requests_full`                                                   |

Reads of a conversation never come sooner than the function's `wait`. A server that responds to a read with `Retry-After` is waited for as long as it asks, up to an hour.

## In a workflow

A workflow calls an interaction function as it calls any function, with `call: run_definition` and `type: interaction`.

A function with `call` finishes within its call:

- The step's output is what the tool returned at `read`. The function's own maximum is 70 seconds, so the step waits at most 70 seconds plus one minute.
- A 503 it raises, `tool_server_failed`, `tool_not_offered` or `tools_unfinished`, is safe to try again, so a retry on that status matches it.
- `effect_unknown` raises 409 under the [problem type](http.md#responses-and-errors) `https://on.auto/problems/effect_unknown`. A retry on status 503 leaves it alone. A `catch` that names its type or kind, matches status 409 or catches every error takes it, and a retry then calls the tool again under a new run id.

A function that asks a person:

- The step waits up to the function's `expires` plus one minute for the request, across a restart and without using server resources. Its output is the answer.
- A request nobody answers raises an error of the [problem type](http.md#responses-and-errors) `https://on.auto/problems/unanswered`, status 410, with the kind `expired`, or `undelivered` for a notification.
- Only a `catch` that names that type or status 410, or catches every error, takes it. So a workflow handles an unanswered request only on purpose. A workflow that does not catch it ends `rejected` as `unanswered` with the same kind.
- When the step runs out of time, or the workflow ends first, the request is cancelled.

This workflow asks for the approval and, when nobody answers in time, asks for a revision:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-review-tutorial
  name: brief-approval
  version: '1.0.0'
  summary: Asks the campaign's owner to approve a review, and asks for a revision when nobody answered.
input:
  schema:
    document:
      type: object
      required: [owner, review]
do:
  - approval:
      try:
        - ask:
            call: run_definition
            with:
              type: interaction
              name: approve-campaign-brief
              input: '${ $data }'
      catch:
        errors:
          with: { type: https://on.auto/problems/unanswered, kind: expired }
        do:
          - unanswered: { set: { verdict: revise, note: No answer within two days } }
```

The run ends `succeeded` with the answer, such as `{"verdict": "approve"}`, as its output, or with `{"verdict": "revise", "note": "No answer within two days"}` when the request expired. `list_interactions` shows the request while it waits, under the `run_id` of the interaction function's run.

`send_run_event` remains for events a waiting workflow listens for that are not the answer to a question.

## The overview

`get_definition` returns a saved function with its `overview`: the function in plain words, for a person who does not read Liquid or YAML. Auto Studio shows it before the document. It opens with the `description`, as a sentence, or says the function has none yet, then the `about` as it is written. It then tells what happens, and names each field by its meaning: the first clause of the field's `description`, such as "the month" for `The month, such as April 2026` beside other fields (a field alone keeps its commas), where that clause begins with the, a, an, its, their, each, every, one, how, what, which, who, where or whether and holds at most 60 characters, or else the field's name in words. The technical facts follow under **Details**.

For a function that asks a system, the overview says in one paragraph what it is given, the server and the tool it asks once per run, and what it answers with: the part of the tool's answer that `read` points at, and its fields. Under Details: each field of `input.schema` and `output.schema` with its name, its whole description, its type and its bounds, and the call: the tool, its server, `read` and each argument as written.

For a function that asks a person, it says:

1. For a function that reads replies by their first word, a diagram: the message, the wait, the first word of a reply deciding each value, and the request that nobody answers.
2. What it is given and whom it sends the message: the meaning of the value `to` reads where `to` is one value, such as `{{ input.owner }}`, `to` itself where it is text, and the party named under Details otherwise.
3. The message, quoted as the person receives it. Each value it reads is in brackets, by its meaning, such as `[the draft report]` for `{{ input.draft }}`, so the author's own bold and italics stay as written.
4. How long it waits and how far apart it reads the replies; how a reply gives each property of the answer, such as "a reply whose first word is approve gives the verdict approve"; that a reply that begins with another word is not taken, or, where the rule reads no first word, that a reply it cannot read is not taken, each with the person told how to answer where `tell` says how; and that a request nobody answers by its expiry ends unanswered. A request in the inbox says that whoever may write to the playbook answers it, and a notification that it waits for nothing.
5. What it answers with: each field of `output.schema`, a field the answer may leave out "when there is one".

Under Details: each field of `input.schema` and `output.schema` with its name, its whole description, its type and its bounds, or that a notification takes no answer, and where the request goes: `to` and `from` as written, and whose reply alone answers where it reads replies, the tools and servers of `deliver` and `replies`, and `wait` and `expires` as written.

Either kind ends with **Used by**: the active definitions of the playbook that use this function, read each time it is returned, and left out when there are none.

The runtime composes the overview from the document when it is saved, and writes it at each read with the definitions that use the function, so the rest says only what the document says. Write the `description` in one or two sentences, and give each field of the schemas a `description` that begins with an article where the field names a thing, such as `The campaign to approve`, so the overview can name the field by it. Write the `about` for a business reader: what the function is for, who it serves, when it runs and what happens. Neither it nor the `description` takes a heading, since the overview writes its own, and a save refuses one at its line. Write it as a literal block scalar, `about: |` with its lines indented under it, so that a `#` in it is text and each of its lines stays a line:

```yaml
about: |
  The campaign owner approves each brief before it goes to a client.
  It runs when a brief is ready, waits two days for the owner's answer,
  and answers with their decision and their note.
```

A function without them still has an overview, with the names of its fields alone.

## Availability

Interaction functions are available in every runtime. A request reaches a person through the inbox, or through the tools of the tool servers the operator configures. See [Functions and availability](../concepts/functions.md#availability).

</div>
