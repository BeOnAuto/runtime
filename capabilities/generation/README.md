# @on.auto/generation

Generation functions: a playbook produces an asset, an image or audio, from a prompt. A generation function is a definition of the type `generation`, saved and versioned as every function is. Its run renders the prompt from its input, asks a model of the catalogue through a model gateway once, keeps the bytes the model made as content of the playbook, records the asset on a stream of its own, and answers a reference to it with an address its bytes are read at for fifteen minutes. The asset is kept until it expires, and this release keeps its content after that, since the same bytes may be held for another part of the playbook. [Generation function format](../../docs/reference/generation-format.md) sets out the document for the people who write one.

## The document

```markdown
---
description: A picture of the product for its listing
produces: image
model: gateway/openai/gpt-image-1
input:
  schema: { type: object, required: [product], properties: { product: { type: string }, photo: { type: string } } }
parameters: { size: 1024x1024, quality: high }
references: [/photo]
expires: P30D
---

A studio photograph of {{ input.product }} on a white table.
```

`parseGenerationDocument(source)` (`src/document/document-parsing.ts`) reads it with the shared document reader of `@on.auto/definitions/document`: `produces`, one of `image`, `audio` and `video`; `model`, written `gateway/model`, the gateway's name of `MODEL_GATEWAYS` before the first `/`; `input.schema`, compiled as every input schema is; `parameters`, `size`, `aspect` and `quality` for an image, `voice`, `format` and `duration` for audio, and `size`, `aspect` and `duration` for a video, a parameter of another kind refused at its pointer; `references`, at most 16 JSON Pointers into the input, none twice; `expires`, an ISO 8601 duration from one hour to 3,650 days read by `readDuration` of `@on.auto/workflow-engine/dsl`; and the body, the prompt, a template of `@on.auto/definitions/template` that reads `input`, `today` and `now`. A parse knows nothing of the catalogue, so a saved definition stays readable whatever a later release's catalogue holds.

The check at save, `checkedAgainst(catalog)` of `src/capability/definition-reading.ts`, over `modelChoiceOf` of `src/document/model-check.ts`, refuses each of these at its line: a model the catalogue does not name, with the models of the kind it names; a retired model, naming `gateway/<replacement>`; a model of another kind than `produces`; a parameter outside the model's limits, naming the values it takes; and more references than the model takes. A gateway the runtime is not given is the run's refusal, not the save's.

## The catalogue

`src/catalog/*.yaml` holds one entry for each model, named for it with each `/` a `-`: its `model`, as the gateway names it, its `kind`, the media types of the assets it takes as references, `media_types`, its `limits`, and `retired: { on, replacement }` where the provider retired it (`src/catalog/catalog-entry.ts`). The limits of an image are its `sizes`, `aspects` and `qualities`, the most characters of its prompt, `prompt_characters`, and its `references: { most, bytes }` where it takes any; of audio its `voices`, `formats` and `seconds: { least, most }` where it takes a duration; of a video its `sizes`, `aspects`, `seconds` and `references`. `readGenerationCatalog(shippedFiles)` (`src/catalog/catalog-reading.ts`) reads the folder through the shipped files of `@on.auto/shipped-files`, the root `generationShippedRoots()` gives, as the server starts, refusing an entry that does not decode, whose file is not named for it, a model named twice, `seconds` whose least is past its most, an audio format the runtime keeps no media type for (`src/catalog/media-types.ts`), references without media types or media types without references, and a replacement that is no other model of the same kind or is retired too (`catalogOf` of `src/catalog/generation-catalog.ts`). It answers the entries ordered by model.

The entries name what the gateway the reasoning functions use serves by the listing code of `@on.auto/reasoning`, which leaves these families out of its list of models for conversation: `openai/gpt-image-1` and `openai/gpt-image-1-mini`, `openai/tts-1`, `openai/tts-1-hd` and `openai/gpt-4o-mini-tts`, and `openai/sora-2`. Their limits are the provider's published ones where known and narrower where not, such as the six original voices of `openai/tts-1`. The catalogue is seeded with these six entries; a model is added by a file of its own in `src/catalog`, named for its model, with its `kind`, its `media_types` and its `limits`, and by its name in the list `src/catalog/shipped-catalog.test.ts` holds the folder to, and the server reads it as it starts.

## The gateway

A run reaches a gateway of `MODEL_GATEWAYS`, the settings reasoning reads, given as `GenerationGateway` (`src/gateway/generation-gateway.ts`): its `base_url`, its key, sent as `Authorization: Bearer`, its headers and query parameters, and its `cost_header`. `gatewayRequestOf` (`src/gateway/gateway-requests.ts`) posts JSON to `/images/generations` for an image, `{ model, prompt, n: 1, size, quality, aspect_ratio }`, or multipart to `/images/edits` for an image with references, each reference a file of `image[]`, and JSON to `/audio/speech` for audio, `{ model, input, voice, response_format, duration }`, the voice and the format the first of the model's where the document names none: the OpenAI-compatible paths, since no gateway the runtime is tested against says otherwise. A request follows no redirect (`redirect: 'manual'`, which every platform the runtime runs on takes), so the gateway's key goes nowhere else. `generatedBy` (`src/gateway/gateway-call.ts`) waits 240 seconds at most and reads an image from `data[0].b64_json`, its media type from its bytes, a WebP by both its `RIFF` header and its `WEBP` mark (`src/catalog/media-types.ts`), and audio as it comes, its media type the one the gateway answers, or that of its format where it answers none, and an answer of a type that is no audio refused as `unavailable` naming the type, each within the most the runtime keeps of one asset of its kind, and the cost from the header `cost_header` names, as `costOf` of `@on.auto/reasoning` reads it. A refusal whose error names `moderation_blocked`, `content_policy_violation` or `content_filter` as its code or type, or whose message says the request met a content policy or a safety system, is a `conflict` of the kind `blocked_by_moderation`; a refusal for the gateway's own budget or quota, `402` or an error that names `budget_exceeded`, `insufficient_quota`, `billing_hard_limit_reached` or `quota_exceeded`, or a message that says so, is `unavailable` in those words, whatever its status; `401` and `403` are the gateway's key, `429` its rate, `408`, `409`, `425` and `5xx` its failure, and a `3xx` a redirect it does not follow, each `unavailable`; another `4xx` is a `conflict` of the kind `unworkable`, naming the error code where it is plain.

## A run

`generationRun(ports)` (`src/run/generation-run.ts`) refuses a function that produces video as `unavailable`, since the runtime cannot wait for one yet; finds the model in the catalogue again and its gateway among those it is given (`src/run/runnable-model.ts`); checks the input (`src/run/prepared-input.ts`); renders the prompt and checks it against the model's characters, counted as code points (`src/run/rendered-prompt.ts`); reads each reference from the input, finds its asset in the projection `assets` of the playbook and refuses one of no asset of this playbook, expired, of a media type or a size the model does not take, or whose content is gone, at its pointer, before anything is asked (`src/run/referenced-assets.ts`); refuses as `oversized` where the playbook keeps all it may already (`src/run/asset-room.ts`); asks the gateway; and keeps the asset (`src/run/finished-run.ts`). A run refused before the gateway answers keeps nothing and records no cost; one the gateway answered and the runtime then refuses, for an asset larger than it keeps of its kind, an answer that holds no image or one that is no audio, keeps nothing and records, on the refusal, `model`, `own_key` and the `cost_usd` the gateway answered, since the call was spent. A run asked again asks the gateway again, so the capability declares `reachesOutside`, and `mayChangeOutside` once it is given a gateway, so that `run_definition` is destructive on a server that can ask one.

The run's record holds `model`, `own_key`, which the composer sets, `duration_ms` and, where the gateway answered one, `cost_usd`. Its output is the shape `asset` of `@on.auto/definitions`: `id`, `media_type`, `bytes`, `sha256`, and `address` and `address_until`, signed by `signedContentAddress` of `@on.auto/identity` for fifteen minutes on the origin the composer gives, or `null` where it gives no signer or the origin is neither HTTPS nor a loopback address (`src/assets/asset-reference.ts`). The address names the asset's bytes by the playbook and their digest, `<origin>/v1/orgs/{org}/playbooks/{playbook}/content/{sha256}?until=&sig=`, the content route of the runtime's API (`contentAddressRoutes` of `@on.auto/api`), which answers them with no credential, its signature being its credential, from whatever store keeps the playbook's content, the ledger's own or an object store, so an asset has one address whichever store keeps its bytes, and the route reads it under the key the signer signed it with.

## The asset

`keptAsset` (`src/assets/asset-keeping.ts`) puts the bytes through `RecordedContent.put` of the playbook, then appends `asset_kept` to the stream `assets/<id>` of the playbook, a UUIDv7, through `assetDecider` (`src/assets/asset-decider.ts`), which takes `asset_kept` once and `asset_expired` once after it. The facts (`src/assets/asset-facts.ts`):

| Fact            | Data                                                                                                                                                 | Context                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `asset_kept`    | `media_type`, `bytes`, `sha256`, `kind`, `model`, `prompt`, `parameters`, `references` (each `{ id, sha256 }`), `cost_usd?`, `own_key`, `expires_at` | the run's: caller, run and definition |
| `asset_expired` | `bytes`, `content_removed`                                                                                                                           | `by: runtime`                         |

The stream kind `assets` is the capability's own, declared in `generationFacts` with its presenter (`src/assets/asset-presenter.ts`), so the playbook's feed shows both facts and the ledger reads them; their fixtures are under `src/assets/0.56.0/` and in `recorded-facts.json`.

Two projections fold the stream (`src/assets/asset-projections.ts`): `assets_1`, one row an asset, keyed by its id, with `media_type`, `bytes`, `sha256`, `kind`, `model`, `run`, `kept_at`, `expires_at`, null once the asset expired, `expired_at` and `live`, indexed across playbooks on `expires_at` where it is set, `expiring`; and `asset_totals_1`, one row a playbook, keyed `playbook`, with the `bytes` and the count of `assets` it keeps. Their tables are part of the layout of the ledger, and `generationLayoutSteps` (`src/assets/asset-layout.ts`) is step 11, the one after the memories' step 10, and holds no statement, since the ledger makes and fills a projection's table it does not find as it opens.

## Expiry

`assetsDue({ ledger })` (`src/expiry/assets-due.ts`) is due work of the host, in the lane that calls nothing outside: the rows of `assets_1` whose `expires_at` has passed, the soonest first. Each one appends `asset_expired`, which takes the asset out of `asset_totals_1`, and an expiry another performer recorded first is left as it is. It removes no content, and records `content_removed: false`, since the playbook's content is kept by its digest and another holder of the same bytes, such as a request of an interaction function, would lose them until the ledger knows every holder of a digest.

## Bounds

`generationBounds` (`src/capability/generation-ports.ts`) is the default of what a run keeps, which the composer may replace: 20 MiB of one image, 50 MiB of audio and 200 MiB of a video, 2,048 MiB of a playbook's assets together, and 90 days for an asset whose function names no `expires`. A run takes at most 300 seconds. The total of a playbook is a soft bound: each run reads it before it keeps its own asset, so two generations that finish together may take it past its bound by one asset.

## Using it from code

```ts
const capability = makeGenerationFunctionAdapter({
  catalog: Result.getOrThrow(await readGenerationCatalog(shippedFiles)),
  gateways: modelSettings.gateways,
  fetch: (request) => fetch(request),
  ownKey: true,
  ledger,
  content: ledger.content,
  addresses: { signedContentAddress, ownOrigin },
  bounds: generationBounds,
});
const dueWork = assetsDue({ ledger });
```

The server composes it in `packages/server/src/composition/served-generation.ts`, with the projections `assets` and `assetTotals` in `kept-projections.ts` and the step in `layout-steps.ts` and `AssetEventSchema` among the facts it reads in `known-facts.ts`.

## Testing

`@on.auto/generation/testing` gives `generationHarness(options)`, a playbook over an in-memory ledger with the projections, the capability over `testCatalog` and a fake gateway, `fakeGateway(answering)`, which answers each request as `answering` says and keeps what it was asked, `answeredByKind(cost)` and `answeredWith(status, body)`, the documents of the tests, `onePixelPng` and `spokenBytes`. `src/assets/assets-on-sqlite.test.ts` and `assets-on-postgresql.test.ts` run the projections on each store, the second where `LEDGER_TEST_POSTGRESQL_URL` is set. The server's `src/generation/` runs a function over HTTP and MCP against a gateway on the loopback, reads its asset at its address and lets it expire.

## Source

`src/capability` the adapter, its ports and its words; `src/catalog` the catalogue and its entries; `src/document` the document and its checks; `src/gateway` the requests and the answers of the gateway; `src/run` a run; `src/assets` the facts, the stream, the projections and the layout step; `src/expiry` the due work; `src/testing` the testing entry; `src/run-testing` the helpers of the tests of a run, and `src/store-testing` the suite of the projections the ledger's stores each run.
