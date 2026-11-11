---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Model settings reference

This page holds the rules behind the model settings, as the operator sees them. [Set up a model provider](../self-host/models.md) shows how to configure a provider and check that it works. The [configuration reference](../self-host/configuration.md#models) lists every model setting.

Two views live on other pages:

- What `list_models` returns to a caller is in [Model information](mcp.md#model-information).
- The rejection a caller gets for each failure is in [How a run ends](reasoning-format.md#how-a-run-ends).

Contributors will find the library behind these settings in the repository's [model access reference](https://github.com/BeOnAuto/runtime/blob/main/docs/engineering/reference/models.md).

## How a model reference is resolved

A definition names its model as `provider/model`, such as `anthropic/claude-sonnet-4-5` or `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`. When it runs, the server resolves the reference in four steps:

1. Aliases apply first: an exact alias, else the wildcard alias with the longest prefix, such as `anthropic/*`. An alias resolves in one hop (see [Model aliases](#model-aliases)).
2. The reference is split at its first `/`. The part before it is the provider prefix. Everything after it is the model id the provider receives, unchanged, so a Bedrock ARN keeps its own `/`.
3. When `allowed_models` is set, the reference as the definition writes it, or the reference its alias sends it to, must be allowed. Otherwise the run is refused and nothing is sent (see [Allowed models](#allowed-models)).
4. The provider must be configured (see [Choose a provider](../self-host/models.md#choose-a-provider)).

A reference without a `/`, or with nothing on one side of it, is invalid, and nothing is sent. There is no default provider, so a model id without a provider prefix is never sent anywhere.

## Gateway fields

Each entry of `model_gateways` in the [configuration file](../self-host/configuration.md), or of `MODEL_GATEWAYS`, is an OpenAI-compatible Chat Completions endpoint with its own provider prefix. [An internal OpenAI-compatible gateway](../self-host/models.md#an-internal-openai-compatible-gateway-with-a-custom-header) shows one in both forms.

| Field                      | Required | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Yes      | The provider prefix: 1 to 32 lowercase letters, digits and hyphens, starting with a letter. It is unique and is not one of the built-in prefixes                                                                                                                                                                                                                                                                                                         |
| `base_url`                 | Yes      | The http or https URL that `/chat/completions` is appended to, and `/audio/transcriptions` where the entry serves the [voice model](#voice-model). Trailing slashes are dropped                                                                                                                                                                                                                                                                          |
| `api_key`                  | No       | The key, sent as `Authorization: Bearer <key>`. In the file, it is a reference to the variable that holds it, such as `${INTERNAL_LLM_KEY}`                                                                                                                                                                                                                                                                                                              |
| `api_key_env`              | No       | In `MODEL_GATEWAYS` only, in place of `api_key`: the name of the variable that holds the key. That variable must be set. Setting both `api_key` and `api_key_env` stops the start                                                                                                                                                                                                                                                                        |
| `headers`                  | No       | Headers sent with every request. Their values are treated as secrets. In the file, a header that carries a credential, such as `authorization`, is a reference                                                                                                                                                                                                                                                                                           |
| `query_params`             | No       | Query parameters added to every request. Their values are treated as secrets                                                                                                                                                                                                                                                                                                                                                                             |
| `structured_outputs`       | No       | `true` when the endpoint accepts strict `response_format: json_schema`. The runtime then sends [the portable form of the schema](#the-portable-form-of-a-schema), so the endpoint enforces it while the model writes. Otherwise the runtime sends no `response_format`, tells the model the schema in the instructions, and checks the answer itself: see [A gateway without structured outputs](#a-gateway-without-structured-outputs). Default `false` |
| `include_usage`            | No       | Asks for usage in streamed responses. Default `false`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `expose_provider_messages` | No       | `true` when the gateway's error messages are safe to show to the callers of a definition. Default `false`: see [Provider messages](#provider-messages)                                                                                                                                                                                                                                                                                                   |
| `allowed_provider_options` | No       | The top-level request body fields a definition may set for this gateway through `provider_options`, such as `["user", "metadata"]`. Default none; see [Provider options](reasoning-format.md#provider-options)                                                                                                                                                                                                                                           |
| `cost_header`              | No       | A gateway entry names the header its gateway answers the call's cost in, in US dollars, or names none and no cost is kept. A run keeps the cost as `cost_usd` in its [record](reasoning-format.md#what-a-run-records), and a transcription as `cost_usd` of its [`voice_transcribed`](#voice-model)                                                                                                                                                      |

Rules for `allowed_provider_options`, each of which stops the start when broken:

- It holds at most 64 field names, each 1 to 64 characters and listed once.
- A field the runtime sets, or one that changes what the call is, cannot be allowed: `model`, `messages`, `stream`, `stream_options`, `n`, `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `response_format`, `tools`, `tool_choice`, `functions`, `function_call`, `reasoning_effort`, `verbosity`, `reasoningEffort`, `textVerbosity` and `strictJsonSchema`.

## Model aliases

`model_aliases` in the [configuration file](../self-host/configuration.md) maps one model reference to another. Definitions keep a name, and the deployment decides where it runs:

```yaml
model_aliases:
  anthropic/claude-haiku-4-5: bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0
  fast/default: google/gemini-2.5-flash
```

The same as an environment variable, which wins over the file's `model_aliases` when both are set:

```sh
MODEL_ALIASES='{"anthropic/claude-haiku-4-5":"bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0","fast/default":"google/gemini-2.5-flash"}'
```

A trailing `*` on both sides makes a wildcard alias, which sends every model of a provider through a gateway. With only a gateway configured, this alias sends a definition that names `anthropic/claude-sonnet-4-5` to `gateway/anthropic/claude-sonnet-4-5`:

```yaml
model_aliases:
  anthropic/*: gateway/anthropic/*
```

As an environment variable: `MODEL_ALIASES='{"anthropic/*":"gateway/anthropic/*"}'`. For a gateway that names models without the provider's prefix, the target is `gateway/*`.

Aliases follow these rules. A broken rule stops the start.

- Both sides are written `provider/model`.
- The `*` appears once, at the end of both sides. It stands for the rest of the reference, which may not be empty.
- A target may not itself be an alias, so chains and cycles are refused. That holds for a wildcard target too: `{"anthropic/*":"gateway/*","gateway/fast":"gateway/llama-3.3-70b"}` is refused.
- An exact alias wins over a wildcard. Among wildcards, the longest prefix wins.

What else aliases change:

- The result of a run records the model as requested, as resolved, and as the provider reported it.
- A provider reached only through a wildcard alias is not a configured provider. With the alias above, `anthropic` stays unconfigured in the [start-up line](../self-host/models.md#check-the-start-up-line).
- `list_models` lists each alias by its own name, marked `alias: true`, unless the provider of its target is not configured. A model that an alias sends elsewhere is not listed: with `anthropic/*` sent to a gateway, the models Anthropic lists are left out, and `anthropic/*` is listed.

## Allowed models

`allowed_models` in the configuration file, or `ALLOWED_MODELS` as a JSON list, names the only model references a definition may give. `ALLOWED_MODELS` wins over the file. Without the setting, every model is allowed.

```yaml
allowed_models:
  - anthropic/*
  - gateway/llama-3.3-70b
  - house/fast
```

An entry is `provider/model`, or ends in a `*` that stands for any model id, as in an alias. The list applies in one place for two uses:

- A definition that names anything else is refused before any provider is called, as `unavailable` of the kind `model_not_offered` with `because: "model_not_allowed"`. Its detail names the model, never the allow list, and its plain words point to `list_models`.
- `list_models` shows only what the list allows, and says `narrowed: true`. Without the setting, it says `narrowed: false`.

Matching rules:

- An alias is allowed when its own name or its target is allowed.
- A target named directly is allowed only when it is allowed itself.
- A wildcard alias, or `<provider>/*`, is listed only when a wildcard allows every model it stands for.
- The [sentence the reasoning function guide ends with](#what-an-agent-is-told) names only the providers and aliases that a definition may use under the list.

These stop the start:

- an empty list;
- an entry that is not a reference, has an uppercase provider, a space or a control character, or is a Bedrock ARN;
- an entry listed twice;
- an entry that can match no configured provider and no alias, such as `There is no provider named mistral, nor an alias that mistral/large matches`.

## Declared models

`declared_models` in the [configuration file](../self-host/configuration.md), or `DECLARED_MODELS`, names the models to list for a provider that does not list its own, and for a gateway whose list cannot be read. `DECLARED_MODELS` wins over the file. Keys are provider prefixes:

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
  azure:
    - gpt-5-production
  gateway:
    - llama-3.3-70b
```

`DECLARED_MODELS='{"bedrock":["eu.anthropic.claude-sonnet-4-5-20250929-v1:0"],"azure":["gpt-5-production"]}'` says the same.

- The keys are `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` and the names of the gateways. `anthropic`, `openai` and `google` list their own models and cannot be keys.
- Each model id is written as the provider receives it: 1 to 256 characters, without spaces, control characters or a `*`, and once per provider.
- A Bedrock ARN is refused, because it names an account and a region. Give it an alias instead, which is listed by its own name with `alias: true` and without `resolved_to`, so the ARN is never shown.
- A broken rule stops the start with `model_settings_invalid`.

## Listing the models

`list_models` lists the models this server can call, so an agent names one that works instead of guessing. An agent with `org:read` calls it as an MCP tool, or as `GET /v1/orgs/{org}/models` over HTTP. Its optional input `provider` lists only what one provider prefix serves and asks no other provider.

[Model information](mcp.md#model-information) describes what it returns: its fields, `catalog_status: "partial"`, how long the server keeps each list, and what the result never carries (keys, endpoints, accounts, regions, Bedrock ARNs, prices and a provider's own owner). When a list cannot be read, the caller learns only that it is `partial`, and the operator learns why from the log. This section covers what you configure.

### Where each list comes from

Each list is read with the credentials and endpoint that the server calls the provider with, through the same `fetch`, so `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` apply.

| Provider                                                              | List                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic`                                                           | `GET <base URL>/models?limit=1000` and its next pages, with the key or token and `anthropic-version: 2023-06-01`. `display_name`, `created_at`, `max_input_tokens` and `max_tokens` give the details                                                                                                      |
| `openai`                                                              | `GET <base URL>/models` with the key. It leaves out the ids that, by OpenAI's naming, are not for a conversation: fine-tunes (`ft:`), embeddings, audio, speech and transcription, images, video, moderation, realtime, and the legacy completion models `babbage-002` and `davinci-002`                  |
| `google`                                                              | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` and its next pages, with the key in `x-goog-api-key`. It keeps the models whose `supportedGenerationMethods` include `generateContent`. `displayName`, `inputTokenLimit` and `outputTokenLimit` give the details              |
| A gateway                                                             | `GET <base_url>/models` with its key, headers and query parameters. An entry with a `type` other than `language`, which is how Vercel's gateway marks embedding and image models, is left out. When the list cannot be read and no earlier list is kept, the gateway's declared models are listed instead |
| `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` | The [declared models](#declared-models) of the provider, or `<provider>/*` when none are declared. Their own list APIs show a catalog rather than what the credential may call, and they need permissions of their own                                                                                    |

Limits on reading a list:

- Each page is read within 10 seconds and 8 MiB.
- A list of more than 10 pages is not read.

Which entries are kept:

- An entry without a text id is left out. So is an id that is empty, longer than 256 characters, holds a space, a control character or a `*`, or is a Bedrock ARN, the same rule declared models meet.
- A lookalike of another id, such as one with a Cyrillic letter, is kept, since a definition would have to write it that way.
- A detail of the wrong type, or null, counts as not reported. The entry is kept.
- A name longer than 100 characters, or on more than one line, is left out. The entry is kept.

Nothing is read when the server starts. A list is read when `list_models` first needs it, or when a run that calls tools needs its model's context window.

### What the operator's log says

When a provider responds to a list request with an error status, the server logs the warning of [Provider messages](#provider-messages) with `model` as `null`. The message is bounded, and the secrets of the settings are redacted, as for a model call.

When the list cannot be read for another reason, the server logs a warning such as `Model provider gateway could not be called: The list of models of gateway could not be read: it could not be reached`. The reasons are:

- `it could not be reached`;
- `it did not answer within 10 seconds`;
- `its TLS certificate is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS`;
- `its answer is not JSON`, `its answer is larger than 8 MiB`, `it has more than 10 pages of models` or `its answer is not a list of models`.

After a failed read, the server does not ask that provider again for a minute, so callers cannot make it press a provider that is failing or limiting its rate.

### What an agent is told

The reasoning function guide that `get_guide` serves ends with one sentence about this server, such as `On this server, a reasoning function names its model through anthropic and gateway, written anthropic/<model id> or gateway/<model id>; it may name the tools of the tool servers that search finds.`

- It names the configured providers that `allowed_models` lets a definition use.
- It names the aliases whose target provider is configured, with the references a wildcard alias accepts.
- With no provider configured, it says that no reasoning function can run until one is.
- It never names a provider's models; `list_models` does.

## When a model call fails

Each failure has a kind. You see it as the `error.type` of the metric `gen_ai.client.operation.duration` (see [Telemetry](../self-host/telemetry.md)). The caller of the reasoning function gets a rejection, which [How a run ends](reasoning-format.md#how-a-run-ends) lists. The tables below sort the model failures by who fixes them.

The operator fixes these:

| What went wrong                                                                                                                                                                              | Kind                      | Fix                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `allowed_models` does not allow the model. Nothing is sent                                                                                                                                   | `model_not_allowed`       | Allow the model, or name an offered one          |
| The provider is not configured, or no provider has that prefix                                                                                                                               | `provider_not_configured` | Configure the provider, or name a configured one |
| The provider's TLS certificate is not trusted, or its SDK found a setting missing                                                                                                            | `provider_not_configured` | Follow the [operator hint](#operator-hints)      |
| HTTP 401 or 403, an API key Google refuses with HTTP 400 and the reason `API_KEY_INVALID`, or no credential from the AWS chain, Google application default credentials or Microsoft Entra ID | `credentials_rejected`    | Fix the credentials or the role                  |

These pass, so a retry can work:

| What went wrong                                                                                 | Kind                   | Fix                        |
| ----------------------------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| HTTP 429                                                                                        | `rate_limited`         | Retry after the delay      |
| HTTP 408, 409 or 5xx (529 included), a failed connection, or a 2xx response that cannot be read | `provider_unavailable` | Retry later                |
| No response before the call's deadline (see [Retries](#retries))                                | `timed_out`            | Retry, or allow more time  |
| A JSON answer is not JSON, or does not match the output schema, when asked for once more too    | `output_invalid`       | Retry, or relax the schema |

The definition's author, or the caller, fixes these:

| What went wrong                                                                                                                                                                                                                                     | Kind                 | Fix                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| The provider refused the request: HTTP 400, 404, 422 or another 4xx not listed above or below                                                                                                                                                       | `definition_invalid` | Change the definition                                                                               |
| The provider's SDK refused a setting, a feature, the prompt or the model                                                                                                                                                                            | `definition_invalid` | Change the definition                                                                               |
| A provider option the gateway does not allow, or a namespace no configured provider reads. Nothing is sent                                                                                                                                          | `definition_invalid` | Change the definition, or allow the option in the gateway                                           |
| The request is too long: HTTP 413, the error code or type `context_length_exceeded`, `request_too_large` or `string_above_max_length`, or an error message that says `prompt is too long`, `maximum context length` or `ContextWindowExceededError` | `request_too_long`   | Shorten the prompt or the input, ask the tools for a page, or move each read into a lookup function |
| A JSON answer was cut off at `max_output_tokens`                                                                                                                                                                                                    | `output_invalid`     | Move out what the run called, or give each piece of work a function, or raise the limit             |
| The provider refused the content: a 4xx with the error code `content_filter` or `content_policy_violation`, or an answer stopped under its content policy                                                                                           | `content_refused`    | Change the input                                                                                    |

More rules:

- A text answer cut off at `max_output_tokens` is not a failure. It succeeds with `finish_reason: "length"`.
- A JSON answer whose schema the provider refuses with HTTP 400 or 422 is asked for once more with the schema in the instructions before the call fails: see [A schema the provider refuses](#a-schema-the-provider-refuses).
- When the caller goes away before the answer, the run is interrupted and recorded as `failed`. The kind is `cancelled`.
- A run that already called tools ends differently, as `tools_unfinished` or `effect_unknown` (see [Tools](reasoning-format.md#tools)).
- A failure the runtime does not recognize is a defect. Its error names only the provider and the kind of error, and the metric records it as `unclassified`.

### Match a caller's message to its kind

A caller who reports a failure quotes its detail. These are the details the model failures give, beyond what [How a run ends](reasoning-format.md#how-a-run-ends) says:

- `provider_not_configured` gives `unavailable`. When other providers are configured, its kind is `model_not_offered`, with `because: "provider_not_configured"`. Its detail is described in [When a provider is not configured](#when-a-provider-is-not-configured).
- A TLS certificate that is not trusted, or a setting the provider's SDK found missing, gives `unavailable`, saying that the operator must act.
- `credentials_rejected` gives `unavailable`, with the HTTP status when there was one. It reads like `openai rejected the credentials (HTTP 401)`, or `No credentials could be obtained for bedrock from its credential source`.
- `rate_limited` says how many seconds to wait, or to try later. `provider_unavailable` and `timed_out` say to try again later.
- `output_invalid` for an answer that does not match its schema gives up to 5 issues and says to try again. After the [one correction](#an-answer-that-misses-its-schema), it says `after one correction`; when the run had no room for it, it says `no correction was attempted` and why. For a JSON answer cut off at `max_output_tokens`, it is `conflict` of the kind `unworkable`, saying what to move out of the function by what the run called, then to raise `config.max_output_tokens`: where it called no tool, to give each piece of work an answer holds a function of its own; where it called tools that only read, to move each read the job always makes into a lookup function and hand the function what it read; and where it called a tool that may act, to move each call the job always makes out, a read into a lookup function and an act into an interaction function. It names no tool. A request too long after the run's tools answered says too to move each read into a lookup function, whose `read` keeps only the part the job needs.
- `definition_invalid` and `request_too_long` give `conflict` of the kind `unworkable`. A refused request names the provider, the HTTP status and what it means: the model was not found (404), the request was rejected as invalid (400 and 422), or the request was not accepted. It adds the error code the body carries, cut at 64 characters, and ends with `update the reasoning function definition`. For example: `gateway answered HTTP 404: the model was not found; update the reasoning function definition`. A refused provider option names the option. A JSON answer whose schema the provider refused, and whose request the provider refused again with the schema in the instructions, says instead that the schema was not the cause: `gateway refused the request (HTTP 400): the request was rejected as invalid. The answer schema was not the cause; check the model's settings in the definition, such as temperature or reasoning, or choose another model`. When too little time was left to ask again, the rejection is `unavailable`, saying so and to try again.
- `request_too_long` names the signal, such as `HTTP 413`, or `its error message` where only the words said so, and says to shorten the prompt or the input. When the run's tools returned results, it says instead how many bytes they returned, and to ask them for a page.
- `content_refused` gives `invalid_input` at `/input`: `The model refused this input under its content policy`.
- `model_not_allowed` names the model, never the list: `house/slow is not one of the models this server offers`.
- No detail quotes the prompt or the answer. Only a refused request (`definition_invalid` and `request_too_long`) can carry the provider's own words, under the rules of [Provider messages](#provider-messages).

### When a provider is not configured

The caller's detail names the providers that are configured:

```text
openai is not configured. Configured providers: anthropic, bedrock, bedrock-anthropic
```

- A prefix that nobody configures, such as `mistral`, starts with `There is no provider named mistral`.
- With no provider configured, the detail says `No model provider is configured`.
- When any alias is set, the detail names the aliases after the providers, so the caller sees every reference that works: `openai is not configured. Configured providers: gateway. Aliases: anthropic/*`.
- The detail never names a missing setting. The [start-up line](../self-host/models.md#check-the-start-up-line) does.

### Retries

- A model call that fails with HTTP 408, 409, 429 or 5xx, or cannot connect, is tried up to twice more.
- The server waits 2 seconds before the second attempt and 4 seconds before the third. When the provider's `retry-after` asks for less than a minute, the server waits that long instead.
- An untrusted certificate is never retried.
- The call's deadline covers every attempt. It is 60 seconds plus 25 ms for every token of `max_output_tokens`: 85.6 seconds for the default 1,024.
- Every run of a reasoning function retries this way, including runs that a workflow starts. A workflow's own retry policy runs the whole function again on top of that.

### Provider messages

A provider's error message is free text. Through a gateway, or through a base URL you chose, it is your infrastructure's text: it can name upstream providers, fallback chains or internal hosts. So the message reaches the caller only when the call went to a built-in provider at its default endpoint:

- `anthropic` without `ANTHROPIC_BASE_URL`;
- `openai` without `OPENAI_BASE_URL`;
- `google`;
- `bedrock` and `bedrock-anthropic` without an endpoint override;
- `azure` addressed by `AZURE_RESOURCE_NAME`;
- `vertex` and `vertex-anthropic`.

Even then, the caller gets only the first line, at most 300 characters, after `The provider said:`. The caller gets nothing when that line is empty, quotes the raw response body, or is itself a JSON, HTML or XML document.

For a gateway, and for a built-in provider at an overridden endpoint, the caller gets only structured facts: the provider prefix, the HTTP status, what the status means, and the error code the body carries, cut at 64 characters. A gateway whose messages are safe to show opts in with `expose_provider_messages: true` in its entry.

The operator always gets the message. For every call that a provider responded to with an error, the server logs a warning:

```json
{
  "message": "Model provider gateway answered with an error",
  "level": "WARN",
  "annotations": {
    "provider": "gateway",
    "model": "gateway/no-such-model-xyz",
    "status": 404,
    "run_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
    "provider_message": "The model no-such-model-xyz does not exist on any upstream"
  }
}
```

- `model` is the model as the definition names it, or `null` for a list of models.
- `status` is `null` when there was no response.
- `provider_message` is at most 2,000 characters and never holds the request body.
- `run_id` is the id of the run that made the call.

Providers sometimes echo what they were sent. So in what the caller and the operator get, the server replaces each of these with `[redacted]` when it is at least 8 characters long: the secrets of the model settings, which are API keys, tokens, and the keys, headers and query parameters of gateways. It replaces the instructions and each message of the prompt with `[prompt]`, under the same length rule. A quote of only part of the prompt stays in the message.

### Operator hints

A failure that only the operator can fix tells the caller what happened and that the operator must act. It never names a setting. What to set goes to the operator, as a warning log:

```json
{
  "message": "Model provider gateway could not be called: The TLS certificate of gateway is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS",
  "level": "WARN",
  "annotations": {
    "provider": "gateway",
    "model": "gateway/llama-3.3-70b",
    "run_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"
  }
}
```

The server logs a hint for a provider certificate it does not trust, and for a setting that the provider's SDK found missing when it called the provider, in the SDK's words.

## Voice model

`voice_model` in the [configuration file](../self-host/configuration.md), or `VOICE_MODEL`, names the model that writes out what a person says, which Studio offers beside each comment field through [`transcribe`](http.md#voice). Left unset, the runtime has no voice model: `get_voice` answers `null`, and `transcribe` is refused as `unavailable`.

It is a model reference, `provider/model`, split at its first `/` as a definition's is. Its provider is one of two:

| Provider                 | The call                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gateway entry's `name` | `POST` to the entry's `base_url` followed by `/audio/transcriptions`, with the entry's `api_key`, `headers` and `query_params`, as its model calls are sent   |
| `openai`                 | `POST` to `OPENAI_BASE_URL`, `https://api.openai.com/v1` unless it is set, followed by `/audio/transcriptions`, with `OPENAI_API_KEY`: OpenAI's Whisper route |

Both take the multipart body of OpenAI's transcription route: `file`, the recording with its media type, named `recording.webm`, `recording.ogg`, `recording.mp4` or `recording.wav` by its type, and `model`, everything after the first `/` of the reference. The runtime reads `text` from the JSON answer. A gateway entry serves the voice model only where its gateway serves that route.

- Any other provider, a value that is not `provider/model`, or `openai` without `OPENAI_API_KEY`, stops the start with `model_settings_invalid`, which names the setting and what it expects: `The model settings are invalid. VOICE_MODEL: Expected openai/<model> or <gateway>/<model> for a gateway of model_gateways`.
- Aliases and `allowed_models` do not apply to it: they govern the models a definition names, and the voice model is named by the operator alone.
- A call is tried again as a model call is ([Retries](#retries)), within 60 seconds for every attempt.
- A failure is sorted into the kinds of [When a model call fails](#when-a-model-call-fails), and the caller of `transcribe` gets what the caller of a reasoning function gets for it: the provider's own words only under the rules of [Provider messages](#provider-messages), so a gateway's only where its entry sets `expose_provider_messages`.
- Each call that reaches the model records one fact on the organization's ledger: `voice_transcribed` when the model answered, and `voice_refused`, with the failure's kind, when it did not ([Voice](http.md#voice)). The entry's `cost_header` fills the `cost_usd` of `voice_transcribed`, which is `null` where the entry names no header or the gateway answers none. The recording and its text are never recorded. A transcription is not a run, so it starts no run and the runtime's meter counts nothing for it.

## What is recorded, and what is never logged

A run records what its model call did: the model as requested, as resolved and as the provider reported it, why the answer ended, the token usage, the provider's response id and warnings, and the duration. [What a run records](reasoning-format.md#what-a-run-records) lists the fields.

The server never logs or returns:

- the request or response bodies of a model call, or anything from an earlier attempt, since they hold the prompt or the answer, and the recording or the text of a transcription;
- the text of an answer that failed to parse or validate;
- an API key, token or secret header. Settings keep secrets redacted, and a settings error names the setting, never its value.

About models, the server logs only the lines this page and [Set up a model provider](../self-host/models.md#check-the-start-up-line) show: the start-up lines, provider messages and operator hints. A provider's warnings go to the run's `warnings`, not to the log. With telemetry on, the spans of model calls carry prompts and answers only when `TELEMETRY_CONTENT=true` (see [Telemetry](../self-host/telemetry.md#what-is-recorded)).

## Answers that are JSON

When a definition asks for JSON, the runtime validates the answer against the output schema as written, whatever the provider enforced. An answer that does not match fails as `output_invalid`. The rules a schema must meet, the limits on schemas and answers, and the subset every provider accepts are in [Answers that are JSON](reasoning-format.md#answers-that-are-json) of the reasoning function format.

The runtime sends the provider [the portable form of the schema](#the-portable-form-of-a-schema), one form for every provider, and each provider is asked for JSON in its own way:

| Provider           | How JSON is asked for                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Anthropic models   | `output_config.format` for models with native structured output; a forced `json` tool for older ones       |
| `openai`, `azure`  | A strict `json_schema` format                                                                              |
| `google`, `vertex` | `responseJsonSchema`                                                                                       |
| `bedrock`          | Native structured output for the Anthropic models that support it; a forced `json` tool otherwise          |
| A gateway          | `response_format`: `json_schema` with `structured_outputs: true`; the schema in the instructions otherwise |

A schema that is not portable is told to the model in the instructions on every route, as through [a gateway without structured outputs](#a-gateway-without-structured-outputs). Which way a call takes is worked out for each call from the route and the schema, never from the model's name, so choosing another model needs no change to the definition. [Check your models](../self-host/models.md#check-your-models) tells which of your models take the portable form.

### The portable form of a schema

The portable form is the output schema rewritten into the part of JSON Schema that OpenAI, Anthropic, Gemini and xAI models all accept under strict structured outputs. The answer is read back into the schema as written before it is validated, so the caller gets the answer in the form the definition wrote, and the run keeps the answer as the model wrote it.

| The schema as written has                                                                                                                                                                 | The portable form sends                                                                        | The answer is read back                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| An optional property                                                                                                                                                                      | A required property that may also be `null`                                                    | `null` is left out                               |
| An optional property that allows `null` itself                                                                                                                                            | A required property, as it is                                                                  | `null` stays `null`                              |
| A `$ref` with a description or a bound beside it                                                                                                                                          | The definition, in its place, with the words added                                             | As written                                       |
| An object that is not closed                                                                                                                                                              | A closed object: the model cannot add keys the schema allows                                   | As written                                       |
| `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties` or `format` | The rule in words in the description, such as `Must be at most 64 characters long.`            | Checked by the runtime                           |
| `oneOf`                                                                                                                                                                                   | `anyOf`                                                                                        | The first choice that fits, checked to fit alone |
| A map: `additionalProperties` with a schema and no `properties`                                                                                                                           | A list of entries, each a `key` and a `value`, with the `enum` of its `propertyNames` on `key` | A map again; a key given twice is an issue       |
| A root that is not one object                                                                                                                                                             | An object with the root as its `value`                                                         | Unwrapped                                        |
| `title`, `default`, `examples`, `$comment` and keywords the runtime does not check                                                                                                        | Nothing                                                                                        | Not needed                                       |

- No provider enforces a bound or a format while the model writes, since the same form goes to every provider. The runtime checks them, and an answer outside one is [asked for once more](#an-answer-that-misses-its-schema).
- A property that is both optional and allows `null` may come back as `null` where the model could have left it out. Both answers match the schema.
- A schema is not portable, and its answers are asked for with the schema in the instructions, when it has a value of any type, an object of any keys or a list of items of any type, `required` names with no schema in `properties`, `allOf`, `not` or `prefixItems`, a `oneOf` or `anyOf` beside other keywords than a description, bounds and a type its choices share, `minProperties` or `maxProperties` beside optional properties that allow `null`, an `enum` that mixes kinds of value, such as a string and a number, keywords beside a `$ref` other than a description and bounds, a definition that refers to itself, rules for the keys of a map that cannot be put into words, or definitions under both `$defs` and `definitions`.
- A schema is not portable either when its portable form is larger than the strictest provider takes, counted with each definition repeated where it is used: more than 16 properties that may be `null` or are a choice of types, more than 10 levels of objects, 5,000 properties, 1,000 `enum` values, or 120,000 characters of property names and `enum` values.
- Before a portable form is used, the runtime checks that it keeps to the subset, and that an answer the schema accepts, written in the portable form, matches it and reads back to an answer the schema accepts. A schema for which the runtime cannot make such an answer, such as one whose bounds contradict each other, is not portable.
- The call's `model_call_answered`, or its `model_call_failed` for an answer that could not be used, records `output_mode: portable` ([The run's model calls](reasoning-format.md#the-run-s-model-calls)). A run that started before the upgrade and resumes after it reads its earlier answers as they were written.

### A gateway without structured outputs

A model call through a gateway entry without `structured_outputs: true` that asks for JSON sends no `response_format`. The runtime adds to the instructions of the call, after the definition's own, `Answer with only a JSON value that matches this JSON Schema, and no other text. Leave out a property that is not required when you have no value for it.` and the schema as JSON, the shape's schema for an `output.shape`.

- The answer is read as the model sent it, or from inside exactly one Markdown code fence that is the whole answer, such as one opened with ` ```json `, and in no other way. An answer in prose, or with prose around its fence, fails as `output_invalid` with `The answer is not JSON`.
- Values are never changed to fit the schema: the answer is validated as written, and one that does not match fails as `output_invalid` with its issues.
- The schema is sent with every model call of the run, so it counts toward the input tokens of each.
- The call's `model_call_answered`, or its `model_call_failed` for an answer that could not be used, records `output_mode: described` ([The run's model calls](reasoning-format.md#the-run-s-model-calls)).
- A schema that is [not portable](#the-portable-form-of-a-schema) is asked for in the same way on every route.

### An answer that misses its schema

A JSON answer that is not JSON, or does not match the output schema or the rules of its shape, is asked for once more, whichever way the schema was given to the provider:

- The second request is the first, followed by the model's answer and, from the user, `Your answer does not meet these rules of the answer's schema:`, up to 5 of the issues, each at its pointer in the JSON the model wrote, and `Answer again in full, following every rule.` For an answer in [the portable form](#the-portable-form-of-a-schema), that pointer is in the portable form, such as `/value/1/value` for the entry `alice` of a map at the root, while the issues the call records and fails with are placed in the schema as written, such as `/alice`. For an answer that is not JSON, it says so instead. Nothing else changes: the request offers the run's tools, with their earlier calls and results, the schema and every setting as the first did, so a provider that took the first request takes the second.
- The second answer is used when it matches. Otherwise the call fails as `output_invalid` with its issues, and no third request is made. A second answer that calls a tool instead is not JSON.
- When the second request itself fails, such as with HTTP 500 or past the call's deadline, the call fails as `output_invalid` with the first answer, its issues, `usage` and `cost_usd`, saying the request for a correction failed and how.
- An answer cut off at `max_output_tokens`, an empty answer, an answer stopped under the provider's content policy and a refusal are not asked for again. A refusal, an OpenAI-compatible answer whose message has a `refusal`, fails as `content_refused`.
- The second request is not made when the run has too little room left for it: when its input, the first request's with the answer and the issues added, would pass the input tokens the run has left or the model's context window, or when less time is left before the call's deadline or the run's bound than the first answer took. The call then fails with the first answer's issues, saying no correction was attempted and why.
- The call's `usage`, `cost_usd`, `duration_ms` and `request_bytes` are those of both requests. Its `model_call_answered` or `model_call_failed` records `repair`: the `outcome` (`repaired`, `invalid`, `failed` or `skipped`), and the first answer's `issues` with the second request's `usage`, `cost_usd` and `duration_ms`, or with `because`, how the second request failed, such as `provider_unavailable` or `timed_out`, and its `duration_ms`, or only `because` (`input_tokens`, `context_window` or `time`) when it was skipped ([The run's model calls](reasoning-format.md#the-run-s-model-calls)).
- The metric `auto.on.json_answers` counts the final answer of every model call that asks for JSON, by provider, model and output mode: `valid`, `valid_after_repair`, `invalid`, `repair_skipped`, `repair_failed`, or `refused` for an answer the provider stopped or the model refused. A call that asked for tools, or that failed before any answer, is not counted (see [Telemetry](../self-host/telemetry.md#metrics)).

### A schema the provider refuses

A JSON answer whose schema is sent to the provider in [the portable form](#the-portable-form-of-a-schema), as every way in the table above sends a portable schema except a gateway without `structured_outputs: true`, is asked for once more when the provider refuses the request with HTTP 400 or 422 for its schema:

- The second request is the first, sent as through [a gateway without structured outputs](#a-gateway-without-structured-outputs): no response format, the schema in the instructions, and the answer read in the same way. It covers what no setting can know ahead, such as a limit a provider does not publish on the schemas it compiles.
- A refusal is for the schema when it points at it: OpenAI's error code `invalid_json_schema`, or an error `param` that starts with `response_format` or `text.format`; or, where the provider gives no such code, an error message that speaks of `response_format`, `json_schema`, `output_format`, `output_config`, structured output or a schema, as Anthropic's and a gateway's do. Gemini's `Request contains an invalid argument.`, which names no argument, counts too: it is how Gemini refuses a schema too large to compile.
- HTTP 401, 403, 404, 429 and 5xx are not asked again, nor a 400 or 422 for anything else: a request too long, an API key the provider refuses, content it refuses, a model it does not serve, or a setting such as `temperature`. They fail as [When a model call fails](#when-a-model-call-fails) says.
- The second request is not made when less time is left before the call's deadline or the run's bound than the refused request took. The call fails as `definition_invalid`, and the rejection is `unavailable`: `gateway refused the request (HTTP 400): the request was rejected as invalid; too little time was left to ask again with the answer schema in the instructions; try again`.
- When the second request is answered, the run sees no error. An answer that misses its schema is [asked for once more](#an-answer-that-misses-its-schema), as any is, so a call asks at most three times: the refused request, the described one and its correction. The provider's SDK sends each of them again on HTTP 408, 409, 429 or 5xx, as it does any request (see [Retries](#retries)), so a call can make more HTTP requests than that.
- When the provider refuses the second request too, with HTTP 400 or 422, the schema was not the cause. The call fails as `definition_invalid`, and the rejection says: `gateway refused the request (HTTP 400): the request was rejected as invalid. The answer schema was not the cause; check the model's settings in the definition, such as temperature or reasoning, or choose another model`. A second request that fails another way, such as with HTTP 429 or past the call's deadline, fails the call as that request did.
- The call's `model_call_answered`, or its `model_call_failed`, records `schema_refusal`: its `outcome`, `described`, `refused_again`, or `skipped` with `because: time`, and the refused request's `status` and `duration_ms` ([The run's model calls](reasoning-format.md#the-run-s-model-calls)). An answer to the second request, whether it could be used or not, also records `output_mode: described`, as through a gateway without structured outputs.
- The call's `usage`, `cost_usd` and `request_bytes` are those of the requests the model answered, since a refused request reports no usage. Its `duration_ms` includes the refused request.
- The provider's words for both requests go to the operator, under the rules of [Provider messages](#provider-messages).
- The metric `auto.on.json_answers` counts each refusal as `schema_refused`, with no output mode, beside the outcome of the answer asked for in the instructions. A refusal the provider repeats for the described request is not counted, since the schema was not the cause.
