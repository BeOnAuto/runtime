<div v-pre>

# Lookup function format

A lookup function is a definition of the type `lookup`. It obtains information that already exists, in one of two ways:

- through one tool that only reads, such as the replies of a thread, a contact's record or this week's figures from a reporting tool. A run makes one call of that tool and returns the part of its result that `read` points at, at once.
- from the playbook's own runs, such as the paces a computation function computed this month. A run returns the outputs of the runs of one definition that succeeded, newest first, at once; see [Reading the playbook's own runs](#reading-the-playbook-s-own-runs).

A lookup function never acts: it calls only a tool marked `reads`, or reads the playbook's runs, and asks no model. A reasoning function interprets what a lookup function fetches, and an interaction function calls a tool that may change something. A function document that asks for something else is refused when it is saved.

## A function document

The source is Markdown with YAML front matter and no body. This example, `thread-replies`, reads the replies of a thread in the team chat, oldest first. Its page shows the replies of each run as a table:

<!-- prettier-ignore -->
````markdown
---
description: Reads the replies of a thread in the team chat, oldest first
call:
  server: chat
  tool: thread_replies
  with:
    channel: '{{ input.channel }}'
    ts: '{{ input.thread }}'
    limit: 100
  read: /messages
input:
  schema:
    type: object
    required: [channel, thread]
    properties:
      channel: { type: string }
      thread: { type: string }
output:
  schema:
    type: array
    items:
      type: object
      required: [user, text, ts]
      properties:
        user: { type: string }
        text: { type: string }
        ts: { type: string }
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: lookup/thread-replies
    views:
      latest: table
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const replies = fieldOf(event.data, 'output');
        if (!Array.isArray(replies)) return view;
        const rows = replies
          .slice(-20)
          .toReversed()
          .map((reply) => [String(fieldOf(reply, 'user') ?? ''), String(fieldOf(reply, 'text') ?? '').slice(0, 500)]);
        return { latest: { columns: [{ name: 'Who' }, { name: 'Reply' }], rows } };
      }
  result: |
    {% assign found = output | size %}
    {{ found }} {% if found == 1 %}reply{% else %}replies{% endif %} in the thread.

    | Who | Reply |
    | --- | --- |
    {% for reply in output -%}
    | {{ reply.user }} | {{ reply.text | normalize_whitespace | replace: "|", "\\|" | clip: 120 }} |
    {% endfor %}
  runs: |
    The replies the latest run found, newest first.

    ```chart table
    {{ views.latest | json }}
    ```
---
````

To save it, call `create_definition` with `type: "lookup"`, the `name` `thread-replies`, the document as `source`, and its `overview` and `diagram`, as for every function. A save without a `diagram` is refused, so give the word `none` when a picture would add nothing; [the overview of a computation function](computation-format.md#the-overview) gives the rules, which a lookup function follows. To run it, call `run_definition` with the same type and name, and with `channel` and `thread` in the `input` object. Both operations also take the playbook id, unless the MCP connection is scoped to that playbook. The run returns `status: succeeded` with the replies as its `output`.

## Writing a lookup

Write the call from what the tool returns, not from memory:

1. Call `search` with `only: read` to see the tools this playbook may use that only read, each with its mark. Call `introspect` for the `input_schema` a tool takes.
2. Call the tool with `query_connection`, with the arguments its `input_schema` takes, and read its `answer`. `query_connection` calls only a tool marked `reads` and refuses any other. The answer is the document `read` points into: the tool's structured content, else its first text block parsed as JSON, else that text.
3. Write `call`:
   - `server` and `tool`, as `search` names them;
   - `with`, the arguments;
   - `read`, a JSON Pointer to the part of the answer the function returns, such as `/messages`. Leave `read` out to return the whole answer.

   Then write `output.schema`: the shape that part has in the answer `query_connection` gave. Name only the fields the function's readers need, list in `required` only the fields every answer holds, and allow `null` wherever the tool may answer `null`, as `{ type: [string, "null"] }`: one answer does not show every case. `query_connection` cuts a long answer's `text` at 64 KiB and leaves out an `answer` larger than that, so ask for fewer rows to see one whole.

4. Show the person the whole document. Once they agree, save it with `create_definition`, `type` lookup. `run_definition` runs it and returns its output at once.

The arguments in `with` are the tool's own, named as its `input_schema` names them, and may nest:

- A number, `true`, `false`, `null`, or a list or an object of them, is sent as written.
- A text is a Liquid template that reads `input`, `today` and `now`, and is sent as the text it renders.
- A text that is one `{{ }}` and nothing else sends the value it reads, as that value is. So `'{{ input.limit }}'` sends a number when the input's `limit` is a number.

A template may use the filters listed in [Templates](template.md#filters), the `templates` guide. `read` names a place in the answer and nothing more. To reshape what a lookup returns, use the workflow's `output.as`, a reasoning function, or a computation function.

## Fields

| Field           | Purpose                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                                                         |
| `call`          | One of `call` and `runs`. The tool the function reads through: `server`, `tool`, `with` and `read`, the same keys an interaction function's [`call`](interaction-format.md#call) takes              |
| `runs`          | One of `call` and `runs`. The definition whose runs the function reads: `type`, `name`, and optionally `words` and `since`; see [Reading the playbook's own runs](#reading-the-playbook-s-own-runs) |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                                                   |
| `output.schema` | Required with `call`, and refused with `runs`. The JSON Schema of the part of the answer the run returns, which it must match                                                                       |
| `page`          | Optional [page](page-format.md) that presents its runs                                                                                                                                              |

A document with both `call` and `runs`, or with neither, is rejected. `to`, `expires`, `deliver`, `replies`, `model`, `tools`, `language`, `input.default` and every other field are rejected with their line, and so is a body after the front matter. The saved function has the `media_type` `text/markdown`.

Quote a text that holds ` #`, or a comma inside `{ }`, such as `description: 'Posts the notes in #deliveries'` or `{ note: 'Costs 1,000 a month' }`. Unquoted, YAML reads ` #` as the start of a comment and a comma there, even the one in `1,000`, as the start of another key, so the text ends early, and the save does not always say so.

Every template of `call.with` is checked when the document is saved, as an interaction function's call is: it is rejected with its line when it does not compile, names another value than `input`, `today` and `now`, or names a property the input schema does not allow. A template that reads no `input` is also rejected when it renders a structure inside a longer text. One that reads `input` is checked when the run renders it: a structure it renders inside a longer text ends the run as a `conflict` of the kind `unworkable`, as [How a run ends](#how-a-run-ends) says. `call.read` is a JSON Pointer such as `/messages`: it starts with a slash, writes `~` as `~0`, and writes a slash within a name as `~1`.

## Reading the playbook's own runs

A lookup function can read what the playbook's own functions found, in place of calling a tool: the outputs of the runs of one definition of the playbook that succeeded. Its document has `runs` in place of `call`, and no `output.schema`, since what it answers has a shape of its own. To keep something for later, run a function whose output is that thing; a lookup function reads it back from its runs.

This example, `pace-history`, reads the paces that the computation function `campaign-pace` of [Computation function format](computation-format.md#a-function-document) computed for one campaign since a day:

<!-- prettier-ignore -->
````markdown
---
description: Reads the paces computed for one campaign since a day, newest first
runs:
  type: computation
  name: campaign-pace
  words: '{{ input.campaign }}'
  since: '{{ input.since }}'
input:
  schema:
    type: object
    required: [campaign, since]
    properties:
      campaign: { type: string }
      since: { type: string }
---
````

`campaign-pace` ran on October 7 with the input of its own example, and on October 14 with the rows of `spring-sale` alone. Given this input on October 15:

```json
{ "campaign": "summer-launch", "since": "2026-10-01" }
```

the run succeeds with this output, the one run whose output names `summer-launch`:

```json
{
  "runs": [
    {
      "run_id": "019a0d2c-6a00-7c1a-9b3f-2f1e0d9c8b7a",
      "definition_version": 1,
      "started_at": "2026-10-07T09:00:00.000Z",
      "finished_at": "2026-10-07T09:00:00.000Z",
      "output": {
        "campaigns": [
          {
            "campaign": "spring-sale",
            "spend_cents": 223050,
            "budget_cents": 800000,
            "projected_cents": 576212,
            "pace_permille": 720
          },
          {
            "campaign": "summer-launch",
            "spend_cents": 40000,
            "budget_cents": 300000,
            "projected_cents": 103333,
            "pace_permille": 344
          }
        ],
        "total_spend_cents": 263050
      }
    }
  ],
  "more": false
}
```

Its record says how far it read, here `{ "examined": 2, "through": "2026-10-07T09:00:00.000Z" }`: `examined` counts the runs of the definition that succeeded it walked, answered or not, and `through` is the start of the oldest run of the playbook it reached, of any definition, or of the run where it stopped, `null` when it reached none.

`runs` takes these keys:

| Key     | Value                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`  | Required. The type of the definition whose runs it reads: a function type, such as `computation`, or `workflow`                                                                      |
| `name`  | Required. Its name, 3 to 48 lowercase letters, digits and hyphens, starting with a letter                                                                                            |
| `words` | Optional. The words every output it answers holds, at most 1,000 characters                                                                                                          |
| `since` | Optional. The earliest start of a run it answers: a day, such as `2026-10-01`, from the start of that day in UTC, or a date and time with its offset, such as `2026-10-01T09:00:00Z` |

`words` and `since` are Liquid templates that read `input`, `today` and `now`, as the arguments of `call` are. Each is checked against its bound when it is saved, where it is written as it is, and when the run renders it otherwise. A definition that does not exist yet may be named: the function is saved, and its runs answer no runs until that definition has runs of its own.

A run reads the runs of the definition newest started first, from its own start back, in the order the ledger recorded them, so a run started after it began is not read, whatever time its start was stamped with:

- It answers only runs that succeeded. A run that was rejected, failed, cancelled or is still going is passed over, since it has no output.
- It answers a run only where its output, written as JSON, holds every word of `words`. Words are compared after Unicode compatibility normalization and full case folding, so `STRASSE` finds `Straße`; a word found inside a longer one counts.
- It stops at the first run that started before `since`. The ledger looks at no run recorded before `since`, so a read reaches `since` however many runs of other definitions came before it.
- Each answered run gives its `run_id`, the `definition_version` it ran, its `started_at` and `finished_at`, and its `output`. Where an output does not fit in what is left of the answer, the run gives the output's size in bytes as `bytes` in place of `output`, and the read stops there.
- `more` is `true` when older runs are left unread: an output did not fit, or the read reached its bound. Ask again with a later `since`, or other `words`, to read fewer.

A run reads at most 10 pages of the playbook's runs, newest first. A page looks at up to 1,000 runs of the playbook and answers up to 100 of the definition's, so a run looks at no more than 10,000 runs of the playbook and answers no more than 1,000. A definition whose runs are rare among many others may answer fewer, or none, with `more` set, and `through` then says how far back it looked.

## The mark of its tool

Every tool carries a mark, `reads`, `acts` or `unmarked`, which `search`, `introspect` and `dry_run` show. A tool's server gives it, or the HTTP method of an operation, or the providers catalogue, or the `marks` of a tool server's entry in the runtime's settings. A tool that carries no mark counts as one that acts.

When a lookup function is saved, the runtime asks the server it names for its tools:

- A tool marked `reads` is saved. A tool its server lists more than once is saved only when every entry of that name is marked `reads`.
- A tool marked `acts`, or carrying no mark, is refused as `invalid_input` at the line of `call`. The refusal says to use an interaction function, or to ask the server's author to mark the tool read-only. For a server whose entry names a provider, it adds that the providers catalogue may mark it; for a tool server of the runtime's settings, that whoever runs the server may mark it in the `marks` of its entry in `tool_servers`.
- A server that does not serve the playbook, or a tool it does not offer, is refused the same way, with words that point to `search`.
- A server that cannot be asked for its tools just now leaves the function unsaved, `unavailable`, in words that name the server. Save it again once the server answers.

When a lookup function runs, the runtime reads the mark again, as it lists the server's tools for the call, before anything is sent. A tool whose server marks it `acts`, or no longer marks it, since the function was saved ends the run `unavailable` with the kind `tool_not_read_only`. Nothing was sent, and the run's history holds no call. Once the tool is marked `reads` again, it can run again; a tool that now acts belongs to an interaction function.

## How a run ends

| Ending                                   | When                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `succeeded`                              | The tool returned a result and the part `read` points at matched `output.schema`; that part is the output. For `runs`, the runs it read, which may be none                                                                                             |
| `invalid_input`                          | The input does not match the input schema, a template names a value the input lacks, or a filter refuses a value it reads                                                                                                                              |
| `conflict`, kind `unworkable`            | An argument renders a structure among text, or the arguments pass 16 KiB                                                                                                                                                                               |
| `conflict`, kind `unworkable`            | `runs.words` renders more than 1,000 characters, `runs.since` renders neither a day nor a date and time, or either renders a structure                                                                                                                 |
| `conflict`, kind `unworkable`            | The tool refused the arguments, the answer has nothing to read or nothing where `read` points, the part at `read` is more than a run may record, or `output.schema` refuses it                                                                         |
| `unavailable`, kind `tool_not_read_only` | The tool is no longer marked `reads`. Nothing was sent                                                                                                                                                                                                 |
| `unavailable`, kind `tool_not_offered`   | The server no longer serves the playbook, its operator no longer allows the tool, the server no longer lists it, or the connection that serves it is not ready, with a `because` such as `connection_pending` or `connection_broken`. Nothing was sent |
| `unavailable`, kind `tool_server_failed` | The tool server could not be reached, or refused the connection or the listing of its tools. Nothing was sent                                                                                                                                          |
| `unavailable`, kind `tools_unfinished`   | The call was sent and then failed: the server failed on it or did not respond within 30 seconds, `because` `server_failed`, or the tool returned an error, `because` `tool_error`                                                                      |
| `failed`                                 | The runtime itself broke down                                                                                                                                                                                                                          |

Every call of a lookup function reads, and so does a read of runs, so a run that could not finish changed nothing, and trying again under a new run id is safe. A run that called its tool and did not succeed is never run again under its run id: a request with that id returns `conflict` with the kind `tools_called` and the because `only_read`. [Retrying under a run id](http.md#retrying-under-a-run-id) gives every case.

A run takes place within the call that started it. It cannot be cancelled, and it goes on to its end when its caller goes away.

### The run's history

The run's history shows its start, its call as `tool_call_started` and `tool_call_answered`, or `tool_call_failed` when the tool never returned a result, and its end. The call's start says it only reads. A run that reads runs calls no tool, so its history shows its start and its end, with `{ examined, through }` as its record.

The playbook keeps the arguments and the tool's whole result, scrubbed of secrets, unless the operator turns this off for a server with `record_content`. The history shows each where it takes at most 2 KiB, and its size beyond. `get_event` reads one event with both whole. The output is shown in `run_succeeded` where it takes at most 2 KiB, and `get_run` returns it whole.

## Bounds

| Bound                                         | Value                                                   | When it is reached                                              |
| --------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| The arguments of the call                     | 16 KiB as JSON                                          | `conflict`, `unworkable`                                        |
| The arguments of a call that reads no `input` | 16 KiB as JSON                                          | Refused when saved                                              |
| The call of its tool                          | 10 seconds to open, 10 to list the tools, 30 to respond | `tool_server_failed` before sending; then `tools_unfinished`    |
| What `read` takes                             | 1 MiB as JSON with the run's record, 512 levels         | `conflict`, `unworkable`                                        |
| Calls in one run                              | 1, within 70 seconds                                    | Not applicable                                                  |
| `runs.words`                                  | 1,000 characters                                        | Refused when saved; `conflict`, `unworkable` when rendered      |
| The runs one run reads                        | 10 pages: 10,000 runs of the playbook, 1,000 answered   | `more: true`                                                    |
| What a read of runs answers                   | 1 MiB as JSON with the run's record                     | The output that does not fit is given by its size; `more: true` |

A tool that pages returns one page for each run. Point `read` at the part that holds both the items and the cursor, and have the workflow call again with the cursor while there is one.

## In a workflow

A workflow calls a lookup function as it calls any function, with `call: run_definition` and `type: lookup`. The step's output is what the tool returned at `read`, or, for `runs`, the runs it read and `more`. The function's own maximum is 70 seconds, so the step waits at most 70 seconds plus one minute.

Every 503 a lookup function raises, `tool_not_read_only`, `tool_server_failed`, `tool_not_offered` or `tools_unfinished`, changed nothing, so a retry on that status may try it again.

## Its page

A lookup function's page is the `page` key of its front matter, written with the document and saved with it. It shows the person what the lookup found:

- `result`: what was found, as a table, such as the replies of a thread, a row for each with who wrote it and what it said.
- `runs`: the values found over time, where they are numbers, such as the stock of each item each morning. Where the answer holds no numbers, `runs` keeps a table of the latest finds.

Show numbers over time as a chart keyed by the period a run is about, and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id. [Page format](page-format.md) says how to write `data`, `result` and `runs`.

## Availability

Lookup functions are available in every runtime. A lookup reads through the tools of the tool servers the operator configures and of the org's connections, or reads the runs the playbook keeps. See [Functions and availability](../concepts/functions.md#availability).

</div>
