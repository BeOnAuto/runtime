---
description: 'The document format of a generation function, which makes an image, audio or a video from a prompt: what it produces, its model, its settings and its asset.'
---

<div v-pre>

# Generation function format

A generation function is a definition of the type `generation`. It produces an asset, an image, audio or a video, from a prompt: its document names what it produces, a model of that kind, the parameters the model takes and a prompt template. A run renders the prompt from its input, asks the model through a model gateway, keeps the bytes the model made in the playbook, and answers with a reference to the asset. An image or audio is made while the run's call waits. A video takes minutes, so its run stays `started` until the video is made<span data-audience="developer operator">, as [A generation the provider finishes later](#a-generation-the-provider-finishes-later) sets out</span>.

Use one for the pictures, the spoken words and the videos a playbook makes. Writing text is a [reasoning function](reasoning-format.md)'s work, and turning text into a file is a [computation function](computation-format.md)'s.

## A function document

The source is Markdown: YAML front matter, then a Liquid prompt template. This example, `product-picture`, makes a picture of a product for its listing. Its page links each run's picture, and counts the pictures of each day:

<div data-variable="generation.example_image_model">

<!-- prettier-ignore -->
````markdown
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
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: generation/product-picture
    views:
      pictures: series
    module: |
      export function fold(view: View, event: Event): View {
        const time = event.time?.slice(0, 10);
        if (time === undefined) return view;
        const points = view.pictures?.lines[0]?.points ?? [];
        const last = points.at(-1);
        const day = last !== undefined && last.at > time ? last.at : time;
        const days = last?.at === day
          ? [...points.slice(0, -1), { at: day, value: last.value + 1 }]
          : [...points, { at: day, value: 1 }];
        return { pictures: { unit: 'pictures', period: 'day', lines: [{ name: 'Pictures', points: days.slice(-30) }] } };
      }
  result: |
    [A picture of the product for its listing]({{ output.address }}), {{ output.bytes | divided_by: 1000000 | round: 1 }} MB.
  runs: |
    ```chart line
    {{ views.pictures | json }}
    ```
---

A studio photograph of {{ input.product }} on a white table, in soft daylight.
````

</div>

This one speaks a welcome:

<div data-variable="generation.example_audio_model">

```markdown
---
produces: audio
model: gateway/vertex_ai/gemini-3.8-flash-tts
parameters:
  voice: kore
  format: wav
---

Welcome to {{ input.shop }}. Today is {{ today }}.
```

</div>

This one films eight seconds of a product, at 1280x720:

<div data-variable="generation.example_video_model">

```markdown
---
produces: video
model: gateway/vertex_ai/veo-3.1-fast-generate-001
parameters:
  size: 1280x720
  duration: 8
---

A slow pan across {{ input.product }} on a wooden table, in warm morning light.
```

</div>

To save one, call `create_definition` with `type: "generation"`, a function `name`, such as `product-picture`, the document as `source`, and its `overview` and `diagram`. A save without a `diagram` is refused, so give the word `none` when a picture would add nothing; [The overview](#the-overview) says how to write both. To run it, call `run_definition` with the same type and name and its `input`. Both operations also need the playbook id, unless the MCP connection is scoped to that playbook.

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

| Field          | Required | Value                                                                                                                                                                                                                                                                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`  | No       | Text of 1 to 1,000 characters                                                                                                                                                                                                                                                                                         |
| `produces`     | Yes      | `image`, `audio` or `video`; see [The models](#the-models)                                                                                                                                                                                                                                                            |
| `model`        | Yes      | `gateway/model`: the name of a gateway<span data-audience="operator"> of `MODEL_GATEWAYS`</span>, then a model of [the catalogue](#the-models) that produces that kind, both as `list_generation_models` names them, such as <span data-variable="generation.example_image_model">`gateway/openai/gpt-image-2`</span> |
| `input.schema` | No       | A JSON Schema of the input. The input is a JSON object; one the schema does not allow is `invalid_input`                                                                                                                                                                                                              |
| `parameters`   | No       | The [parameters](#parameters) of the kind, each within the limits of the model                                                                                                                                                                                                                                        |
| `references`   | No       | JSON Pointers into the input, such as `/photo`, each at the `id` of an asset of the playbook the model takes as a reference; see [References](#references)                                                                                                                                                            |
| `expires`      | No       | How long the asset is kept, an ISO 8601 duration from one hour to 3,650 days, such as `P30D`. Without it, an asset is kept for <span data-variable="generation.kept">90 days</span><span data-audience="operator">, unless the runtime's operator sets another</span>                                                 |
| `page`         | No       | The [page](page-format.md) that presents its runs                                                                                                                                                                                                                                                                     |

The prompt is everything after the front matter. It is a [template](template.md) that reads `input`, `today`, the date as `YYYY-MM-DD`, and `now`, the time in ISO 8601, and it must render text: a list or an object written whole is refused. For audio, the prompt is the text the model speaks.

### How a document is checked

These are refused when the definition is saved, each with its line and its pointer:

- a `produces` other than `image`, `audio` or `video`, and a `model` not written `gateway/model`;
- a model the catalogue does not name, with the models it names that produce that kind;
- a model the catalogue says has retired, from the day it retires, naming the model to use instead;
- a model that produces another kind than `produces`;
- a parameter of another kind, and a parameter outside the limits of the model, naming the values it takes;
- more references than the model takes, or any for a model that takes none;
- an expiry that is no ISO 8601 duration or is outside its range;
- a prompt that does not parse, reads a property the input schema does not allow, or is missing.

A gateway the runtime is not given is not refused when the function is saved; its runs are.

A function that names a model the catalogue retires on a later day is saved, with a notice that names that day and the model to use instead. Its runs keep working until that day. From that day, both saving the function and running it are refused, so name the replacement before then.

Quote a text that holds ` #`, or a comma inside `{ }`, such as `description: 'Posts the notes in #deliveries'` or `{ note: 'Costs 1,000 a month' }`. Unquoted, YAML reads ` #` as the start of a comment and a comma there, even the one in `1,000`, as the start of another key, so the text ends early, and the save does not always say so.

## The models

The runtime keeps a catalogue of the models a generation function may name, each with the kind it produces and the limits of what it takes. A model is named as the gateway names it, after the gateway's own name and a `/`, such as <span data-variable="generation.example_image_model">`gateway/openai/gpt-image-2`</span> for `openai/gpt-image-2`. `list_generation_models` answers the catalogue a server holds, with the names of its gateways<span data-audience="developer">; see [Generation models](mcp.md#generation-models)</span>.

<div data-audience="developer operator user">

| Model                                 | Produces | Takes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openai/gpt-image-2`                  | image    | `size` `auto`, `1024x1024`, `1536x1024` or `1024x1536`; `quality` `auto`, `low`, `medium` or `high`; a prompt of up to 32,000 characters; up to 16 references of PNG, JPEG or WebP, each up to 50 MiB                                                                                                                                                                                                              |
| `openai/gpt-image-2.6-flare`          | image    | The sizes, prompt and references of `openai/gpt-image-2`; `quality` `low`, `medium`, `high`, `xhigh`, `max` or `auto`                                                                                                                                                                                                                                                                                              |
| `openai/gpt-image-2.6-sunburst`       | image    | The same as `openai/gpt-image-2.6-flare`                                                                                                                                                                                                                                                                                                                                                                           |
| `vertex_ai/gemini-3-pro-image`        | image    | `aspect` `1:1`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, `1:4`, `4:1`, `1:8` or `8:1`; a prompt of up to 32,000 characters; up to 14 references of PNG, JPEG or WebP, each up to 15 MiB                                                                                                                                                                                                   |
| `vertex_ai/gemini-nano-banana-2.1`    | image    | The same as `vertex_ai/gemini-3-pro-image`                                                                                                                                                                                                                                                                                                                                                                         |
| `xai/grok-imagine-image-2.0`          | image    | `aspect` `auto`, `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `19.5:9`, `9:19.5`, `20:9`, `9:20`, `21:9` or `5:2`; `quality` `low`, `medium` or `auto`; a prompt of up to 4,000 characters; up to 5 references of PNG, JPEG or WebP, each up to 10 MiB                                                                                                                                         |
| `openai/tts-1`                        | audio    | `voice` `alloy`, `echo`, `fable`, `onyx`, `nova` or `shimmer`; `format` `mp3`, `opus`, `aac`, `flac` or `wav`; a prompt of up to 4,096 characters                                                                                                                                                                                                                                                                  |
| `openai/tts-1-hd`                     | audio    | The same as `openai/tts-1`                                                                                                                                                                                                                                                                                                                                                                                         |
| `openai/gpt-4o-mini-tts`              | audio    | `voice` `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer` or `verse`; the formats of `openai/tts-1`; a prompt of up to 4,096 characters                                                                                                                                                                                                                                        |
| `vertex_ai/gemini-3.8-flash-tts`      | audio    | `voice` `kore`, `achernar`, `achird`, `algenib`, `algieba`, `alnilam`, `aoede`, `autonoe`, `callirrhoe`, `charon`, `despina`, `enceladus`, `erinome`, `fenrir`, `gacrux`, `iapetus`, `laomedeia`, `leda`, `orus`, `puck`, `pulcherrima`, `rasalgethi`, `sadachbia`, `sadaltager`, `schedar`, `sulafat`, `umbriel`, `vindemiatrix`, `zephyr` or `zubenelgenubi`; `format` `wav`; a prompt of up to 4,096 characters |
| `vertex_ai/gemini-3.8-flash-lite-tts` | audio    | The same as `vertex_ai/gemini-3.8-flash-tts`                                                                                                                                                                                                                                                                                                                                                                       |
| `vertex_ai/veo-3.1-generate-001`      | video    | `size` `1280x720`, `720x1280`, `1920x1080` or `1080x1920`; `duration` 8 seconds; a prompt of up to 1,000 characters; 1 reference, its first frame, a PNG or JPEG of up to 20 MB                                                                                                                                                                                                                                    |
| `vertex_ai/veo-3.1-fast-generate-001` | video    | The same as `vertex_ai/veo-3.1-generate-001`                                                                                                                                                                                                                                                                                                                                                                       |
| `vertex_ai/veo-3.1-lite-generate-001` | video    | The sizes, duration and prompt of `vertex_ai/veo-3.1-generate-001`; no references                                                                                                                                                                                                                                                                                                                                  |

`openai/tts-1`, `openai/tts-1-hd` and `openai/gpt-4o-mini-tts` retire on 2027-01-06: name `vertex_ai/gemini-3.8-flash-lite-tts` in place of `openai/tts-1`, and `vertex_ai/gemini-3.8-flash-tts` in place of the other two. [How a document is checked](#how-a-document-is-checked) says what happens before and after that day.

The models that produce video, Veo 3.1's, take minutes to make one. A run of one stays `started` while it waits, and ends `unavailable` if the video is not made in time; a workflow's step that runs it waits for the asset.

</div>

A gateway may not serve every model of the catalogue. A model it does not serve is answered by the gateway as not found when the function runs.

### Choosing a model

`list_generation_models` is the source of truth: it lists the models this server offers, and what each one takes. Choose by what the function needs to make and what a run may cost. The providers charge an image by the image, speech by its length and a video by the second, so a video is the dearest kind to make.

- **An image.** Name `vertex_ai/gemini-nano-banana-2.1` for most pictures: it is one of the cheapest images here, takes an `aspect` and up to 14 references. Name `vertex_ai/gemini-3-pro-image` where the picture must be at its best; it costs about four times as much. Name `openai/gpt-image-2.6-flare` for an exact `size` or to try many drafts, since its `quality` runs from `low`, the cheapest, to `max`; `openai/gpt-image-2.6-sunburst` takes the same values at the same price. `openai/gpt-image-2` is OpenAI's earlier model. `xai/grok-imagine-image-2.0` takes the widest range of aspects, and up to 5 references.
- **Speech.** Name `vertex_ai/gemini-3.8-flash-tts` for the most natural voice, or `vertex_ai/gemini-3.8-flash-lite-tts`, which costs about two thirds as much. Both take the same 30 voices and make `wav`. `openai/tts-1`, `openai/tts-1-hd` and `openai/gpt-4o-mini-tts` retire on 2027-01-06, so a new function names a Gemini model.
- **A video.** Each Veo 3.1 model makes 8 seconds at one of four sizes. Name `vertex_ai/veo-3.1-fast-generate-001` for most work. Name `vertex_ai/veo-3.1-generate-001` for the best quality, at about three times Fast's price a second, and `vertex_ai/veo-3.1-lite-generate-001` for the cheapest, at about two thirds of Fast's, which takes no first-frame reference.

### Parameters

| Kind  | Parameter  | Value                                                                                                              |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| image | `size`     | One of the sizes of the model, such as `1024x1024`                                                                 |
| image | `aspect`   | One of the aspects of the model, such as `16:9`, for a model that takes an aspect rather than a size               |
| image | `quality`  | One of the qualities of the model, such as `high`. Without it, the first quality the catalogue names for the model |
| audio | `voice`    | One of the voices of the model. Without it, the first voice the catalogue names for the model                      |
| audio | `format`   | One of the formats of the model: `mp3`, `opus`, `aac`, `flac` or `wav`. Without it, the first it names             |
| audio | `duration` | A whole number of seconds within the model's, for a model that takes a duration                                    |
| video | `size`     | One of the sizes of the model, such as `1280x720`, which also sets its aspect                                      |
| video | `duration` | A whole number of seconds within the model's. Without it, the fewest seconds the model makes                       |

A parameter the model has no values for is refused, such as an `aspect` for `openai/gpt-image-2`, and an `aspect` for any video, whose size sets it.

## References

A reference gives the model an asset of the playbook to work from, such as a photograph of a product to place in a new scene. `references` names where in the input each asset's `id` is, and the input holds the id an earlier run answered:

<div data-variable="generation.example_image_model">

```markdown
---
produces: image
model: gateway/openai/gpt-image-2
references: [/photo]
---

The same product, {{ input.product }}, on a garden table.
```

</div>

A reference is never an address. Each one is checked as the run starts, and the run is `invalid_input` at its pointer, asking the model nothing, when:

- the input holds no text at the pointer;
- no asset of this playbook has that id, as for an asset of another playbook;
- the asset has expired;
- its media type is not one the model takes, or it is larger than the model takes of one reference;
- its content is no longer kept.

## The asset

<div data-audience="developer">

A run keeps the bytes the model made as content of the playbook, at once, and records the asset on a stream of its own, `assets/{id}`, as the fact `asset_kept`. The fact holds the asset's media type, size and SHA-256, the kind, what made it as `made_by`, and when the asset expires, `expires_at`. For a generation function, `made_by.generation` holds the model, the prompt as rendered, the parameters sent, the references taken, each by its id and digest, the cost the gateway answered as `cost_usd` where it answered one, and `own_key`. Its context names the run and the definition that made it. An image a tool answers a reasoning function's run is an asset too, made by that call, `made_by.tool_call` ([The run's history](reasoning-format.md#the-run-s-history)).

</div>

The reference a run answers is the [asset shape](output-shapes.md#asset):

- `id` is the asset's id, which a later run takes as a reference;
- `media_type`, `bytes` and `sha256` describe its bytes<span data-audience="developer">. An image's media type is read from its bytes; audio's is the one the gateway answers, or that of its format</span>;
- `address` is a [signed address](http.md#content-at-a-signed-address) its bytes are read at without a key, which lasts 15 minutes, until `address_until`. Both are `null` where the runtime signs no address<span data-audience="operator">: where its own address is neither `https` nor a loopback address</span>. An address in the record of an earlier run has expired: `get_asset` reads the asset again by its `id`, with the model that made it, when it expires and an address signed as it is read, until the asset expires<span data-audience="developer"> ([Generation functions](http.md#generation-functions))</span>.

<div data-audience="developer">

When the asset expires, the runtime records `asset_expired` on the asset's stream, with its size, and its id as a reference is then refused. It then removes the content, unless another part of the playbook holds the same bytes, such as another asset made the same, or they were kept again within the last hour. Bytes another asset holds are removed when the last asset that holds them expires. Once the content is removed, the runtime records `asset_content_removed` on the asset's stream, with its size and digest, and an address answered before reads nothing more.

</div>

## How a run works

1. The input is checked against `input.schema`.
2. The prompt is rendered from the input, and checked against the most characters the model takes, each character a Unicode code point.
3. Each reference is read from the input and checked.
4. The playbook must have room left for assets.
5. The runtime asks the gateway once<span data-audience="developer operator">: `POST` to the gateway's `base_url` with `/images/generations` for an image, `/images/edits` with the references as files for an image with references, `/audio/speech` for audio, and `/videos` for a video, naming the seconds it asks for, with the gateway's key, headers and query parameters. For a generation the provider finishes later, the run then waits; see [A generation the provider finishes later](#a-generation-the-provider-finishes-later)</span>.
6. The asset is checked against the most bytes the runtime keeps of one asset of its kind as it is read.<span data-audience="developer"> The playbook was checked against the most it keeps of all its assets before the gateway was asked, so two runs that finish together may take it past that by one asset.</span>
7. The bytes are kept, the asset recorded, and its reference answered.

A run reaches outside the runtime, and a run asked again asks the gateway again and may cost again, so a workflow retries a generation function only where a second asset is wanted.

<div data-audience="developer operator">

## A generation the provider finishes later

The models of [the catalogue](#the-models) that produce video, Veo 3.1's, finish later.

A model whose provider takes minutes to make what it is asked for, as a video's does, is waited for rather than answered within the run's call. The gateway answers the request with the id of what it is making, and the run stays `started`. Its record holds that id as `handle`, and when the run stops waiting as `waits_until`. A workflow's step that runs the function waits for it as a step waits for an answer to a request, and goes on with the asset once it is kept.

Meanwhile the runtime asks the gateway at `/videos/{id}` how the generation stands: five seconds after the request, then every 10, 20 and 30 seconds, or, where the provider says how far it has got, about half the time that leaves, from five seconds to a minute. Once the provider has made it, the runtime fetches its bytes from `/videos/{id}/content` and keeps them as an asset, as for an image, and the run succeeds with the asset's reference. Both are paths of the video API of a LiteLLM gateway.

A run waits 10 minutes at most, unless its operator sets another time from 1 to 60 minutes. A generation not made by then ends the run `unavailable`, kind `generation_timed_out`. One the provider fails to make ends the run as the gateway answers. Either way the run's record holds the cost the request spent. However many times the runtime finds a generation made, it keeps one asset of it, under an id the run's deferral gives.

</div>

## How a run ends

| Rejection                                | When                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_input`, kind `input_schema`     | The input is no JSON object, or the input schema does not allow it                                                                                                                                                                                                                                                                                |
| `invalid_input`                          | The prompt cannot be rendered from the input, renders empty, or is longer than the model takes; or a reference cannot be used, at its pointer                                                                                                                                                                                                     |
| `conflict`, kind `blocked_by_moderation` | The provider behind the gateway refused the request under its moderation. Change the prompt, the input or the references                                                                                                                                                                                                                          |
| `conflict`, kind `oversized`             | The asset is larger than the runtime keeps of one asset of its kind, or the playbook already keeps all it may of its assets                                                                                                                                                                                                                       |
| `conflict`, kind `unworkable`            | The gateway did not take the request, such as for a model it does not serve, or the catalogue no longer takes the model. Update the function                                                                                                                                                                                                      |
| `unavailable`, kind `model_not_offered`  | The model names a gateway the runtime is not given                                                                                                                                                                                                                                                                                                |
| `unavailable`                            | The gateway rejected its key, limited the rate, refused for its own budget or quota, answered a redirect, failed, did not answer within 240 seconds, or answered no image, no audio or no video<span data-audience="developer operator">; or the provider failed to make a generation it finishes later, or the gateway no longer knows it</span> |

<div data-audience="developer operator">

| Rejection                                  | When                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable`, kind `generation_timed_out` | The provider had not made a generation it finishes later when the run had waited as long as it may. A new run asks for it again, which may cost again |

</div>

A run refused before the gateway answers keeps no asset and records no cost. A run the gateway answered and the runtime then refused, such as for an image larger than it keeps<span data-audience="developer operator">, or a generation it waited for in vain</span>, keeps no asset and records the cost the gateway answered, since the model was asked.

## What a run records

A run that succeeds records the asset's reference as its output and, as its `record`:

| Field         | Value                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`       | The model the document names                                                                                                                                                                                               |
| `own_key`     | `true` where the gateway is reached with the runtime operator's own key<span data-audience="operator">, the one its entry of `MODEL_GATEWAYS` gives</span>, and `false` where the runtime reaches it with a key it is lent |
| `duration_ms` | How long the run took<span data-audience="developer operator">, for a generation the provider finishes later from the request to its bytes kept</span>                                                                     |
| `cost_usd`    | The cost in US dollars the gateway answered, where it answered one<span data-audience="operator">: in the header its entry names as `cost_header`, where it names one</span>                                               |

Each run counts once on the runtime's meter, as a run of every other function does. The meter counts the run, not the model call it makes.<span data-audience="user"> On hosted Auto, the model call uses credits of its own, in addition to the run's, as [Pricing](https://on.auto/pricing) explains.</span>

## Bounds

| Bound                                       | Limit                                                       |
| ------------------------------------------- | ----------------------------------------------------------- |
| One image                                   | <span data-variable="generation.most_image">20 MiB</span>   |
| One asset of audio                          | <span data-variable="generation.most_audio">50 MiB</span>   |
| One video                                   | <span data-variable="generation.most_video">200 MiB</span>  |
| The storage quota of a playbook's assets    | <span data-variable="generation.most_kept">2,048 MiB</span> |
| How long an asset is kept without `expires` | <span data-variable="generation.kept">90 days</span>        |
| The prompt                                  | The model's                                                 |
| References                                  | The model's                                                 |
| Waiting for the gateway                     | 240 seconds                                                 |
| A run                                       | 300 seconds                                                 |

The limits for one image, one asset of audio, one video, a playbook's assets and how long an asset is kept without `expires` <span data-variable="generation.bounds_changed_by">can be changed only by whoever runs the server</span>. A run refused for the storage quota says the quota in force: how much the playbook keeps, and how much it may keep.

<div data-audience="developer operator">

The bounds of a generation the provider finishes later:

| Bound                                                | Limit                       |
| ---------------------------------------------------- | --------------------------- |
| Waiting for a generation the provider finishes later | 10 minutes                  |
| A run of a generation the provider finishes later    | The wait and 9 minutes more |

</div>

<div data-audience="operator">

A limit above that has a setting below is a default, which holds where the runtime's operator sets no other value, as the configuration reference sets out for [generation functions](../self-host/configuration.md#generation-functions) and for [assets](../self-host/configuration.md#assets). Hosted Auto sets values of its own for some of them, the storage quota among them.

| Bound                                                | Setting                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| One image                                            | `GENERATION_MAX_IMAGE_MIB`, from 1 to 1,024    |
| One asset of audio                                   | `GENERATION_MAX_AUDIO_MIB`, from 1 to 1,024    |
| One video                                            | `GENERATION_MAX_VIDEO_MIB`, from 1 to 4,096    |
| The storage quota of a playbook's assets             | `ASSET_STORAGE_QUOTA_MIB`, from 1 to 1,048,576 |
| How long an asset is kept without `expires`          | `ASSET_RETENTION_DAYS`, from 1 to 3,650        |
| Waiting for a generation the provider finishes later | `GENERATION_WAIT_MINUTES`, from 1 to 60        |
| A run of a generation the provider finishes later    | `GENERATION_WAIT_MINUTES` sets the wait        |
| The prompt                                           | The catalogue                                  |
| References                                           | The catalogue                                  |

</div>

## The overview

`create_definition` and `update_definition` take an `overview` and a `diagram` beside the document. Write both after the document, and again with every update, as the descriptions of those arguments say. Auto Studio draws the diagram under the overview, at full size in a column, so draw it top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code. An overview holds up to 16,384 bytes and a diagram 8,192, in UTF-8.<span data-audience="developer"> [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.</span>

## Its page

A generation function's page is the `page` key of its front matter, written with the document and saved with it. It shows the person what the function made:

- `result`: the asset the run produced, said in the function's own words with its kind and size, such as `A picture of the product for its listing, 1.8 MB.`, and linked at its `address`. The run's output is the asset's reference, not the prompt it rendered, so `result` names what the function makes as its description does. The address lasts 15 minutes after the run, so the link opens the asset only until `address_until`, and a client shows an image as a link, never in the page, as in [the example](#a-function-document).
- `runs`: what was produced over time, such as the assets made each week by kind, as a count, or a table of the latest, each with its kind and size.

Show numbers over time as a chart keyed by the period a run is about, and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id. The page guide, [Page format](page-format.md), gives the whole format of a page.

## Availability

A runtime runs generation functions once it is given a model gateway<span data-audience="operator"> in `MODEL_GATEWAYS`</span> that serves the models of the catalogue. See [Functions and availability](../concepts/functions.md#availability).

</div>
