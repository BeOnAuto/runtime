<div v-pre>

# Reasoning function format

A reasoning function is a definition of the type `reasoning`. Its document names a model, the input and output contracts, the settings and a prompt template. A run renders the prompt from its input, calls the model and records the model's answer. [Build your first playbook](../tutorials/first-playbook.md) walks through one with an agent.

## A function document

The source is Markdown: YAML front matter, then a Liquid prompt template. This example reviews a campaign brief. Replace the model reference with a concrete id from [`list_models`](mcp.md#model-information), or with one your workspace administrator confirms.

```markdown
---
description: Reviews a campaign brief against the team's criteria
model: anthropic/claude-sonnet-4-5
config:
  max_output_tokens: 800
input:
  schema:
    type: object
    properties:
      brief: { type: string }
      criteria: { type: string }
    required: [brief, criteria]
---

{% system %}Review the brief using the supplied criteria. Identify missing evidence. Do not invent facts.{% endsystem %}
Brief: {{ input.brief }}
Criteria: {{ input.criteria }}
```

To save it, call `create_definition` with `type: "reasoning"`, a function `name` and the document as `source`. To run it, call `run_definition` with the same type and name, and with `brief` and `criteria` in the `input` object. Both operations also need the playbook id, unless the MCP connection is scoped to that playbook.

A function document contains instructions, never model credentials. Each change to the document creates a version. A run uses the latest active version and records it as `definition_version`; a run cannot select an older version.

## Fields

| Field                      | Required    | Value                                                                                                                                                                           |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`              | No          | Text of 1 to 1,000 characters. `list_definitions` and `get_definition` show it                                                                                                  |
| `model`                    | Yes         | A model reference in `provider/model` form, such as `anthropic/claude-sonnet-4-5`                                                                                               |
| `config.max_output_tokens` | No          | A whole number from 1 to 64,000; 1,024 when left out. The most tokens the answer may use                                                                                        |
| `config.temperature`       | No          | A finite number: the sampling temperature. Each provider accepts its own range                                                                                                  |
| `config.top_p`             | No          | A finite number: nucleus sampling                                                                                                                                               |
| `config.seed`              | No          | A whole number of 0 or more, for providers that accept a seed                                                                                                                   |
| `config.stop_sequences`    | No          | A list of strings. The answer stops where the model writes one                                                                                                                  |
| `config.reasoning`         | No          | The reasoning effort, for models that reason: `none`, `minimal`, `low`, `medium`, `high` or `xhigh`                                                                             |
| `input.schema`             | No          | A JSON Schema whose root is `"type": "object"`. Without it, any JSON object is accepted                                                                                         |
| `input.default`            | No          | Defaults for top-level input fields, as a JSON object. The supplied input's fields override them before validation                                                              |
| `output.format`            | No          | `text`, the default, or `json`                                                                                                                                                  |
| `output.schema`            | With `json` | A JSON Schema the answer must match; see [Answers that are JSON](#answers-that-are-json). Not allowed with `text`                                                               |
| `output.shape`             | No          | The name of an [output shape](output-shapes.md), `series`, `categories`, `table` or `text`: the answer is JSON of that shape. Not allowed beside `output.schema` or with `text` |
| `provider_options`         | No          | Options for one provider, under its namespace; see [Provider options](#provider-options)                                                                                        |
| `tools`                    | No          | The tools a run may call, each `server/tool` or `server/*`; see [Tools](#tools)                                                                                                 |

Any other key, at any level, is rejected.

### How a document is checked

`create_definition` and `update_definition` check the whole document, and every run checks it again. A document with problems is rejected with every problem listed under `/source`:

- Each problem names its line and, where there is one, a JSON pointer into the front matter, such as `Line 4, /config/temperature: Expected number`.
- A problem found twice is reported once. A rejection lists at most 20 problems in line order, then one line that counts the rest, such as `Line 23: 5881 more issues are not shown`.
- The front matter is YAML 1.2 with the core schema, so `yes` and `2026-10-01` stay strings. Anchors, aliases and tags are rejected. A key may appear only once in a mapping, and numbers must be finite. Nesting is limited to 72 levels.
- `input.default` must match the input schema for the fields it names. Required fields may be left for the input to supply.
- A setting in `config` is checked only against the type and range in the table above. Whether the provider accepts the value becomes clear when a run calls it.
- Saving calls no model. Whether the provider is configured, and whether it offers the model, becomes clear only when the function runs; see [How a run ends](#how-a-run-ends).

## How a run works

A run takes these steps:

1. It applies `input.default`: each top-level field the supplied input leaves out takes its default. It checks the result against `input.schema`. The input may be at most 256 KiB as JSON and 512 levels deep. A run without input gets `{}`.
2. It renders the [template](#the-template). The system block becomes the system instructions, and everything else becomes one user message.
3. It calls the model, one call at a time, and records each [model call](#the-run-s-model-calls) in the run's history. A function with `tools` lets the model call them before it answers; see [Tools](#tools).
4. It checks a JSON answer against `output.schema`, or against the shape `output.shape` names.
5. It records the output and a [record](#what-a-run-records) of the call.

An external agent can pass evidence it collected through its own connections as input. The function itself cannot reach that agent's tools.

Supply a `run_id` to read a run later or to retry it. The same id and input return a recorded success or `invalid_input` without calling the model again. After `unavailable`, `conflict` or a failure, they run the definition again. A run that called tools is the exception; see [When a tool-calling run cannot finish](#when-a-tool-calling-run-cannot-finish). A run that is still `started` is not started a second time: it goes on from what it recorded; see [A run performed again](#a-run-performed-again). [Retrying under a run id](http.md#retrying-under-a-run-id) gives every case. The [HTTP reference](http.md) gives the other rules of the run operations.

## The template

The template is [Liquid](https://shopify.github.io/liquid/). It reads three variables and nothing else:

| Variable | Value                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| `input`  | The run's input, a JSON object, after `input.default` is applied and the result checked |
| `today`  | The date when the run starts, `YYYY-MM-DD`, in UTC                                      |
| `now`    | The time when the run starts, in ISO 8601, in UTC                                       |

Rules for reading values:

- The template may also read names it creates itself with `assign`, `for`, `increment` or `cycle`. Any other name is rejected when the document is saved.
- When the input schema lists its `properties` and sets `additionalProperties: false`, `input.<field>` must be one of them.
- A field the input does not have stops the run with `invalid_input`, naming the field and the line.
- Two places may read a missing field without stopping the run: a condition of `if`, `elsif` or `unless`, and the `default` filter. So a template can test a field that may be absent: `{% if input.vip %}…{% endif %}`, `{{ input.nickname | default: "friend" }}`.
- Only the input's own fields can be read: `input.constructor` is a missing field.
- A list renders as its items with no separators, and an object renders as `[object Object]`. Use `{{ input.account | json }}` to render JSON.

### The system block

```liquid
{% system %}You review expenses against the policy of {{ input.company }}.{% endsystem %}
Review this expense: {{ input.expense | json }}
```

- The text between `{% system %}` and `{% endsystem %}` is sent as the system instructions. Everything outside it is the message, sent as one user message.
- A template has at most one system block. The block must sit at the top level, outside every other tag, and its tags take no arguments.
- The template must render some text outside the block.
- An input that contains `{% system %}` or `{% endsystem %}` renders as those literal characters. It never opens or closes the instructions.
- The template renders in document order, so a value assigned in the block is available after it.

### Tags

Available: `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment`, `#` and `tablerow`.

Not available: `include`, `render`, `layout` and `block`, since a function is a single document. `capture` is not available either; use `assign` with `append` instead.

### Filters

A template may use the filters listed in [Templates](template.md#filters), the `templates` guide, the same in every template.

### Limits

| Limit                                       | Value                         | When it is reached              |
| ------------------------------------------- | ----------------------------- | ------------------------------- |
| Length of the template                      | 65,536 characters             | Refused when saved              |
| Names in tags and outputs                   | 1,000                         | Refused when saved              |
| Time to render                              | 200 ms                        | The run ends as `invalid_input` |
| Memory that filters and ranges may charge   | 5,000,000 characters or items | The run ends as `invalid_input` |
| Rendered instructions, and rendered message | 200,000 characters each       | The run ends as `invalid_input` |

Names are counted in the text inside `{{ }}` and `{% %}`: every variable, property, filter and keyword. A template that nests tags or parentheses more deeply than the engine can parse (about 2,000 levels of tags) is refused when saved. A render limit ends the run as `invalid_input` because the input is what makes the render grow.

## Answers that are JSON

With `output.format: json`, the answer must match `output.schema`. With `output.shape`, it must match the shape's schema and the rules the shape adds, such as the order of a series' points; [Output shapes](output-shapes.md) gives them, and the shape's schema is sent to the provider as `output.schema` would be. The runtime validates the answer against the schema as written, whatever the provider enforced. A schema is a JSON Schema document in draft 2020-12. It is read as draft-07 when `$schema` says so, or when the document uses `definitions` without `$defs`.

These rules apply to `output.schema` and `input.schema` alike, and a schema that breaks one is refused when saved:

- At most 65,536 bytes as JSON, at most 64 nested levels of objects and lists, and at most 1,000 values in one `enum`.
- No `pattern` or `patternProperties`, because a hostile regular expression can stall validation.
- A `format` is one of `date`, `date-time`, `time`, `email`, `uri` and `uuid`, which the runtime checks: `date`, `date-time` and `time` as RFC 3339 writes a full date, a date and time and a full time, such as `2026-04-01`, `2026-04-01T09:30:00Z` and `09:30:00Z`; `email` as the HTML standard defines a valid email address, such as `name@example.com`; `uri` as an absolute URI with a scheme, ASCII in the characters RFC 3986 allows, with no white space and each `%` followed by two hexadecimal digits, such as `https://example.com`; and `uuid` in the form of RFC 4122, such as `0f8fad5b-d9cb-469f-a165-70867728950e`. An input with a string out of its format is refused as `invalid_input` at its field, with the form and its example, such as `day: expected a date such as 2026-04-01`, and an answer with one fails as `output_invalid`, such as `/day: Expected a string in the format date, such as 2026-04-01`. A format checks strings alone, so beside another type it takes every value of that type. Any other format is refused, since the runtime would not check it.
- No `if`, `then`, `else`, `contains`, `minContains`, `maxContains`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedItems`, `unevaluatedProperties` or `additionalItems`.
- No `$anchor`, `$dynamicRef`, `$dynamicAnchor`, `$recursiveRef` or `$recursiveAnchor`.
- `$ref` may point only to `#/$defs/<name>` or `#/definitions/<name>`. `not` may only be `{}`. `enum` and `const` may contain only strings, numbers, booleans and null. `additionalProperties` may not be a schema when `properties` is present.
- No definition that loops through `$ref`, `allOf`, `anyOf` or `oneOf` with no property or item in between, such as `"a": {"$ref": "#/$defs/a"}`. A definition may refer to itself through `properties` or `items`, as a tree does.

An answer may nest at most 128 levels deep. When an input or an answer does not match, the rejection reports each distinct issue once. It lists at most 20, then one line that counts the rest.

Some providers reject or do not enforce parts of a schema. Such a schema is still saved, and the definition carries `warnings` that name the line and the providers concerned. The warnings also name the keywords the runtime does not know, which are sent to the provider but not checked by the runtime. A `format` the runtime takes is checked against the answer whatever the provider enforced while the model wrote it. A definition shows at most 100 warnings. `create_definition`, `get_definition`, `list_definitions` and `update_definition` show them. For example: `Line 8, /output/schema/properties/total/minimum: minimum is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)`. To write a schema every provider accepts:

- Make the root `"type": "object"`. OpenAI and Azure strict structured outputs accept only an object, and so do providers that return JSON through a tool call.
- Give every object `"additionalProperties": false` and list every property in `required`. Write an optional property as nullable, such as `"type": ["string", "null"]`. OpenAI and Azure reject anything else.
- Expect Anthropic models not to receive numeric, length and count bounds (`minimum`, `maxLength`, `minItems`, `uniqueItems` and the like). The runtime still checks them, so an answer outside them fails. The same holds for `oneOf`, which Anthropic models receive as `anyOf`.
- Keep schemas small: Google notes that very large or deeply nested schemas may be rejected.

## Tools

`tools` lists the tools a run may call, from the tool servers the operator configured for the playbook and the connections people added to its org. Write each as `server/tool`, or `server/*` for every tool of a server that the operator allows; a connection is named the same way, by its name:

```yaml
tools: [graph/search, graph/query, notes/*]
```

`server/*` gives every tool the server lists that the server's `allowed` setting names. When the operator left `allowed` out, it gives every tool the server lists. A tool written in another form, or listed twice, is refused when the document is saved.

### Find the tool names

Do not guess tool names. Ask the runtime:

1. Call `search` (MCP, or `GET /v1/orgs/{org}/playbooks/{playbook}/tool-servers/search`). It returns the servers set up for the playbook and the tools the operator allows on each. It asks each server for its tools, as a run does. When the servers offer many tools, pass a few words describing what the function should do as `terms`. See [Tool servers](http.md#tool-servers).
2. Call `introspect` to read one tool in full, with the schema of its arguments.
3. Call the tool with `execute` to see what it returns before you name it. `execute` calls the tool once, as a run would, and returns what the run's model would see. The call is recorded in the playbook's history. `dry_run` reports beforehand what the call would check. See [Calling a tool by hand](http.md#calling-a-tool-by-hand).

### Before the model is called

A run checks its tools after it confirms that its model is offered, and before it calls the model. A run whose model is not offered contacts no tool server. A tool that cannot be used ends the run as `unavailable`, and the model is never called:

| Kind                 | `because`                    | When                                                                                                                                                                                                                     |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool_not_offered`   | `tool_server_not_configured` | The server is not configured for the playbook                                                                                                                                                                            |
| `tool_not_offered`   | `tool_not_allowed`           | The tool is outside the server's `allowed`                                                                                                                                                                               |
| `tool_not_offered`   | `tool_not_listed`            | The server does not list the tool                                                                                                                                                                                        |
| `tool_not_offered`   | `connection_pending`         | The server is a connection nobody has approved yet                                                                                                                                                                       |
| `tool_not_offered`   | `connection_broken`          | The server is a connection whose credential is gone from the secret store or is not the tokens of a consent, whose consent was revoked or has ended, or whose client is no longer registered; remove it and add it again |
| `tool_not_offered`   | `connection_not_allowed`     | The server is a connection a rule of the operator no longer allows                                                                                                                                                       |
| `tool_not_offered`   | `connection_unavailable`     | The server is a connection whose credential cannot be read just now; try again later                                                                                                                                     |
| `tool_server_failed` | `unreachable`                | The server cannot be reached, or does not respond in time                                                                                                                                                                |
| `tool_server_failed` | `failing`                    | The server fails, or refuses to list its tools                                                                                                                                                                           |
| `tool_server_failed` | `rate_limited`               | The server asks the run to slow down                                                                                                                                                                                     |
| `tool_server_failed` | `key_refused`                | The server did not accept the key the runtime gives it; check that key, do not retry                                                                                                                                     |

### What the model sees

- Each tool reaches the model under a unique name made from `server__tool`, for an MCP server and an HTTP API alike. Characters other than letters, digits and underscores become underscores. A name longer than 64 characters, or one that clashes with another after that change, gets an 8-character hash. A numeric suffix resolves any clash that remains.
- The tool's description is cut to 4 KiB. Its input schema is sent unchanged.
- Parts of a tool's input schema that the provider may refuse or not enforce are added to the run's `warnings`, such as `graph__search inputSchema#/properties/query/maxLength`. Tools are not sent as strict structured outputs, so the rules for JSON output schemas do not apply to them.
- The model keeps the function's output format. It may call several tools in one step, and call tools over several steps, before it answers.
- Each call carries the run id in the request's metadata, under `auto.on/run_id`.
- A tool's text content reaches the model as text. Structured content reaches it only when there is no text. Other content reaches it as a one-line placeholder.
- A result the server marks `isError`, such as a policy denial, reaches the model as a tool error it may recover from.
- A server's own instructions never reach the model. Error text is scrubbed of the server's secrets and of minted tokens.

### Limits on calls

The runtime checks each call before it sends it:

- A run makes at most 25 calls; any further call is refused.
- A call that sends more than 16 KiB of arguments is refused.
- A third call of the same tool with the same arguments is refused, and the model is pointed to the result of the earlier call.

A refused call is not sent and not recorded, and the model is told why.

The model reads each tool result in full. A result is cut, with a note of how much was left out, only when it would not fit in the room left for the step that called it:

- The room starts as the smaller of two figures: the model's context window, as the server's model catalog gives it, and what is left of the run's budget. The step's input and output are taken off it, and the step's calls share the rest equally.
- Room is counted in the provider's tokens for that step, and converted to bytes at the step's ratio of bytes sent to input tokens counted.
- A cut result stays valid JSON, with a note asking for fewer rows, fields or depth.
- When the catalog does not know the window, or the provider reports no token counts, each result is read in full.

A run's model calls use at most the input tokens the operator sets with `REASONING_MAX_INPUT_TOKENS`, 2,000,000 by default. Before each step, the runtime estimates that step's input from the step before. When the remaining budget would not cover another step after it, that step is the last, and it is made without tools.

Once the run has used all its calls, or the budget would run out, the model answers from what it has, without tools. That last step gives the model the calls so far as text, so every provider accepts it. The tool results sit in a block fenced by a random marker and labelled as the results of the tools the model called. The label tells the model they are data to answer from, not instructions and not the user's words.

A run that calls tools costs more. Every step resends the conversation so far, so a run that uses its whole budget sends on the order of a million tokens. Ask a tool for one page of its data when the whole would be more than the model should read.

### Limits on time and failures

| Bound                                            | Value                                                        | When it is reached                               |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| One call                                         | 30 seconds                                                   | A tool error that counts as a server failure     |
| A 429 from a tool server                         | Waited out when `Retry-After` asks for at most 10 seconds    | Otherwise a server failure                       |
| Server failures in one run                       | 5                                                            | The run ends with `because: "server_failed"`     |
| One model call                                   | 60 seconds plus 25 ms for every token of `max_output_tokens` | The run ends with `because: "model_unavailable"` |
| The whole run                                    | 10 minutes, or one model call's limit when that is longer    | The run ends with `because: "run_bound"`         |
| A tool call in the last step, made without tools | None allowed                                                 | The run ends with `because: "no_answer"`         |

Once the run has called a tool, each of these ends it as `tools_unfinished` or `effect_unknown`; see [When a tool-calling run cannot finish](#when-a-tool-calling-run-cannot-finish). Before its first call, the run ends as plain `unavailable`.

A provider may signal that the request is too long: HTTP 413, or the error code or type `context_length_exceeded` or `request_too_large`. The run then ends as `conflict` with the kind `unworkable`. Its detail names the signal, how many bytes the tools returned, and the input tokens the provider counted for the last step.

### The run's history

Each call adds two events to the run's history, appended as they happen:

1. `tool_call_started`, recorded before the call is sent. It has the call's number, the id the model gave it, the server, the tool and the size of its arguments. It has `read_only: true` when the server marks the tool read-only, and the SHA-256 digest of the arguments when they are kept.
2. Then one of:
   - `tool_call_answered`, when the tool answered: `is_error`, the size of the result and its digest when it is kept, `shown_bytes` when the model read less than all of it, the duration and the JSON-RPC id.
   - `tool_call_failed`, when it did not: `because` (`arguments_refused`, `server_failure`, `timed_out`, `too_large` for a result larger than the transport reads, `cancelled`, or `interrupted` for a call whose attempt ended before it answered, which the run makes again; see [A run performed again](#a-run-performed-again)), the failure message, the duration and the JSON-RPC id.

Either event carries the server's own request id when the server's `request_id` setting says where to find it. The arguments and the result are kept in full, scrubbed of secrets, unless the operator sets `record_content: false` for the server. A run's history, from `list_playbook_events` given its `run_id`, shows each one when it is at most 2 KiB, and its size otherwise. `get_event` reads them in full.

### When a tool-calling run cannot finish

A tool may change something outside the playbook. So a run that called tools and then could not finish ends in one of two ways, depending on what it called:

| It called                                                | Ending                                 | Status | What may follow                                                                                |
| -------------------------------------------------------- | -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Only tools their servers mark read-only (`readOnlyHint`) | `unavailable`, kind `tools_unfinished` | 503    | A new run, or a workflow's retry on status 503, may do the work again                          |
| Any tool its server does not mark read-only              | `conflict`, kind `effect_unknown`      | 409    | No retry on status 503 matches it, since that tool may already have changed an external system |

Both endings name, in words, the tools the run called. They keep the `because` field of the bound or failure that stopped the run.

The same run id never runs that work again. [Retrying under a run id](http.md#retrying-under-a-run-id) gives the rule for every run; for a tool-calling run:

- `run_definition` with the `run_id` of a tool-calling run that ended without succeeding returns `conflict` with the kind `tools_called`. When every tool it called only reads, the rejection also has `because: "only_read"`, and its words say nothing was changed.
- A run that is still `started` is not started again: it goes on from what it recorded, and calls again only a tool its server marks read-only whose call has no answer; see [A run performed again](#a-run-performed-again).

A caller that disconnects before the run returns does not stop the run: it goes on to its end and records it, and a request with its `run_id` is given what it recorded. Only the server stopping cuts a run off, and that leaves it to be performed again from what it recorded; see [A run performed again](#a-run-performed-again).

Inspect its history and any external effects before deliberately starting a new run with a new id. Retrying a successful run returns its recorded result without calling tools again.

### Setting up tools

Tool access works in every runtime, whether started with npx or Docker, once the operator configures `tool_servers`. The operator binds each server to an org, and optionally to some of its playbooks. Its `allowed` setting narrows the server's tools; see the [Configuration reference](../self-host/configuration.md#tool-servers). Connecting an external agent does not give the function that agent's tools, credentials or accounts; see [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## How a run ends

Every rejection is a problem document, and is recorded on the run.

| What happened                                                                            | Rejection                                                                                               | HTTP       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| The input is not a JSON object, or does not match the input schema                       | `invalid_input`, with the issues under `/input`                                                         | 422        |
| The template reads a missing field outside a condition                                   | `invalid_input` at `/input/<field>`, with the line                                                      | 422        |
| A filter rejects an input value, a render limit is reached, or the message renders empty | `invalid_input`, with the line                                                                          | 422        |
| The model refuses the content under its policy                                           | `invalid_input`                                                                                         | 422        |
| The provider rejects the model, the schema or a setting                                  | `conflict`, kind `unworkable`                                                                           | 409        |
| A provider option its gateway does not allow, or a namespace nothing reads               | `conflict`, kind `unworkable`; nothing is called                                                        | 409        |
| A JSON answer is cut off at `max_output_tokens`                                          | `conflict`, kind `unworkable`: raise `config.max_output_tokens`                                         | 409        |
| The answer is too large for the 1 MiB a run records                                      | `conflict`, kind `unworkable`: lower `config.max_output_tokens`                                         | 409        |
| The provider signals the request is too long                                             | `conflict`, kind `unworkable`                                                                           | 409        |
| The model is outside the operator's allowed models                                       | `unavailable`, kind `model_not_offered`, `because: "model_not_allowed"`                                 | 503        |
| The provider is not configured, or its certificate is not trusted                        | `unavailable`                                                                                           | 503        |
| The provider rejects the credentials                                                     | `unavailable`, with the HTTP status                                                                     | 503        |
| The provider limits the rate of requests                                                 | `unavailable`, with the seconds to wait when it said                                                    | 503        |
| The provider cannot be reached or cannot serve now, or does not respond in time          | `unavailable`: try again later                                                                          | 503        |
| A JSON answer does not match the schema                                                  | `unavailable`, with the first issues: try again                                                         | 503        |
| A tool cannot be used before the model is called                                         | `unavailable`, kind `tool_not_offered` or `tool_server_failed`                                          | 503        |
| A run that called tools cannot finish                                                    | `unavailable`, kind `tools_unfinished`, or `conflict`, kind `effect_unknown`                            | 503 or 409 |
| The run under the `run_id` is still `started`, and its last event is recent              | `conflict`, kind `taken`: the run is still running; see [A run performed again](#a-run-performed-again) | 409        |
| The server restarted before the run finished, and the run kept no content to go on from  | `unavailable`, `because: "restarted_without_content"`                                                   | 503 or 409 |
| The server restarted while the run called a tool its server does not mark read-only      | `conflict`, kind `effect_unknown`, `because: "call_outcome_unknown"`                                    | 409        |
| The caller disconnects before the run returns                                            | The run goes on to its end and records it; a request with its `run_id` is given its result              | 499        |

What the rejections say:

- A provider's rejection names the provider, the HTTP status and what it means. It quotes the provider's own words only where [Provider messages](model-settings.md#provider-messages) allow them.
- A rejection for a provider that is not configured names that provider, with the configured providers and the aliases. A rejection for an untrusted certificate says that the operator must act. Neither names a setting. When other providers are configured but not this one, the kind is `model_not_offered` and `because` is `provider_not_configured`.
- Nothing is sent to a model outside the allowed models.
- A request that is too long is explained under [Limits on time and failures](#limits-on-time-and-failures). The tool endings are explained under [Before the model is called](#before-the-model-is-called) and [When a tool-calling run cannot finish](#when-a-tool-calling-run-cannot-finish).

More rules:

- A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"` in the record.
- A model call may take 60 seconds plus 25 ms for every token of `max_output_tokens`: 85.6 seconds at the default 1,024. That time includes up to two retries of a call that failed with HTTP 408, 409, 429 or 5xx, or could not connect.
- When a provider ignores or changes a setting, the record's `warnings` say so.
- The definition operations add their own rejections: `not_found` for a definition the playbook does not have, and `conflict` for a retired definition or one whose document no longer parses.

## What a run records

`get_run` returns the output of a succeeded run with its `record`:

| Field                                | What it holds                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                              | The model as `requested`, as `resolved` through the aliases, and as the provider `answered`                                                                |
| `settings`                           | The settings sent, with the default `max_output_tokens` filled in                                                                                          |
| `output_format`                      | `text` or `json`                                                                                                                                           |
| `finish_reason`, `raw_finish_reason` | Why the answer ended: `stop`, `length`, `content_filter`, `tool_calls`, `error` or `other`; and the provider's own word for it                             |
| `usage`                              | Input tokens (uncached, cache read, cache write), output tokens (text, reasoning) and the total, added up over the run's model calls; `null` where unknown |
| `response_id`                        | The provider's id of the last response; for Bedrock, its request id                                                                                        |
| `cost_usd`                           | What the run's model calls cost in US dollars, added up, where the gateway answered a cost; absent when it answered none                                   |
| `warnings`                           | What the provider said it ignored or changed, and the parts of a tool's input schema that are not portable to it; at most 20                               |
| `duration_ms`                        | How long the run's model calls took, added up                                                                                                              |
| `prompt`                             | The rendered `instructions` and `message`, and `truncated`                                                                                                 |

- The output and the record may be at most 1 MiB together; see [Runs and results](http.md#runs-and-results). When the prompt does not fit beside the answer, the record keeps the start of the instructions and of the message, and sets `truncated: true`.
- The record contains no credentials. It also leaves out the provider options, which the definition already contains.
- A run rejected after one of its model calls ended keeps a record with only `usage`, `duration_ms` and `cost_usd`, added up over the model calls that ended, and the playbook's analytics count its tokens. That holds for every ending: an answer that does not match the schema or is cut off, content the model refused, a model that kept calling tools in the last step, an answer too large for the 1 MiB, and a run stopped by a call's deadline, by its bound or by failing tool servers. A count the provider did not report is `null`.
- A rejection that comes before any model call ended records no usage, since none is known.

## The run's model calls

A run calls its model one call at a time. Each call adds two events to the run's history, appended as they happen:

1. `model_call_started`, recorded before the call is sent. It has the call's `number`, counted from 1 across the run, the `model` asked for, `tools_offered`, and `messages_bytes`, the size of the messages the call adds to the conversation: the prompt for the first call, the answers of the tools for a later one, and for the last step of a run that called tools, the conversation told again in one message.
2. Then one of:
   - `model_call_answered`, when the model answered: `finish_reason` and `raw_finish_reason`, `usage`, `cost_usd` where the gateway answered a cost, `response_id`, `duration_ms`, `request_bytes`, the size of the request the call sent, `response_bytes`, the model as `resolved_model` and `answered_model`, the provider's `warnings`, and `tool_calls`, one for each tool call the model asked for, with its `call_id`, the `tool` and `server` it names, and the digest of its arguments.
   - `model_call_failed`, when it did not: `because` (`cancelled`, `content_refused`, `credentials_rejected`, `definition_invalid`, `interrupted`, `model_not_allowed`, `output_invalid`, `provider_not_configured`, `provider_unavailable`, `rate_limited`, `request_too_long` or `timed_out`), the `provider`, the failure message as `detail`, `duration_ms`, and, where they apply, the `usage` and `cost_usd` of an answer the run could not use, `finish_reason`, `retry_after_ms`, the provider's own words and the issues it named.

The messages each call adds and the model's response are kept in full, scrubbed of the secrets of the run's tool servers, when every tool server of the run keeps content, as `record_content` keeps it unless the operator turns it off. A run without tools always keeps them. The events then carry their SHA-256 digests, `messages_sha256` and `response_sha256`, and each tool call the digest of its arguments, `arguments_sha256`. A call keeps only what it adds, never the whole conversation again, so what a run keeps grows with its length. A run goes on from the scrubbed messages and response whether it keeps them or not, so a secret of a tool server in the prompt or in the model's answer reaches no model call and no tool. A JSON answer is checked against its schema again once scrubbed, and one that no longer matches, such as a number that held a secret, ends the run as an answer that does not match its schema does. A run's history shows each one when it is at most 2 KiB, and its size otherwise. `get_event` reads them in full.

A gateway that answers what a call cost, in US dollars, in a response header gives the call its `cost_usd`; [Gateway fields](model-settings.md#gateway-fields) names the header. The [record](#what-a-run-records) of the run adds up its model calls.

## A run performed again

A run is not interrupted by its client going away; only the server stopping cuts it off, and that leaves it to be performed again from what it recorded. A run a workflow's step started goes on within that step: it stops when the step's server stops or hands its workflows to another server, and the server that runs the workflow then goes on with it. Nothing limits how many runs go on after their clients went away: each is bounded as any run is, and its client started it. `cancel_run` cancels a run that is still `started`, whether its client is there or gone: the server where a run its client started is going stops it at once, ending each call it has in flight as `interrupted`, as the workflow that started a run does when it cancels it, and a run a workflow's step started that `cancel_run` cancels, or one going in another server, stops before its next model call or tool call, a call it already sent still recording its answer, and a run whose last model call answers ends with that answer. Otherwise the run ends `rejected` with the reason `cancelled`, with the spending of its model calls so far; see [Cancelling a run](http.md#cancelling-a-run). A run that is still `started` is never started a second time. `run_definition` with its `run_id` goes on with it from what it recorded, at the version it started with, and answers when the run ends. The workflow host does the same for the calls its workflows wait on, once a server starts again after one stopped.

A run is told to be still running by its events alone. Every model call and every tool call has a bound: the model call's limit under [Limits on time and failures](#limits-on-time-and-failures), and the server's bound of a tool call, 30 seconds unless the operator sets another. The two together are longer than any gap between two events of a run that is still going. A run whose last event is newer than that may still be running, so a request for it is refused as `conflict` with the kind `taken`, saying the run is still running, and makes no second attempt. Once its last event is older, the attempt that wrote it has ended, and the request goes on with the run. The age of the last event is read from the database's clock, so two servers that share a database need not agree on the time. The workflow host, which knows the server it replaces stopped, goes on at once. In the server where the run is going, a request for it waits for it to end and is given what it recorded, so two requests for one run in one server make one attempt of it, and a client that sends a request twice is answered once. Each model call and each tool call is numbered, and an event is recorded only under the next number, or as the end of a call that is still open, so of two attempts that go on at once, from two servers too, the second stops at its first event, before it calls anything, and no call is ever started a second time.

The run goes on from its events and the content it kept, and reads them before it does anything else: it takes its prompt from what its first model call kept and does not render the template again, and an ending it meets before its first call, such as a tool server that cannot be opened yet, names the tools it called and records the spending of its model calls, as every other ending does.

- The bound of a run that calls tools, 10 minutes, counts from its start.
- A model call that was answered is not made again. A model call started without an answer ends as `interrupted` and is made again from the same messages, under the next number.
- When the last model call asked for tool calls, each call that has an answer gives the model that answer again, rebuilt from what the run kept, and a call that failed gives the model its failure. A call without an answer ends as `interrupted`, and is made again when its server marks the tool read-only. Every call counts toward the run's 25, the ones made before included.
- A call without an answer of a tool its server does not mark read-only is not made again, since it may already have changed something outside the playbook, and neither is any other call of the same step without an answer, even one of a read-only tool. Each ends as `interrupted`, and the run ends as `conflict`, kind `effect_unknown`, with `because: "call_outcome_unknown"`.
- A call of a tool the run no longer offers, because its tool server changed while the run was stopped, is not sent. The model is told so and goes on.
- A model call that failed ends the run as that failure did, and a run whose cancel was asked ends cancelled, neither calling anything.
- A run that kept no content, because a tool server of the run has `record_content: false`, cannot go on. Each of its calls without an answer ends as `interrupted`, so every call it started has an end, and the run ends as `unavailable` with `because: "restarted_without_content"`, or, once it called a tool, as `tools_unfinished` or `effect_unknown` with that `because`; see [When a tool-calling run cannot finish](#when-a-tool-calling-run-cannot-finish).

A run that has ended is never performed again in this way; [Retrying under a run id](http.md#retrying-under-a-run-id) gives the rule.

## The overview

`create_definition` and `update_definition` take an `overview` beside the document: Markdown for the person who runs the business, written from everything known of them and of the playbook. It says why the function exists, what it does and how it fits, in one to three short paragraphs, with a Mermaid diagram in a fenced block where a flow is worth a picture; less technical, more value. Write it after the document, and write it again with every update.

An overview holds 1 character to 16,384 bytes in UTF-8. The version keeps it as written, and `get_definition` returns it so until an update gives another; an update that leaves it out keeps the overview saved. `list_definitions` leaves it out. [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.

## Provider options

`provider_options` passes options to one provider, under the namespace that provider reads. Only options that shape how the model reasons or writes its answer are offered:

```yaml
provider_options:
  anthropic:
    thinking: { type: enabled, budgetTokens: 2000 }
```

| Namespace       | Read for models of                                                           | Offered                                                                            |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `anthropic`     | `anthropic`, `bedrock-anthropic`, `vertex-anthropic`                         | `thinking`, with only `type`, `budgetTokens` and `display`                         |
| `openai`        | `openai`, and `azure` when there are no `azure` options                      | `textVerbosity`, `reasoningMode`, `logitBias`                                      |
| `azure`         | `azure`                                                                      | `textVerbosity`, `reasoningMode`, `logitBias`                                      |
| `google`        | `google`, and `vertex` when there are no `googleVertex` or `vertex` options  | `thinkingConfig`, `safetySettings`, `threshold`                                    |
| `vertex`        | `vertex`                                                                     | `thinkingConfig`, `safetySettings`, `threshold`                                    |
| `googleVertex`  | `vertex`, `vertex-anthropic`                                                 | `thinkingConfig`, `safetySettings`, `threshold`, and `thinking` as for `anthropic` |
| `amazonBedrock` | `bedrock`                                                                    | `reasoningConfig`                                                                  |
| `bedrock`       | `bedrock` when there are no `amazonBedrock` options, and `bedrock-anthropic` | `reasoningConfig`                                                                  |

An option is offered only when this table lists it; an option a provider adds is not offered until it is reviewed and listed. Put the options of Anthropic models on Bedrock under `anthropic`, since Bedrock passes anything under `bedrock` through unchanged. The runtime checks the option names, including the names inside `thinking`; the provider checks the values when the run calls it.

These are never offered, for any provider:

- Anything the front matter sets, such as the effort level (`config.reasoning`), the token limit or how a JSON schema is sent (`output`).
- Credentials, and attribution such as `user`, `metadata` or `labels`.
- Anything stored or reused on the operator's account: `store`, `previousResponseId`, `conversation`, `container`, `cacheControl`, `cachedContent`, and prompt cache keys and retention.
- Routing, fallbacks, capacity and service tiers.
- Request headers and betas, such as `anthropicBeta`.
- Tools and servers, such as `mcpServers`.
- Raw request fields, such as `additionalModelRequestFields` or `prediction`.
- Options for provider-managed conversation state, since the runtime manages the run's conversation.
- Output the runtime does not read, such as `logprobs` or `reasoningSummary`.
- Options that change how the runtime sends the prompt, such as `systemMessageMode` or `forceReasoning`.

An option that is not offered is refused when the document is saved. The problem names the option and says it `is not offered`, with the reason, such as `effort is not offered: the front matter sets it`. A namespace that is neither a provider's nor shaped like a gateway's name (a lowercase letter, then up to 31 letters, digits and hyphens) is refused the same way. Do not copy a provider's full API request into this field; write the options the table offers and read the validation feedback.

### Options for a gateway

A gateway is an endpoint the operator configures under its own name. Every field under the gateway's name, or its camel-case form (`my-gateway` and `myGateway`), goes into the request body unchanged. `user` is read from `openaiCompatible`. A gateway gives meaning to body fields its operator may not want a function to set: attribution and budgets, routing and fallbacks, mock answers, endpoints and credentials. So under any of these namespaces, a function may set only the top-level fields the operator lists in the gateway's `allowed_provider_options`. By default that list is empty. The operator cannot allow a field the runtime sets, such as `temperature`.

Saving does not know which gateways are configured, so these checks happen when the function runs:

- A field outside the list rejects the run as `conflict` with the kind `unworkable`, naming the field and saying the gateway does not allow it. The gateway is not called.
- A namespace shaped like a gateway's name that no configured provider or gateway reads rejects the run the same way, before any provider is called.

The repository's [engineering reference](https://github.com/BeOnAuto/runtime/blob/main/docs/engineering/reference/reasoning-format.md#provider-options) explains, for contributors, why each option is withheld.

</div>
