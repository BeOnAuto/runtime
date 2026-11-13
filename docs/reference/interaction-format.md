---
description: 'The document format of an interaction function: asking a system, asking a person or an agent and waiting for the answer, and sending a notification.'
---

<div v-pre>

# Interaction function format

An interaction function is a definition of the type `interaction`. It takes one of three shapes:

| Shape                              | What a run does                                                                                                                                                            | Use it for                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Asks a system                      | Calls the tool named in `call` once, and returns part of the tool's result at once                                                                                         | What a system does and answers now, such as adding a contact to a list    |
| Asks a person through a connection | Renders a request to a party, with an expiry, and sends it through the tool of a connection named in `deliver`, such as a chat's post tool, and may read the replies to it | An approval, a choice, or a figure only someone else has, where they work |
| Asks an agent                      | Renders the same request and holds it for an agent, `deliver: agent`, which reads it with `list_interactions` and answers it with `answer_interaction`                     | The same, answered by the person in a conversation with their agent       |

Use one where a person must decide or supply something, or a service must act. It is not for reading what a tool marked reads returns, which is a lookup function's work, and no model reads the answer: judging or wording it is a reasoning function's.

A message to a person can be a card, with fields, a table, a chart and link buttons, instead of a text: write `render` in the front matter, and read the guide [`render-slack`](render-slack.md) first.

A run that asks a person renders the message from its input. Then it waits until the request is answered, expires or is cancelled, without using server resources. The answer is checked against the document's answer schema, and becomes the run's output. A function without an answer schema sends a **notification**, which needs no answer and goes through a connection.

## How a request reaches its party

Write in `deliver` how the request reaches its party: the tool of a connection that sends to them, or `agent`. A person answers a request where it reaches them, so a request that names neither is refused when it is saved.

A connection carries a request when its server offers two tools:

- A tool that sends to a party. Its name says it sends, posts, publishes, replies, comments or mails, or creates or writes a message, a comment or mail, and names no other operation, such as update, delete, pin or list. It deletes nothing, and where an OpenAPI document describes it, that document does not say it answers without a body, since `sent` points into what it answers.
- A tool marked `reads` that reads the replies.

For example:

- a chat tool: the tool that posts a message in a channel or a thread, and the one that lists the replies of a thread;
- an email provider: the tool that sends mail, and the one that lists the messages of a thread;
- a ticketing or approvals app: the tool that adds a comment to an item, and the one that lists its comments.

`deliver: agent` holds the request for an agent: an agent the person talks to reads it with `list_interactions`, and answers it with `answer_interaction` once the person says what to answer.

A notification takes no answer, so no agent holds it: it goes through a connection, `deliver` naming the tool that sends it, and any connection with a tool that sends can carry it. Its run succeeds with the output `{}`, so nothing after it learns where the message landed. To post something whose replies a later step reads, write a function that [asks a system](#asking-a-system) instead: its `call` posts the message, and its output keeps the tool's answer, such as the message's `ts`, for a lookup function to read the replies by.

Ask the person once where they want to be asked. When a document names no way to reach its party, `create_definition` and `update_definition` refuse it, and the refusal names the ways this playbook has:

- For a request, each connection of the playbook whose tools can send a request and read its replies, with those two tools, and the agent way.
- For a notification that names no tool, or names `agent`, each connection whose tools can send it.

A tool server of the server's own settings is named as a tool server. A playbook with none is told so, with the reason for each connection that cannot be used just now. Wherever no connection can carry it, the refusal says that one can be connected with `search` and `add_connection`, where the agent's tools include both.

When the agent's MCP client answers forms, the server itself asks the person before it refuses, in words such as "Where should the owner be asked?", or "Where should the owner be told?" for a notification. The person chooses from each such connection and, for a request, the agent way. Once they choose, the refusal names the connection's sending tool and, for a request, its reading tool, or says to write `deliver: agent`.

The agent then learns what each tool takes with `introspect`. Once the person agrees, it calls the sending tool with `execute_connection` and a message the party would want anyway, to see what the tool answers for `sent`. Then it writes `deliver` from that answer. For a request, it also calls the reading tool on a thread that already has replies, and writes `replies` from what it lists, as [Sending through a tool](#sending-through-a-tool) sets out.

### Whom a request waits on

A request waits on a member of the org when its party, its `to` as rendered, is an email address, one that holds an `@`: it waits on the member whose address that is, compared without regard to case. A party that is a person's id, `person:` and an id, waits on that person. Any other party, such as a channel, a role or a name, waits on any member of the org, whether the request goes through a connection or is held for an agent. Whom a request waits on does not limit who may answer it: any caller that may write to the playbook can answer, as [Answering a request](#answering-a-request) says.

So write `to: "{{ input.reviewer }}"`, given the reviewer's address such as `priya@acme.example`, for a request one person should see as theirs. A request answered by reply takes a reply only when the reading tool names its sender exactly as the answerer is written: `from`, or `to` when there is no `from`. So a chat request that waits on an address also writes `from` as the chat names the person, and gives the sending tool the conversation to post in from the input rather than from `to`; see [Answering by reply](#answering-by-reply). [The organization's activity](http.md#the-organization-s-activity) shows each open request as a `needs_you` row whose `waits_on` holds the address in lower case, the person's id or `any_member`. It counts a request for the caller whose id it names, or for every caller where it waits on any member, and one that names an address for no caller, since the runtime knows a caller by their id and never by an address: a client that knows the person's address, as Auto Studio does, tells them which of those are theirs.

## A function document

The source is Markdown with YAML front matter followed by the message. This example, `approve-campaign-brief`, asks a campaign's owner, in the team chat, to approve the review of their brief, and takes their answer from their reply in the thread of the message. Its answer is `{ verdict: approve | revise, note? }`:

<!-- prettier-ignore -->
````markdown
---
description: Asks the campaign owner, in the team chat, to approve a reviewed brief
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
page:
  data:
    language: typescript
    source:
      events:
        - type: run_started
          subject: interaction/approve-campaign-brief
        - type: run_succeeded
          subject: interaction/approve-campaign-brief
        - type: run_rejected
          subject: interaction/approve-campaign-brief
        - type: run_failed
          subject: interaction/approve-campaign-brief
    views:
      waiting: categories
      decisions: table
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const open = (view.waiting?.values[0]?.value ?? 0) + (event.type === 'run_started' ? 1 : -1);
        const waiting = { values: [{ name: 'Waiting for an answer', value: Math.max(open, 0) }] };
        const verdict = fieldOf(fieldOf(event.data, 'output'), 'verdict');
        const answer = verdict === 'approve' ? 'Approved' : verdict === 'revise' ? 'Sent back' : undefined;
        const day = event.time?.slice(0, 10);
        if (answer === undefined || day === undefined) return { ...view, waiting };
        const rows = view.decisions?.rows ?? [];
        const counted = rows.some(([at, kind]) => at === day && kind === answer)
          ? rows.map((row) => (row[0] === day && row[1] === answer ? [day, answer, Number(row[2]) + 1] : row))
          : [...rows, [day, answer, 1]];
        return { waiting, decisions: { columns: [{ name: 'Day' }, { name: 'Answer' }, { name: 'Briefs' }], rows: counted.slice(-60) } };
      }
  result: |
    {% if run.status == "started" %}
    Waiting for the campaign owner to answer in the team chat.
    {% else %}
    {% if output.verdict == "approve" %}Approved{% else %}Sent back{% endif %} by the campaign owner on {{ run.ended | slice: 0, 10 }}{% if output.note %}: {{ output.note | clip: 160 }}{% else %}.{% endif %}
    {% endif %}
  runs: |
    ```chart figure
    {{ views.waiting | json }}
    ```

    ```chart bars x=Day y=Briefs color=Answer
    {{ views.decisions | json }}
    ```
---
The review of your campaign brief is ready:

{{ input.review }}

Reply **approve**, or **revise** with a note of what to change.
````

To save it, call `create_definition` with `type: "interaction"`, the `name` `approve-campaign-brief`, the document as `source`, and its `overview` and `diagram`. A save without a `diagram` is refused, so give the word `none` when a picture would add nothing; [The overview](#the-overview) says how to write both. To run it, call `run_definition` with the same type and name, and with `owner` and `review` in the `input` object. Both operations also take the playbook id, unless the MCP connection is scoped to that playbook.

The run returns `status: started` with its `run_id`, and sends the review to the owner through the chat's `post_message`. The owner answers by replying in the thread of the message, or tells their agent, which answers with `answer_interaction`. The same request held for an agent writes `deliver: agent` in place of `deliver`, `replies` and `reply`. The function's page heads each run with the owner's answer and the day it came, and counts the requests still waiting and the answers of each day; see [Its page](#its-page).

## Asking a system

A function that asks a system names a tool in `call`, with the arguments the call takes. Its run makes one call and takes the part of the tool's answer that `read` points at. It checks that part against `output.schema` and ends with it as its output.

A tool marked `reads` belongs to a lookup function, which takes the same `call`: an interaction function that names one is refused when it is saved and its server can be asked, in words that say to save it with the type `lookup`. See [Lookup function format](lookup-format.md).

Such a function makes no request, sends no message and asks no model. So it has no `to`, `expires`, `deliver`, `replies`, `render` or body.

Write a call from what the tool returns, not from memory:

1. Call `search` to see the tool servers this playbook may use, the tools each offers and the mark of each. Call `introspect` for the `input_schema` a tool takes.
2. `introspect` gives what a tool takes, not what it answers, and a call may change something. So look for a call that changes nothing: a tool that takes each id once changes nothing when it is called again with an id it has already taken. Once the person agrees, call it with `execute_connection`, with the arguments its `input_schema` takes, and read its `answer`. That is the document `read` points into: the tool's structured content, else the text of every text block and every embedded resource that holds text, such as a file, in the tool's order and joined by a newline, parsed as JSON where that text is JSON, else that text.
3. Write `call`:
   - `server` and `tool`, as `search` names them;
   - `with`, the arguments;
   - `read`, a JSON Pointer to the part of the answer the function returns, such as `/messages`. Leave `read` out to return the whole answer.

   Then write `output.schema`: the shape that part has in the answer `execute_connection` gave. Name only the fields the function's readers need, list in `required` only the fields every answer holds, and allow `null` wherever the tool may answer `null`: one answer does not show every case.

4. Show the person the whole document. Once they agree, save it with `create_definition`, `type` interaction. `run_definition` runs it and returns its output at once.

The arguments in `with` are the tool's own, named as its `input_schema` names them, and may nest:

- A number, `true`, `false`, `null`, or a list or an object of them, is sent as written.
- A text is a Liquid template that reads `input`, `today` and `now`, and is sent as the text it renders.
- A text that is one `{{ }}` and nothing else sends the value it reads, as that value is. So `'{{ input.limit }}'` sends a number when the input's `limit` is a number.

`read` names a place in the answer and nothing more. To reshape what a call returns, use the workflow's `output.as`, or a computation function.

How a call ends when it goes wrong:

- Before anything is sent: when the playbook may not use the tool server, the operator does not allow the tool, or the server does not list it, the run ends `unavailable` as `tool_not_offered`, in words that name `search`. When the server cannot be reached, it ends `unavailable` as `tool_server_failed`. Either can be run again.
- Once the call is sent, it is in the run's history. When the tool server fails on it, or the tool returns an error:
  - a tool marked `reads` ends the run `unavailable` as `tools_unfinished`, status 503. A workflow may try it again.
  - any other tool may have changed something, so the run ends `conflict` as `effect_unknown`, status 409. A workflow's retry on status 503 does not match it.
- The tool refused the arguments, or the answer holds nothing where `read` points, or does not match `output.schema`. The run ends `conflict` as `unworkable`, which trying again does not change.

A tool that pages returns one page for each run. Point `read` at the part that holds both the items and the cursor, and have the workflow call again with the cursor while there is one.

A run that called its tool and did not succeed is never run again under its run id, since the tool may have changed something. A request with that id returns `conflict` with the kind `tools_called`. Check the run's history, then start a new run under a new id. [Retrying under a run id](http.md#retrying-under-a-run-id) gives every case.

## Sending through a tool

A function sends its request through a tool by naming the tool in `deliver`, with the arguments the call takes. It needs nothing set up beyond the tool server itself, a connection of the org or a server whoever runs this server set up.

Write a delivery from what the tool returns, not from memory:

1. Call `search` to see the servers this playbook may use and the tools each offers, and `introspect` for the `input_schema` a tool takes.
2. The sending tool sends a real message, so wait until the person agrees, and make it one the party would want anyway, such as one that tells them the playbook will ask them here. Then call it with `execute_connection`, with the arguments its `input_schema` takes, and read its answer. That is the document `deliver.sent` points into. `sent` holds two JSON Pointers: to the conversation the message landed in, and to the message's identity. A chat's tool that posts a message returns the conversation it posted in and the message's timestamp or id.
3. If the person will answer where the message reached them, call the tool that reads what came since a point, with `query_connection` where it is marked `reads` and `execute_connection` where it is not. Read a thread that already has replies, to see their fields without asking the party to reply. Then write `replies`:
   - `conversation`, the key the playbook reads the conversation by;
   - `tool` and `with`, the reading tool and its arguments, over `sent` and the cursor `since`;
   - `read`, the pointers to the list of replies and, within each, to its id, its sender, its words and the message it answers;
   - `wait`, the floor of the reading cadence;
   - `tell`, what the party is told of their reply: left out, as the provider of the connection says; `refusals` only when a reply was not taken; `none` never.

   The `reply` rule maps the words of a reply to the answer; see [Answering by reply](#answering-by-reply). [Tool blocks](#tool-blocks) gives each key, whether it is required and its default.

4. Write `deliver` with `server`, `tool`, `with` and `sent`. Show the person the whole document, and save it with `create_definition`, `type` interaction, once they agree. A run refuses a server this playbook may not use, or a tool its operator does not allow, in words that name `search`.

The arguments of `deliver.with`, `replies.with` and `tell.with` are typed as written:

- A number, boolean, null, list or object is sent as written, with the templates inside its strings rendered.
- A string that is exactly one `{{ expression }}` is sent as the value the expression reads. A number stays a number and an object stays an object, so `'{{ answer_schema }}'` sends the schema itself.
- Any other string is rendered as text. Use `| json` to embed a structured value in it.

The templates of `deliver.with` read:

- `input`, `today` and `now`, as the message does. Here `today` and `now` are the request's own moment, so every attempt sends the same arguments.
- The request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`. `to` is the party the request goes to, which the templates may use as the tool's address or not.
- `rendered`, only for a function with `render`: the blocks of its card, as a list, as [Rendering the message as a card](#rendering-the-message-as-a-card) sets out.

A template holds no `${`, since a document is never filled from the environment.

[`approve-campaign-brief`](#a-function-document) sends the review to its owner in a chat, and takes their approval from the replies in the thread of the message. Every name in it is the chat's own, learned by testing its two tools. Testing shows what the sending tool takes, where its result names the message, and what the reading tool lists. `channel` is the chat's word for a conversation; the playbook passes it on as it passes any argument.

- `tell` names no `tool`, so a party whose reply was not an answer is told through `post_message`, the sending tool, in the thread of the message.
- `reply` takes the verdict from the first word of a reply and the note from the rest. Without it, the rule made from the schema would read the verdict alone and drop the note.

[Tool blocks](#tool-blocks) gives every key of `deliver` and `replies`, with its default.

### Attempts

A request sent through a tool is attempted at once. After a failed attempt it is tried again 1, 2, 4 and 8 minutes after the one before: five attempts in all.

- A server that responds with `Retry-After` is waited for as long as it asks, up to 8 minutes.
- Each attempt is one call of the tool. It is recorded in the run's history before it is sent, with the size and digest of its arguments. So two servers never make the same attempt. Its end records what the tool returned.
- These are failed attempts, tried again: a tool error, a server failure, no response within 30 seconds, and a connection not opened within 10 seconds.
- Arguments past 256 KiB as JSON are refused and not tried again.
- A tool the server no longer offers to the playbook fails the attempt. The request stays open, and `answer_interaction` answers it.
- An attempt cut off by a restart counts as failed a minute after it started, and the next one follows. So a tool may be called twice for one request.
- A question whose attempts are spent stays open until someone answers it or it expires. A notification whose attempts are spent ends `unanswered` as `undelivered`.

## Rendering the message as a card

A request sent through a connection may write `render: slack`, the only target, so that its body is a card in YAML instead of a Liquid text. The run turns the card into Slack blocks and offers them to `deliver.with` as `rendered`, with the card's plain text as `message`. [Cards for Slack](render-slack.md), the `render-slack` guide, holds the components, their props, the limits, the example and what is refused. The rules that involve other keys are checked when the function is saved:

- `render` names another target, or is written with `call`, with no `deliver`, or with `deliver: agent`.
- `deliver.with` reads no `rendered`, or the function has no `render` and reads it.

## Fields

| Field           | Purpose                                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                                                                                                                                                                                   |
| `call`          | The tool the function asks: `server`, `tool`, `with` and `read`; see [`call`](#call). With it, `output.schema` is required and `to`, `expires`, `deliver`, `replies`, `from`, `reply`, `render` and the body are refused                                                                                                      |
| `to`            | Required without `call`, refused with it. A template that renders the party the request goes to: a name the playbook's readers filter by, which a delivery's templates may use as the tool's address                                                                                                                          |
| `from`          | Optional. A template, as `to` is, that renders the party whose reply counts, the answerer; `to` when left out. A request sent to a room names the person here                                                                                                                                                                 |
| `expires`       | Required without `call`, refused with it. An ISO 8601 duration from one minute to thirty days, such as `PT4H` or `P2D`, after which a request nobody answered ends                                                                                                                                                            |
| `deliver`       | The tool the request is sent through: `server` and `tool` as `search` names them, and `with`, the call's arguments. `sent` holds two JSON Pointers into the tool's answer, to the conversation and to the message's identity; see [`deliver`](#deliver). Or `agent`, for a request held for an agent. Required without `call` |
| `replies`       | Only with the tool of `deliver`, its `sent` and `output.schema`: how the replies to the message are read, with `conversation`, `tool`, `with`, `read`, `wait` and `tell`; see [`replies`](#replies)                                                                                                                           |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                                                                                                                                                                             |
| `output.schema` | Optional JSON Schema of the answer. The answer must match it and is the run's output. A function without it is a notification: it takes no answer and succeeds once its request is delivered                                                                                                                                  |
| `render`        | Optional, `slack` only: the body is a card in YAML, as [Rendering the message as a card](#rendering-the-message-as-a-card) sets out. Refused with `call` and `deliver: agent`                                                                                                                                                 |
| `reply`         | Optional, only with `output.schema`: the reply rule; see [Answering by reply](#answering-by-reply)                                                                                                                                                                                                                            |
| `page`          | Optional [page](page-format.md) that presents its runs                                                                                                                                                                                                                                                                        |

`model`, `config`, `tools`, `language` and every other field are rejected with their line. The body after the front matter is the message, or with `render` a card. The saved function has the `media_type` `text/markdown`.

Quote a text that holds ` #`, or a comma inside `{ }`, such as `description: 'Posts the notes in #deliveries'` or `{ note: 'Costs 1,000 a month' }`. Unquoted, YAML reads ` #` as the start of a comment and a comma there, even the one in `1,000`, as the start of another key, so the text ends early, and the save does not always say so.

### Fields by shape

| Field                         | Asks a system | Asks a person through a connection                               | Asks an agent                                    |
| ----------------------------- | ------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `call`                        | Required      | Refused                                                          | Refused                                          |
| `to`, `expires`, the message  | Refused       | Required                                                         | Required                                         |
| `from`                        | Refused       | Optional                                                         | Optional                                         |
| `render`                      | Refused       | Optional; needs a `deliver` tool that reads `rendered`           | Refused                                          |
| `deliver`                     | Refused       | Required: the tool that sends the request                        | Required: `agent`                                |
| `replies`                     | Refused       | Optional; needs `deliver.sent`, `output.schema` and a reply rule | Refused                                          |
| `output.schema`               | Required      | Optional; without it, a notification                             | Required                                         |
| `reply`                       | Refused       | Optional, with `output.schema`; read only with `replies`         | Optional, with `output.schema`; nothing reads it |
| `description`, `input.schema` | Optional      | Optional                                                         | Optional                                         |

A request that names no `deliver` is refused when saved, and so is a notification that names no tool, whether it leaves `deliver` out or writes `deliver: agent`; [How a request reaches its party](#how-a-request-reaches-its-party) says what the refusal names.

A function that reads replies needs a reply rule: the one `reply` writes, or one made from the answer schema. Without either, it is refused when saved.

### Templates and pointers

`to`, `from` and the message are Liquid templates that read `input`, `today` and `now` and nothing else. The body of a function with `render` is a card and no template. A rendered value is text and is never read again as a template.

A template must render within 200 ms. One that builds a large text in a long loop or through a long chain of filters can be refused for its time, whatever its size, so send a large value as one `{{ }}`, which sends it as it is.

A template may use the filters listed in [Templates](template.md#filters), the `templates` guide, the same in every template.

Every template is checked when the document is saved, against the names its place reads:

| Place                                  | Names it reads                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`, `from`, the message, `call.with` | `input`, `today`, `now`                                                                                                                            |
| `deliver.with`                         | `input`, `today`, `now`, and the request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`; with `render`, also `rendered` |
| `replies.conversation`                 | `to`, `sent.conversation`, `sent.id`                                                                                                               |
| `replies.with`                         | `to`, `sent.conversation`, `sent.id`, `conversation`, `since`                                                                                      |
| `tell.with`                            | `to`, `sent.conversation`, `sent.id`, `message`, `reply.id`, `reply.to`                                                                            |

A template is rejected with its line when it does not compile, names another value, or names a property the input schema does not allow. So is a structure inside a longer text, in a template that reads no `input`; one that reads `input` is checked when the run renders it.

Other rules checked when saved:

- Each pointer of `call.read`, `deliver.sent` and `replies.read` is a JSON Pointer such as `/messages`. It starts with a slash, writes `~` as `~0`, and writes a slash within a name as `~1`.
- `read.order` is `oldest_first` or `newest_first`.
- `wait` lies between `PT5S` and `PT1H`, and is `PT5S` when left out.
- A function that reads replies and writes no `tell`, or `tell: all` or `tell: refusals`, is refused when its server can be asked and its provider does not say how its conversations are replied to, as a server added by hand does not: `Nothing says how a reply is answered through chat, so nobody could be told what became of theirs; write tell.with, the arguments of post_message that post under the message, or tell: none to stay silent`.
- The server and the tool are not checked when the document is saved, but for the mark of the tool of `call` when its server can be asked: one it marks `reads` is refused, since it belongs to a lookup function. A document whose server cannot be asked just then, or does not serve the playbook, is saved. A run whose server does not serve the playbook, or whose tool its operator does not allow, is `unavailable` with the kind `tool_not_offered`.

## Tool blocks

### Which tool each step uses

A request uses the tools of one server, `deliver.server`:

| Step                      | Tool                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Send the message          | `deliver.tool`                                                                                                   |
| Read the replies          | `replies.tool`                                                                                                   |
| Tell the party of a reply | The provider's own way of replying and marking, or `replies.tell.tool`, or `deliver.tool` when `tell` names none |

A function with `call` uses `call.tool` on `call.server`. A run checks every tool its function names before it sends anything: the server must serve the playbook, and the operator must allow the tool. Otherwise the run is `unavailable` with the kind `tool_not_offered`.

### `call`

| Key      | Required                           | What it holds                                                                                                     |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server` | Yes                                | The tool server, as `search` names it: 1 to 32 lowercase letters, digits and hyphens, starting with a letter      |
| `tool`   | Yes                                | The tool, as `search` lists it: 1 to 128 letters, digits, underscores, hyphens and dots. The server must list it  |
| `with`   | No; `{}` when left out             | The tool's arguments, named as its `input_schema` names them. Their templates read `input`, `today` and `now`     |
| `read`   | No; the whole answer when left out | A JSON Pointer to the part of the tool's answer the run returns, such as `/messages`. An empty pointer is refused |

The answer is the tool's structured content, else the text of every text block and every embedded resource that holds text, such as a file, in the tool's order and joined by a newline, parsed as JSON where that text is JSON, else that text.

### `deliver`

| Key      | Required                     | What it holds                                                                                                                                                                                        |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server` | Yes                          | The tool server, as `search` names it. Reading replies and telling use it too                                                                                                                        |
| `tool`   | Yes                          | The tool that sends the message                                                                                                                                                                      |
| `with`   | Yes                          | The sending tool's arguments. Their templates read `input`, `today`, `now` and the request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`; with `render`, also `rendered` |
| `sent`   | With `replies`; otherwise no | Where the tool's answer names the message it sent; see [`deliver.sent`](#deliver-sent). Without it, the history does not say what the message was delivered as                                       |

### `deliver.sent`

| Key            | Required | What it holds                                                                |
| -------------- | -------- | ---------------------------------------------------------------------------- |
| `conversation` | Yes      | A JSON Pointer to the conversation the message landed in, such as `/channel` |
| `id`           | Yes      | A JSON Pointer to the message's identity, such as `/ts`                      |

- Each must point to a text or a whole number of at most 256 bytes, with no control character.
- When one does not, the request is still delivered, without what it was delivered as. A function that reads replies then takes no reply, and the request waits for `answer_interaction`.
- The templates of `replies` and `tell` read the two values as `sent.conversation` and `sent.id`.

### `replies`

| Key            | Required                                      | What it holds                                                                                                                                                              |
| -------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation` | No; `'{{ sent.conversation }}'` when left out | A template over `to`, `sent.conversation` and `sent.id` that renders the key of the conversation. Open requests with the same reading tool and key are in one conversation |
| `tool`         | Yes                                           | The tool of `deliver.server` that lists the messages of a conversation since a point                                                                                       |
| `with`         | Yes                                           | The reading tool's arguments. Their templates read `to`, `sent.conversation`, `sent.id`, `conversation` and `since`                                                        |
| `read`         | Yes                                           | Where the replies are in the reading tool's answer; see [`replies.read`](#replies-read)                                                                                    |
| `wait`         | No; `PT5S` when left out                      | The shortest time between two reads, from `PT5S` to `PT1H`                                                                                                                 |
| `tell`         | No; the provider's way when left out          | What the party is told of their reply: `all`, `refusals` or `none`, or how a line is posted; see [`replies.tell`](#replies-tell)                                           |

- A key that renders empty, past 256 bytes or with a control character, or arguments of `with` that do not render for the request, leave it to `answer_interaction`.
- In `with`, `conversation` is the rendered key. `since` is the id of the newest message an earlier read listed, and empty text before any. Write `'{{ since | default: "0" }}'` where the tool needs a value.
- Each open request is read by its own read. Open requests whose read is the same call share it. A read whose arguments name the request's own message, as a thread's do with `sent.id`, has its own `since`, empty until it has read, so it starts where its tool starts, at the first message of the thread. The other reads of a conversation go on from where its reads left off, whether or not their replies name a message in `read.each.to`. A conversation makes at most ten reads each time it is read, and the next time goes on from the first it left.

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
| `sender` | Yes      | Who wrote it. Only the answerer's answer is taken                                                 |
| `text`   | Yes      | Its words, which the reply rule reads. A message with nothing there reads as empty and is refused |
| `to`     | No       | The message it replies to, such as the first message of its thread                                |

- A message whose `id` or `sender` is not a text or a whole number of at most 256 bytes, without a control character, is passed over.
- A message the connection's provider marks as posted by an app, such as one with a `bot_id` in Slack, is passed over too, so Auto never answers another program.
- A message from anyone but the answerer is passed over, unless the rule reads it as an answer and its sender answers none of the open requests it could be meant for. Then it is refused once a request, keeping who sent it and never their words.
- A message whose `id` is one the playbook sent in the conversation, such as the first message of a thread it started, is the playbook's own and not a reply. It is passed over and not counted, so a read that finds nothing else has found nothing and records no `replies_read`.
- The message of a request that has ended is the playbook's own too. It is neither taken nor refused, though the read counts it.
- A message a telling of the playbook posted is the playbook's own too, whoever the chat names as its sender, as through a connection that posts as the person who answers. The playbook knows it by the id the telling's tool answered and where it landed, read at `deliver.sent.id` and `deliver.sent.conversation` where the telling goes through `deliver.tool`, and neither takes nor refuses it. Unlike the request's own message, it is still counted among the replies the read found, so a read that finds only a telling records `replies_read` with one reply, none taken and none refused.
- With `to`, a message answers the open request whose `sent.id` it names. It is passed over when it names none of them.
- A message with nothing at `to`, or any message when `each` has no `to`, answers the conversation's one open request. It is refused when several are open.

### `replies.tell`

`tell` is a word, or a block that says how a line is posted.

| The function writes | What the party is told                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing             | What the connection's provider says: through a chat, such as Slack or Microsoft Teams, everything below; a function whose provider says nothing is refused when saved  |
| `tell: all`         | A reply taken is marked, where the provider can mark a message, and answered with one line. A reply not taken is answered with a line that says why. An ending is said |
| `tell: refusals`    | Only a reply not taken is answered. A reply taken is still marked                                                                                                      |
| `tell: none`        | Nothing. A refused reply is still recorded                                                                                                                             |
| The block           | Lines go through its own tool and arguments. `when` is the provider's word when left out, or `refusals`                                                                |

| Key    | Required                                            | What it holds                                                                                                                                                  |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `when` | No                                                  | `all` or `refusals`, as the words above                                                                                                                        |
| `tool` | No; `deliver.tool` when left out                    | The tool of `deliver.server` that posts a line                                                                                                                 |
| `with` | Yes                                                 | Its arguments. Their templates read `to`, `sent.conversation`, `sent.id`, `message`, and `reply.id` and `reply.to`, the reply's message and the one it answers |
| `sent` | No; `deliver.sent.id` when `tool` is `deliver.tool` | A JSON Pointer into what the tool answered, to the message it posted                                                                                           |

- A request keeps the `tell` it was asked with, as its provider said then.
- A reply taken is told `Auto recorded your answer: approve.`, naming the words its rule took, or `Auto recorded your answer.` where the rule takes the whole reply. The mark and the line are made after the answer is recorded, once each, even across a restart of the runtime.
- A request that ends with no reply taken says how, once, in Studio's words: `Answered in Auto by June Park: approve.`, for an answer given through `answer_interaction`, `Expired unanswered.` or `Cancelled unanswered.`. A line whose arguments read `sent.id` goes under the request's message. Any other starts with when the request was sent, in UTC: `The request sent 9 Nov, 09:00 UTC: Expired unanswered.`
- Here `message` is the line, not the request's message. A reply not taken is told why, with the rule's words:

| The reply                                       | The line                                                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not an answer                                   | `Auto couldn't take that as an answer. Reply with approve or revise. Anything after that word is kept as the note.` Where the rule takes the whole reply: `Reply with your answer in words.` |
| An answer the schema refuses                    | `Auto couldn't take that answer:`, the schema's problems, then `Reply with approve or revise.`                                                                                               |
| Past 8 KiB                                      | `That reply is too long for Auto to take. A reply can hold up to 8 KB of text.`                                                                                                              |
| Several requests open, `each.to` names messages | `More than one request is open here. Reply in the thread of the one you're answering.`                                                                                                       |
| Several requests open, without `each.to`        | `Two requests are open here, so Auto can't tell which one this answers. Neither was answered. Answer them in Auto, or reply here when one is left.`                                          |
| An answer from someone else                     | `This request is waiting for someone else's answer, so Auto didn't take this reply.` Once a request, and only where the provider answers every reply, so never by mail                       |
| After the answer, in the read that took it      | `This request was already answered, so Auto didn't take this reply.` Once                                                                                                                    |

- A request is told of replies not taken at most three times, never in the same words twice running. Arguments that do not render are not sent; the reply is still refused.
- A telling whose message the playbook cannot know is the request's last: one through a tool other than `deliver.tool`, whose answer it reads no id from, or one whose tool failed after it may have posted, such as by not answering in time. A reply after it is still refused, and nobody is told.

## Answering a request

`answer_interaction` answers a request over MCP. Over HTTP it is `POST /v1/orgs/{org}/playbooks/{playbook}/runs/{run_id}/answer`. It takes the `run_id` of the interaction function's run, which `list_interactions` shows, and the `answer`:

```json
{ "answer": { "verdict": "approve", "note": "Ready to launch." }, "claimed_for": "the campaign team" }
```

A person often answers in a conversation with their agent: they approve, reject, ask for changes, or say it in other words. The agent then calls `answer_interaction` on the request's `run_id`, with the answer in the shape of the request's `answer_schema`:

- `list_interactions` shows the `answer_schema` beside the `run_id`. It is the function's `output.schema` as it stood when the request was asked. Once the function has changed, `get_definition` no longer shows it.
- For the document above, the person's "approve" is `{ "verdict": "approve" }`, and "revise: name the job role" is `{ "verdict": "revise", "note": "Name the job role." }`. A function with another `output.schema` takes its own shape, whatever words the person used: for a function whose answer has a `decision` of `approve`, `revise` or `skip` and an optional `note`, it is `{ "decision": "approve" }`.
- This holds for a request held for an agent and for one sent through a tool, such as a chat's.
- Running the function or its workflow again answers nothing: it makes a new request, the first stays open until it expires, and the run that waits for it goes on waiting.

Rules of an answer:

- A caller that may write to the playbook can answer.
- The answer is checked against the answer schema the request recorded, and takes at most 64 KiB as JSON.
- It is recorded on the run as one fact, `request_answered`, with the answer and `claimed_for`. `claimed_for` is whom the caller says it answers for: a claim the runtime keeps and never checks. The fact records the caller and the time itself.
- `answer_interaction` returns that fact: the `run_id`, the `answer_id` of the fact (which `get_event` reads), the `answer`, `claimed_for`, `answered_by` (the caller who answered, by `id` and `name`) and `answered_at`.
- The request leaves the open requests at once. The run takes the answer within about a second (the server checks waiting runs every second by default). It succeeds with the answer as its output, settled as the caller that answered.
- An answer that does not match is `invalid_input`, with a pointer under `/answer` for each problem, and leaves the request open.
- The same answer sent again returns the fact the run took. A different answer is `conflict`, since a run takes one answer.
- An answer to a request that has ended, or whose run was asked to cancel, is `conflict`, and so is an answer to a notification.

### Listing requests

`list_interactions`, or `GET /v1/orgs/{org}/playbooks/{playbook}/interactions` over HTTP, lists the playbook's open requests, newest first. An answered request leaves the list. Each request shows:

- the `run_id`, and the `type`, the name and the version of the function that asked;
- `to`, and the `delivery`: the tool the request is sent through, or `null` for a request held for an agent;
- the message, whether it takes an answer, and when it was asked and expires;
- the attempts made, and how its delivery stands: `held_for_an_agent`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, or `cancelling` once a cancel of its run was asked;
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

- A reply the rule cannot read is refused. Unless the function says `tell: none`, the party is told how to answer, three times at most, and a reply taken is marked and, with `tell: all`, answered; see [`replies.tell`](#replies-tell).
- A reply in a thread answers the question the thread began with. A reply outside a thread answers the conversation's one open request, and is refused when several are open.
- The answer is recorded as any answer is, as `request_answered`. It carries `reply`, the identity of the message that answered. It names the playbook (`playbook:` and its id) as the one that answered. The run takes it at once.
- A reply taken once is never taken twice, and a request already answered takes no further reply.
- A request whose function reads no replies is answered with `answer_interaction` alone. A function that reads replies always has a reply rule, since one without is refused when saved.

## How a run ends

| Ending                                         | When                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                    | The request was answered, and the answer is the output                                                                                                                                                                                                           |
| `succeeded`                                    | A notification was delivered, with the output `{}`                                                                                                                                                                                                               |
| `succeeded`                                    | A function with `call`: the tool returned a result and the part `read` points at matched `output.schema`; that part is the output                                                                                                                                |
| `invalid_input`                                | The input does not match the input schema, a card cannot be made from it, a template names a value the input lacks, or a filter refuses a value it reads, as `money` refuses text that is not a decimal number: `The message cannot be rendered with this input` |
| `conflict`, kind `unworkable`                  | `to` or `from` rendered empty, as something that is not text, with a control character, or longer than 256 bytes                                                                                                                                                 |
| `conflict`, kind `unworkable`                  | The message, or the plain text of a card, is longer than 8 KiB, the blocks of a card pass 32 KiB, or the arguments of `deliver` pass 256 KiB or one renders no text                                                                                              |
| `conflict`, kind `unworkable`                  | A function with `call`: an argument renders a structure among text, or the arguments pass 256 KiB                                                                                                                                                                |
| `conflict`, kind `unworkable`                  | A function with `call`: the tool refused the arguments                                                                                                                                                                                                           |
| `conflict`, kind `unworkable`                  | A function with `call`: the answer has nothing to read, or nothing where `read` points                                                                                                                                                                           |
| `conflict`, kind `unworkable`                  | A function with `call`: the part at `read` is more than a run may record (1 MiB with its record), or holds a value `output.schema` refuses                                                                                                                       |
| `unavailable`, kind `tool_not_offered`         | A server the function names does not serve the playbook, or its operator does not allow a tool the function names. For a function with `call`, also a tool the server does not list. Nothing was sent                                                            |
| `unavailable`, kind `tool_server_failed`       | A function with `call`: the tool server could not be reached, or refused the connection or the listing of its tools. Nothing was sent                                                                                                                            |
| `unavailable`, kind `tools_unfinished`         | A function with `call`: the call was sent and then failed, and the tool is marked `reads`. Trying again under a new run id is safe                                                                                                                               |
| `conflict`, kind `effect_unknown`              | The same, for a tool not marked `reads`, which may have changed something. No retry on status 503 matches it; a person, or a workflow rule that names the kind, decides                                                                                          |
| `unavailable`, kind `requests_full`            | The playbook already has as many open requests as the runtime allows: 10,000 unless its operator sets another number with `INTERACTION_OPEN_REQUESTS`                                                                                                            |
| `rejected` as `unanswered`, kind `expired`     | Nobody answered the request before it expired                                                                                                                                                                                                                    |
| `rejected` as `unanswered`, kind `undelivered` | Every attempt to deliver a notification failed                                                                                                                                                                                                                   |
| `rejected` as `cancelled`                      | `cancel_run` cancelled the run, or the workflow that waited for it ran out of time or ended first                                                                                                                                                                |
| `failed`                                       | The runtime itself broke down                                                                                                                                                                                                                                    |

More rules:

- A failed call has a `because`. It is `server_failed` when the server failed on the call or did not respond within 30 seconds. It is `tool_error` when the tool returned an error. Both `tools_unfinished` and `effect_unknown` carry it.
- After a call of a tool that may change something, an answer the run cannot use still ends `unworkable`. Its detail says that running again calls the tool again.
- A request that has ended is final for its run id. Answering it is `conflict`, and running the function again starts a new request under a new id.

### The run's history

The run's history shows, in order:

1. `interaction_requested`: the delivery, the party, the size of the message, whether it takes an answer, and the expiry.
2. Each delivery attempt as `delivery_started`, with the tool and the size and digest of its arguments, and then how it ended:
   - `delivery_succeeded`, with the size and digest of what the tool returned. Where the delivery writes `sent`, it also shows what the message was delivered as and where its replies are read.
   - `delivery_failed`, with `because` (`tool_error`, `arguments_refused`, `server_failure`, `timed_out`, `too_large` for an answer larger than one call may take, `tool_not_offered` or `lost`), its words, and the wait a server asked for as `retry_after_ms`.
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

| Bound                                             | Value                                                                                                                      | When it is reached                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The rendered party, and the answerer              | 256 bytes, no control character                                                                                            | `conflict`, `unworkable`                                                         |
| The rendered message, or the plain text of a card | 8 KiB                                                                                                                      | `conflict`, `unworkable`                                                         |
| The blocks of a card, as JSON                     | 32 KiB (32,768 bytes)                                                                                                      | `conflict`, `unworkable`                                                         |
| The arguments of a call                           | 256 KiB as JSON                                                                                                            | `conflict`, `unworkable` at the start; a read or telling is not sent             |
| The arguments of a call that reads no `input`     | 256 KiB as JSON                                                                                                            | Refused when saved                                                               |
| A call of the tool                                | 10 seconds to open, 30 seconds to respond                                                                                  | A failed attempt or read                                                         |
| A function's call of its tool                     | 10 seconds to open, 10 to list the tools, 30 to respond                                                                    | `tool_server_failed` before sending; then `tools_unfinished` or `effect_unknown` |
| What a function's `read` takes                    | 1 MiB as JSON with the run's record, 512 levels                                                                            | `conflict`, `unworkable`                                                         |
| Calls in one run of a function with `call`        | 1, within 70 seconds                                                                                                       | Not applicable                                                                   |
| What `sent` reads, and the conversation key       | 256 bytes of text each, no control character                                                                               | Delivered without what it was delivered as; the request takes no reply           |
| A read's result                                   | 64 KiB                                                                                                                     | A failed read; the reading goes on                                               |
| A reply's words                                   | 8 KiB                                                                                                                      | The reply is refused                                                             |
| A reply rule                                      | 16 values, 16 words a value, 64 bytes a word                                                                               | Refused when saved                                                               |
| Refused replies of a request                      | 10 recorded, 3 told                                                                                                        | Further ones leave no trace, or are recorded and nobody is told                  |
| Reads of a conversation                           | 5 seconds after a request joins, then 10, 20 and 40 seconds, then every minute through the 18th read, then every 5 minutes | Not applicable                                                                   |
| `expires`                                         | 1 minute to 30 days                                                                                                        | Refused when saved                                                               |
| An answer                                         | 64 KiB as JSON, 512 levels                                                                                                 | `invalid_input`                                                                  |
| `claimed_for`                                     | 256 bytes                                                                                                                  | `invalid_input`                                                                  |
| Attempts                                          | 5: at once, then after 1, 2, 4 and 8 minutes                                                                               | A question stays open; a notification ends `unanswered` as `undelivered`         |
| Open requests of a playbook                       | 10,000 unless the operator sets another number                                                                             | `unavailable`, `requests_full`                                                   |

A tool server may take less than a call may send: Auto Browser, the browser of Auto Cloud, refuses a call of more than 64 KiB with HTTP 413, which the run reads as `The tool server answered HTTP 413: the request was larger than the server takes`.

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

`create_definition` and `update_definition` take an `overview` beside the document: Markdown for the person who runs the business, written from everything known of them and of the playbook. It says why the function exists, what it does and how it fits, in one to three short paragraphs; less technical, more value. Write it after the document, and write it again with every update.

They also take a `diagram`, every time, so that whether the function is drawn is a choice its author makes: Mermaid source of a flowchart or a state diagram of how the function works, whose first line is `flowchart`, `graph` or `stateDiagram`, or the word `none` when a picture would add nothing. A save without it is refused. A diagram holds at most 8,192 bytes in UTF-8, and Auto Studio draws it under the overview. It is read there at full size in a column, so draw it top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code.

An overview holds 1 character to 16,384 bytes in UTF-8. The version keeps it as written, and `get_definition` returns it so until an update gives another; an update that leaves it out keeps the overview saved. `list_definitions` leaves it out. [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.

## Its page

An interaction function's page is the `page` key of its front matter, written with the document and saved with it. It shows the person what was decided:

- `result`: the decision, who made it and when, such as `Approved by the campaign owner on 2026-11-01: Ready to launch.` The answer is `output`, and the moment it came `run.ended`. `result` reads neither the input nor `to`, so name who answers in words. Nor can it say what was decided on, such as which brief was approved: the answer holds only what the person answered, so the page of the workflow that asks says it, from the workflow's output. While the request waits, `result` says whom it waits for.
- `runs`: the decisions over time, what waits now, and how long people took to answer. A request's run starts with `run_started` and ends with `run_succeeded`, the answer, `run_rejected` when it ends without one, as when nobody answered, or `run_failed`, each naming the run in `source`. So a fold counts each day's answers by their verdict, the requests still open, and the hours between asking and answering.

A fold pairs a request's start with its end by `source`. Another page for `approve-campaign-brief`, in place of the one in [its document](#a-function-document), keeps the requests still open in a view of its own, `open`, which holds each run's `source` and when it asked. `runs` never draws that view, so the run ids in it never reach the page; it draws the hours each answer took:

<!-- prettier-ignore -->
````yaml
page:
  data:
    language: typescript
    source:
      events:
        - type: run_started
          subject: interaction/approve-campaign-brief
        - type: run_succeeded
          subject: interaction/approve-campaign-brief
        - type: run_rejected
          subject: interaction/approve-campaign-brief
        - type: run_failed
          subject: interaction/approve-campaign-brief
    views:
      open: table
      hours: series
    module: |
      export function fold(view: View, event: Event): View {
        const columns = [{ name: 'Request' }, { name: 'Asked' }];
        const asked = view.open?.rows ?? [];
        if (event.type === 'run_started') {
          return { ...view, open: { columns, rows: [...asked, [event.source, event.time ?? null]].slice(-500) } };
        }
        const start = asked.find(([source]) => source === event.source)?.[1];
        const open = { columns, rows: asked.filter(([source]) => source !== event.source) };
        const points = view.hours?.lines[0]?.points ?? [];
        const last = points.at(-1)?.at;
        const time = event.time;
        if (event.type !== 'run_succeeded' || typeof start !== 'string' || time === undefined) return { ...view, open };
        if (last !== undefined && last >= time) return { ...view, open };
        const hours = Math.round((Date.parse(time) - Date.parse(start)) / 360_000) / 10;
        const line = { name: 'Hours to answer', points: [...points, { at: time, value: hours }].slice(-200) };
        return { ...view, open, hours: { unit: 'hours', lines: [line] } };
      }
  runs: |
    {% if views.open %}Briefs waiting for their owner's answer: {{ views.open.rows | size }}.{% endif %}

    ```chart line
    {{ views.hours | json }}
    ```
````

Show numbers over time as a chart keyed by the period a run is about, and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id.

A notification takes no answer, so its page counts what was sent. [Page format](page-format.md) says how to write `data`, `result` and `runs`.

## Availability

Interaction functions are available in every runtime. A request reaches a person through the tools of the tool servers the operator configures and of the org's connections, or is held for an agent. See [Functions and availability](../concepts/functions.md#availability).

</div>
