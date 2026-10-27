<div v-pre>

# Reasoning function format

A reasoning function is a definition whose `type` field is `reasoning`, in API calls, MCP arguments and workflow definitions alike. A run performs one model invocation, or, when the function names [`tools`](#tools), a loop of them with the tools of the playbook's tool servers. Skill references are still planned; the `tools` field does not load skills or inherit an external agent's context.

## Reasoning function document format

A reasoning function definition is one Markdown document (`text/markdown`): YAML front matter between two lines of three dashes, then a Liquid template. The front matter uses Dotprompt's key names; the format is this package's own, and this package parses it.

```markdown
---
description: Summarizes an account for the sales team
model: anthropic/claude-sonnet-4-5
config:
  max_output_tokens: 800
  temperature: 0.2
input:
  schema:
    type: object
    properties:
      account: { type: string }
      tone: { type: string }
    required: [account]
  default:
    tone: plain
---

{% system %}You write for a sales team, in a {{ input.tone }} tone.{% endsystem %}
Summarize the account {{ input.account }} as of {{ today }}.
```

| Key                        | Required    | Value                                                 | Meaning                                                                                                                                                                                  |
| -------------------------- | ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`              | No          | Text of 1 to 1000 characters                          | What the definition does. `list_definitions` and `get_definition` show it                                                                                                                |
| `model`                    | Yes         | `provider/model`                                      | The model to call; see [How a model reference is resolved](../../reference/model-settings.md#how-a-model-reference-is-resolved)                                                          |
| `config.max_output_tokens` | No          | A whole number from 1 to 64000; 1024 when left out    | The most tokens the answer may take. The time the call may take grows with it                                                                                                            |
| `config.temperature`       | No          | A number                                              | Sampling temperature. Providers accept different ranges and reject a value outside theirs                                                                                                |
| `config.top_p`             | No          | A number                                              | Nucleus sampling                                                                                                                                                                         |
| `config.seed`              | No          | A whole number of 0 or more                           | A seed, for providers that take one                                                                                                                                                      |
| `config.stop_sequences`    | No          | A list of texts                                       | Texts that end the answer                                                                                                                                                                |
| `config.reasoning`         | No          | `none`, `minimal`, `low`, `medium`, `high` or `xhigh` | Reasoning effort, for models that reason                                                                                                                                                 |
| `input.schema`             | No          | A JSON Schema whose root is `"type": "object"`        | The input of a run must match it. Without it, any JSON object is accepted                                                                                                                |
| `input.default`            | No          | A JSON object                                         | Values merged under the input before it is validated. They must match the schema for the fields they name; required fields may be left to the input                                      |
| `output.format`            | No          | `text`, the default, or `json`                        | Whether the answer is the model's text or a JSON value                                                                                                                                   |
| `output.schema`            | With `json` | A JSON Schema                                         | The answer must match it; see [Answers that are JSON](../../reference/model-settings.md#answers-that-are-json). Not allowed with `text`                                                  |
| `provider_options`         | No          | An object of objects, keyed by the provider namespace | Options for `anthropic`, `openai`, `azure`, `google`, `vertex`, `googleVertex`, `amazonBedrock`, `bedrock`, or a gateway's name: only those [Provider options](#provider-options) offers |
| `tools`                    | No          | A list of `server/tool` or `server/*`                 | The tools of the tool servers configured for the playbook that a run may call; see [Tools](#tools)                                                                                       |

Any other key, at any level, is rejected.

Parsing is validation. Every create, update and run parses the document, and a document with a problem is rejected with every problem found at once, each with its line in the document, and a JSON pointer into the front matter where there is one, for example `Line 4, /config/temperature: Expected number`. The operations answer them under `/source`. An issue found more than once is reported once, and a rejection reports at most 20, in the order of their lines, followed by one that says how many more there were, such as `Line 23: 5881 more issues are not shown`. Parsing finds:

- front matter that does not open on the first line or is never closed; a document without it is never read as a template;
- YAML that cannot be read. The front matter is YAML 1.2 with the core schema, so `yes` and `2026-10-01` stay text. Anchors, aliases and tags are rejected, a key may appear once in a mapping, numbers are finite, and nesting stops at 72 levels: deeper front matter, however deep, is rejected with `The front matter may nest at most 72 levels`;
- unknown keys and values of the wrong type, and a missing `model`;
- a model not written `provider/model`, and settings out of range;
- an input schema whose root is not an object, a schema that cannot be validated (see [Answers that are JSON](../../reference/model-settings.md#answers-that-are-json) for what is rejected), and defaults that do not match it;
- a `json` output without a schema, and a `text` output with one;
- a provider option that is not offered, and a namespace that is no provider's (see [Provider options](#provider-options));
- a tool not written `server/tool` or `server/*`, and a tool listed twice;
- Liquid that does not parse, a tag or filter that is not available, the rules of the system block, a template that writes no message outside it, and every variable it reads (see below).

A JSON output schema that some providers reject or do not enforce is accepted. The definition then carries `warnings`, which `create_definition`, `get_definition`, `list_definitions` and `update_definition` show, each with its line and the providers concerned, for example `Line 8, /output/schema/properties/total/minimum: minimum is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)`. At most 100 are shown.

### Provider options

`provider_options` passes options to the AI SDK for a provider, keyed by the namespace the SDK reads for it. A definition may set only the options that shape how the model reasons or writes its answer. None of these is offered, whatever the provider: attribution (`user`, `metadata`, `labels`, request metadata), anything stored or reused on the operator's account (`store`, `previousResponseId`, `conversation`, `container`, `cachedContent`, prompt cache keys and retention), routing, fallbacks, capacity and service tiers, request headers and betas, tools and servers, guardrails, raw request fields, options for provider-managed conversation state (the runtime manages the run's conversation), output the runtime does not read, and anything the front matter already sets (`config` and `output`, such as an effort level or the strictness of a JSON schema). An option is offered only when it is listed here; an option a provider adds is not offered until it is reviewed and listed.

| Namespace       | Read by                                                                      | Offered                                                                        |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `anthropic`     | `anthropic`, `bedrock-anthropic`, `vertex-anthropic`                         | `thinking`, with only `type`, `budgetTokens` and `display`                     |
| `openai`        | `openai`, and `azure` when there are no `azure` options                      | `textVerbosity`, `reasoningMode`, `logitBias`                                  |
| `azure`         | `azure`                                                                      | `textVerbosity`, `reasoningMode`, `logitBias`                                  |
| `google`        | `google`, and `vertex` when there are no `googleVertex` or `vertex` options  | `thinkingConfig`, `safetySettings`, `threshold`                                |
| `vertex`        | `vertex`                                                                     | `thinkingConfig`, `safetySettings`, `threshold`                                |
| `googleVertex`  | `vertex`, `vertex-anthropic`                                                 | `thinkingConfig`, `safetySettings`, `threshold`, `thinking` as for `anthropic` |
| `amazonBedrock` | `bedrock`                                                                    | `reasoningConfig`                                                              |
| `bedrock`       | `bedrock` when there are no `amazonBedrock` options, and `bedrock-anthropic` | `reasoningConfig`                                                              |

Some of what is withheld, and why:

- `anthropic`: `effort`, which `config.reasoning` sets; `cacheControl` and `container` (stored on the account); `metadata` (attribution); `mcpServers`, `disableParallelToolUse`, `toolStreaming` and `safeguards` (tools and servers); `anthropicBeta` (a request header); `fallbacks`, `speed`, `serviceTier` and `inferenceGeo` (routing and capacity); `sendReasoning`, `taskBudget`, `compaction` and `contextManagement` (conversation state); `structuredOutputMode` (the front matter's `output` decides how JSON is asked for); `thinking.blockBinding`, which turns on a beta.
- `openai`, `azure`: `reasoningEffort`, `reasoningEffortUpdate` and `maxCompletionTokens` (`config` sets them); `store`, `previousResponseId`, `conversation` and the prompt cache options; `user`, `safetyIdentifier` and `metadata`; `serviceTier`; `prediction` (raw request content); `instructions`, `systemMessageMode`, `forceReasoning` and `strictJsonSchema`, which change how the runtime sends the prompt or the schema; `logprobs`, `include` and `reasoningSummary` (output the runtime does not read); the tool options.
- `google`, `vertex`, `googleVertex`: `labels`; `cachedContent`; `serviceTier`, `sharedRequestType` and `requestType` (Vertex AI capacity headers); `retrievalConfig` and `streamFunctionCallArguments`; `responseModalities`, `imageConfig`, `audioTimestamp` and `mediaResolution`; `structuredOutputs`.
- `amazonBedrock`, `bedrock`: `additionalModelRequestFields`, and every key Bedrock does not read, because Bedrock adds those to the Converse request as they are (`inferenceConfig`, `guardrailConfig` and the like); `requestMetadata` (attribution); `anthropicBeta`; `serviceTier`; `structuredOutputMode`. The options of Anthropic models on Bedrock go under `anthropic`, since Bedrock would send them as they are under `bedrock`.

Any other option is rejected when the document is parsed, with the option named and the words `is not offered`, so such a definition is never stored. A namespace that is neither a provider's nor shaped like a gateway's name is rejected the same way. The offered and withheld options are one table of data in `src/model/offered-provider-options.ts`, typed against the option types the AI SDK exports, so an upgrade that adds or removes an option fails the type check until the option is decided.

A gateway is a different case: the AI SDK adds every key under the gateway's name, or its camel case (`my-gateway` and `myGateway`), to the request body as it is, and reads `user` from `openaiCompatible`. A gateway gives meaning to body fields its operator may not want a tenant to set: attribution and budgets, routing and fallbacks, mock answers, endpoints and credentials. So a definition sets for a gateway only the top-level fields its entry lists in `allowed_provider_options`, under any of those namespaces, and by default none. The list is checked when the server starts: at most 64 distinct names of 1 to 64 characters, none of them a field the runtime sets or that changes what the call is (`model`, `messages`, `stream`, `stream_options`, `n`, `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `response_format`, `tools`, `tool_choice`, `functions`, `function_call`, `reasoning_effort`, `verbosity`, and the SDK's `reasoningEffort`, `textVerbosity` and `strictJsonSchema`). A problem names the setting and the field, never a value.

The parser does not know the gateways, so this check runs when the function runs: a field outside the list rejects the run as `conflict`, naming the field and saying the gateway does not allow it, and the gateway is not called. The same goes for a namespace that is shaped like a gateway's name but is no configured gateway's: the run is rejected as `conflict` before any provider is called.

A document is checked without calling a model, and the same document always gives the same answer. Whether its provider is configured, and whether the provider accepts the model and the settings, shows only when it runs; see [When a run is rejected](#when-a-run-is-rejected).

### Tools

`tools` names the tools a run may call, each `server/tool` or `server/*`, from the servers in [`tool_servers`](../../self-host/configuration.md#tool-servers) that serve the playbook's org and playbook and the [connections](../../self-host/connections.md) of its org that serve it, a connection named by its name. A run checks them once its model is known to be offered, and before the model is called, so a run whose model is not offered reaches no server and starts no process: a server that is not configured for the playbook is `unavailable` of the kind `tool_not_offered` because `tool_server_not_configured`, a tool outside the server's `allowed` because `tool_not_allowed`, a tool the server does not list because `tool_not_listed`, and a connection that is not ready because `connection_pending`, `connection_broken`, `connection_not_allowed` or `connection_unavailable`; a server that cannot be used is `unavailable` of the kind `tool_server_failed`, because `unreachable`, `failing`, `rate_limited` or `key_refused`, the last when the server did not accept the key the runtime gives it, whose words say to check that key rather than to try again. `server/*` gives every tool the server lists that the server's `allowed` names, or every tool it lists when `allowed` is left out. `search` lists the servers that serve the playbook and the tools each would give `server/*`, asking each server as a run does, and scores the tools by `terms` where the servers offer many, so the names can be found rather than told ([Tool servers](../../reference/http.md#tool-servers)); `introspect` answers one tool whole, and `execute` calls one as a run would and answers what its model would see, so what a tool answers can be read before a function names it ([Calling a tool by hand](../../reference/http.md#calling-a-tool-by-hand)).

The model receives each tool under a unique name derived from `server__tool`, for an MCP server and an HTTP API alike, and the server's name ends at the first `__`. Characters other than letters, digits and underscores become underscores; names longer than 64 characters or sharing a normalized name receive an 8-character hash. A numeric suffix resolves any remaining collision within the run's tool list. The description is cut to 4 KiB and the server's input schema is unchanged; what in it the provider of the run's model may refuse or not hold the tool's arguments to is added to the run's `warnings`: a root that is not an object, and for Anthropic models the bounds, `oneOf` and the formats they do not enforce or accept, such as `graph__search inputSchema#/properties/query/maxLength`. Tools are not sent as strict structured outputs, so the rules a JSON output schema has for open objects and optional properties do not apply to them. The model keeps the function's output format and may call tools, several in one step, before it answers, each call forwarded with the run id in the request's metadata under `auto.on/run_id`:

| Bound                                                                                                                           | Value                                                                                                                                                                                                                                                                                                                  | When it is reached                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Calls in one run                                                                                                                | 25                                                                                                                                                                                                                                                                                                                     | further calls are refused, then one more step without tools                                                                           |
| Input tokens of a run's model calls                                                                                             | `REASONING_MAX_INPUT_TOKENS`, 2,000,000 by default                                                                                                                                                                                                                                                                     | before a step the budget would not pay for another after it: that step is made without tools                                          |
| One result                                                                                                                      | an equal share, among the step's calls, of what the model's context window and the run's budget leave past the input and output the provider counted for the step, in bytes at the step's own ratio of bytes sent to input tokens counted; whole where the window is not known or the provider counted no input tokens | cut where it stays valid JSON, with a note asking for fewer rows, fields or depth                                                     |
| One call's arguments                                                                                                            | 16 KiB                                                                                                                                                                                                                                                                                                                 | the call is refused                                                                                                                   |
| The same tool with the same arguments                                                                                           | twice                                                                                                                                                                                                                                                                                                                  | the third call is refused, naming the earlier answer                                                                                  |
| One call                                                                                                                        | 30 s                                                                                                                                                                                                                                                                                                                   | a tool error that counts as a server failure                                                                                          |
| A 429                                                                                                                           | waited out when `Retry-After` asks for at most 10 s                                                                                                                                                                                                                                                                    | otherwise a server failure                                                                                                            |
| Server failures in one run                                                                                                      | 5                                                                                                                                                                                                                                                                                                                      | `tools_unfinished` or `effect_unknown`, because `server_failed`                                                                       |
| One model call                                                                                                                  | 60 s plus 25 ms for every token of `max_output_tokens`                                                                                                                                                                                                                                                                 | `tools_unfinished` or `effect_unknown`, because `model_unavailable`                                                                   |
| The whole run                                                                                                                   | 10 minutes, or one model call's limit when longer                                                                                                                                                                                                                                                                      | `tools_unfinished` or `effect_unknown`, because `run_bound`                                                                           |
| The last step, without tools, still calls tools                                                                                 |                                                                                                                                                                                                                                                                                                                        | `tools_unfinished` or `effect_unknown`, because `no_answer`                                                                           |
| The provider signals the request too long: HTTP 413, or the error code or type `context_length_exceeded` or `request_too_large` |                                                                                                                                                                                                                                                                                                                        | `conflict`, `unworkable`, naming the signal, the bytes the tools answered and the input tokens the provider counted for the last step |

A refused call is not sent and not recorded. The step that follows the end of the calls withholds the tools and tells the model the calls so far as text, so every provider takes it, with their answers in a block fenced by a random marker and labelled as the results of the tools it called: data to answer from, not instructions, and not the words of the user. A result's text content reaches the model as text, structured content only when there is no text, other content as a one-line placeholder, and a result the server marks `isError`, such as a policy's denial, as a tool error the model may recover from; a server's own instructions never reach it. Error text is scrubbed of the entry's secrets and minted tokens.

Each call is two events on the run's stream, appended as it happens: `tool_call_started`, recorded before the call is sent, with its number, the id the model gave it, the server, the tool, the size of its arguments and, where they are kept, the SHA-256 digest of the kept text, and `read_only: true` where the server marks the tool read-only; and then `tool_call_answered` when the tool answered, with `is_error`, the size of its answer and, where it is kept, its digest, both over the kept text, `shown_bytes` where the model read less than the whole, the duration and the JSON-RPC id, or `tool_call_failed` when it did not, with `because` (`arguments_refused`, `server_failure`, `timed_out`, `too_large` for an answer past what the transport reads, or `cancelled`), the words of the failure, the duration and the JSON-RPC id; either carries the server's own request id where the entry's `request_id` names it. The arguments and the answer are kept whole, scrubbed of secrets, in the ledger's recorded content unless the entry's `record_content` is `false`. A run's history, `list_playbook_events` given its `run_id` and `get_run_history` over HTTP, shows them where each is within 2 KiB and their sizes otherwise, and `get_event` reads them whole. The model reads each answer whole, cut with a note only where it passes its equal share, among the step's calls, of what the model's context window and the run's budget leave past the input and output the provider counted for the step, in bytes at the step's own ratio of bytes sent to input tokens counted; and a run's model calls add up to at most `REASONING_MAX_INPUT_TOKENS` input tokens, 2,000,000 by default: before a step the budget would not pay for another after it, that step is made without tools and the model answers from what it has. Once a run has recorded a call, every `unavailable` ending names the tools it called in words and has the kind `tools_unfinished` when every tool it called is one its server marks `readOnlyHint`, which says running it again is safe, and becomes a `conflict` of the kind `effect_unknown`, with the same because and words, when any is not, since whether that tool changed something is not known; `run_definition` answers the same `run_id` with `conflict` of the kind `tools_called` unless the run succeeded: a tool may have changed something, so start a new run instead. It answers the same while a run of a function with `tools` is started, before any call too, since that run may still be in progress.

A run that calls tools costs more: every step resends the conversation so far, so a run that uses its whole budget of results sends on the order of a million tokens.

## The template language

The template is [Liquid](https://shopify.github.io/liquid/), rendered by liquidjs 10.30.0, configured for templates written by tenants: templates live in memory and the engine has no file system.

### Variables

A template reads three variables and nothing else:

- `input`: the input of the run, with the defaults merged under it and validated;
- `today`: the date, `YYYY-MM-DD`, in UTC;
- `now`: the time, in ISO 8601, in UTC.

`today` and `now` come from the server's clock when the run starts, and have no properties. Names a template makes itself, with `assign`, `for`, `increment` or `cycle`, are fine. Any other name is rejected when the document is parsed, by the engine's static analysis of the template. When the input schema declares `properties` and sets `"additionalProperties": false`, `input.<field>` must be one of them.

Reading is strict. A field the input does not have stops the run with `invalid_input`, naming the field, except in a condition of `if`, `elsif` or `unless` and in the `default` filter, so a template can test a field that may be absent: `{% if input.vip %}…{% endif %}`, `{{ input.nickname | default: "friend" }}`. Only the input's own fields can be read: `input.constructor` is a missing field. Values are written as Liquid writes them: a list as its items without separators, an object as `[object Object]`; write `{{ input.account | json }}` for JSON.

### The system block

```liquid
{% system %}You review expenses against the policy of {{ input.company }}.{% endsystem %}
Review this expense: {{ input.expense | json }}
```

- What is between `{% system %}` and `{% endsystem %}` is sent as the system instructions; everything outside it is the message, sent as one user message.
- A template has at most one system block, at its top level, outside every other tag, and the tags take no arguments. The template must write something outside it.
- The block is found in the template's own syntax tree, never in the rendered text. An input that holds `{% system %}` or `{% endsystem %}` is written as those characters, in the part where the template writes it, and can never open or close the instructions.
- The template renders in document order, so a value assigned in the block is known after it.

### Tags

Available: `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment`, `#` and `tablerow`.

Not available: `include`, `render`, `layout` and `block` load other templates, and a definition is one document; `capture` renders into a buffer of its own, outside the limit on the rendered size, so use `assign` with `append` instead.

### Filters

A template may use the filters listed in [Templates](../../reference/template.md#filters), the same in every template.

Left out, and why:

- `where_exp`, `reject_exp`, `group_by_exp`, `has_exp`, `find_exp` and `find_index_exp` evaluate an expression given as text, which the check of the variables a template reads cannot see;
- `date`, `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and `date_to_long_string` read the server's clock, time zone and locale, so the same definition would render differently from one server to the next; `today` and `now` give the date and the time to the templates that read them;
- `sample` is random;
- `sha256` and `hmac_sha256` compute digests, which a template has no use for, and `hmac_sha256` would put a key in a definition;
- `strip_html` is a hand-written HTML parser that had three advisories in 2026 (a regular expression that backtracks, an infinite loop, and a bypass); they are fixed in this version, and a template has no HTML to strip;
- `url_encode`, `cgi_escape`, `uri_escape` and `url_decode`: the encoders grow their output without charging the memory limit (nine `url_encode` in a row turn 65,536 characters into 1,245,184 without charging anything), and a template has no URL to encode;
- `inspect` and `jsonify` do what `json` does.

As of October 2026, no published advisory affects liquidjs 10.27.2 or later; earlier versions have several, including running code from a crafted template. 10.30.0 is the newest release the workspace's minimum release age allows.

### Limits

| Limit                                       | Value                         | Why                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Length of the template                      | 65,536 characters             | The document itself takes at most 65,536 bytes                                                                                                                                         |
| Names in tags and outputs                   | 1000                          | The engine's static analysis finds the position of every variable from the start of the text: 1000 variables at the end of a 64 KiB template take 90 ms to analyse, 13,107 take 574 ms |
| Time to render                              | 200 ms                        | Rendering is synchronous. The heaviest renders measured take 3 to 10 ms: a loop over 2000 items writing 114,000 characters takes 9 ms                                                  |
| Memory that filters and ranges may charge   | 5,000,000 characters or items | About nineteen passes of a filter over the largest input a run takes (256 KiB)                                                                                                         |
| Rendered instructions, and rendered message | 200,000 characters each       | Checked as the output is written, so a render stops as soon as it grows past it                                                                                                        |

Names are counted in the text inside `{{ }}` and `{% %}`: every variable, property, filter and keyword. A template over the first two limits is rejected when it is parsed. The engine reads tags and parentheses recursively, so a template that nests them more deeply than it can read (about 2000 levels of tags) is rejected with `The tags or parentheses of the template nest too deeply to be read`, never with the engine's own message. A render that hits one of the last three stops the run with `invalid_input`, because it is the input that makes the render grow.

## Creating and running a reasoning function

The definition and run operations of [`@on.auto/definitions`](../../../packages/definitions) store reasoning function definitions and record their runs: `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, `run_definition` and `get_run`, under `/v1/orgs/{org}/playbooks/{playbook}`, with `type: "reasoning"`. Give the server a key for the provider first; it reads the model settings when it starts:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

With the [reasoning function document](#reasoning-function-document-format) saved as `account-summary.md`, create a playbook and the function. `jq` turns the document into a JSON string:

```bash
curl --request POST http://localhost:5555/v1/orgs/acme/playbooks \
  --header 'content-type: application/json' \
  --data '{"playbook":"sales","name":"Sales"}'
jq --null-input --rawfile source account-summary.md '{name: "account-summary", source: $source}' |
  curl --request POST http://localhost:5555/v1/orgs/acme/playbooks/sales/definitions/reasoning \
    --header 'content-type: application/json' --data @-
```

`create_definition` answers `201` with the definition: its `version` 1, the `description`, the `input_schema`, any `warnings`, and the document as `source`. A document with problems gets `422` with every problem under `/source`. Read it back, and list the reasoning functions in the playbook:

```bash
curl http://localhost:5555/v1/orgs/acme/playbooks/sales/definitions/reasoning/account-summary
curl http://localhost:5555/v1/orgs/acme/playbooks/sales/definitions/reasoning
```

Run the function. The optional `run_id` identifies the run so you can inspect it and retry according to the [retry rules](#when-a-run-is-rejected):

```bash
curl --request POST http://localhost:5555/v1/orgs/acme/playbooks/sales/definitions/reasoning/account-summary/run \
  --header 'content-type: application/json' \
  --data '{"input":{"account":"Globex"},"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
```

```json
{
  "run_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "type": "reasoning",
  "name": "account-summary",
  "definition_version": 1,
  "status": "succeeded",
  "output": "Globex renewed for two years and expanded to three regions this quarter.",
  "started_at": "2026-10-01T09:30:00.000Z",
  "started_by": { "id": "local", "name": "ada" },
  "finished_at": "2026-10-01T09:30:02.412Z"
}
```

`get_run` reads it back with the [record](#what-a-run-records):

```bash
curl http://localhost:5555/v1/orgs/acme/playbooks/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

An agent calls the same operations as MCP tools on `POST /mcp`, where the tools inside a playbook take its id as `playbook`: `get_guide` serves the format of the document as the guide `reasoning-function`, the public reference page with what this server offers at its end, and a rejection comes back as `isError` with the same problem document. A retry with the same `run_id`, definition and input returns a recorded success or invalid-input rejection without calling the model. Other failures may permit another attempt, except where tool calls may already have changed something; [rejection and retry rules](#when-a-run-is-rejected) cover those cases. `update_definition` (`PUT …/definitions/reasoning/account-summary` with a new `source`) makes version 2, and `retire_definition` (`POST …/retire`) retires the function for good. The [definitions README](../../../packages/definitions/README.md) has the rules of each operation.

`scripts/try-reasoning.sh` at the root of the repository does all of this against a server that is already running, with a small reasoning function of its own, and prints the run and its record. It starts nothing, and needs `curl` and `jq`:

```bash
scripts/try-reasoning.sh http://localhost:5555 anthropic/claude-sonnet-4-5
```

It works in org `local`, or `AUTO_RUNTIME_ORG`, creates a playbook named `try-<seconds>`, and sends `AUTO_RUNTIME_KEY` as the API key when it is set. CI never runs it.

## An example with a JSON answer

```markdown
---
description: Checks an expense against the travel policy
model: openai/gpt-5
config:
  max_output_tokens: 300
input:
  schema:
    type: object
    properties:
      expense: { type: string }
      amount: { type: number }
    required: [expense, amount]
    additionalProperties: false
output:
  format: json
  schema:
    type: object
    properties:
      approve: { type: boolean }
      reason: { type: string }
    required: [approve, reason]
    additionalProperties: false
---

{% system %}You check expenses against the travel policy: meals up to $80 a person, no alcohol.{% endsystem %}
Expense: {{ input.expense }}, {{ input.amount | money }}.
```

Run with `{"input":{"expense":"Dinner for two with a client","amount":142.5}}`, it answers with the JSON value, validated against the schema:

```json
{
  "status": "succeeded",
  "output": { "approve": true, "reason": "Two meals at $71.25 each are within the $80 limit." }
}
```

## When a run is rejected

The definition operations answer every rejection as a problem document, and record it on the run. A call with the same `run_id` runs the definition again after `unavailable` or `conflict`, unless the run called tools, and answers the same `invalid_input` again.

| What happened                                                                                         | Rejection                                                                                                                                                                                                            | HTTP |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| The input is not a JSON object, or does not match the input schema                                    | `invalid_input`, with the issues under `/input`                                                                                                                                                                      | 422  |
| The template reads a field the input does not have, outside a condition                               | `invalid_input` at `/input/<field>`, naming the field and the line                                                                                                                                                   | 422  |
| A filter rejects a value of the input, a render limit stops the render, or the message renders empty  | `invalid_input`, with the line                                                                                                                                                                                       | 422  |
| The model refuses the content under its policy                                                        | `invalid_input` at `/input`                                                                                                                                                                                          | 422  |
| The provider rejects the definition: a model it does not have, a schema or a setting it cannot accept | `conflict` of the kind `unworkable`, naming the provider, the HTTP status and what it means; the provider's own words only where [Provider messages](../../reference/model-settings.md#provider-messages) allow them | 409  |
| The definition sets a provider option its gateway does not allow                                      | `conflict` of the kind `unworkable`, naming the option; the gateway is not called                                                                                                                                    | 409  |
| A JSON answer is cut off at `max_output_tokens`                                                       | `conflict` of the kind `unworkable`, saying to raise `config.max_output_tokens`                                                                                                                                      | 409  |
| The answer leaves no room in the 1 MiB a run records                                                  | `conflict` of the kind `unworkable`, saying to lower `config.max_output_tokens`                                                                                                                                      | 409  |
| The definition names a model outside `allowed_models`                                                 | `unavailable` of the kind `model_not_offered` because `model_not_allowed`; nothing is sent                                                                                                                           | 503  |
| The provider is not configured, or its certificate is not trusted                                     | `unavailable`, naming the provider, the configured providers and the aliases, or saying that the operator must act; never a setting                                                                                  | 503  |
| The provider rejects the credentials                                                                  | `unavailable`, with the HTTP status                                                                                                                                                                                  | 503  |
| The provider limits the rate of requests                                                              | `unavailable`, saying how many seconds to wait when it said                                                                                                                                                          | 503  |
| The provider cannot be reached or cannot serve now, or does not answer in time                        | `unavailable`, saying to try again later                                                                                                                                                                             | 503  |
| A JSON answer does not match the schema                                                               | `unavailable`, with the first issues, saying to try again                                                                                                                                                            | 503  |
| The definition names a tool the playbook's tool servers do not offer, or a server cannot be used      | `unavailable` of the kind `tool_not_offered` or `tool_server_failed`; the model is not called                                                                                                                        | 503  |
| The run called only tools their servers mark read-only and then could not finish                      | `unavailable` of the kind `tools_unfinished`, naming the tools it called in words                                                                                                                                    | 503  |
| The run called a tool its server does not mark read-only and then could not finish                    | `conflict` of the kind `effect_unknown`, naming the tools it called in words; no retry on status 503 repeats it                                                                                                      | 409  |
| The same `run_id` again, after a run that called tools and did not succeed                            | `conflict` of the kind `tools_called`; inspect the history and external effects before deliberately starting a new run                                                                                               | 409  |
| The same `run_id` again, while a run of a reasoning function with `tools` is started                  | `conflict` of the kind `tools_called`; the run may still be in progress, so inspect its history before starting another                                                                                              | 409  |
| The caller goes away before the answer                                                                | the run is interrupted and recorded as `failed`; in-flight tool calls are cancelled and may have external effects                                                                                                    | 499  |

A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"` in the record. A call may take 60 seconds plus 25 ms for every token of `max_output_tokens`: 85.6 seconds for the default 1024, and that covers the up to two retries of a failure that may pass (see [Retries](../../reference/model-settings.md#retries)). The definition operations add their own rejections: `not_found` for a definition the playbook does not have, and `conflict` for a retired definition or one whose document no longer parses.

## What a run records

`get_run` shows the record of a succeeded run:

| Field                                | What it holds                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `model`                              | The model as `requested`, as `resolved` through the aliases, and as the provider `answered`                           |
| `settings`                           | The settings sent, with the default `max_output_tokens` filled in                                                     |
| `output_format`                      | `text` or `json`                                                                                                      |
| `finish_reason`, `raw_finish_reason` | Why the answer ended, and the provider's own word for it                                                              |
| `usage`                              | Input tokens (uncached, cache read, cache write), output tokens (text, reasoning) and the total; `null` where unknown |
| `response_id`                        | The provider's id of the response                                                                                     |
| `warnings`                           | What the provider said it ignored or changed, and what in a tool's input schema is not portable to it, at most 20     |
| `duration_ms`                        | How long the call took                                                                                                |
| `prompt`                             | The rendered `instructions` and `message`, and `truncated`                                                            |

A run rejected after its model answered keeps a record too, of `usage` and `duration_ms` alone: when the answer does not match the schema or is cut off at `max_output_tokens`, when the model refused the content, when it kept calling tools in the step that withheld them, and when the answer leaves no room in the 1 MiB a run records. `get_run` shows it, and the playbook's analytics count its tokens. A rejection that comes before the model answers, or a call stopped by its deadline, by the bound of a run that calls tools or by failing tool servers, records none, since no usage is known then.

The output and the record take at most 1 MiB together, the limit of the definition operations. When the prompt does not fit beside the answer, the record keeps the start of the instructions and of the message and sets `truncated: true`. The record holds no credential, and not the provider options, which the definition already holds.
