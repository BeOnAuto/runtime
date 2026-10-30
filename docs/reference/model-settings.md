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

| Field                      | Required | Meaning                                                                                                                                                                                                               |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Yes      | The provider prefix: 1 to 32 lowercase letters, digits and hyphens, starting with a letter. It is unique and is not one of the built-in prefixes                                                                      |
| `base_url`                 | Yes      | The http or https URL that `/chat/completions` is appended to. Trailing slashes are dropped                                                                                                                           |
| `api_key`                  | No       | The key, sent as `Authorization: Bearer <key>`. In the file, it is a reference to the variable that holds it, such as `${INTERNAL_LLM_KEY}`                                                                           |
| `api_key_env`              | No       | In `MODEL_GATEWAYS` only, in place of `api_key`: the name of the variable that holds the key. That variable must be set. Setting both `api_key` and `api_key_env` stops the start                                     |
| `headers`                  | No       | Headers sent with every request. Their values are treated as secrets. In the file, a header that carries a credential, such as `authorization`, is a reference                                                        |
| `query_params`             | No       | Query parameters added to every request. Their values are treated as secrets                                                                                                                                          |
| `structured_outputs`       | No       | `true` when the endpoint accepts `response_format: json_schema`. Otherwise JSON is asked for as `json_object`, and only the runtime checks the schema. Default `false`                                                |
| `include_usage`            | No       | Asks for usage in streamed responses. Default `false`                                                                                                                                                                 |
| `expose_provider_messages` | No       | `true` when the gateway's error messages are safe to show to the callers of a definition. Default `false`: see [Provider messages](#provider-messages)                                                                |
| `allowed_provider_options` | No       | The top-level request body fields a definition may set for this gateway through `provider_options`, such as `["user", "metadata"]`. Default none; see [Provider options](reasoning-format.md#provider-options)        |
| `cost_header`              | No       | A gateway entry names the header its gateway answers the call's cost in, in US dollars, or names none and no cost is kept. A run keeps the cost as `cost_usd` in its [record](reasoning-format.md#what-a-run-records) |

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

| What went wrong                                                                                                    | Kind                      | Fix                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------ |
| `allowed_models` does not allow the model. Nothing is sent                                                         | `model_not_allowed`       | Allow the model, or name an offered one          |
| The provider is not configured, or no provider has that prefix                                                     | `provider_not_configured` | Configure the provider, or name a configured one |
| The provider's TLS certificate is not trusted, or its SDK found a setting missing                                  | `provider_not_configured` | Follow the [operator hint](#operator-hints)      |
| HTTP 401 or 403, or no credential from the AWS chain, Google application default credentials or Microsoft Entra ID | `credentials_rejected`    | Fix the credentials or the role                  |

These pass, so a retry can work:

| What went wrong                                                                                 | Kind                   | Fix                        |
| ----------------------------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| HTTP 429                                                                                        | `rate_limited`         | Retry after the delay      |
| HTTP 408, 409 or 5xx (529 included), a failed connection, or a 2xx response that cannot be read | `provider_unavailable` | Retry later                |
| No response before the call's deadline (see [Retries](#retries))                                | `timed_out`            | Retry, or allow more time  |
| A JSON answer is not JSON, or does not match the output schema                                  | `output_invalid`       | Retry, or relax the schema |

The definition's author, or the caller, fixes these:

| What went wrong                                                                                                                                           | Kind                 | Fix                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| The provider refused the request: HTTP 400, 404, 422 or another 4xx not listed above or below                                                             | `definition_invalid` | Change the definition                                        |
| The provider's SDK refused a setting, a feature, the prompt or the model                                                                                  | `definition_invalid` | Change the definition                                        |
| A provider option the gateway does not allow, or a namespace no configured provider reads. Nothing is sent                                                | `definition_invalid` | Change the definition, or allow the option in the gateway    |
| The request is too long: HTTP 413, or the error code or type `context_length_exceeded` or `request_too_large`                                             | `request_too_long`   | Shorten the prompt or the input, or ask the tools for a page |
| A JSON answer was cut off at `max_output_tokens`                                                                                                          | `output_invalid`     | Raise the limit                                              |
| The provider refused the content: a 4xx with the error code `content_filter` or `content_policy_violation`, or an answer stopped under its content policy | `content_refused`    | Change the input                                             |

More rules:

- A text answer cut off at `max_output_tokens` is not a failure. It succeeds with `finish_reason: "length"`.
- When the caller goes away before the answer, the run is interrupted and recorded as `failed`. The kind is `cancelled`.
- A run that already called tools ends differently, as `tools_unfinished` or `effect_unknown` (see [Tools](reasoning-format.md#tools)).
- A failure the runtime does not recognize is a defect. Its error names only the provider and the kind of error, and the metric records it as `unclassified`.

### Match a caller's message to its kind

A caller who reports a failure quotes its detail. These are the details the model failures give, beyond what [How a run ends](reasoning-format.md#how-a-run-ends) says:

- `provider_not_configured` gives `unavailable`. When other providers are configured, its kind is `model_not_offered`, with `because: "provider_not_configured"`. Its detail is described in [When a provider is not configured](#when-a-provider-is-not-configured).
- A TLS certificate that is not trusted, or a setting the provider's SDK found missing, gives `unavailable`, saying that the operator must act.
- `credentials_rejected` gives `unavailable`, with the HTTP status when there was one. It reads like `openai rejected the credentials (HTTP 401)`, or `No credentials could be obtained for bedrock from its credential source`.
- `rate_limited` says how many seconds to wait, or to try later. `provider_unavailable` and `timed_out` say to try again later.
- `output_invalid` for an answer that does not match its schema gives up to 5 issues and says to try again. For a JSON answer cut off at `max_output_tokens`, it is `conflict` of the kind `unworkable`, saying to raise `config.max_output_tokens`.
- `definition_invalid` and `request_too_long` give `conflict` of the kind `unworkable`. A refused request names the provider, the HTTP status and what it means: the model was not found (404), the request was rejected as invalid (400 and 422), or the request was not accepted. It adds the error code the body carries, cut at 64 characters, and ends with `update the reasoning function definition`. For example: `gateway answered HTTP 404: the model was not found; update the reasoning function definition`. A refused provider option names the option.
- `request_too_long` names the signal, such as `HTTP 413`, and says to shorten the prompt or the input. When the run's tools returned results, it says instead how many bytes they returned, and to ask them for a page.
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

## What is recorded, and what is never logged

A run records what its model call did: the model as requested, as resolved and as the provider reported it, why the answer ended, the token usage, the provider's response id and warnings, and the duration. [What a run records](reasoning-format.md#what-a-run-records) lists the fields.

The server never logs or returns:

- the request or response bodies of a model call, or anything from an earlier attempt, since they hold the prompt or the answer;
- the text of an answer that failed to parse or validate;
- an API key, token or secret header. Settings keep secrets redacted, and a settings error names the setting, never its value.

About models, the server logs only the lines this page and [Set up a model provider](../self-host/models.md#check-the-start-up-line) show: the start-up lines, provider messages and operator hints. A provider's warnings go to the run's `warnings`, not to the log. With telemetry on, the spans of model calls carry prompts and answers only when `TELEMETRY_CONTENT=true` (see [Telemetry](../self-host/telemetry.md#what-is-recorded)).

## Answers that are JSON

When a definition asks for JSON, the runtime validates the answer against the output schema as written, whatever the provider enforced. An answer that does not match fails as `output_invalid`. The rules a schema must meet, the limits on schemas and answers, and the subset every provider accepts are in [Answers that are JSON](reasoning-format.md#answers-that-are-json) of the reasoning function format.

Each provider is asked for JSON in its own way:

| Provider           | How JSON is asked for                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Anthropic models   | `output_config.format` for models with native structured output; a forced `json` tool for older ones |
| `openai`, `azure`  | A strict `json_schema` format                                                                        |
| `google`, `vertex` | `responseJsonSchema`                                                                                 |
| `bedrock`          | Native structured output for the Anthropic models that support it; a forced `json` tool otherwise    |
| A gateway          | `response_format`: `json_schema` with `structured_outputs: true`, `json_object` otherwise            |
