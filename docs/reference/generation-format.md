<div v-pre>

# Generation function format

A generation function is a definition of the type `generation`. It produces an asset, an image or audio, from a prompt: its document names what it produces, a model of that kind, the parameters the model takes and a prompt template. A run renders the prompt from its input, asks the model through a model gateway, keeps the bytes the model made in the playbook, and answers with a reference to the asset. An image or audio is made while the run's call waits; a run of a generation the provider finishes later waits for it instead, as [A generation the provider finishes later](#a-generation-the-provider-finishes-later) sets out.

Use one for the pictures and the spoken words a playbook makes. Writing text is a [reasoning function](reasoning-format.md)'s work, and turning text into a file is a [computation function](computation-format.md)'s.

## A function document

The source is Markdown: YAML front matter, then a Liquid prompt template. This example makes a picture of a product for its listing:

```markdown
---
description: A picture of the product for its listing
produces: image
model: gateway/openai/gpt-image-2
input:
  schema:
    type: object
    required: [product]
    properties:
      product: { type: string }
parameters:
  size: 1024x1024
  quality: high
expires: P30D
---

A studio photograph of {{ input.product }} on a white table, in soft daylight.
```

This one speaks a welcome:

```markdown
---
produces: audio
model: gateway/openai/gpt-4o-mini-tts
parameters:
  voice: coral
  format: mp3
---

Welcome to {{ input.shop }}. Today is {{ today }}.
```

To save it, call `create_definition` with `type: "generation"`, a function `name` and the document as `source`. To run it, call `run_definition` with the same type and name and its `input`. Both operations also need the playbook id, unless the MCP connection is scoped to that playbook.

A run answers the [asset](output-shapes.md#asset) it made:

```json
{
  "id": "019a4f2e-0000-7000-8000-000000000001",
  "media_type": "image/png",
  "bytes": 1843021,
  "sha256": "497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581",
  "address": "https://runtime.example.com/v1/orgs/acme/playbooks/shop/content/4977…?until=1793527200&sig=…",
  "address_until": "2026-11-01T10:15:00.000Z"
}
```

## Fields

| Field          | Required | Value                                                                                                                                                                                              |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`  | No       | Text of 1 to 1,000 characters                                                                                                                                                                      |
| `produces`     | Yes      | `image`, `audio` or `video`. The catalogue names no model that produces video, so a function that produces `video` is refused as it is saved; see [The models](#the-models)                        |
| `model`        | Yes      | `gateway/model`: the name of a gateway of `MODEL_GATEWAYS`, then a model of [the catalogue](#the-models) that produces that kind, such as `gateway/openai/gpt-image-2`                             |
| `input.schema` | No       | A JSON Schema of the input. The input is a JSON object; one the schema does not allow is `invalid_input`                                                                                           |
| `parameters`   | No       | The [parameters](#parameters) of the kind, each within the limits of the model                                                                                                                     |
| `references`   | No       | JSON Pointers into the input, such as `/photo`, each at the `id` of an asset of the playbook the model takes as a reference; see [References](#references)                                         |
| `expires`      | No       | How long the asset is kept, an ISO 8601 duration from one hour to 3,650 days, such as `P30D`. Without it, an asset is kept for the days the runtime keeps one, 90 unless its operator sets another |
| `page`         | No       | The [page](page-format.md) that presents its runs                                                                                                                                                  |

The prompt is everything after the front matter. It is a [template](template.md) that reads `input`, `today`, the date as `YYYY-MM-DD`, and `now`, the time in ISO 8601, and it must render text: a list or an object written whole is refused. For audio, the prompt is the text the model speaks.

### How a document is checked

These are refused when the definition is saved, each with its line and its pointer:

- a `produces` other than `image`, `audio` or `video`, and a `model` not written `gateway/model`;
- a model the catalogue does not name, with the models it names that produce that kind;
- a model the catalogue says was retired, naming the model to use instead;
- a model that produces another kind than `produces`;
- a parameter of another kind, and a parameter outside the limits of the model, naming the values it takes;
- more references than the model takes, or any for a model that takes none;
- an expiry that is no ISO 8601 duration or is outside its range;
- a prompt that does not parse, reads a property the input schema does not allow, or is missing.

A gateway the runtime is not given is not refused when the function is saved; its runs are.

Quote a text that holds ` #`, or a comma inside `{ }`, such as `description: 'Posts the notes in #deliveries'` or `{ note: 'Costs 1,000 a month' }`. Unquoted, YAML reads ` #` as the start of a comment and a comma there, even the one in `1,000`, as the start of another key, so the text ends early, and the save does not always say so.

## The models

The runtime keeps a catalogue of the models a generation function may name, each with the kind it produces and the limits of what it takes. A model is named as the gateway names it, after the gateway's own name: a gateway named `gateway` that serves `openai/gpt-image-2` is named `gateway/openai/gpt-image-2`.

| Model                     | Produces | Takes                                                                                                                                                                                                 |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai/gpt-image-2`      | image    | `size` `auto`, `1024x1024`, `1536x1024` or `1024x1536`; `quality` `auto`, `low`, `medium` or `high`; a prompt of up to 32,000 characters; up to 16 references of PNG, JPEG or WebP, each up to 50 MiB |
| `openai/gpt-image-1-mini` | image    | The same as `openai/gpt-image-2`                                                                                                                                                                      |
| `openai/tts-1`            | audio    | `voice` `alloy`, `echo`, `fable`, `onyx`, `nova` or `shimmer`; `format` `mp3`, `opus`, `aac`, `flac` or `wav`; a prompt of up to 4,096 characters                                                     |
| `openai/tts-1-hd`         | audio    | The same as `openai/tts-1`                                                                                                                                                                            |
| `openai/gpt-4o-mini-tts`  | audio    | `voice` `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer` or `verse`; the formats of `openai/tts-1`; a prompt of up to 4,096 characters                           |

A gateway may not serve every model of the catalogue. A model it does not serve is answered by the gateway as not found when the function runs. The catalogue names no model that produces video, so a function that produces video is refused as it is saved.

### Parameters

| Kind  | Parameter  | Value                                                                                                  |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------ |
| image | `size`     | One of the sizes of the model, such as `1024x1024`                                                     |
| image | `aspect`   | One of the aspects of the model, such as `16:9`, for a model that takes an aspect rather than a size   |
| image | `quality`  | One of the qualities of the model, such as `high`                                                      |
| audio | `voice`    | One of the voices of the model. Without it, the first voice the catalogue names for the model          |
| audio | `format`   | One of the formats of the model: `mp3`, `opus`, `aac`, `flac` or `wav`. Without it, the first it names |
| audio | `duration` | A whole number of seconds within the model's, for a model that takes a duration                        |
| video | `size`     | One of the sizes of the model, such as `1280x720`, which also sets its aspect                          |
| video | `duration` | A whole number of seconds within the model's. Without it, the fewest seconds the model makes           |

A parameter the model has no values for is refused, such as an `aspect` for `openai/gpt-image-2`, and an `aspect` for any video, whose size sets it.

## References

A reference gives the model an asset of the playbook to work from, such as a photograph of a product to place in a new scene. `references` names where in the input each asset's `id` is, and the input holds the id an earlier run answered:

```markdown
---
produces: image
model: gateway/openai/gpt-image-2
references: [/photo]
---

The same product, {{ input.product }}, on a garden table.
```

A reference is never an address. Each one is checked as the run starts, and the run is `invalid_input` at its pointer, asking the model nothing, when:

- the input holds no text at the pointer;
- no asset of this playbook has that id, as for an asset of another playbook;
- the asset has expired;
- its media type is not one the model takes, or it is larger than the model takes of one reference;
- its content is no longer kept.

## The asset

A run keeps the bytes the model made as content of the playbook, at once, and records the asset on a stream of its own, `assets/{id}`, as the fact `asset_kept`. The fact holds the asset's media type, size and SHA-256, the kind, the model, the prompt as rendered, the parameters sent, the references taken, each by its id and digest, the cost the gateway answered as `cost_usd` where it answered one, `own_key` and when the asset expires, `expires_at`. Its context names the run and the definition that made it.

The reference a run answers is the [asset shape](output-shapes.md#asset):

- `id` is the asset's id, which a later run takes as a reference;
- `media_type`, `bytes` and `sha256` describe its bytes. An image's media type is read from its bytes; audio's is the one the gateway answers, or that of its format;
- `address` is a [signed address](http.md#content-at-a-signed-address) its bytes are read at without a key, which lasts 15 minutes, until `address_until`. Both are `null` where the runtime's own address is neither `https` nor a loopback address, since the runtime signs no address there. An address in the record of an earlier run has expired: `get_asset` reads the asset again by its `id`, with the model that made it, when it expires and an address signed as it is read, until the asset expires ([Generation functions](http.md#generation-functions)).

When the asset expires, the runtime records `asset_expired` on the asset's stream, with its size, and its id as a reference is then refused. It then removes the content, unless another part of the playbook holds the same bytes, such as another asset made the same, or they were kept again within the last hour. Bytes another asset holds are removed when the last asset that holds them expires. Once the content is removed, the runtime records `asset_content_removed` on the asset's stream, with its size and digest, and an address answered before reads nothing more.

## How a run works

1. The input is checked against `input.schema`.
2. The prompt is rendered from the input, and checked against the most characters the model takes, each character a Unicode code point.
3. Each reference is read from the input and checked.
4. The playbook must have room left for assets.
5. The runtime asks the gateway once: `POST` to the gateway's `base_url` with `/images/generations` for an image, `/images/edits` with the references as files for an image with references, `/audio/speech` for audio, and `/videos` for a video, naming the seconds it asks for, with the gateway's key, headers and query parameters. For a generation the provider finishes later, the run then waits; see [A generation the provider finishes later](#a-generation-the-provider-finishes-later).
6. The asset is checked against the most bytes the runtime keeps of one asset of its kind as it is read. The playbook was checked against the most it keeps of all its assets before the gateway was asked, so two runs that finish together may take it past that by one asset.
7. The bytes are kept, the asset recorded, and its reference answered.

A run reaches outside the runtime, and a run asked again asks the gateway again and may cost again, so a workflow retries a generation function only where a second asset is wanted.

## A generation the provider finishes later

A model whose provider takes minutes to make what it is asked for, as a video's does, is waited for rather than answered within the run's call. The gateway answers the request with the id of what it is making, and the run stays `started`. Its record holds that id as `handle`, and when the run stops waiting as `waits_until`. A workflow's step that runs the function waits for it as a step waits for an answer to a request, and goes on with the asset once it is kept.

Meanwhile the runtime asks the gateway at `/videos/{id}` how the generation stands: five seconds after the request, then every 10, 20 and 30 seconds, or, where the provider says how far it has got, about half the time that leaves, from five seconds to a minute. Once the provider has made it, the runtime fetches its bytes from `/videos/{id}/content` and keeps them as an asset, as for an image, and the run succeeds with the asset's reference. Both are paths of the video API of a LiteLLM gateway.

A run waits 10 minutes at most, unless its operator sets another time from 1 to 60 minutes. A generation not made by then ends the run `unavailable`, kind `generation_timed_out`. One the provider fails to make ends the run as the gateway answers. Either way the run's record holds the cost the request spent. However many times the runtime finds a generation made, it keeps one asset of it, under an id the run's deferral gives.

## How a run ends

| Rejection                                  | When                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_input`, kind `input_schema`       | The input is no JSON object, or the input schema does not allow it                                                                                                                                                                                                                                |
| `invalid_input`                            | The prompt cannot be rendered from the input, renders empty, or is longer than the model takes; or a reference cannot be used, at its pointer                                                                                                                                                     |
| `conflict`, kind `blocked_by_moderation`   | The provider behind the gateway refused the request under its moderation. Change the prompt, the input or the references                                                                                                                                                                          |
| `conflict`, kind `oversized`               | The asset is larger than the runtime keeps of one asset of its kind, or the playbook already keeps all it may of its assets                                                                                                                                                                       |
| `conflict`, kind `unworkable`              | The gateway did not take the request, such as for a model it does not serve, or the catalogue no longer takes the model. Update the function                                                                                                                                                      |
| `unavailable`, kind `model_not_offered`    | The model names a gateway the runtime is not given                                                                                                                                                                                                                                                |
| `unavailable`                              | The gateway rejected its key, limited the rate, refused for its own budget or quota, answered a redirect, failed, did not answer within 240 seconds, or answered no image, no audio or no video; or the provider failed to make a generation it finishes later, or the gateway no longer knows it |
| `unavailable`, kind `generation_timed_out` | The provider had not made a generation it finishes later when the run had waited as long as it may. A new run asks for it again, which may cost again                                                                                                                                             |

A run refused before the gateway answers keeps no asset and records no cost. A run the gateway answered and the runtime then refused, such as for an image larger than it keeps, or a generation it waited for in vain, keeps no asset and records the cost the gateway answered, since the model was asked.

## What a run records

A run that succeeds records the asset's reference as its output and, as its `record`:

| Field         | Value                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`       | The model the document names                                                                                                                                                     |
| `own_key`     | `true` where the gateway is reached with the key its entry of `MODEL_GATEWAYS` gives, the runtime operator's own, and `false` where the runtime reaches it with a key it is lent |
| `duration_ms` | How long the run took, for a generation the provider finishes later from the request to its bytes kept                                                                           |
| `cost_usd`    | The cost in US dollars the gateway answered in the header its entry names as `cost_header`, where it names one and answered a cost                                               |

Each run is one run of the runtime's meter, as a run of every other function is, whatever its cost.

## Bounds

| Bound                                                | Default                     | Setting                                      |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------- |
| One image                                            | 20 MiB                      | `GENERATION_MAX_IMAGE_MIB`, from 1 to 1,024  |
| One asset of audio                                   | 50 MiB                      | `GENERATION_MAX_AUDIO_MIB`, from 1 to 1,024  |
| One video                                            | 200 MiB                     | `GENERATION_MAX_VIDEO_MIB`, from 1 to 4,096  |
| The assets of a playbook, together                   | 2,048 MiB                   | `GENERATION_MAX_PLAYBOOK_MIB`                |
| How long an asset is kept without `expires`          | 90 days                     | `GENERATION_RETENTION_DAYS`, from 1 to 3,650 |
| Waiting for a generation the provider finishes later | 10 minutes                  | `GENERATION_WAIT_MINUTES`, from 1 to 60      |
| The prompt                                           | The model's                 | The catalogue                                |
| References                                           | The model's                 | The catalogue                                |
| Waiting for the gateway                              | 240 seconds                 |                                              |
| A run                                                | 300 seconds                 |                                              |
| A run of a generation the provider finishes later    | The wait and 9 minutes more | `GENERATION_WAIT_MINUTES` sets the wait      |

The [configuration reference](../self-host/configuration.md#generation-functions) sets out the settings.

## The overview

`create_definition` and `update_definition` take an `overview` beside the document: Markdown for the person who runs the business, written from everything known of them and of the playbook. It says why the function exists, what it does and how it fits, in one to three short paragraphs; less technical, more value. Write it after the document, and write it again with every update.

They also take a `diagram`, every time, so that whether the function is drawn is a choice its author makes: Mermaid source of a flowchart or a state diagram of how the function works, whose first line is `flowchart`, `graph` or `stateDiagram`, or the word `none` when a picture would add nothing. A save without it is refused. A diagram holds at most 8,192 bytes in UTF-8, and Auto Studio draws it under the overview. It is read there at full size in a column, so draw it top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code.

## Its page

A generation function's page is the `page` key of its front matter, written with the document and saved with it. It shows the person what the function made:

- `result`: the asset the run produced, said in the function's own words with its kind and size, such as `A picture of the product for its listing, 1.8 MB.`, and linked at its `address`. The run's output is the asset's reference, not the prompt it rendered, so `result` names what the function makes as its description does. The address lasts 15 minutes after the run, so the link opens the asset only until `address_until`, and a client shows an image as a link, never in the page.
- `runs`: what was produced over time, such as the assets made each week by kind, as a count, or a table of the latest, each with its kind and size.

Show numbers over time as a chart keyed by the period a run is about, and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id. [Page format](page-format.md) says how to write `data`, `result` and `runs`.

## Availability

A runtime runs generation functions once it is given a model gateway in `MODEL_GATEWAYS` that serves the models of the catalogue. See [Functions and availability](../concepts/functions.md#availability).

</div>
