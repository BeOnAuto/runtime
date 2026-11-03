<div v-pre>

# Lookup function format

A lookup function is a definition of the type `lookup`. It obtains information that already exists outside the playbook, such as the replies of a thread, a contact's record or this week's figures from a reporting tool, through one tool that only reads. A run makes one call of that tool and returns the part of its result that `read` points at, at once.

A lookup function never acts: it calls only a tool marked `reads`, and asks no model. A reasoning function interprets what a lookup function fetches, and an interaction function calls a tool that may change something. A function document that asks for something else is refused when it is saved.

## A function document

The source is Markdown with YAML front matter and no body. This example, `thread-replies`, reads the replies of a thread in the team chat, oldest first:

<!-- prettier-ignore -->
```markdown
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
---
```

To save it, call `create_definition` with `type: "lookup"`, the `name` `thread-replies`, and the document as `source`. To run it, call `run_definition` with the same type and name, and with `channel` and `thread` in the `input` object. Both operations also take the playbook id, unless the MCP connection is scoped to that playbook. The run returns `status: succeeded` with the replies as its `output`.

## Writing a lookup

Write the call from what the tool returns, not from memory:

1. Call `search` with `only: read` to see the tools this playbook may use that only read, each with its mark. Call `introspect` for the `input_schema` a tool takes.
2. Call the tool with `execute`, with the arguments its `input_schema` takes, and read its `answer`. A tool marked `reads` changes nothing, so this is safe. The answer is the document `read` points into: the tool's structured content, else its first text block parsed as JSON, else that text.
3. Write `call`:
   - `server` and `tool`, as `search` names them;
   - `with`, the arguments;
   - `read`, a JSON Pointer to the part of the answer the function returns, such as `/messages`. Leave `read` out to return the whole answer.

   Then write `output.schema`: the shape that part has in the answer `execute` gave.

4. Show the person the whole document. Once they agree, save it with `create_definition`, `type` lookup. `run_definition` runs it and returns its output at once.

The arguments in `with` are the tool's own, named as its `input_schema` names them, and may nest:

- A number, `true`, `false`, `null`, or a list or an object of them, is sent as written.
- A text is a Liquid template that reads `input`, `today` and `now`, and is sent as the text it renders.
- A text that is one `{{ }}` and nothing else sends the value it reads, as that value is. So `'{{ input.limit }}'` sends a number when the input's `limit` is a number.

A template may use the filters listed in [Templates](template.md#filters), the `templates` guide. `read` names a place in the answer and nothing more. To reshape what a lookup returns, use the workflow's `output.as`, a reasoning function, or a computation function.

## Fields

| Field           | Purpose                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                            |
| `call`          | Required. The tool the function reads through: `server`, `tool`, `with` and `read`, the same keys an interaction function's [`call`](interaction-format.md#call) takes |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                      |
| `output.schema` | Required. The JSON Schema of the part of the answer the run returns, which it must match                                                                               |
| `page`          | Optional [page](page-format.md) that presents its runs                                                                                                                 |

`to`, `expires`, `deliver`, `replies`, `model`, `tools`, `language` and every other field are rejected with their line, and so is a body after the front matter. The saved function has the `media_type` `text/markdown`.

Every template of `call.with` is checked when the document is saved, as an interaction function's call is: it is rejected with its line when it does not compile, names another value than `input`, `today` and `now`, names a property the input schema does not allow, or renders a structure inside a longer text. `call.read` is a JSON Pointer such as `/messages`: it starts with a slash, writes `~` as `~0`, and writes a slash within a name as `~1`.

## The mark of its tool

Every tool carries a mark, `reads`, `acts` or `unmarked`, which `search`, `introspect` and `dry_run` show. A tool's server gives it, or the HTTP method of an operation, or the providers catalogue, or the `marks` of a tool server's entry in the runtime's settings. A tool that carries no mark counts as one that acts.

When a lookup function is saved, the runtime asks the server it names for its tools:

- A tool marked `reads` is saved. A tool its server lists more than once is saved only when every entry of that name is marked `reads`.
- A tool marked `acts`, or carrying no mark, is refused as `invalid_input` at the line of `call`. The refusal says to use an interaction function, or to ask the server's author to mark the tool read-only. For a server whose entry names a provider, it adds that the providers catalogue may mark it; for a tool server of the runtime's settings, that whoever runs the server may mark it in the `marks` of its entry in `tool_servers`.
- A server that does not serve the playbook, or a tool it does not offer, is refused the same way, with words that point to `search`.
- A server that cannot be asked for its tools just now leaves the function unsaved, `unavailable`, in words that name the server. Save it again once the server answers.

When a lookup function runs, the runtime reads the mark again, as it lists the server's tools for the call, before anything is sent. A tool whose server marks it `acts`, or no longer marks it, since the function was saved ends the run `unavailable` with the kind `tool_not_read_only`. Nothing was sent, and the run's history holds no call. Once the tool is marked `reads` again, it can run again; a tool that now acts belongs to an interaction function.

## How a run ends

| Ending                                   | When                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                              | The tool returned a result and the part `read` points at matched `output.schema`; that part is the output                                                                         |
| `invalid_input`                          | The input does not match the input schema, a template names a value the input lacks, or a filter refuses a value it reads                                                         |
| `conflict`, kind `unworkable`            | An argument renders a structure among text, or the arguments pass 16 KiB                                                                                                          |
| `conflict`, kind `unworkable`            | The tool refused the arguments, the answer has nothing to read or nothing where `read` points, the part at `read` is more than a run may record, or `output.schema` refuses it    |
| `unavailable`, kind `tool_not_read_only` | The tool is no longer marked `reads`. Nothing was sent                                                                                                                            |
| `unavailable`, kind `tool_not_offered`   | The server no longer serves the playbook, its operator no longer allows the tool, or the server no longer lists it. Nothing was sent                                              |
| `unavailable`, kind `tool_server_failed` | The tool server could not be reached, or refused the connection or the listing of its tools. Nothing was sent                                                                     |
| `unavailable`, kind `tools_unfinished`   | The call was sent and then failed: the server failed on it or did not respond within 30 seconds, `because` `server_failed`, or the tool returned an error, `because` `tool_error` |
| `failed`                                 | The runtime itself broke down                                                                                                                                                     |

Every call of a lookup function reads, so a run that could not finish changed nothing, and trying again under a new run id is safe. A run that called its tool and did not succeed is never run again under its run id: a request with that id returns `conflict` with the kind `tools_called` and the because `only_read`. [Retrying under a run id](http.md#retrying-under-a-run-id) gives every case.

A run takes place within the call that started it. It cannot be cancelled, and it goes on to its end when its caller goes away.

### The run's history

The run's history shows its start, its call as `tool_call_started` and `tool_call_answered`, or `tool_call_failed` when the tool never returned a result, and its end. The call's start says it only reads.

The playbook keeps the arguments and the tool's whole result, scrubbed of secrets, unless the operator turns this off for a server with `record_content`. The history shows each where it takes at most 2 KiB, and its size beyond. `get_event` reads one event with both whole. The output is shown in `run_succeeded` where it takes at most 2 KiB, and `get_run` returns it whole.

## Bounds

| Bound                                         | Value                                                   | When it is reached                                           |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| The arguments of the call                     | 16 KiB as JSON                                          | `conflict`, `unworkable`                                     |
| The arguments of a call that reads no `input` | 16 KiB as JSON                                          | Refused when saved                                           |
| The call of its tool                          | 10 seconds to open, 10 to list the tools, 30 to respond | `tool_server_failed` before sending; then `tools_unfinished` |
| What `read` takes                             | 1 MiB as JSON with the run's record, 512 levels         | `conflict`, `unworkable`                                     |
| Calls in one run                              | 1, within 70 seconds                                    | Not applicable                                               |

A tool that pages returns one page for each run. Point `read` at the part that holds both the items and the cursor, and have the workflow call again with the cursor while there is one.

## In a workflow

A workflow calls a lookup function as it calls any function, with `call: run_definition` and `type: lookup`. The step's output is what the tool returned at `read`. The function's own maximum is 70 seconds, so the step waits at most 70 seconds plus one minute.

Every 503 a lookup function raises, `tool_not_read_only`, `tool_server_failed`, `tool_not_offered` or `tools_unfinished`, changed nothing, so a retry on that status may try it again.

## Availability

Lookup functions are available in every runtime. A lookup reads through the tools of the tool servers the operator configures and of the org's connections. See [Functions and availability](../concepts/functions.md#availability).

</div>
