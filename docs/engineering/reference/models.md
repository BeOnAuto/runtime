# Model access

This repository-only page describes the library behind [Set up a model provider](../../self-host/models.md) and the [model settings reference](../../reference/model-settings.md): the model access of `@on.auto/reasoning` (`capabilities/reasoning`) and how the server wires it. The public page holds the operator's and the caller's view, the settings, log lines and rejections. This page holds the function names, callback signatures, failure objects and SDK behavior that contributors need. Keep both accurate when the behavior changes.

## Building model access

`readModelSettings(environment)` reads every model setting from an environment record with Effect `Config` (`src/settings/model-settings.ts`). It fails with `ModelSettingsInvalid`, tagged `model_settings_invalid`, whose `message` is `The model settings are invalid. ` followed by each `SETTING: detail`, and whose `problems` list `{ setting, detail }`. No problem repeats a value.

`makeModelAccess(settings, options)` (`src/providers/model-access.ts`) builds everything else and returns:

| Field           | What it is                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languageModel` | The `LanguageModel` service: `admit(request)` and `generate(request)`                                                                                   |
| `status`        | The `ProviderStatus`: `configured`, the configured prefixes, and `unconfigured`, each `{ provider, missing, partial? }`                                 |
| `offered`       | The `OfferedModels`: the providers and aliases a definition may use, which the reasoning function guide's last sentence names (`onThisServer`)          |
| `catalog`       | The `ModelCatalog`: `list(provider?)`, which `list_models` answers with, and `contextWindowOf(model)`, which a run that calls tools reads its window by |

`status.unconfigured` holds every built-in provider that is not configured, with the names of the settings it lacks. `partial: true` marks one that has some of its settings, which the server logs as a warning of its own. Azure configured without `AZURE_API_KEY`, where `@azure/identity` cannot be loaded, is unconfigured and partial, with `missing` naming `AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID`.

The options of `makeModelAccess` (`ModelAccessOptions`, `src/providers/model-access-options.ts`) are all optional:

| Option                  | What it injects                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`                 | The `fetch` every provider and every list of models uses; `globalThis.fetch` by default. Tests pass a recording fake                                                      |
| `credentials`           | Credential sources: `aws` (a function that resolves AWS credentials), `google` and `azure` (functions that resolve an access token). Per-tenant credentials will use them |
| `proxy`                 | The `ProxySettings` of `@on.auto/outbound`, `{ enabled, environment }`; off by default                                                                                    |
| `loadEntraIdentity`     | How `@azure/identity` is loaded; by default a dynamic import that answers `undefined` when the module is missing                                                          |
| `reportProviderMessage` | `(report: ProviderMessageReport) => Effect<void>`; see [Reports](#reports)                                                                                                |
| `reportOperatorHint`    | `(report: OperatorHintReport) => Effect<void>`; see [Reports](#reports)                                                                                                   |
| `telemetry`             | `{ integrations, recordContent }`: the AI SDK telemetry integrations, and whether they record inputs and outputs                                                          |

The server builds it in `packages/server/src/composition/served-reasoning.ts` (`loggedModelAccess`), logs `status` with `logModelProviders`, and hands `languageModel`, `offered` and `catalog.contextWindowOf` to `makeReasoningFunctionAdapter`.

## Reports

Neither the language model nor the catalog logs anything. They report through the two callbacks, which the server sets to `logProviderMessage` and `logOperatorHint` of `packages/server/src/logging/provider-logging.ts`.

`ProviderMessageReport` is `{ provider, model, status, message, run_id }`:

- `model` is the reference as the request names it, or `null` for a list of models;
- `status` is the HTTP status, or `null` when there was no response;
- `message` is the provider's message, scrubbed and cut at 2,000 characters, never the request body;
- `run_id` is the request's `run_id`, or `null`. Only the reports read it; the reasoning function adapter sets it to the run's id.

A model call reports a message for every `APICallError` whose message is not empty. A list of models reports one for every answer with an error status, reading at most 64 KiB of its body: `The answer was larger than 64 KiB` or `The answer had no message` stand in where the body gives nothing usable.

`OperatorHintReport` is `{ provider, model, hint, run_id }`. A call reports a hint for an untrusted certificate and for the AI SDK's `LoadAPIKeyError` and `LoadSettingError`, in the SDK's words, scrubbed and cut at 2,000 characters (`operatorHintOf` in `src/model-calls/failure-classification.ts`). A list of models reports `The list of models of <provider> could not be read: <reason>` for every failure that is not an error status.

## `list_models`

`defineListModels(catalog)` (`src/catalog/list-models.ts`) defines `list_models` as an org query with `defineQuery('org', ...)`: route `GET /models`, `reachesOutside: true`, the input `{ provider? }` checked against `^[a-z][a-z0-9-]{0,31}$`, and the output `ModelListSchema` of `src/catalog/model-list.ts`. Its handler is `catalog.list(provider)`. Its plain words come from `modelsListed` in `src/catalog/catalog-words.ts`.

### The catalog

`modelCatalogOf` (`src/catalog/model-catalog.ts`) combines the sources of `modelSources` (`src/listing/model-sources.ts`): a listed source for each configured `anthropic`, `openai` and `google` and for each gateway, whose fallback is the gateway's declared models, and a declared source for each configured provider that does not list its own.

`listingCache` (`src/catalog/listing-cache.ts`) keeps each list, keyed by the provider:

- a list read less than 5 minutes ago (`freshForMs`) is served as it is. Five minutes is the interval the AI SDK's gateway provider keeps its own list for;
- calls that arrive while a list is read share that read through one promise;
- a failed read is remembered for a minute (`failureKeptForMs`); within it, the last list is served as not current and the provider is not asked;
- a catalog belongs to one model access, whose settings never change, so a list read with one credential is never served for another.

`catalogListing` (`src/catalog/catalog-listing.ts`) builds the answer: alias entries, each `alias: true` and the only entries that carry it, offered under the allow list and whose target provider is configured, then the listed and declared entries that resolve to themselves through the aliases and are offered, deduplicated by `id` and sorted. `catalog_status` is `complete` only when every source answered from a current list; `narrowed` is `true` when `allowed`, the allow list of the settings, is not `null`; `listed_at` is the oldest `listedAt`, or now when none was read.

### Reading a list

`src/listing/listing-request.ts` reads each page through the injected `fetch`, wrapped by `withCertificateFailures`, with a 10-second `AbortSignal.timeout` joined to the call's signal. It reads the body as a stream, counting bytes in one pass however small the chunks, and stops at 8 MiB for a list and 64 KiB for an error. `everyPage` follows the provider's cursor for at most 10 pages. `wellFormedEntries` decodes each entry on its own, so an entry of an unexpected shape does not cost the others. `listedModel` (`src/listing/listed-model.ts`) keeps a `created` that is a positive finite number, a `context_window` and `max_tokens` that are positive safe integers, and a trimmed `name` of at most 100 characters on one line.

### Plain words

`modelsListed` names at most 20 models, then `<n> more`. A model is named by the name its provider gives, else by the last part of its id. A name two providers share gets the provider in parentheses; a name that is still repeated is replaced by the last part of the id. Wildcard entries follow as `any <provider> model`, or `any <provider> model starting with <start>`. A `narrowed` answer then says `It lists only the models its operator allows.` A `partial` answer ends with `The list may be incomplete: a provider could not be asked just now.` An empty answer says `This server has no model it can call`, with `through <provider>` when a provider was chosen.

## Requests and failures

A `ModelRequest` (`src/model/model-request.ts`) has `model`, optional `instructions`, `messages`, `output`, `settings`, optional `provider_options`, `timeout_ms`, `signal`, `retries`, `run_id` and, for a run that calls tools, `tools`. `requestIssues(request)` (`src/model/request-checks.ts`) gives the problems that make `generate` fail as `definition_invalid` with the detail `The request is not valid` before any provider is called:

- no messages;
- `max_output_tokens` not an integer of 1 or more;
- `temperature` or `top_p` not finite;
- `seed` not an integer of 0 or more;
- `timeout_ms` not an integer of 1 or more.

`admit(request)` runs those checks, resolves the model (`modelResolution` in `src/model/model-resolution.ts`) and checks the provider options against the gateways (`gatewayOptionsCheck`), all without calling a provider. `generate` does the same and then calls the provider.

### Failure objects

Every failure is an Effect `Data.TaggedError` in `src/failure`. Each has a `_tag`, a `detail` safe to show the caller, and the `provider` prefix, `null` when none was resolved. The reasoning function adapter turns each into the rejection the public page lists (`rejections` in `src/capability/model-rejection.ts`).

| `_tag`                    | Also carries                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definition_invalid`      | `status`; `issues`, each `{ pointer, detail }` with a JSON pointer into the request; `provider_message`, the first line of the provider's message, scrubbed and cut at 300 characters, only where [Provider messages](../../reference/model-settings.md#provider-messages) allow it, and `null` when it is empty, quotes the response body or starts with `[`, `{` or `<` |
| `request_too_long`        | `status`; `signal`, such as `HTTP 413` or `the error code context_length_exceeded`; `provider_message`, as above; `last_input_tokens`, the input tokens the provider counted for the last step it answered in a run that calls tools                                                                                                                                      |
| `model_not_allowed`       | Nothing more                                                                                                                                                                                                                                                                                                                                                              |
| `provider_not_configured` | `configured`, the configured prefixes; `missing`, the setting names, which never reach the caller (`NODE_EXTRA_CA_CERTS` for an untrusted certificate, none for a setting the SDK found missing)                                                                                                                                                                          |
| `credentials_rejected`    | `status`, `null` when the credential source failed                                                                                                                                                                                                                                                                                                                        |
| `rate_limited`            | `retry_after_ms`, from `retry-after-ms`, or `retry-after` in seconds or as an HTTP date; `null` without a hint                                                                                                                                                                                                                                                            |
| `provider_unavailable`    | `status`, `null` when there was no response                                                                                                                                                                                                                                                                                                                               |
| `content_refused`         | `status`, `raw_finish_reason`, `usage`                                                                                                                                                                                                                                                                                                                                    |
| `output_invalid`          | `finish_reason`, `raw_finish_reason`, `usage`, and `issues` with JSON pointers into the answer and the validator's messages, which never quote the answer                                                                                                                                                                                                                 |
| `tools_stopped`           | `because`: `no_answer`, `run_bound` or `server_failed`, and `usage` where known                                                                                                                                                                                                                                                                                           |
| `timed_out`               | `timeout_ms`                                                                                                                                                                                                                                                                                                                                                              |
| `cancelled`               | Nothing more; the caller's `signal` aborted                                                                                                                                                                                                                                                                                                                               |

`classified` (`src/model-calls/failure-classification.ts`) maps what the AI SDK throws, after unwrapping up to four layers of `RetryError` to the last attempt:

- `OutboundFailure('untrusted_certificate')` from `withCertificateFailures`, which asks `isUntrustedCertificate` of `@on.auto/outbound`, becomes `provider_not_configured`;
- `OutboundFailure('credential_lookup_failed')`, which `guarded` credential sources throw, and any error whose message carries that marker, become `credentials_rejected`;
- `APICallError` goes to `apiCallFailure` (`src/model-calls/api-call-failure.ts`), which reads the status, the body's `error.code` and `error.type`, and the `retry-after` headers;
- `NoObjectGeneratedError` becomes `content_refused` for a `content-filter` finish, otherwise `output_invalid`;
- `InvalidArgumentError`, `UnsupportedFunctionalityError`, `NoSuchModelError` and `InvalidPromptError` become `definition_invalid`;
- `InvalidResponseDataError`, `EmptyResponseBodyError` and `JSONParseError` become `provider_unavailable`;
- `LoadAPIKeyError` and `LoadSettingError` become `provider_not_configured`.

Anything else is a defect: `generate` dies with `UnclassifiedModelError`, whose message names the provider and the error's `name` and nothing else, and records `error.type` `unclassified`. A classified failure records its `_tag` as `error.type` (`src/model-calls/model-metrics.ts`).

No failure or defect carries the request or response bodies the SDK keeps on its errors (`requestBodyValues`, `responseBody`, `data`), the errors of earlier attempts (`RetryError.errors`), the texts and values on parse and validation errors, or the SDK's own error objects.

### Retries

`retries` is `'adapter'`, the default, or `'caller'` (`retriesOf` in `src/model-calls/call-options.ts`). `'adapter'` passes `maxRetries: 2` to the AI SDK, whose own policy retries a retryable `APICallError` (HTTP 408, 409, 429 and 5xx) and connection failures after 2 and then 4 seconds, or after a `retry-after` of less than a minute. `'caller'` passes `maxRetries: 0`, so exactly one request is made, for a caller that retries on its own. Only the test harness passes `'caller'`: the reasoning function adapter leaves the default, so a workflow's retry policy retries on top of the adapter's retries. `timeout_ms` covers every attempt; the adapter sets it to 60 seconds plus 25 ms for each token of `max_output_tokens` (`timeoutFor` in `src/capability/definition-request.ts`).

### Scrubbing

`secretScrubber(settings)` (`src/settings/message-exposure.ts`) replaces every redacted value of the settings that is at least 8 characters long with `[redacted]`. `scrubberFor(policy, request)` (`src/model-calls/call-policy.ts`) first replaces the trimmed instructions and each message text of the request, each at least 8 characters long, with `[prompt]`. `providersShowingMessages(settings)` gives the providers whose `provider_message` may reach the caller.

## SDK globals

`installSdkGlobals` (`src/providers/sdk-globals.ts`), which `modelFactories` calls, sets `AI_SDK_DEFAULT_PROVIDER` to `customProvider({})`, so a model id without a provider never reaches the AI SDK's default gateway, and `AI_SDK_LOG_WARNINGS` to `false`, so the SDK's warnings arrive in the result's `warnings` and are not written to the console.

## Credentials

- Bedrock takes `credentialProvider` from the AWS default chain (`awsCredentialChainOf(proxy)` of `@on.auto/outbound`), which `modelFactories` loads once, when model access is built with Bedrock configured and no `aws` credential source given (`bedrockEntries` in `src/providers/model-factories.ts`), so a server without Bedrock loads no part of it for the capability. `AWS_BEARER_TOKEN_BEDROCK`, when set, is passed as `apiKey`, which the provider sends instead of signing. The chain's own STS and SSO clients make agents of their own, which `NODE_USE_ENV_PROXY` does not reach, so `awsClientSettingsOf(proxy)` gives them the proxy's variables when the switch is on.
- Vertex takes tokens from `GoogleAuth` with the scope `https://www.googleapis.com/auth/cloud-platform` (`googleCredentialChain`), wrapped in an `OAuth2Client` for `vertex` and passed as `generateAuthToken` for `vertex-anthropic`. A `vertex-anthropic` call reads the access token twice, because the AI SDK's Anthropic model resolves its headers twice per request; the token client caches it, so this costs no extra exchange. `GoogleAuth` and `OAuth2Client` are `google-auth-library`'s, which the AI SDK's two Vertex providers import too, and all three are in `src/providers/vertex-providers.ts`, which `modelFactories` imports once, when model access is built with Vertex configured (`vertexEntries` in `src/providers/model-factories.ts`), so a server without Vertex never loads them, which were 75 files and 0.8 MiB of its start, and 10 ms of it in a CPU profile (`src/providers/credential-libraries.test.ts`; measured on 2026-10-23, at the median of 11 starts and of 7 profiles).
- Azure without a key loads `@azure/identity` once, when model access is built (`azureTokensFor` in `src/providers/entra-id.ts`). A missing module (`ERR_MODULE_NOT_FOUND`) leaves Azure unconfigured; any other import error is not swallowed. With the module, tokens come from `getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default')`, looked up again when they expire.

## Answer schemas

`compileAnswerSchema(document)` (`src/schema/answer-schema.ts`) checks an output schema and gives an `AnswerSchema`, or issues with JSON pointers into the document. It uses the compiler of `@on.auto/json-schema`, built on Effect's JSON Schema importer, which compiles a schema into data rather than code and rejects regular expressions; an answer may nest 128 levels. `checkAnswerSchema(document)` reports:

- `unsupported`: what makes the schema unusable here;
- `not_portable`: what some providers reject or do not enforce, with the prefixes concerned (`src/schema/schema-portability.ts`);
- `unchecked`: what is sent to the provider but not checked here, the keywords the compiler does not know. A `format` is not among them: the compiler checks `date`, `date-time`, `time`, `email`, `uri` and `uuid` whatever the provider enforces, and any other is `unsupported`.

A definition is rejected for `unsupported` issues, and carries the `not_portable` and `unchecked` ones as `warnings`, at most 100 (`src/definition/definition-schemas.ts`). `jsonOutput` (`src/schema/json-output.ts`) hands the schema to the AI SDK's `Output.object` with a validator that checks the answer against the schema as written; a document the SDK cannot take fails as `definition_invalid` with `The output schema is not one this package can validate`.
