---
description: 'The document format of a reasoning function: its model, input and output contracts, settings and prompt template, and what a run records.'
---

<div v-pre>

# Reasoning function format

A reasoning function is a definition of the type `reasoning`. Its document names a model, the input and output contracts, the settings and a prompt template. A run renders the prompt from its input, calls the model and records the model's answer. [Build your first playbook](../tutorials/first-playbook.md) walks through one with an agent.

Use one where the work needs judgement or language. It judges or writes from what it is handed: the workflow passes it what lookup functions read and computation functions worked out. Reading what a service holds is a lookup function's work, even where an earlier step's answer says what to read; exact arithmetic or reshaping data, a computation function's; asking a person or having a service act, an interaction function's; and the order of the work, its branches and its waits, the workflow's.

## A function document

The source is Markdown: YAML front matter, then a Liquid prompt template. This example reviews a campaign brief and answers JSON: its recommendation and what the brief misses. Its page heads each run with both, and counts the recommendations of each day. Replace the model reference with a concrete id from [`list_models`](mcp.md#model-information), or with one the operator of your runtime confirms.

<!-- prettier-ignore -->
````markdown
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
output:
  format: json
  schema:
    type: object
    properties:
      recommendation: { type: string, enum: [Ready, Revise] }
      missing: { type: array, items: { type: string } }
    required: [recommendation, missing]
    additionalProperties: false
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: reasoning/review-brief
    views:
      reviews: table
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const recommendation = fieldOf(fieldOf(event.data, 'output'), 'recommendation');
        const day = event.time?.slice(0, 10);
        if (typeof recommendation !== 'string' || day === undefined) return view;
        const rows = view.reviews?.rows ?? [];
        const counted = rows.some(([at, kind]) => at === day && kind === recommendation)
          ? rows.map((row) => (row[0] === day && row[1] === recommendation ? [day, recommendation, Number(row[2]) + 1] : row))
          : [...rows, [day, recommendation, 1]];
        return { reviews: { columns: [{ name: 'Day' }, { name: 'Recommendation' }, { name: 'Reviews' }], rows: counted.slice(-60) } };
      }
  result: |
    {{ output.recommendation }}{% if output.missing.size > 0 %}: {{ output.missing | join: "; " }}{% endif %}.
  runs: |
    ```chart bars x=Day y=Reviews color=Recommendation
    {{ views.reviews | json }}
    ```
---

{% system %}Review the brief using the supplied criteria. Recommend Ready only when it meets every criterion, and list what it misses, each in a short clause. Do not invent facts.{% endsystem %}
Brief: {{ input.brief }}
Criteria: {{ input.criteria }}
````

To save it, call `create_definition` with `type: "reasoning"`, the `name` `review-brief`, which its page's filter names, the document as `source`, and its `overview` and `diagram`. A save without a `diagram` is refused, so give the word `none` when a picture would add nothing; [The overview](#the-overview) says how to write both. To run it, call `run_definition` with the same type and name, and with `brief` and `criteria` in the `input` object. Both operations also need the playbook id, unless the MCP connection is scoped to that playbook.

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
| `tools`                    | No          | The tools a run may call, each `server/tool` or `server/*`, only where the model must explore; see [Tools](#tools)                                                              |
| `max_input_tokens`         | No          | A whole number from 10,000 to 9,999,999: the input tokens a run may read; see [Limits on calls](#limits-on-calls)                                                               |
| `max_tool_calls`           | No          | A whole number from 1 to 1,000: a count of all a run's tool calls, in place of 25 calls of tools not marked `reads`; see [Limits on calls](#limits-on-calls). Only with `tools` |
| `exit_behavior`            | No          | `error`, the default, or `continue`: how a run ends at its limit of tool calls or of input tokens; see [At a limit](#at-a-limit). Only with `tools`                             |
| `page`                     | No          | The [page](page-format.md) that presents its runs                                                                                                                               |

Any other key, at any level, is rejected.

### How a document is checked

`create_definition` and `update_definition` check the whole document, and every run checks it again. A document with problems is rejected with every problem listed under `/source`:

- Each problem names its line and, where there is one, a JSON pointer into the front matter, such as `Line 4, /config/temperature: Expected number`.
- A problem found twice is reported once. A rejection lists at most 20 problems in line order, then one line that counts the rest, such as `Line 23: 5881 more issues are not shown`.
- The front matter is YAML 1.2 with the core schema, so `yes` and `2026-10-01` stay strings. Anchors, aliases and tags are rejected. A key may appear only once in a mapping, and numbers must be finite. Nesting is limited to 72 levels.
- Quote a text that holds ` #`, or a comma inside `{ }`, such as `description: 'Posts the notes in #deliveries'` or `{ note: 'Costs 1,000 a month' }`. Unquoted, YAML reads ` #` as the start of a comment and a comma there, even the one in `1,000`, as the start of another key, so the text ends early, and the save does not always say so.
- `input.default` must match the input schema for the fields it names. Required fields may be left for the input to supply.
- A setting in `config` is checked only against the type and range in the table above. Whether the provider accepts the value becomes clear when a run calls it.
- Saving calls no model. Whether the provider is configured, and whether it offers the model, becomes clear only when the function runs; see [How a run ends](#how-a-run-ends).

## How a run works

A run takes these steps:

1. It applies `input.default`: each top-level field the supplied input leaves out takes its default. It checks the result against `input.schema`. The input may be at most 1 MiB as JSON and 512 levels deep. A run without input gets `{}`.
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
- A list or an object written whole stops the run with `invalid_input`, naming the line. Write one of its fields, such as `{{ input.account.name }}`, or render it as JSON with `{{ input.account | json }}`.

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

With `output.format: json`, the answer must match `output.schema`. With `output.shape`, it must match the shape's schema and the rules the shape adds, such as the order of a series' points; [Output shapes](output-shapes.md) gives them, and the shape's schema is sent to the provider as `output.schema` would be. The runtime validates the answer against the schema as written, whatever the provider enforced. The provider is sent [the portable form of the schema](model-settings.md#the-portable-form-of-a-schema), and the answer is read back into the schema as written. Through [a gateway without structured outputs](model-settings.md#a-gateway-without-structured-outputs), and for a schema that is not portable, the schema as written is in the instructions instead of sent as a response format. A schema is a JSON Schema document in draft 2020-12. It is read as draft-07 when `$schema` says so, or when the document uses `definitions` without `$defs`.

These rules apply to `output.schema` and `input.schema` alike, and a schema that breaks one is refused when saved:

- At most 65,536 bytes as JSON, at most 64 nested levels of objects and lists, and at most 1,000 values in one `enum`.
- No `pattern` or `patternProperties`, because a hostile regular expression can stall validation.
- A `format` is one of `date`, `date-time`, `time`, `email`, `uri` and `uuid`, which the runtime checks: `date`, `date-time` and `time` as RFC 3339 writes a full date, a date and time and a full time, such as `2026-04-01`, `2026-04-01T09:30:00Z` and `09:30:00Z`; `email` as the HTML standard defines a valid email address, such as `name@example.com`; `uri` as an absolute URI with a scheme, ASCII in the characters RFC 3986 allows, with no white space and each `%` followed by two hexadecimal digits, such as `https://example.com`; and `uuid` in the form of RFC 4122, such as `0f8fad5b-d9cb-469f-a165-70867728950e`. An input with a string out of its format is refused as `invalid_input` at its field, with the form and its example, such as `day: expected a date such as 2026-04-01`, and an answer with one fails as `output_invalid`, such as `/day: Expected a string in the format date, such as 2026-04-01`. A format checks strings alone, so beside another type it takes every value of that type. Any other format is refused, since the runtime would not check it.
- No `if`, `then`, `else`, `contains`, `minContains`, `maxContains`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedItems`, `unevaluatedProperties` or `additionalItems`.
- No `$anchor`, `$dynamicRef`, `$dynamicAnchor`, `$recursiveRef` or `$recursiveAnchor`.
- `$ref` may point only to `#/$defs/<name>` or `#/definitions/<name>`. `not` may only be `{}`. `enum` and `const` may contain only strings, numbers, booleans and null. `additionalProperties` may not be a schema when `properties` is present.
- No definition that loops through `$ref`, `allOf`, `anyOf` or `oneOf` with no property or item in between, such as `"a": {"$ref": "#/$defs/a"}`. A definition may refer to itself through `properties` or `items`, as a tree does.

An answer may nest at most 128 levels deep. When an input or an answer does not match, the rejection reports each distinct issue once. It lists at most 20, then one line that counts the rest.

A schema whose answers cannot be enforced while the model writes them is still saved. Its answers are asked for with the schema in the instructions, as [a schema that is not portable](model-settings.md#the-portable-form-of-a-schema) is, and checked after the model writes them. The definition carries `warnings`, one for each part of the schema that keeps its answers from being enforced, at its line and pointer. They are the same whatever the model and the server, and the output shapes carry none. `create_definition`, `update_definition`, `get_definition` and `list_definitions` show them, at most 100. They are found in the definition's document whenever it is read, so a definition saved by an earlier release shows the warnings of this one. For example:

```text
Line 5, /output/schema: answers to this schema cannot be enforced while a model writes them: 17 fields that may be null or are a choice of types, counted where each definition is used (most 16). Answers are checked after the model writes them. To have them enforced, make some of these fields required and of one type, or split the answer.
```

The warnings also name the keywords the runtime does not know, which it does not check: they are left out of the portable form, and written in the instructions as they are when the schema is told to the model there. A `format` the runtime takes is checked against the answer whatever the provider enforced while the model wrote it.

To have the answers enforced, rewrite what a warning names:

| A warning names                                                                                 | Rewrite it                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A value of any type, an object of any keys and values, or a list whose items may be of any type | Give the value a `type`, the object its `properties` or a schema of its values in `additionalProperties`, and the list its `items`               |
| A schema no value matches                                                                       | Leave out the property or the list that takes it, such as one with `"items": false`                                                              |
| Required names with no schema in properties                                                     | Give each name a schema in `properties`, or leave it out of `required`                                                                           |
| `allOf`, `not`, or a list of fixed positions (`prefixItems`)                                    | Write the parts of an `allOf` as one schema, leave `not` out, and write a list of fixed positions as an object with a property for each position |
| `oneOf` or `anyOf` beside other keywords                                                        | Move the other keywords into each choice: beside a choice, keep only a description, bounds and a type every choice shares                        |
| A count of properties beside optional properties that may be null                               | Leave out `minProperties` and `maxProperties`, or make those properties required                                                                 |
| An enum that mixes kinds of value                                                               | Keep to one kind of value in an `enum`, such as strings                                                                                          |
| Keywords beside `$ref`                                                                          | Keep only a description and bounds beside a `$ref`, and move the other keywords into its definition                                              |
| A definition that refers to itself                                                              | Write out each level the answer needs as a definition of its own                                                                                 |
| Rules of the keys that cannot be put into words                                                 | Keep to an `enum`, a `type`, a description and bounds in `propertyNames`                                                                         |
| Definitions under both `$defs` and `definitions`                                                | Keep them all under `$defs`                                                                                                                      |
| A count over its most, such as 17 fields that may be null or are a choice of types (most 16)    | Do what the warning says: make fields required and of one type, nest fewer levels of objects, list fewer `enum` values, or split the answer      |
| That no answer this schema accepts could be made to test its portable form with                 | Make bounds that contradict each other agree, such as a `minLength` above the `maxLength`                                                        |

## Tools

`tools` lists the tools a run may call, from the tool servers the operator configured for the playbook and the connections people added to its org. Name them only where what the model searches for next depends on what it has just read, as when it searches again with better words until it can answer. A read whose arguments the input or an earlier step gives belongs in a lookup function, and the workflow hands its answer to this function, as the `start` guide sets out under Build from the job. Choosing from the input what to search for or open is not exploring, and neither is choosing which of a search's hits to read: a reasoning function with no tools makes each choice, one lookup searches, and another reads each chosen item in a `for`, as [A lookup for each item](workflow-format.md#a-lookup-for-each-item) shows. A function whose tools are all marked reads is still saved, and run when you ask. Its save answers a notice that says so when its tool servers list their tools within two seconds, and so does a run you ask for that succeeds. When that notice comes, move those reads to lookup functions, or keep the tools and tell the person what the model searches for after a read.

Write each as `server/tool`, or `server/*` for every tool of a server that the operator allows; a connection is named the same way, by its name:

```yaml
tools: [notes/search, notes/read_note]
```

`server/*` gives every tool the server lists that the server's `allowed` setting names. When the operator left `allowed` out, it gives every tool the server lists. A tool written in another form, or listed twice, is refused when the document is saved.

### Find the tool names

Do not guess tool names. `search` lists the servers set up for the playbook and the tools the operator allows on each; when there are many, give it `terms`, a few words of what the function should do. `introspect` reads one tool in full. Call a tool once before you name it, as a run would: `query_connection` for a tool marked `reads`, `execute_connection` for any tool once the person agrees. Each returns the `text` the run's model would see and is recorded in the playbook's history; see [Calling a tool by hand](http.md#calling-a-tool-by-hand).

### Before the model is called

A run checks its tools after it confirms that its model is offered, and before it calls the model. A run whose model is not offered contacts no tool server. A tool that cannot be used ends the run as `unavailable`, and the model is never called:

| Kind                 | `because`                    | When                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_not_offered`   | `tool_server_not_configured` | The server is not configured for the playbook                                                                                                                                                                                                                                    |
| `tool_not_offered`   | `tool_not_allowed`           | The tool is outside the server's `allowed`                                                                                                                                                                                                                                       |
| `tool_not_offered`   | `tool_not_listed`            | The server does not list the tool                                                                                                                                                                                                                                                |
| `tool_not_offered`   | `connection_pending`         | The server is a connection nobody has approved yet                                                                                                                                                                                                                               |
| `tool_not_offered`   | `connection_broken`          | The server is a connection whose server refused its credential, whose credential is gone from the secret store or is not the tokens of a consent, whose consent was revoked or has ended, whose client is no longer registered, or whose provider is replaced here; reconnect it |
| `tool_not_offered`   | `connection_not_allowed`     | The server is a connection a rule of the operator no longer allows                                                                                                                                                                                                               |
| `tool_not_offered`   | `connection_unavailable`     | The server is a connection whose credential cannot be read just now; try again later                                                                                                                                                                                             |
| `tool_server_failed` | `unreachable`                | The server cannot be reached, or does not respond in time                                                                                                                                                                                                                        |
| `tool_server_failed` | `failing`                    | The server fails, or refuses to list its tools                                                                                                                                                                                                                                   |
| `tool_server_failed` | `rate_limited`               | The server asks the run to slow down                                                                                                                                                                                                                                             |
| `tool_server_failed` | `key_refused`                | The server did not accept the key the runtime gives it; check that key, do not retry                                                                                                                                                                                             |
| `tool_server_failed` | `scope_lacking`              | The server asks for a scope its credential lacks, which the details name; do not retry until a credential is granted that scope                                                                                                                                                  |

### What the model sees

- Each tool reaches the model under a unique name made from `server__tool`, for an MCP server and an HTTP API alike. Characters other than letters, digits and underscores become underscores. A name longer than 64 characters, or one that clashes with another after that change, gets an 8-character hash. A numeric suffix resolves any clash that remains.
- The tool's description is cut to 4 KiB. Its input schema is sent unchanged.
- Parts of a tool's input schema that the provider may refuse or not enforce are added to the run's `warnings`, such as `notes__search inputSchema#/properties/query/maxLength`. Tools are not sent as strict structured outputs, so the rules for JSON output schemas do not apply to them.
- The model keeps the function's output format. It may call several tools in one step, and call tools over several steps, before it answers.
- Each call carries the run id in the request's metadata, under `auto.on/run_id`.
- A tool's text content reaches the model as text, and so does the text of an embedded resource, such as a file the tool returns, in the order the tool gave them. Structured content reaches it only when no part of the result holds text. A resource link reaches it as its fields in JSON: its `uri`, its `name`, and the title, description, media type and size the tool gave. Other content, such as an image, audio or an embedded resource that holds binary data, reaches it as a one-line placeholder that names its type.
- A result the server marks `isError`, such as a policy denial, reaches the model as a tool error it may recover from.
- A server's own instructions never reach the model. Error text is scrubbed of the server's secrets and of minted tokens.

### Limits on calls

The runtime checks each call before it sends it:

- A run makes as many calls as it needs within its time, ten minutes, and the input tokens it reads. It makes at most 25 calls of tools not marked `reads`, a tool that declares nothing among them. Reads go uncounted, but a read the workflow can make still belongs in a lookup function. A function that sets `max_tool_calls` gives the run a count of its own, which bounds all its calls: every call the model asks for, reads and refused repeats included. A step that asks for a call past the count ends the run, or has the calls past it refused; see [At a limit](#at-a-limit). A tool's [mark](http.md#the-mark-of-a-tool) is the one its server or its connection's entry declares.
- A third call of the same tool with the same arguments is refused, and the model is pointed to the result of the earlier call.

A refused call is not sent and not recorded, and the model is told why. A tool's server may take less than a model writes, and says so only by refusing, with HTTP 413: the model then reads how large the arguments were, and to send less in one call, in parts where the tool takes them.

A model writes a call's arguments as output tokens, so `config.max_output_tokens` limits them. At the default of 1,024, a model writes about 3 to 4 KiB of arguments. For larger arguments, raise it to about one token for every 3 bytes: about 22,000 for 64 KiB. At its most, 64,000, a model writes roughly 200 KiB.

When the model reaches `config.max_output_tokens` while it writes a call, a call whose arguments were cut so that they no longer parse is not sent: the model reads that they did not parse, and the run goes on. A call whose arguments still parse is sent as written, though the model may have been cut off before it finished them. In a function that answers in JSON, the run ends as `conflict`, kind `unworkable`, as a JSON answer cut off at `max_output_tokens` does. Every later step of the run reads those arguments again as input, so a run that writes several large arguments uses its input tokens quickly; [Send a large value to a tool](../guides/tools.md#send-a-large-value-to-a-tool) shows a workflow that sends one large value a run.

The model reads each tool result in full, unless it would not fit in the room left for the step that called it. Then the result is cut, stays valid JSON, and ends with a note of how much was left out, asking for fewer rows, fields or depth: ask the tool for less, such as one page.

A run reads at most its function's `max_input_tokens` input tokens, or the default of the server it runs on where the function sets none, and never more than that server's most. A run at that limit ends as [At a limit](#at-a-limit) says, in words that name the limit in force and what to change.

<div data-audience="operator">

On a runtime of one's own, [`REASONING_MAX_INPUT_TOKENS`](../self-host/configuration.md#models) is both the default and the most, 2,000,000 unless set. Auto Cloud sets its own.

</div>

A run that calls tools costs more. Every step resends the conversation so far, so a long run can use its whole budget. Ask a tool for one page of its data when the whole would be more than the model should read. Work that grows with a list belongs to a workflow's `for`: a [lookup for each item](workflow-format.md#a-lookup-for-each-item) reads them, and where each item needs judging on its own, this function runs once for each, with its own calls and budget. Raise `max_input_tokens` only for one item that needs more, and tell the person the cost first.

#### At a limit

`exit_behavior` sets what a run does when a step asks for a call past its count, or at the most input tokens it may read:

- `error`, the default: the run stops before it finished. A step that asks for a call past the count sends none of its calls. The last step the budget covers is made with the tools: if the model answers, the run succeeds; if it asks for a tool, none is sent. The run ends as `conflict`, kind `unworkable` when every tool it called is marked `reads`, else `effect_unknown`, with `because: "max_tool_calls"` or `"max_input_tokens"`. Its detail names the limit and what to change, starting with lookup functions where reads count toward it. A workflow's `catch` can take it by that `because`.
- `continue`: the model answers from what it has. Calls past the count are refused and the calls within it are sent, and the next step, or the last the budget covers, is made without tools. The run succeeds, with `incomplete_details: { "reason": "max_tool_calls" }` or `"max_input_tokens"` beside its output. A workflow's step gets the output alone, so keep the default when the answer must cover everything.

A run that makes the last call its count allows and then answers succeeds, unmarked, either way.

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

A provider may signal that the request is too long: HTTP 413, the error code or type `context_length_exceeded`, `request_too_large` or `string_above_max_length`, or an error message that says `prompt is too long`, `maximum context length` or `ContextWindowExceededError`. The run then ends as `conflict` with the kind `unworkable`. Its detail names the signal, how many bytes the tools returned, and the input tokens the provider counted for the last step.

### The run's history

Each call adds two events to the run's history, appended as they happen:

1. `tool_call_started`, recorded before the call is sent. It has the call's number, the id the model gave it, the server, the tool and the size of its arguments. It has `read_only: true` when the tool is marked `reads`, and the SHA-256 digest of the arguments when they are kept.
2. Then one of:
   - `tool_call_answered`, when the tool answered: `is_error`, the size of the result and its digest when it is kept, `shown_bytes` when the model read less than all of it, `shown_format`, the format the model was shown the result in, the duration and the JSON-RPC id. A run performed again shows its model each result exactly as the first attempt did, in the format its event names.
   - `tool_call_failed`, when it did not: `because` (`arguments_refused`, `server_failure`, `timed_out`, `too_large` for a result larger than the transport reads, `cancelled`, or `interrupted` for a call whose attempt ended before it answered, which the run makes again; see [A run performed again](#a-run-performed-again)), the failure message, the duration and the JSON-RPC id.

Either event carries the server's own request id when the server's `request_id` setting says where to find it. The arguments and the result are kept in full, scrubbed of secrets, unless the operator sets `record_content: false` for the server. A run's history, from `list_playbook_events` given its `run_id`, shows each one when it is at most 2 KiB, and its size otherwise. `get_event` reads them in full.

An image a tool answers is kept as an asset of the run, apart from the result, when the result is kept:

- The runtime records `asset_kept` on the asset's own stream, `assets/{id}`. Its `made_by.tool_call` names the id the model gave the call, the server, the connection where the server is one, and the tool.
- The kept result names the asset in place of the image's bytes, as `{ "type": "image", "mimeType": "image/png", "asset": "<id>" }`, so the run's history holds no image.
- [`get_asset`](http.md#generation-functions) reads the asset by that id, with an address to its bytes. Its `model` is `null`.
- The runtime keeps an image this way when its bytes are a PNG, JPEG, GIF or WebP image no larger than the limit for one image, and the playbook has room for it.<span data-audience="operator"> The [settings of generation functions](../self-host/configuration.md#generation-functions) set the limit for one image, and the [asset settings](../self-host/configuration.md#assets) the room a playbook has and how long the asset is kept, 90 days by default.</span> Any other image stays in the result as the tool sent it.
- With `record_content: false`, the result is not kept, so its images are not kept either.

### When a tool-calling run cannot finish

A tool may change something outside the playbook. So a run that called tools and then could not finish ends in one of two ways, depending on what it called:

| It called                   | Ending                                 | Status | What may follow                                                                                |
| --------------------------- | -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Only tools marked `reads`   | `unavailable`, kind `tools_unfinished` | 503    | A new run, or a workflow's retry on status 503, may do the work again                          |
| Any tool not marked `reads` | `conflict`, kind `effect_unknown`      | 409    | No retry on status 503 matches it, since that tool may already have changed an external system |

Both endings name, in words, the tools the run called. They keep the `because` field of the bound or failure that stopped the run.

The same run id never runs that work again. [Retrying under a run id](http.md#retrying-under-a-run-id) gives the rule for every run; for a tool-calling run:

- `run_definition` with the `run_id` of a tool-calling run that ended without succeeding returns `conflict` with the kind `tools_called`. When every tool it called is marked `reads`, the rejection also has `because: "only_read"`, and its words say nothing was changed.
- A run that is still `started` is not started again: it goes on from what it recorded, and calls again only a tool marked `reads` whose call has no answer; see [A run performed again](#a-run-performed-again).

A caller that disconnects before the run returns does not stop the run; see [A run performed again](#a-run-performed-again).

Inspect its history and any external effects before deliberately starting a new run with a new id. Retrying a successful run returns its recorded result without calling tools again.

### Setting up tools

Tool access works in every runtime, whether started with npx or Docker, once the playbook has a tool server: one the operator configures under `tool_servers`, or a connection a person adds to its org. The operator binds each server under `tool_servers` to an org, and optionally to some of its playbooks. Its `allowed` setting narrows the server's tools; see the [Configuration reference](../self-host/configuration.md#tool-servers). Connecting an external agent does not give the function that agent's tools, credentials or accounts; see [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## How a run ends

Every rejection is a problem document, and is recorded on the run.

| What happened                                                                            | Rejection                                                                                                                                                                       | HTTP       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The input is not a JSON object, or does not match the input schema                       | `invalid_input`, with the issues under `/input`                                                                                                                                 | 422        |
| The template reads a missing field outside a condition                                   | `invalid_input` at `/input/<field>`, with the line                                                                                                                              | 422        |
| A filter rejects an input value, a render limit is reached, or the message renders empty | `invalid_input`, with the line                                                                                                                                                  | 422        |
| The model refuses the content under its policy                                           | `invalid_input`                                                                                                                                                                 | 422        |
| The provider rejects the model, the schema or a setting                                  | `conflict`, kind `unworkable`                                                                                                                                                   | 409        |
| A provider option its gateway does not allow, or a namespace nothing reads               | `conflict`, kind `unworkable`; nothing is called                                                                                                                                | 409        |
| A JSON answer is cut off at `max_output_tokens`                                          | `conflict`, kind `unworkable`: by what the run called, what to move into a function of its own, then raise `config.max_output_tokens`                                           | 409        |
| The answer is too large for the 1 MiB a run records                                      | `conflict`, kind `unworkable`: lower `config.max_output_tokens`                                                                                                                 | 409        |
| The provider signals the request is too long                                             | `conflict`, kind `unworkable`                                                                                                                                                   | 409        |
| The model is outside the operator's allowed models                                       | `unavailable`, kind `model_not_offered`, `because: "model_not_allowed"`                                                                                                         | 503        |
| The provider is not configured, or its certificate is not trusted                        | `unavailable`                                                                                                                                                                   | 503        |
| The provider rejects the credentials                                                     | `unavailable`, with the HTTP status                                                                                                                                             | 503        |
| The provider limits the rate of requests                                                 | `unavailable`, with the seconds to wait when it said                                                                                                                            | 503        |
| The provider cannot be reached or cannot serve now, or does not respond in time          | `unavailable`: try again later                                                                                                                                                  | 503        |
| A JSON answer does not match the schema, when asked for once more too                    | `unavailable`, with the first issues: try again                                                                                                                                 | 503        |
| A tool cannot be used before the model is called                                         | `unavailable`, kind `tool_not_offered` or `tool_server_failed`                                                                                                                  | 503        |
| A run that called tools cannot finish                                                    | `unavailable`, kind `tools_unfinished`, or `conflict`, kind `effect_unknown`                                                                                                    | 503 or 409 |
| A step asks past its count of calls, or of input tokens, under `exit_behavior: error`    | `conflict`, kind `unworkable` or `effect_unknown`, `because: "max_tool_calls"` or `"max_input_tokens"`; see [At a limit](#at-a-limit)                                           | 409        |
| The run under the `run_id` is still `started`, and its last event is recent              | `conflict`, kind `taken`: the run is still running; see [A run performed again](#a-run-performed-again)                                                                         | 409        |
| The server restarted before the run finished, and the run kept no content to go on from  | `unavailable`, `because: "restarted_without_content"`; once it called a tool, `unavailable`, kind `tools_unfinished`, or `conflict`, kind `effect_unknown`, with that `because` | 503 or 409 |
| The server restarted while the run called a tool not marked `reads`                      | `conflict`, kind `effect_unknown`, `because: "call_outcome_unknown"`                                                                                                            | 409        |
| The caller disconnects before the run returns                                            | The run goes on to its end and records it; a request with its `run_id` is given its result                                                                                      | 499        |

What the rejections say:

- A provider's rejection names the provider, the HTTP status and what it means. It quotes the provider's own words only where [Provider messages](model-settings.md#provider-messages) allow them.
- A rejection for a provider that is not configured names that provider, with the configured providers and the aliases. A rejection for an untrusted certificate says that the operator must act. Neither names a setting. When other providers are configured but not this one, the kind is `model_not_offered` and `because` is `provider_not_configured`.
- Nothing is sent to a model outside the allowed models.
- A request that is too long is explained under [Limits on time and failures](#limits-on-time-and-failures). The tool endings are explained under [Before the model is called](#before-the-model-is-called) and [When a tool-calling run cannot finish](#when-a-tool-calling-run-cannot-finish).

More rules:

- A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"` in the record and `incomplete_details: { "reason": "max_output_tokens" }` beside the output, as `get_run` and `list_runs` show it.
- A model call may take 60 seconds plus 25 ms for every token of `max_output_tokens`: 85.6 seconds at the default 1,024. That time includes up to two retries of a call that failed with HTTP 408, 409, 429 or 5xx, or could not connect.
- When a provider ignores or changes a setting, the record's `warnings` say so.
- A JSON answer that does not match its schema is asked for once more, with its issues, when the run has room left for it, and the rejection of one that misses it again says `after one correction`: see [An answer that misses its schema](model-settings.md#an-answer-that-misses-its-schema).
- A JSON answer whose schema the provider refuses with HTTP 400 or 422 is asked for once more with the schema in the instructions. When the provider refuses that request too, the rejection says the schema was not the cause and to check the model's settings or choose another model; when too little time was left to ask, it is `unavailable`, saying to try again: see [A schema the provider refuses](model-settings.md#a-schema-the-provider-refuses).
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
- A prompt of more than the payload size threshold as JSON, 16,384 bytes unless the runtime is set otherwise ([Payload offloading](../self-host/configuration.md#payload-offloading)), may be kept outside the run, in the playbook's stored content. `get_run` still answers `prompt`. Where it cannot read it, it answers `prompt_sha256` and `prompt_bytes`, its SHA-256 and its size, in its place, and the run is answered all the same. `get_event` shows the prompt beside its SHA-256 and size.
- A run rejected after one of its model calls ended keeps a record with only `usage`, `duration_ms` and `cost_usd`, added up over the model calls that ended, and the playbook's analytics count its tokens. That holds for every ending: an answer that does not match the schema or is cut off, content the model refused, a model that kept calling tools in the last step, an answer too large for the 1 MiB, and a run stopped by a call's deadline, by its bound or by failing tool servers. A count the provider did not report is `null`.
- A rejection that comes before any model call ended records no usage, since none is known.

## The run's model calls

Each model call adds `model_call_started` to the run's history, then `model_call_answered` or `model_call_failed`, which `list_playbook_events` reads, given the run's `run_id`. [A reasoning function's model calls](http.md#a-reasoning-function-s-model-calls) gives their fields, and what a run keeps of its messages.

## A run performed again

A run keeps going when its client goes away; only the server stopping cuts it off. `run_definition` with the `run_id` of a run still `started` resumes it from what it recorded: a call that was answered is not made again, and a call without an answer of a tool not marked `reads` is never made again. While the run may still be running in another server, `run_definition` returns `conflict` with the kind `taken`. [A reasoning run performed again](http.md#a-reasoning-run-performed-again) gives every rule, and what `cancel_run` does to a run going elsewhere.

## The overview

`create_definition` and `update_definition` take an `overview` and a `diagram` beside the document. Write both after the document, and again with every update, as the descriptions of those arguments say. Auto Studio draws the diagram under the overview, at full size in a column, so draw it top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code. An overview holds up to 16,384 bytes and a diagram 8,192, in UTF-8. [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.

## Its page

A reasoning function's page is the `page` key of its front matter, written with the document and saved with it. It shows the person the judgment the function made:

- `result`: the judgment in a sentence, with the fields that decided it, such as `Revise: the audience names no job role.` for a review of a brief.
- `runs`: the outcomes by category over time, such as the reviews of each day by their recommendation.

Show numbers over time as a chart keyed by the period a run is about, and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id.

A page counts what the answer names, so give the answer the fields that decide it: `output.format: json`, and an `output.schema` that holds them, such as the `recommendation` of `Ready` or `Revise` and the criteria it found `missing` in [the example](#a-function-document). An answer in text gives the page its words alone. The page guide, [Page format](page-format.md), gives the whole format of a page.

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
