---
description: Every route of Auto Runtime's HTTP API, for playbooks, definitions, runs and their history, requests and events, with its fields, limits and errors.
---

# HTTP API

The HTTP API serves every operation of Auto Runtime. It covers playbooks, function and workflow definitions, runs and their history, and requests. It also covers events, analytics and the tool servers a playbook's functions may use. This page lists every route with its fields, limits and errors.

The [MCP endpoints](mcp.md) serve the same operations as tools. A definition's `type` is `reasoning`, `lookup`, `interaction`, `prediction`, `computation`, `generation` or `workflow`.

## Requests and access

Send requests to the server's address, such as `https://auto.example.com`, the `PUBLIC_URL` of a team's runtime, with a credential.

- Org routes begin at `/v1/orgs/{org}`. Playbook routes begin at `/v1/orgs/{org}/playbooks/{playbook}`.
- Send the credential, an [API key](../self-host/security.md#api-keys) or a signed-in person's token, as `Authorization: Bearer <key>`. Keep credentials out of prompts and source documents.
- A server in [local mode](../self-host/security.md#local-mode) asks for no credential. The [Sign-in and token reference](authentication.md) gives the rules the server applies to credentials.
- Send command bodies as UTF-8 JSON with `Content-Type: application/json`, at most 1 MiB. Compressed bodies are not accepted.
- Query parameters are for `GET` and `DELETE` requests, which take no body. A field may be supplied in only one place.

Each API key belongs to one org and has permissions for a set of playbooks:

| Permission       | Lets the caller                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org:read`       | Read the org's playbooks and connections, list models and providers, search the org's tool servers, read the org's activity and mark it seen, and make, read and resolve the org's own comments |
| `org:write`      | Create, update and retire playbooks, add, reconnect and remove connections, and set which playbooks may use one                                                                                 |
| `playbook:read`  | Read definitions, runs, history, events, requests and analytics, search and read tools, make, read and resolve comments, and transcribe a recording                                             |
| `playbook:write` | Create, change, retire or run a function or workflow, cancel a run, send or publish an event, answer a request and call a tool                                                                  |

Each route table below names the permission a route needs.

When the server [sends telemetry](../self-host/telemetry.md), every response except that of `/health` carries its trace id in the `x-trace-id` header. A request with a W3C `traceparent` header continues the caller's trace.

## The OpenAPI document, the guides and the API catalog

| Method and route               | Returns                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /v1/openapi.json`         | The OpenAPI 3.1.1 document of this API                                                             |
| `GET /v1/guides/{guide}`       | One guide, as `text/markdown`                                                                      |
| `GET /.well-known/api-catalog` | The API catalog of this server, as `application/linkset+json`                                      |
| `GET /health`                  | Whether the server is up                                                                           |
| `GET /debug`                   | A page of [everything an agent receives](mcp.md#everything-an-agent-receives-on-one-page) over MCP |

These five need no key, and neither does [content at a signed address](#content-at-a-signed-address), whose signature is its credential. Where sign-in is on, the [protected resource metadata](authentication.md#protected-resource-metadata) needs no key either. It is served at `/.well-known/oauth-protected-resource` and under the path of each MCP endpoint. Where the runtime signs people in at an `https` `PUBLIC_URL`, the [client metadata document](authentication.md#client-metadata-document), by which Auto names its own client when a person connects a provider by consent, needs no key either. It is served at `/oauth/client.json`.

### The OpenAPI document

The server builds the document when it starts, from its operations: the same operations its routes and its MCP tools serve.

- Each operation appears once. Its `operationId` is the operation's name, with `search_in_org` for the org's `search`, and `make_comment_in_org`, `list_comments_in_org`, `resolve_comment_in_org` and `reopen_comment_in_org` for the org's own comments. Its summary is its title. Its tag names the resource it acts on.
- Its description is its MCP tool's description. An operation served only over HTTP has no tool, so its description is its own: the six routes of Studio's connection page, `read_link`, `approve`, `give_credential`, `give_client`, `start` and `finish`; `get_connection`, `set_connection_playbooks` and `list_providers`; `get_run_history`, `get_playbook_analytics`, `render_page`, `render_playbook_page` and `validate`; `make_comment` and `make_comment_in_org`, and `reopen_comment` and `reopen_comment_in_org`; `list_org_changes`, `list_playbook_changes`, `list_activity` and `mark_activity_seen`; `transcribe` and `get_voice`; `get_content`, the route of [content at a signed address](#content-at-a-signed-address); and `get_license`, `activate_allocation` and `report_allocation`.
- Its input is in the path, and in the query string of a `GET`. A command, or a query routed by `POST` such as `validate` and `dry_run`, takes it in the JSON body.
- Its schemas are JSON Schema 2020-12. Each has its own `$id` under `https://on.auto/schemas/runtime/`, with its definitions inside it.
- Each problem an operation can return is listed under its status.
- The server URL is the relative `/v1`, so the document stays valid behind any host.

A client library can be generated from the document, and a gateway that accepts OpenAPI documents can add the runtime from it. Each release's document is kept in the repository at [`docs/assets/openapi.json`](https://github.com/BeOnAuto/runtime/blob/main/docs/assets/openapi.json), so a client library can be generated without running a server.

### The guides

`GET /v1/guides/{guide}` returns one of the guides that the MCP endpoints serve as `guide://{guide}`, with the same text. The guides say where an agent starts and what the words mean, give the format of each definition type and the filters of every template, and hold the recipes for common tasks. The OpenAPI document lists their names. Each guide has its own path. So the server treats an unknown guide name like any other path it does not serve: without a key, the response is `401`.

### The API catalog

`GET /.well-known/api-catalog` returns a linkset in the API catalog profile. It lists the API at `/v1`, described by the OpenAPI document and documented by each guide with its title, and the API's status at `/health`.

- Every address is absolute. It is based on `PUBLIC_URL` when that is set, and otherwise on the origin the request arrived at.
- Behind a proxy, that origin is the scheme and host the server itself receives. The server reads no `X-Forwarded-*` header.
- Responses for the catalog, `HEAD` included, carry `Link: <…/.well-known/api-catalog>; rel="api-catalog"`. `GET /health` carries the same relation, so a client given only the health address can find the catalog, and from there the document and the guides.

### Caching

The document, the guides and the catalog change only when a new release of the server is deployed or the server is configured again.

- Each carries a strong `ETag` of its bytes and `Cache-Control: public, max-age=300`.
- Each responds with `304` and no body when the request's `If-None-Match` names its tag, a list that includes it, or `*`.
- `HEAD` returns their headers without the body.
- `/health` is never cached: it responds with `Cache-Control: no-store`.

## Content at a signed address

This route serves the bytes a playbook keeps by their digest at an address the runtime signs. The address carries its own credential, so a person or a browser can follow it without a key.

| Method and route                                                                   | Returns                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /v1/orgs/{org}/playbooks/{playbook}/content/{sha256}?until={until}&sig={sig}` | The content's bytes, with the media type it was kept with |

- `sha256` is the SHA-256 of the bytes, in lowercase hex.
- `until` is the time the address lasts until, in whole seconds since 1970-01-01T00:00:00Z. An address lasts 15 minutes at the most. The runtime accepts an `until` up to 30 seconds later than that, for servers whose clocks differ, and refuses one beyond it.
- `sig` is the runtime's signature of the org, the playbook, the digest and `until`, under a key the runtime keeps for itself.
- The runtime signs an address only on an `https` origin or on `localhost`, `127.0.0.1` or `[::1]`, as it does for [links to Studio](#links-to-studio).
- An asset a generation function made has its address in the output of its run, and [`get_asset`](#generation-functions) answers a new one each time it reads the asset, as it does for an image a tool answered a run.
- The response carries `Content-Type`, `Content-Length` and `Cache-Control: private, max-age={seconds}`, the seconds the address has left, at most 900.
- The route takes no key and makes no `Origin` check. `HEAD` returns the headers without the bytes, and any other method gets `405`.
- Every response of this route carries `Cross-Origin-Resource-Policy: cross-origin`, so a page on another origin can embed the bytes in an `img`, `audio` or `video` element. Every other route answers `same-origin`.
- Every response of this route carries a `Content-Security-Policy` with `sandbox`, so HTML or SVG content opened at the address runs no script and submits no form. An image still displays.
- Every response with the content carries `Accept-Ranges: bytes`, so an `audio` or `video` element can seek. A `Range` of one range, `bytes={first}-{last}` or `bytes={first}-` to the end, counted from 0, returns `206` with that part, its `Content-Range: bytes {first}-{last}/{size}` and the part's size as `Content-Length`. A range that runs past the end stops at the last byte.
- Any other `Range`, such as several ranges, a suffix such as `bytes=-500`, or a range whose last byte comes before its first, returns the whole content with `200`.
- A part is checked against its length only, since the digest is of the whole content. Read the whole content to check its digest.

| Case                                                                                         | Response                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The time in `until` has passed                                                               | `403` `forbidden`, "The address to this content expired at {time}; ask for a new one" |
| The signature is not for this org, playbook, digest and time, or `until` or `sig` is missing | `403` `forbidden`, "The address is not one this runtime signed for this content"      |
| The playbook holds no content under the digest, such as content it no longer keeps           | `404` `not_found`, "The playbook holds no content under this digest"                  |
| The `Range` starts at or past the end of the content                                         | `416` `range_not_satisfiable`, with `Content-Range: bytes */{size}`                   |

## Playbooks

These routes are relative to `/v1/orgs/{org}`:

| Operation              | Method and route                     | Permission                    | Input                                            |
| ---------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------ |
| `create_playbook`      | `POST /playbooks`                    | `org:write`                   | `playbook`, `name`, optional `description`       |
| `list_playbooks`       | `GET /playbooks`                     | `org:read` or `playbook:read` | Optional `include_retired`                       |
| `get_playbook`         | `GET /playbooks/{playbook}`          | `org:read`                    | Playbook id in path                              |
| `update_playbook`      | `PUT /playbooks/{playbook}`          | `org:write`                   | At least one of `name`, `description` and `page` |
| `retire_playbook`      | `POST /playbooks/{playbook}/retire`  | `org:write`                   | Playbook id in path                              |
| `restore_playbook`     | `POST /playbooks/{playbook}/restore` | `org:write`                   | Playbook id in path                              |
| `render_playbook_page` | `POST /playbooks/{playbook}/render`  | `playbook:read`               | Playbook id in path                              |

| Field         | Rule                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `playbook`    | The id: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter                   |
| `name`        | 1 to 100 characters, stored without the whitespace around it; it cannot be all whitespace        |
| `description` | At most 2,000 characters, stored without the whitespace around it                                |
| `page`        | The playbook's [page](page-format.md) as YAML text, at most 65,536 bytes, or `null` to remove it |

Each operation returns the playbook, with its `id`, `name`, `description`, `status` (`active` or `retired`), `created_at`, `created_by`, the caller who created it, by `id` and `name`, `updated_at` and, once retired, `retired_at`. `get_playbook` and `update_playbook` add `page: { source }` for a playbook with a page. `list_playbooks` returns them in `playbooks`, and `create_playbook` returns the playbook's page in Studio as `studio` too ([Links to Studio](#links-to-studio)).

`list_playbooks` of an org with no playbook yet, active or retired, to a caller who may act on every playbook of the org and holds `org:write`, also returns `welcome`: words the agent relays to the person, on what a playbook is, three ways to start and what Studio shows, ending with the link to Studio's home. [The welcome of a new organization](mcp.md#the-welcome-of-a-new-organization) quotes them. A caller who may only read, or who acts on some playbooks alone, gets the empty list and no `welcome`, and an org with a playbook returns none to anyone.

- `list_playbooks` lists the playbooks the caller may access. It leaves out retired ones unless `include_retired` asks for them. It also accepts a key with only `playbook:read`, so a key that may only read inside some playbooks can find them.
- A key limited to a list of playbooks can create only a playbook whose id is on that list.
- `update_playbook` changes the fields it is given and keeps the others. A `page` is checked as [Saving a page](page-format.md#saving-a-page) sets out, with its issues under `/page`, and recorded as `playbook_page_saved`. An update that changes nothing records nothing.
- `render_playbook_page` renders the playbook's page now and answers `{ page: { runs, standing } }`, both where the page has `data` ([The preview](page-format.md#the-preview)).
- A retired playbook keeps its id: no other playbook can take it. `restore_playbook` brings the playbook back, active, with its definitions, page and history as they were. Restoring a playbook that is not retired succeeds and changes nothing.
- A retired playbook stays readable: `get_playbook` reads it, `include_retired` lists it, and its definitions, runs and history remain readable. Commands inside it return `conflict` with the kind `retired`. Retiring it again succeeds and changes nothing.

| Case                                                                                                      | Response                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `create_playbook` with an id the org has or had                                                           | `conflict`                |
| `update_playbook` of a retired playbook                                                                   | `conflict`                |
| `get_playbook`, `update_playbook`, `retire_playbook` or `restore_playbook` of an id the org does not have | `not_found`               |
| `render_playbook_page` of a playbook without a page                                                       | `not_found`               |
| A change that meets another change to the org's playbooks at the same moment                              | `conflict`; send it again |

### Links to Studio

`create_playbook`, `create_definition`, `update_definition` and `run_definition` return `studio`, the page in Studio of what they made or ran: the playbook's, the definition's in its playbook, and the playbook's Ledger with the run chosen. A comment carries one too, to the place it is about. The link opens the Studio the runtime names: `/studio/` on its own origin where it serves Studio, and the Studio host, `STUDIO_ORIGIN`, otherwise. It names the runtime the request reached as `server`, its `PUBLIC_URL` where it signs people in, such as `https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&src=agent&playbook=briefs&ledger=&run=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a`.

A run's place is `ledger`, which is empty, then `run`, its id.

A definition's place is its type and its name, as `reasoning=summarize-brief`, then `because`, `created` from `create_definition` and `updated` from `update_definition`, and `version`, the version the call answers: `reasoning=summarize-brief&because=updated&version=3`. An `update_definition` that changes nothing records no version, so its link has no `because` and names the version that stands. The link names no install. Where the runtime's own address is neither `https` nor on this computer, Studio would not open it, so `studio` is left out, and the welcome ends without a link.

A comment's `studio`, which each [comment](#comments) carries, opens its [address](addresses.md) and shows the comment beside it. It opens a place rather than announcing what an agent made, so it has no `src` and no `because`. It carries `server` where the other links do, then the parameters Studio's own address takes, each URL-encoded: one for each segment of the address, and `ledger` before a run's. They come in this order, and only those the address has:

| Parameter       | What it names                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playbook`      | The playbook, for a thing of a playbook                                                                                                                                          |
| `settings`      | The page of Settings, for a thing of the organization's other than `org` itself: the page `org/settings/<page>` names, `connections` for a connection and `members` for a member |
| `<type>=<name>` | The definition, by its type and its name, as the other links name it: `workflow=close-the-week` or `computation=total-spend`                                                     |
| `version`       | The definition's version                                                                                                                                                         |
| `step`          | The step of a workflow, its reference without its leading `/`: `step=do%2F1%2Freview`                                                                                            |
| `ledger`        | The playbook's Ledger, empty, where Studio shows a run, its events and its request                                                                                               |
| `run`           | The run chosen in the Ledger, for a run, an event of a run, a block of its result and a request                                                                                  |
| `event`         | The event of the run                                                                                                                                                             |
| `block`         | The place of a block of the run's result, from 1                                                                                                                                 |
| `comment`       | The comment's id, always                                                                                                                                                         |

So a comment on a step opens `https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&playbook=finance&workflow=close-the-week&version=4&step=do%2F1%2Freview&comment=019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f`, one on an event of a run `…&playbook=finance&ledger=&run=<run id>&event=<event id>&comment=<id>`, and one on the playbook `…&playbook=finance&comment=<id>`. Studio reads a resolved comment with `open=false`, so its link opens it too.

A part adds no parameter: a comment on a part opens the page of its thing, and Studio finds the part there by the comment's address and shows it with the comment. A comment of the organization's own opens:

- on `org`, Studio's home: `…?server=…&comment=<id>`;
- on a page of Settings, Settings at that page: `…&settings=billing&comment=<id>`;
- on a connection, Settings at Connections, with the connection's row: `…&settings=connections&comment=<id>`;
- on a member, Settings at Members, with the member's row: `…&settings=members&comment=<id>`.

## Models

| Operation     | Method and route            | Permission | Input               |
| ------------- | --------------------------- | ---------- | ------------------- |
| `list_models` | `GET /v1/orgs/{org}/models` | `org:read` | Optional `provider` |

`provider` is a provider prefix of 1 to 32 lowercase letters, digits or hyphens, starting with a letter. The result is the same over HTTP and MCP; [Model information](mcp.md#model-information) describes its fields, aliases, wildcard entries and incomplete lists.

## Voice

A person can speak a comment rather than type it. Studio records what they say and sends it to the runtime, which has it written out by the voice model its settings name. These two routes are served over HTTP alone; no MCP tool serves them. They are relative to `/v1/orgs/{org}`:

| Operation    | Method and route             | Permission      | Input                         |
| ------------ | ---------------------------- | --------------- | ----------------------------- |
| `transcribe` | `POST /voice/transcriptions` | `playbook:read` | `audio`, `type` and `seconds` |
| `get_voice`  | `GET /voice`                 | `playbook:read` | None                          |

`get_voice` answers `{ model }`: the voice model as the runtime's settings name it, such as `openai/whisper-1`, or `null` where none is set. A client offers voice only where it answers a model. A runtime that answers `404` to it predates voice and has none.

`transcribe` takes:

- `audio`, the recording, in base64;
- `type`, its media type: `audio/webm`, `audio/ogg`, `audio/mp4` or `audio/wav`;
- `seconds`, how long the recording is, as the caller measured it: a whole number from 1 to 120.

The body is held to the runtime's 1 MiB, as every body is, which holds two minutes of speech recorded as Opus. The runtime sends the recording to the voice model, as [Voice model](model-settings.md#voice-model) sets out, and answers `200` with `{ text }`, the transcription as the model gave it, without the white space around it. A recording in which the model heard nothing answers an empty `text`.

A transcription is a model call, not a run: it starts no run, is in no playbook's history, and the runtime's meter does not count it. It is recorded on the organization's ledger, on a stream of its own, `org/<org>/voice/<id>`, `id` the transcription's, with `at` and `by`, who asked:

| Fact                | When                                                                          | Fields                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `voice_transcribed` | The model answered                                                            | `id`, the transcription's id, a UUIDv7 the runtime gives it; `model`, the voice model as the settings name it; `type`, `audio_bytes` and `seconds`, the recording's media type, its size and its length as the caller gave it; `text_characters`, the length of the `text` answered; `cost_usd`, what the gateway answered in the entry's [`cost_header`](model-settings.md#gateway-fields), or `null` |
| `voice_refused`     | The call reached the model and failed, or the model or its gateway refused it | `id`, `model`, `type`, `audio_bytes` and `seconds`, as above, and `because`, the kind of the failure, as [When a model call fails](model-settings.md#when-a-model-call-fails) names it                                                                                                                                                                                                                 |

The text itself is never recorded, nor the recording. A request refused before the model is called, for its input or since no voice model is set, records nothing. A gateway that meters the organization's calls may refuse a call with a `402` before the model is called; `transcribe` answers it in the gateway's own words, as the table below says.

```http
POST /v1/orgs/acme/voice/transcriptions
Authorization: Bearer <key>
Content-Type: application/json

{ "audio": "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC…", "type": "audio/webm", "seconds": 6 }
```

```json
{ "text": "Flag any entry over ten thousand dollars for Priya before the week closes." }
```

| Case                                                                                    | Response                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No voice model is set                                                                   | `unavailable`, "This runtime has no voice model"                                                                                                                                                              |
| A body over 1 MiB                                                                       | `413` `content_too_large`                                                                                                                                                                                     |
| An `audio` that is empty or not base64                                                  | `invalid_input` at `/audio`                                                                                                                                                                                   |
| A `type` other than the four above                                                      | `invalid_input` at `/type`                                                                                                                                                                                    |
| A `seconds` left out, or not a whole number from 1 to 120                               | `invalid_input` at `/seconds`                                                                                                                                                                                 |
| The model or its gateway refuses the call, fails or does not answer in time             | As a reasoning function's model call ([When a model call fails](model-settings.md#when-a-model-call-fails)), by its kind, and in the gateway's own words only where its entry sets `expose_provider_messages` |
| The gateway refuses the call with a `402` of `credits_exhausted` or `account_closed`    | `conflict` of that kind, with its `resolve_at` and `because` where the gateway gives them; nothing is recorded                                                                                                |
| The gateway refuses the call with a `402` of `meter_unavailable` or `model_not_offered` | `unavailable` of that kind; nothing is recorded                                                                                                                                                               |
| Any other `402`                                                                         | `unavailable`, "`<provider>` could not serve the request (HTTP 402); try again later", recorded as `voice_refused` with `because` `provider_unavailable`                                                      |

## Reasoning functions

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation            | Method and route                             | Permission       | Input                                               |
| -------------------- | -------------------------------------------- | ---------------- | --------------------------------------------------- |
| `create_definition`  | `POST /definitions/reasoning`                | `playbook:write` | `name`, `source`, `diagram`, optional `overview`    |
| `list_definitions`   | `GET /definitions/reasoning`                 | `playbook:read`  | Optional `include_retired`                          |
| `get_definition`     | `GET /definitions/reasoning/{name}`          | `playbook:read`  | Name in path; optional `render` and `sample_output` |
| `update_definition`  | `PUT /definitions/reasoning/{name}`          | `playbook:write` | `source`, `diagram`, optional `overview`            |
| `pause_definition`   | `POST /definitions/reasoning/{name}/pause`   | `playbook:write` | Optional `reason`                                   |
| `resume_definition`  | `POST /definitions/reasoning/{name}/resume`  | `playbook:write` | Name in path                                        |
| `retire_definition`  | `POST /definitions/reasoning/{name}/retire`  | `playbook:write` | Name in path                                        |
| `restore_definition` | `POST /definitions/reasoning/{name}/restore` | `playbook:write` | Name in path                                        |
| `run_definition`     | `POST /definitions/reasoning/{name}/run`     | `playbook:write` | Optional `input`, optional UUID `run_id`            |
| `render_page`        | `POST /definitions/reasoning/{name}/render`  | `playbook:read`  | Optional `sample_output` or `run_id`                |
| `get_run`            | `GET /runs/{run_id}`                         | `playbook:read`  | Run id in path                                      |

The `source` is a [reasoning function document](reasoning-format.md). These rules apply to the definitions of every type:

- A name follows the playbook id rule: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter.
- A name is unique within its type and playbook. A retired definition keeps its name, so no other definition takes it.
- A source document may be at most 65,536 UTF-8 bytes.
- Changing a document, its overview or its diagram creates a version. Updating it with identical source and diagram, and the same overview or none, records no change.
- A run uses the latest version.
- A definition's `status` is `active`, `paused` or `retired`.
- A paused definition starts no runs: `run_definition` of it is refused with `conflict` of the kind `paused`, a workflow step that calls it ends the run `rejected` with `invalid_input` and words that say the function is paused, as a step that calls a retired function does, its triggers start nothing, and the runs already going finish. It can still be read, listed and updated, and an update keeps it paused. Pausing changes neither its version nor its `updated_at`, and it carries `paused_at`, `paused_by`, the caller who paused it by `id` and `name`, and the `reason` given, 1 to 1,024 characters, until it is resumed.
- A resumed definition is `active` again and runs as before. Pausing a paused definition, or resuming an active one, succeeds and records nothing, so both are safe to retry.
- A retired definition can be read, but cannot be edited, run, paused or resumed: those are refused with `conflict` of the kind `retired`. It carries `retired_at` until `restore_definition` brings it back, with its page and its history, at its version: it comes back `paused`, with `paused_at` and `paused_by` the caller who restored it, and runs again once resumed. Restoring is refused with `conflict` where the playbook already keeps as many definitions of the type as it may, as creating one is. Retiring a retired definition, or restoring one that is not retired, succeeds and records nothing.
- A definition carries its `input_schema` and `output_schema` where its document declares them. A reasoning function, a computation function or a workflow whose `output.shape` names an [output shape](output-shapes.md) has the shape's schema as its `output_schema`, and the shape's name as `details.shape`, such as `"details": { "shape": "series" }`. A prediction function has the `series` shape so, since its questions answer a series, and a generation function the `asset` shape. `details` is left out otherwise. `list_definitions` shows both too.

A definition names the caller who created it as `created_by`, by `id` and `name`, and keeps it across its versions.

`create_definition`, `update_definition`, `get_definition`, `pause_definition`, `resume_definition`, `retire_definition` and `restore_definition` return the definition with its `overview`, its `diagram` and its `used_by`; `list_definitions` leaves all three out. `get_definition` of a definition with a page also has `page` ([Pages](#pages)). `create_definition` and `update_definition` return its page in Studio as `studio` too ([Links to Studio](#links-to-studio)).

- `overview` is Markdown its author gives beside `source` for the person who runs the business: why the definition exists, what it does and how it fits, in one to three short paragraphs. It holds 1 character to 16,384 UTF-8 bytes. The version keeps it as written, and an update that leaves it out keeps the overview saved. A definition saved without one has none.
- `diagram` is how a function works as a picture, which Auto Studio draws under the overview. Every `create_definition` and `update_definition` of a function gives it, as one of two choices: Mermaid source of a flowchart or a state diagram, whose first line is `flowchart`, `graph` or `stateDiagram`, optionally with a direction such as `TD`, in at most 8,192 UTF-8 bytes; or the word `none`, when a picture would add nothing. Since Auto Studio draws it at full size in a column, a diagram reads best top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code. The version keeps it as given. A version saved before functions took one has none.
- `used_by` lists the definitions of the playbook, active or paused, that use this one, read from the playbook each time the definition is returned, and is left out when none does. Each gives its `type`, its `name` and its `relation`: `calls` for a workflow whose `run_definition` steps call it, with those `steps`, each its `number`, its place among the workflow's tasks in the order of its document, and its `name`; or `reads` for a lookup function that reads its runs.

The interaction function `approve-brief` that a workflow calls in two steps is returned with this `used_by`, shown here without its other fields:

```json
{
  "used_by": [
    {
      "type": "workflow",
      "name": "briefing",
      "relation": "calls",
      "steps": [
        { "number": 1, "name": "send" },
        { "number": 3, "name": "again" }
      ]
    }
  ]
}
```

A save is refused for its `diagram` in these cases, and nothing is saved:

| Case                                                                                     | Response                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A function saved without `diagram`                                                       | `invalid_input` at `/diagram`: `Say whether this reasoning function has a diagram: give diagram as Mermaid source of a flowchart or a state diagram, or the word none when a picture would add nothing` |
| A `diagram` that is neither a flowchart or state diagram nor `none`, or over 8,192 bytes | `invalid_input` at `/diagram`, which names the two choices or the bound                                                                                                                                 |
| A workflow saved with `diagram`                                                          | `invalid_input` at `/diagram`: `A workflow takes no diagram, since Auto Studio draws a workflow from its steps; leave diagram out`                                                                      |

## Lookup functions

Lookup functions use the operations of reasoning functions, with `lookup` in place of `reasoning` in each route, such as `POST /definitions/lookup` and `POST /definitions/lookup/{name}/run`. The `source` is a [lookup function document](lookup-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

Saving a definition asks the tool server it names for its tools, and a run finishes within the request that starts it, its output what the tool returned at `read`.

| Case                                                                                         | Response                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A save whose tool is marked `acts` or carries no mark, or names a server or tool not offered | `invalid_input` under `/source`, at the line of `call`         |
| A save while the tool server cannot be asked for its tools                                   | `unavailable`, naming the server; nothing is saved             |
| A run whose tool its server no longer marks `reads`                                          | `unavailable` with the kind `tool_not_read_only`; nothing sent |
| A run whose call was sent and could not finish                                               | `unavailable` with the kind `tools_unfinished`                 |

## Interaction functions

Interaction functions use the operations of reasoning functions, with `interaction` in place of `reasoning` in each route, such as `POST /definitions/interaction` and `POST /definitions/interaction/{name}/run`. The `source` is an [interaction function document](interaction-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

A save is refused as `invalid_input` when the document names no way to reach its party, as [How a request reaches its party](interaction-format.md#how-a-request-reaches-its-party) sets out:

- A request that names no `deliver` is refused, and its issue names the connections whose tools can send a request and read its replies, and `deliver: agent`.
- A notification takes no answer, so no agent holds it: it goes through a connection. One that names no tool, or names `deliver: agent`, is refused, and its issue names the connections whose tools can send it.

A run responds with `200`, `status: started` and its `run_id`. It then waits until its request is answered, expires or is cancelled. A function that calls a tool finishes within the request instead: its output is the tool's result, or it ends in one of the endings its format lists.

| Case                                                                                                                                                                                                                                    | Response                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A `to`, a message or an argument that renders a value that is not text, or more bytes than a request or a call may hold, a `to` that renders empty or with a control character, or a `deliver.with` argument the function cannot render | `conflict` with the kind `unworkable`          |
| A `to`, a message or a `call` argument that reads a variable the input does not have, or whose render stops past what a render may take or at a filter that refuses the value                                                           | `invalid_input`                                |
| A server or a tool the playbook may not use                                                                                                                                                                                             | `unavailable` with the kind `tool_not_offered` |
| The playbook has as many open requests as the runtime allows                                                                                                                                                                            | `unavailable` with the kind `requests_full`    |

The requests of a playbook have two routes of their own, relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation            | Method and route             | Permission       | Input                                                   |
| -------------------- | ---------------------------- | ---------------- | ------------------------------------------------------- |
| `list_interactions`  | `GET /interactions`          | `playbook:read`  | Optional `to`, `type`, `function`, `limit` and `cursor` |
| `answer_interaction` | `POST /runs/{run_id}/answer` | `playbook:write` | Run id in path; `answer` and an optional `claimed_for`  |

### Listing open requests

`list_interactions` returns `interactions`, the playbook's open requests newest first, with `has_more` and `next_cursor`. They are the requests of interaction functions. An answered request leaves the list. Anyone who may read the playbook sees each request's party and message, just as they see a run's input.

- `to` keeps only the requests to one party.
- `type` keeps only those from one type of function.
- `function` keeps only those from functions of one name. A name is unique within its type, so `function` with `type` names one function.

Each request has these fields:

| Field            | Contents                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_id`         | The run that asked, which `answer_interaction` takes                                                                                        |
| `type`           | The type of the function that asked                                                                                                         |
| `function`       | The name of the function that asked                                                                                                         |
| `version`        | The version of the function that asked                                                                                                      |
| `to`             | The party the request goes to                                                                                                               |
| `delivery`       | The `server` and `tool` the request is sent through, or `null` for a request held for an agent                                              |
| `message`        | The message of the request                                                                                                                  |
| `takes_answer`   | `true` for a question, `false` for a notification                                                                                           |
| `answer_schema`  | The JSON Schema an answer must match, as the request recorded it when it was asked; `null` for a notification                               |
| `requested_at`   | When the request was made, in ISO 8601 UTC                                                                                                  |
| `expires_at`     | When the request expires unanswered, in ISO 8601 UTC                                                                                        |
| `attempts`       | The delivery attempts made so far                                                                                                           |
| `conversation`   | The conversation the playbook reads replies in, or `null`                                                                                   |
| `answerer`       | The party whose reply counts, or `null`                                                                                                     |
| `reply_refusals` | How many replies from the answerer the playbook refused                                                                                     |
| `standing`       | `held_for_an_agent`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, or `cancelling` once a cancel of its run was asked |

`answer_interaction` checks the `answer_schema` the request recorded. That holds even after the function has a newer version, whose `output_schema` is the one `get_definition` shows. A schema may be up to 64 KiB as JSON, so a page of 100 requests can contain up to 6.25 MiB of schemas. A smaller `limit` keeps a page smaller.

### Answering a request

`answer_interaction` takes the run's `run_id`, an `answer` and an optional `claimed_for`:

- `answer` must match the request's answer schema, and may be at most 64 KiB as JSON.
- `claimed_for` names whom the caller says it is answering for, in at most 256 bytes. The runtime never checks it.

It records the answer on the run as one fact, `request_answered`, and returns that fact:

| Field         | Contents                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| `run_id`      | The run that asked                                                                       |
| `answer_id`   | The id of the fact                                                                       |
| `answer`      | The answer                                                                               |
| `claimed_for` | Whom the caller says it is answering for, when given                                     |
| `answered_by` | The caller who answered, by `id` and `name`; for a run answered by a reply, the playbook |
| `reply`       | For a run answered by a reply, that reply's identity                                     |
| `answered_at` | When the answer was recorded                                                             |

The run takes the answer within about a second (the server checks waiting runs every second by default), as [Answering a request](interaction-format.md#answering-a-request) explains.

- A run of an interaction function succeeds with the answer as its `output`, which reaches a workflow that waits for it.

| Case                                                                                                                       | Response                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| An answer that does not match                                                                                              | `invalid_input` with pointers under `/answer`; the request stays open |
| The same answer again                                                                                                      | The fact the run took                                                 |
| A different answer, an answer to a request that has ended or whose run was asked to cancel, or an answer to a notification | `conflict`                                                            |
| A run the playbook does not have                                                                                           | `not_found`                                                           |

### A request nobody answers

When nobody answers a request before it expires, its run ends `rejected`, with the reason `unanswered` and the kind `expired`. A notification that could not be delivered ends with the kind `undelivered`. A request with the same run id and input then returns that ending as a `410` problem of the type `https://on.auto/problems/unanswered`. [How a run ends](interaction-format.md#how-a-run-ends) lists every ending.

## Computation functions

Computation functions use the operations of reasoning functions, with `computation` in place of `reasoning` in each route, such as `POST /definitions/computation` and `POST /definitions/computation/{name}/run`. The `source` is a [computation function document](computation-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

A run finishes within the request that starts it. Saving a definition checks its program, and refuses each problem under `/source` with its line.

| Case                                                                                       | Response                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| A ready checker does not finish the check within 2 seconds of the server's wall-clock time | `invalid_input`; nothing is saved                     |
| A save finds no checker ready                                                              | `unavailable` (503); the same call may be tried again |
| The program cannot produce its output for the input                                        | `conflict` with the kind `unworkable`                 |

A program cannot produce its output when it:

- raised an error;
- returned a value JSON cannot represent, or an output larger than a run may record (see [Runs and results](#runs-and-results));
- did more work or used more memory than a run allows.

The same input gives the same `unworkable` result again, unless the program reads the clock. Change the definition or the input rather than retrying.

## Pages

Give every workflow and function its page, which presents its results ([Page format](page-format.md)). A save without one is accepted, and over MCP its summary says the definition has no page yet, where the summary has room for it. The page is the `page` key of the definition's document, so `create_definition` and `update_definition` save it with the rest of `source`, and a save that changes only the page is a new version like any other. The playbook's page is saved by [`update_playbook`](#playbooks).

- `get_definition` adds `page`, with `runs` and `standing` where the page has them, and `get_run` of a run of the definition adds `page.result`. `list_definitions` shows nothing of a page.
- `render_page`, `POST /definitions/{type}/{name}/render`, renders the page now, with `page.result` and `page.runs`, over the definition's latest run or over an optional JSON body `{ "sample_output": … }`. It needs `playbook:read`, and is refused with `not_found` for a definition without a page and `conflict` for a retired one.
- Given `{ "run_id": … }` in place of `sample_output`, `render_page` answers the page as it stood when that run ended: `page.result`, and `page.runs` and `page.standing` over the views folded again up to the run's last event. A run still going renders over the views as they stand.
- The replay reads at most 10 pages of up to 1,000 records. Past that, `page.standing.state` is `out_of_reach` and `page.runs` is a line that says so.
- A run the playbook does not have is refused with `not_found`, and a run of another definition with `invalid_input`. See [As of a run](page-format.md#as-of-a-run).
- Retiring a definition retires its page with it.

See [What reads render](page-format.md#what-reads-render).

## Prediction functions

Prediction functions use the operations of reasoning functions, with `prediction` in place of `reasoning` in each route, such as `POST /definitions/prediction` and `POST /definitions/prediction/{name}/run`. The `source` is a [prediction function document](prediction-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

- A playbook may have at most 32 prediction functions, active or paused.
- A question finishes within the request that asks it, and the runtime's forecaster makes the prediction. A question such as `{ "series": "north", "horizon": 1 }` answers a [series](output-shapes.md#series) whose `observed` line holds the last periods of the dataset and whose `predicted` line holds the period asked, with its `value`, `low` and `high`; without `horizon` it holds every horizon the function names. The run's `record` holds the `method` the forecaster used, the `coverage` and the `history` it backtested. [The input and the output](prediction-format.md#the-input-and-the-output) has every field, and [A question](prediction-format.md#a-question) an answer in full.
- A series whose history is too short to forecast from is refused as `conflict` with the kind `history_too_short`, its `detail` naming the periods it has and the periods it needs.
- `get_definition` adds the dataset's `standing`.

## Generation functions

Generation functions use the operations of reasoning functions, with `generation` in place of `reasoning` in each route, such as `POST /definitions/generation` and `POST /definitions/generation/{name}/run`. The `source` is a [generation function document](generation-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions). A run's output is the [asset](output-shapes.md#asset) it made, with an address that lasts 15 minutes from the end of the run.

It finishes within the request that starts it, unless the provider finishes the generation later, as it does a video: then `run_definition` returns the run `started`, as [A generation the provider finishes later](generation-format.md#a-generation-the-provider-finishes-later) sets out. The [catalogue](generation-format.md#the-models) names no model that produces video, so a function that produces video is refused as it is saved. [How a run ends](generation-format.md#how-a-run-ends) lists its endings.

The assets of a playbook have an operation of their own, relative to `/v1/orgs/{org}/playbooks/{playbook}`, which reads an asset again with an address signed as it is read:

| Operation   | Method and route   | Permission      | Input            |
| ----------- | ------------------ | --------------- | ---------------- |
| `get_asset` | `GET /assets/{id}` | `playbook:read` | Asset id in path |

| Field                      | Value                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | The asset's id, as the output of the run that made it gives it, or the result of the tool call that answered it                                                                                                                                      |
| `media_type`, `bytes`      | The media type and the size of its bytes                                                                                                                                                                                                             |
| `sha256`                   | The SHA-256 of its bytes, in lowercase hex                                                                                                                                                                                                           |
| `model`                    | The model that made it, or `null` for an image a tool answered                                                                                                                                                                                       |
| `kept_at`                  | When the playbook kept it                                                                                                                                                                                                                            |
| `expires_at`               | When it expires, or `null` once its expiry is recorded                                                                                                                                                                                               |
| `expired_at`               | When its expiry was recorded, or `null` while it is kept                                                                                                                                                                                             |
| `expired`                  | `true` from the moment the asset expires, whether or not its expiry is recorded yet                                                                                                                                                                  |
| `content_removed`          | `true` once its content was removed, which happens when it expires and nothing else of the playbook holds the same bytes                                                                                                                             |
| `address`, `address_until` | A [signed address](#content-at-a-signed-address) its bytes are read at without a key, signed as it is read and answered for 15 minutes, until `address_until`; both `null` from the moment the asset expires, and where the runtime signs no address |

| Case                                                                           | Response                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| An `id` that is no UUID                                                        | `invalid_input` at `/id`                               |
| No asset of the playbook has the `id`, an asset of another playbook among them | `not_found`, "There is no such asset in this playbook" |

## Workflows

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation           | Method and route                           | Permission       | Input                                                                  |
| ------------------- | ------------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| `create_definition` | `POST /definitions/workflow`               | `playbook:write` | `name`, `source`, optional `overview`                                  |
| `list_definitions`  | `GET /definitions/workflow`                | `playbook:read`  | Optional `include_retired`                                             |
| `get_definition`    | `GET /definitions/workflow/{name}`         | `playbook:read`  | Name in path; optional `render` and `sample_output`                    |
| `update_definition` | `PUT /definitions/workflow/{name}`         | `playbook:write` | `source`, optional `overview`                                          |
| `pause_definition`  | `POST /definitions/workflow/{name}/pause`  | `playbook:write` | Optional `reason`                                                      |
| `resume_definition` | `POST /definitions/workflow/{name}/resume` | `playbook:write` | Name in path                                                           |
| `retire_definition` | `POST /definitions/workflow/{name}/retire` | `playbook:write` | Name in path                                                           |
| `run_definition`    | `POST /definitions/workflow/{name}/run`    | `playbook:write` | Optional `input`, optional UUID `run_id`                               |
| `render_page`       | `POST /definitions/workflow/{name}/render` | `playbook:read`  | Optional `sample_output` or `run_id`                                   |
| `get_run`           | `GET /runs/{run_id}`                       | `playbook:read`  | Run id in path                                                         |
| `cancel_run`        | `POST /runs/{run_id}/cancel`               | `playbook:write` | Optional `reason`                                                      |
| `send_run_event`    | `POST /runs/{run_id}/events`               | `playbook:write` | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

### A saved workflow

The `source` is a [workflow document](workflow-format.md). Names, document size, versions, pausing and retirement follow the rules for [reasoning functions](#reasoning-functions).

- A saved workflow has the `media_type` `application/yaml`.
- A workflow takes no `diagram`, and one given is refused: Auto Studio draws a workflow from its steps, with the words [Describing steps](workflow-format.md#describing-steps) sets out.
- Its `description`, `input_schema` and `output_schema` come from the document, the `output_schema` from its `output.shape` where it names one, with `details.shape`.
- A workflow whose document has a `schedule` also has `triggers`, in `get_definition` and `list_definitions`. They are the [triggers](workflow-format.md#triggers) its schedule names, in the order it names them.

| Trigger field  | Contents                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| `kind`         | `event`, `cron` or `every`                                                            |
| `reference`    | `/schedule/on`, `/schedule/cron` or `/schedule/every`                                 |
| `filters`      | For an event trigger: its filters, each with its `reference`, `type` and `attributes` |
| `expression`   | For a cron trigger: its expression                                                    |
| `time_zone`    | For a cron trigger whose schedule names one: its time zone; without it, UTC           |
| `milliseconds` | For an every trigger: its period                                                      |

A paused workflow's triggers start nothing: a time its schedule names and an event its trigger matches while it is paused are not run, and resuming it makes up none of them, so its next run is at the first time or event after it was resumed. A version saved while it is paused takes over its triggers as any version does, and starts nothing until it is resumed.

`get_definition` of an active workflow with triggers adds `triggers_since`: the id of the record that saved its current version. From that record on, every run its triggers start is a run of this version. `triggers_since` is one id for the whole workflow. A trigger that a later version left unchanged continues from the record that first saved it in that form, which `triggers_since` does not show.

### Running a workflow

- `run_definition` returns `200` as soon as the run begins, with its `run_id` and `status: started`. A run that ended before its first wait returns how it ended.
- Read the run with `get_run` until its status is `succeeded`, `rejected` or `failed`.
- Read its steps with `get_run_history`, which contains one `workflow_input_applied` event for each input the run took (see [Run history and playbook events](#run-history-and-playbook-events)).
- While the runtime is stopping, `run_definition` returns `unavailable`; try again shortly.

A workflow runs once for each `run_id`. [Retrying under a run id](#retrying-under-a-run-id) says what a request with the id of an earlier run returns.

### Sending an event to a run

`send_run_event` delivers an event to a run that is still `started`. It returns the `run_id` and the delivered `event`, with these filled in:

- `id`, which the runtime makes when you leave it out;
- `source`, which is `/callers/` and your caller id when you leave it out;
- `time`, when it was sent.

| Part of the event | Limit                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| The whole event   | 256 KiB as JSON                                                                   |
| `type`, `id`      | 256 characters each                                                               |
| `source`          | A URI reference such as `/ledger/eu`, as for a published event; 1,024 characters  |
| `subject`         | 1,024 characters                                                                  |
| `data`            | Nests at most 510 levels deep, so that the run can keep the whole event in a list |

A run accepts an event with a given `id` only once, so a request can be retried with the same id.

| Case                                                                                                                                                                 | Response                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A type or source the runtime reserves for its own facts, as listed under [Publishing events](#publishing-events)                                                     | `invalid_input`                  |
| Text a published event may not contain: a control character, a lone surrogate or a noncharacter, or a `type`, `id` or `subject` with no character other than a space | `invalid_input`                  |
| The playbook has no running workflow with that run id, including one that has ended                                                                                  | `not_found`                      |
| The run cannot take the event at that moment, such as while the runtime is stopping                                                                                  | `unavailable`; try again shortly |

### Cancelling a run

`cancel_run` needs `playbook:write`. It cancels:

- a workflow run that is still `started`;
- the run of a reasoning function that is still `started`, whether its client is there or gone;
- the run of an interaction function whose request waits.

It takes an optional `reason`, 1 to 1,024 characters with no control character. The run keeps it as the detail of its ending; without one, the detail says who asked.

1. The request is recorded on the run at once, whichever server takes it. `cancel_run` returns `200` with the run as it stands: still `started`, or already `rejected` for a reasoning run the server that took the request was running.
2. Within a moment the run stops its tasks and cancels each run it waits for.
3. It ends `rejected` with the reason `cancelled` and the kind `requested`. Read it with `get_run`.

A reasoning run its client started is stopped at once in the server where it is going, each call it has in flight ended as `interrupted`; so is one a workflow's step started when its workflow cancels it. One a workflow's step started that `cancel_run` cancels, or one going in another server, stops before its next model call or tool call, so it may go on for as long as one call of it may take: a call it already sent still answers and its answer is recorded, and a run whose last model call answers ends with that answer. Either way, the run records the spending of its model calls so far, and no call of it is left started without an end. A reasoning run whose server stopped before the run met the cancel stays `started`, its cancel recorded, until a request with its `run_id`, or the workflow that started it, asks for it again, which ends it cancelled.

Asking again before the run has ended records nothing more.

| Case                                            | Response    |
| ----------------------------------------------- | ----------- |
| The playbook has no run with that id            | `not_found` |
| The run has ended                               | `conflict`  |
| The run ends within the request that started it | `conflict`  |

These runs end within the request that started them, so they cannot be interrupted from outside:

- the run of a computation function;
- the run of an interaction function that calls a tool;
- a prediction function's question.

When the request that started one is lost, the run stays `started` until the workflow that waited for it cancels it, at its step's deadline or because it ended first. A cancel made once the run has been quiet for longer than it may take ends it `rejected` with the reason `cancelled` and the cancel's kind, a tool call it left unanswered ended as `interrupted`, and its `detail` says whether that call may have changed something. One made sooner is recorded alone, and a later cancel of the run ends it the same way.

A cancelled run's rejection names the kind of its cancellation:

| Kind           | The run was cancelled because                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `requested`    | someone allowed to change the playbook asked, with `cancel_run`                           |
| `deadline`     | the workflow that waited for it ran out of time                                           |
| `overrun`      | it ran as long as a workflow may run                                                      |
| `parent_ended` | the workflow that waited for it ended first, or the branch that waited for it lost a race |

## Runs and results

A run records its `run_id`, `type`, `name`, `definition_version`, `status`, timestamps and `started_by`, the caller who started it, by `id` and `name`. A run a trigger started, and each run its workflow's steps start, has `acts_for`, the id of the person it acts for, such as `person:user_7kLm2`: whoever saved or restored the version the trigger runs, where that was a person ([When a trigger applies](workflow-format.md#when-a-trigger-applies)). It grants the run nothing, and a run without it acts for its caller where that is a person. A successful run includes `output`, and a rejected run includes a rejection. `get_run` also returns the detailed `record` and, where the run's definition has a page, `page.result`, the run as that page shows it ([Pages](#pages)). `run_definition` returns the run in Studio as `studio` ([Links to Studio](#links-to-studio)). A run that a workflow's step started has `within`, which names that step. Its `run_id` is the workflow's run, and its `step` is the step's reference without its leading `/`, such as `do/1/review`. The `called_by` of the run's events says which call of the step it answered ([Event fields](#event-fields)). A run that no step started has no `within`. A run whose output takes an [output shape](output-shapes.md#what-a-run-shows) says it as `output_shape`, such as `"output_shape": "series"` on a question to a prediction function; a run of a definition that declares no shape has none.

Most runs finish within the request that starts them. These runs finish later, so `run_definition` returns them `started`, unless one ended before its first wait:

- a workflow's run, whose `record` is empty while it is in progress;
- an interaction function's run that asks a person, or that sends a notification through a tool;
- a generation function's run that waits for a generation the provider finishes later.

Read such a run again with `get_run` until its status is `succeeded`, `rejected` or `failed`. A cancelled run is `rejected` with the reason `cancelled`. [Workflows and runs](../concepts/workflows.md) explains how a run waits and ends.

| What                       | Limit                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input                      | 256 KiB as encoded JSON, nesting at most 512 levels deep, as deep as a workflow can hold a value. A deeper one returns `invalid_input` at `/input` |
| Output and record together | 1 MiB (1,048,576 bytes) as JSON                                                                                                                    |

These limits apply independently of the request-body limit.

A run's output and its record share that 1 MiB. Each type of definition makes room for its record in its own way, so the largest output differs by type:

| Type                    | Largest output                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reasoning               | What leaves room for the record. The record keeps less of the prompt to fit; an answer that leaves too little room ends `conflict`, `unworkable` |
| Interaction with `call` | 1 MiB less the run's record, measured exactly                                                                                                    |
| Computation             | 1,048,320 bytes: the function keeps 256 bytes for its record                                                                                     |
| Workflow                | 1,048,574 bytes; a larger output ends the run `conflict` with the kind `oversized`                                                               |

A function's output past its bound ends the run `conflict` with the kind `unworkable`. Each format page repeats the bound for its type.

### Retrying under a run id

`run_definition` takes an optional `run_id`, a UUID. Supply one to retry a request without doing the work twice, or to read the run later. The runtime keeps one run under each id.

A request that reuses an id for another definition or another input returns `conflict`. A request with the same definition and input gets what the run under that id recorded:

| The run under that id                                                                                                                  | A request with the same id and input                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Succeeded                                                                                                                              | Returns the recorded output; nothing runs again                                                                                                                                                 |
| Was rejected as `invalid_input`                                                                                                        | Returns the same rejection                                                                                                                                                                      |
| Was cancelled                                                                                                                          | Returns its cancellation, `cancelled` (409)                                                                                                                                                     |
| Went unanswered                                                                                                                        | Returns `unanswered` (410), as [A request nobody answers](#a-request-nobody-answers) says                                                                                                       |
| Still waits: a workflow run or an interaction function's request                                                                       | Returns the run as it stands, still `started`, and starts nothing                                                                                                                               |
| Has no final result: it ended `unavailable`, `conflict` or `failed`, or it is `started` without waiting, such as after an interruption | Runs the definition again, as a new attempt. The attempt may use the latest version, and records the one it used. A `started` run of a reasoning function goes on from what it recorded instead |

The last row has three exceptions.

A workflow runs once for its id. A request with the id of a workflow run that ended without a final result returns `conflict` with the kind `unworkable`, once its input passes the workflow's input schema, which is checked first. Its detail says to use a new run id.

A `started` run of a reasoning function is never started a second time. A request with its id goes on from what the run recorded, at the version it started with, and answers when the run ends. In the server where the run is going, the request waits for it to end. Elsewhere, while the run's last event, by the database's clock, is newer than the longest gap between two events of a run that is still going, the run may still be running, and the request returns `conflict` with the kind `taken`, saying so. [A run performed again](reasoning-format.md#a-run-performed-again) gives the rule, and what a model call or a tool call without an answer becomes.

A run that may have called a tool is never attempted again under its id once it ended. That is a run of a lookup function, of a reasoning function with `tools`, or of an interaction function with `call`:

- A run that recorded a tool call and ended without a final result returns `conflict` with the kind `tools_called`. When every tool it called is marked `reads`, the rejection adds `because: "only_read"`, and its words say nothing was changed.
- A run of a lookup function, or of an interaction function with `call`, that is still `started` returns `tools_called` too, even before its first recorded call, since it may still be in progress.
- A run that ended before its first call, for example with `tool_not_offered` or `tool_server_failed`, runs again like any other.

After `tools_called`, read what the run called with `get_run_history`, and check its effects outside the playbook. Then start a new run under a new id, which calls the tools again. [When a tool-calling run cannot finish](reasoning-format.md#when-a-tool-calling-run-cannot-finish) gives the endings that come before it, `tools_unfinished` and `effect_unknown`.

A workflow step that calls a function meets the same rules when the server performs the step again, for example after a restart. A reasoning function's run goes on at once from what it recorded, since the workflow host knows the server before it stopped. An interaction function's run that may have called its tool raises `tools_called` in the workflow; see [When the function's run does not succeed](workflow-format.md#when-the-function-s-run-does-not-succeed).

The runtime records one final result for each run id. That does not mean an external effect happened only once.

## Publishing events

`publish_event` records an event in a playbook, such as a month closed in a ledger or a deal won in a CRM.

| Operation       | Method and route                                  | Permission       | Input   |
| --------------- | ------------------------------------------------- | ---------------- | ------- |
| `publish_event` | `POST /v1/orgs/{org}/playbooks/{playbook}/events` | `playbook:write` | `event` |

The body contains `event`, a [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) event:

| Attribute                       | Required | Contents                                                                                                                          | Limit                                                        |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `source`                        | Yes      | Where the event comes from, a URI reference such as `/ledger/eu` or `https://acme.example/ledger`                                 | 1,024 characters                                             |
| `type`                          | Yes      | What happened, such as `com.acme.ledger.month-closed`                                                                             | 256 characters                                               |
| `id`                            | No       | Unique among the events of its source; the runtime makes one when you leave it out                                                | 256 characters                                               |
| `time`                          | No       | When it happened, in RFC 3339 such as `2026-10-01T09:00:00Z`; when it is left out, the runtime uses the time it records the event |                                                              |
| `subject`                       | No       | What the event is about within its source                                                                                         | 1,024 characters                                             |
| `specversion`                   | No       | `1.0`                                                                                                                             |                                                              |
| `datacontenttype`, `dataschema` | No       | The media type of `data`, such as `application/json`, and the absolute URI of a schema it follows                                 | 256 characters for `datacontenttype`, 1,024 for `dataschema` |
| `data`                          | No       | Any JSON value                                                                                                                    | Nests at most 510 levels                                     |

- The event, with its id and time filled in, may be at most 240 KiB as JSON.
- `data` nests at most 510 levels deep, so that a run can keep the event in a list. A deeper one returns `invalid_input` at `/event/data`.
- Any other attribute is an extension, and an event may have at most 32. Its name is 1 to 20 lowercase letters and digits. Its value is a string, a boolean or an integer from -2,147,483,648 to 2,147,483,647, and it is kept as given.

As CloudEvents requires:

- no attribute but `data`, an extension's included, may contain a control character, a lone surrogate or a noncharacter; strings inside `data` are not checked for them;
- `id`, `type` and `subject` need a character that is not a space;
- `datacontenttype` is a media type;
- a `time` has a second of 60 only at the end of a day in UTC.

```http
POST /v1/orgs/acme/playbooks/finance/events
Content-Type: application/json

{
  "event": {
    "source": "/ledger/eu",
    "type": "com.acme.ledger.month-closed",
    "id": "2026-09",
    "subject": "september",
    "data": { "region": "eu", "revenue": 120000 }
  }
}
```

It returns `200` with the event's `id` and `time`, and `recorded_at`, when the playbook recorded it:

```json
{ "id": "2026-09", "time": "2026-10-01T09:00:00.000Z", "recorded_at": "2026-10-01T09:00:00.000Z" }
```

`list_playbook_events` shows each published event as an `event_published` event. A published event starts the workflows whose [event trigger](workflow-format.md#triggers) matches it, and reaches the runs listening for its type.

### Publishing the same event again

A playbook keeps one event for each `source` and `id`, so a request can be retried with the same id.

- Publishing the same event again records nothing, and returns the first `id`, `time` and `recorded_at`.
- A retry that leaves out `time` is the same event.
- A retry that gives a `time` to an event first published without one is the same event too. It returns the time the runtime filled in the first time, not the one the retry gave.
- Times are compared as instants, so `2026-10-01T10:59:00+02:00` is the same time as `2026-10-01T08:59:00Z`.
- A leap second counts as the first second of the next day, so `2016-12-31T23:59:60Z` is the same time as `2017-01-01T00:00:00Z`.
- A different event with the same `source` and `id` returns `conflict`.
- Without an `id`, every request records a new event.

### What the runtime keeps for itself

Some types, sources and attributes are reserved for what the runtime records itself. An event that uses one returns `invalid_input`:

| Reserved   | Names                                                                                                                                 | Refused at                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Types      | Every type the playbook's events show and every fact the playbook's capabilities declare, listed below                                | `/event/type`                      |
| Sources    | Those beginning `/runs/`, `/definitions/` or `/callers/`                                                                              | `/event/source`                    |
| Attributes | `causationid`, `correlationid`, `caller`, `definitionversion`, `depth`, `calldepth`, `calledby`, `triggerkind` and `triggerreference` | `/event/` and the attribute's name |

The reserved types are `run_started`, `run_deferred`, `attempt_resumed`, `run_succeeded`, `run_rejected`, `run_failed`, `run_cancel_requested`, `tool_call_started`, `tool_call_answered`, `tool_call_failed`, `model_call_started`, `model_call_answered`, `model_call_failed`, `request_answered`, `delivery_started`, `delivery_succeeded`, `delivery_failed`, `delivery_refused`, `reply_refused`, `telling_started`, `telling_succeeded`, `telling_failed`, `replies_read`, `reading_failed`, `interaction_requested`, `asset_kept`, `asset_expired`, `asset_content_removed`, `definition_created`, `definition_updated`, `definition_retired`, `definition_paused`, `definition_resumed`, `playbook_page_saved`, `event_published`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped` and `reaction_refused`.

A run of a reasoning function also records each call of its model: `model_call_started`, then `model_call_answered` with the tool calls the model asked for, or `model_call_failed` with `because`. [The run's model calls](reasoning-format.md#the-run-s-model-calls) gives their fields.

The reserved attributes are the ones the playbook gives its own events; see [Event filters](workflow-format.md#event-filters). So a published event cannot claim a cause, a caller or a depth it does not have.

## Run history and playbook events

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation              | Method and route             | Permission      | Input                                                             |
| ---------------------- | ---------------------------- | --------------- | ----------------------------------------------------------------- |
| `list_runs`            | `GET /runs`                  | `playbook:read` | Optional `type`, `name`, `status`, `steps`, `limit` and `cursor`  |
| `get_run_history`      | `GET /runs/{run_id}/history` | `playbook:read` | Run id in path; optional `order`, `limit` and `cursor`            |
| `list_playbook_events` | `GET /events`                | `playbook:read` | Optional `type`, `since`, `run_id`, `order`, `limit` and `cursor` |
| `get_event`            | `GET /events/{event_id}`     | `playbook:read` | Event id in path                                                  |

A retired playbook stays readable: these reads work on it, while every change to it is refused with `conflict`. The playbook's own creation, changes and retirement are not playbook events; `get_playbook` shows them.

### Listing runs

`list_runs` returns `runs`, newest first by when each run first started.

- A listed run has the fields `get_run` returns, without `output`, `record` and the detail and issues of a rejection.
- A rejection shows its `reason`, with `kind` and `because` when the function gave them.
- `status` keeps only the runs whose status is `started`, `succeeded`, `rejected` or `failed`.
- `type` and `name` keep only the runs of one definition.
- `steps: false` leaves out the runs that a workflow's step started. Left out, `steps` is `true`, and those runs are listed among the others, each with its `within`.

### A run's history

`get_run_history` returns the `events` of one run in the order the playbook recorded them, oldest first unless `order` is `desc`. Each event comes after the event that caused it. The events are the facts the runtime recorded about the run: each start and how it ended. A run that does not exist in the playbook returns `not_found`.

Runs that use tools (a lookup function's, a reasoning function's, and an interaction function's that calls a tool) also record each call:

- `tool_call_started`, with `read_only: true` when the tool's [mark](#the-mark-of-a-tool) is `reads`, and `connection_id` beside `server` when the server is a connection a person added;
- then `tool_call_answered` when the tool answered, with `is_error` when its result is an error of its own;
- or `tool_call_failed` when it never answered, with `because`: `arguments_refused`, `server_failure`, `timed_out`, `cancelled`, `too_large` when the tool's result was larger than one call may return, or `interrupted` for a call still open when its attempt ended, because the run was cancelled or its server stopped; see [Cancelling a run](#cancelling-a-run) and [A run performed again](reasoning-format.md#a-run-performed-again).

The run of an interaction function records its request and its deliveries. Each delivery attempt starts with `delivery_started` and ends with `delivery_succeeded`, `delivery_failed` or `delivery_refused`.

| Event                   | Shows                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `interaction_requested` | The delivery, the party, the size of the message and the expiry                                                                       |
| `delivery_started`      | The tool, the connection's `connection_id` where its server is one, and the size and digest of its arguments                          |
| `delivery_succeeded`    | Where the request landed and where its replies are read                                                                               |
| `delivery_failed`       | `because`, including `too_large` for a result larger than one call may return, and `retry_after_ms` when the server asked for a delay |
| `delivery_refused`      | `because`, `too_large` or `unworkable`                                                                                                |
| `request_answered`      | The answer the run took, `claimed_for` and, for a reply, its identity                                                                 |
| `reply_refused`         | Each refused reply's identity, never its words                                                                                        |

Each of the three endings of an attempt also shows the size and digest of the tool's result, when there was one. That result is the run's output, which its `run_succeeded` shows.

A workflow's history also contains one `workflow_input_applied` event for each input its run took. Each is followed by one event for each step that input moved, named for the state the input left the step in:

- `step_waiting`, `step_finished`, `step_failed` or `step_skipped`;
- `step_started` for a step that runs others, such as a `do` or a `fork`, and was still running.

A step that starts and finishes in one input shows only `step_finished`.

### The playbook's events

`list_playbook_events` returns the `events` of the whole playbook, newest first unless `order` is `asc`. They include:

- definitions created, updated and retired;
- runs started and ended;
- tool calls, and tests of a tool;
- the playbook's reads of a conversation, `replies_read` or `reading_failed`;
- its tellings, `telling_started` and then `telling_succeeded` or `telling_failed`;
- the inputs workflow runs took;
- the events published to the playbook.

| Filter   | Keeps                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `type`   | One event type                                                                                          |
| `since`  | What the playbook recorded from that time on, in either order                                           |
| `run_id` | What one run and every run it started recorded, such as the functions a workflow called: its whole tree |

`since` is an ISO 8601 time with its offset, such as `2026-10-05T09:00:00Z`. Its date must exist in the calendar and its hour must run from 00 to 23, so `T24:00:00Z` is refused.

A run that another run started belongs to the tree of the run at its top, so filtering by its own id returns no events. Read the tree from the id of the run you started.

### Tool-call content

Tool-call events identify the server, the tool, the sizes of the arguments and the result, and how each call ended. The playbook keeps the full arguments and result of every call, scrubbed of secrets, unless the operator turns `record_content` off for the server.

- The sizes are of the scrubbed text the playbook keeps.
- A kept text's SHA-256 digest, `arguments_sha256` or `result_sha256`, is the key it is kept under. It is present only when the text was kept.
- The history shows `arguments` and `answer` when each is at most 2 KiB, and otherwise their sizes. `get_event` reads one event with both in full.
- Anyone with read access to the playbook can read that history.

A started call without an answer may have had an external effect; absence of an answer does not prove it was cancelled before acting.

### Event fields

Each event has these fields, and no others:

| Field      | Contents                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`       | The event's id, a UUID that stays the same on every read; a step's is its input's id, an underscore and a number |
| `type`     | What happened, such as `run_started`, `delivery_failed` or `step_finished`                                       |
| `summary`  | A sentence in plain language                                                                                     |
| `data`     | The fact itself, at most 4 KiB as JSON                                                                           |
| `metadata` | Where the event is recorded, when, who acted, and which definition, run and chain it belongs to                  |

`metadata` always has the first seven fields below, and each other field only when the event has it:

| Field                 | Contents                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream`              | The stream the event is recorded in, such as `playbook/acme/finance/runs/<run id>`                                                                                                                                  |
| `position`            | The event's number in its stream, from 1                                                                                                                                                                            |
| `global_position`     | The store's sequence across every playbook, with gaps; it is not the order a page reads events in                                                                                                                   |
| `correlation_id`      | The id of the run at the top of the chain the event belongs to, or `null`                                                                                                                                           |
| `causation_id`        | The `id` of the event that directly led to this one, or `null` when nothing recorded did, such as for a run you started                                                                                             |
| `at`                  | When it happened, by its own clock, in ISO 8601 UTC                                                                                                                                                                 |
| `by`                  | Who acted: a caller's id, `playbook:` and the playbook's id for the playbook's own work, or `runtime` for what the runtime records of its own accord, such as a connection whose credential it found it cannot read |
| `run_id`              | The run the event belongs to, when it belongs to one                                                                                                                                                                |
| `definition`          | The `type`, `name` and, when the event names one, `version` of the definition the run carries out or the event is about                                                                                             |
| `called_by`           | On a run a workflow's call started: the calling run's `run_id`, the `reference` of the call in its document, and `run`, which run of the call it is                                                                 |
| `call_depth`          | On a run a call started: how many calls are above it                                                                                                                                                                |
| `depth`               | On a run a trigger or another run started, and on an event a workflow emitted: how many reactions are above it                                                                                                      |
| `trigger`             | On a run a trigger started: its `kind`, `event`, `cron` or `every`, and its `reference` in the document                                                                                                             |
| `acts_for`            | On a run a trigger started, and on the runs its steps started: the id of the person it acts for, as on the run                                                                                                      |
| `trace_id`, `span_id` | The trace and span of the append that recorded the event, one pair for every event of one append; with telemetry on, the trace the server exported                                                                  |

### What `data` shows

`data` keeps each event within 4 KiB:

- Large values are shown in full when each is at most 2 KiB as JSON. They are an input, an output, a record, an answer, a call's arguments, a model call's messages, response, tool calls, warnings, issues and repair, and a published event's data. A larger one is shown as its size in bytes, under its name plus `_bytes`, such as `output_bytes`. A call's `result` is never shown by `get_run_history` or `list_playbook_events`, only its size, `result_bytes`; `get_event` reads it in full.
- When the event's data would still be larger than 4 KiB, its largest field is shown as its size first.
- A definition's document and schemas appear as their sizes. Its description shows its first 300 characters, and its warnings as a count.
- A rejection shows its reason, its detail shortened to fit, and for invalid input the number of issues and the first five.
- A rejection that kept a record shows the record as a success does. A run of a reasoning function keeps one when it is rejected after its model answered.

The full values are read elsewhere: `get_run` returns a run's output and record, `get_definition` a definition's document and schemas, and `get_event` one event with every field in full.

Some events show more in `data`:

- `workflow_input_applied` shows the kind and key of the input and how many steps it moved. It lists the first five, each with its task, run and outcome. For a function's rejection that has a kind and a `because`, it shows both, and its summary says them in words. It also shows the kinds of what the run did next. It never shows the run's data.
- A step event shows the step's `name` and its `reference` in the document. It also shows `run`, which counts each time the step starts, and `times`, which counts how often it moved that way in that run.
- `step_waiting` adds what it waits for, `call`, `timer`, `event` or `admission`. For a call it adds the `run_id` of the run it started, whose `run_started` names the input that started the call as its cause. For `admission`, a call the meter would not start for now ([When the runtime will not start the run for now](workflow-format.md#when-the-runtime-will-not-start-the-run-for-now)), it adds the refusal's `detail`, its `kind`, its `because`, its `resolve_at`, its `lifts_at` and its `limited_because` where it gave them, `retry_at`, when the step tries again, and `until`, when it stops waiting, both in ISO 8601 UTC; its summary says what it waits for, why, when it tries again and stops waiting, and where to fix it.
- `step_failed` adds how it failed, and its error's type and title.
- `event_published` shows the published event's `event_id`, `event_type`, `source`, `subject`, `time` and `data`, and which attributes the runtime `filled` in.
- `reaction_refused` shows how many times in the `minute` a trigger did not start its workflow, as `count`, and the last `reason`.

Some events say more in their `metadata`:

- For an event a workflow emitted, `metadata` names the run in `run_id`, the workflow and its version in `definition`, and its depth in a chain of triggers in `depth`.
- A `reaction_refused` event's `metadata` names the workflow and the version whose trigger refused, in `definition`.
- A run that a trigger started shows `playbook:` and the playbook's id as `by`. Every event of it shows the `trigger` that started it in its `metadata`, with its `kind` and `reference`, and, where it acts for a person, `acts_for`. Its `run_started` says in words which kind it was, such as "was started by its every schedule".

### How events link

Each event's `causation_id` links the events of a run into a graph.

- A run you start has no cause.
- A workflow run's start is followed directly by its inputs and their steps. Its first input is caused by its start.
- A step's event has the id of the input that moved it, an underscore and its number among the steps that input moved, such as `<input id>_2`.
- A step's event is caused by what came before it in that input:
  - the input, for the first step;
  - the step before it in its list;
  - the `switch` that chose it;
  - the `fork` it is a branch of;
  - the failed attempt a retry repeats.
- A step that continues from an earlier input is caused by the input that moved it on. That input (a call's result, a delivered event or a fired timer) is caused by the input whose step waited for it.
- A run that a step's call started is caused by the input that started the call, and the run's end by the input that ended it.
- A run that an event trigger started names the event's record as its cause.
- A run that a schedule started names as its cause the record that saved its schedule in its current form. That record comes before the record of the run's `definition_version` when a later version left the schedule unchanged.

### Reading one event

`get_event` reads one event in full by its id, as `get_run_history` and `list_playbook_events` show it. It has the same `type`, `summary` and `metadata`. Its `data` has every field in full. A call's `arguments` and `result` are read from what the playbook kept, and `answer` is the document read from the result. Use it to open a tool's result, or an input or output too large for a page, from the history.

- A step event's id goes in the path unchanged, such as `GET /events/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a_2`.
- Its number counts from 1 without a leading zero, so `_0` and `_02` are refused with `invalid_input`.
- An id the playbook does not have, whether of another playbook or of a step its input did not move, returns `not_found`.

Over MCP, a field that may be large is shown in full only up to 64 KiB, as [the MCP reference](mcp.md#events-and-history) says.

### Paging

Every page carries `has_more` and `next_cursor`, on the page and not on its events. Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`.

- `limit` is 1 to 100, and 20 when left out.
- `limit` counts the events a page returns, step events included. A page can end between the step events of one input; its `next_cursor` continues from the next one.
- Cursors are opaque. A cursor this playbook did not give returns `invalid_input` at `/cursor`.

A page can contain fewer items than `limit`, or none, while `has_more` is `true`:

- records with no event type are left out;
- a page stops after loading 4 MiB of stored data;
- with `status`, `type`, `name` or `steps: false`, a page stops after looking at 1,000 runs or records.

## Comments

A person comments on what Studio shows, where they see it: of a playbook, a definition, a step of a workflow, a run, an event of a run, a block of a run's result, a request or the playbook itself; of the organization, a connection, a member, a page of Settings or the organization itself; and a [part](addresses.md#the-parts-of-a-thing) of most of these. Each comment names what it is about by its [address](addresses.md), and stays open until a person or an agent resolves it; a person can reopen a resolved one. A comment dropped on the thing carries its `anchor`, where on the thing it was dropped, and Studio draws it there as a pin. The person hands the open comments to their agent, which reads them, acts on each and resolves it. A playbook's comments have these routes, relative to `/v1/orgs/{org}/playbooks/{playbook}`, and the organization's own have the same four under `/v1/orgs/{org}` ([The organization's comments](#the-organization-s-comments)):

| Operation         | Method and route              | Permission      | Input                                                     |
| ----------------- | ----------------------------- | --------------- | --------------------------------------------------------- |
| `make_comment`    | `POST /comments`              | `playbook:read` | `address`, `text` and an optional `anchor`                |
| `list_comments`   | `GET /comments`               | `playbook:read` | Optional `address`, `under`, `open`, `limit` and `cursor` |
| `resolve_comment` | `POST /comments/{id}/resolve` | `playbook:read` | Comment id in path; `how`                                 |
| `reopen_comment`  | `POST /comments/{id}/reopen`  | `playbook:read` | Comment id in path                                        |

- Commenting, resolving and reopening are a reader's acts: anyone who may read the playbook may comment on it, and resolve and reopen its comments, their own or anyone's.
- `make_comment` and `reopen_comment` are served over HTTP alone, so an agent does not comment on its own work, and a person, not an agent, reopens a comment. `list_comments` and `resolve_comment` are also [MCP tools](mcp.md#comments).
- A comment cannot be edited. A person corrects one by resolving it and commenting again, and replies by commenting on the same address.
- A comment belongs to the playbook whose thing it is about, and a comment on the organization's things to the organization. A retired playbook's comments stay readable, open or resolved, and `make_comment`, `resolve_comment` and `reopen_comment` there are refused with `conflict` with the kind `retired`, as every change to it is: its comments can be read and reported, never resolved, reopened or added to.

### A comment

Each operation answers a comment with these fields:

| Field          | Contents                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The comment's id, a UUIDv7 the runtime gives it                                                                                                                              |
| `address`      | The [address](addresses.md) of what it is about                                                                                                                              |
| `text`         | What the person said, in Markdown                                                                                                                                            |
| `anchor`       | Where on the thing the person dropped it, `{ x, y }`, as [Making a comment](#making-a-comment) sets out; `null` for a comment made without one, as a reply is                |
| `by`           | The id of the caller who made it. An agent connected as a person comments as that person                                                                                     |
| `by_name`      | The name of the caller who made it, as the runtime names them, as `created_by` of a definition gives it                                                                      |
| `at`           | When it was made, in ISO 8601 UTC                                                                                                                                            |
| `open`         | `true` until it is resolved, and again once it is reopened                                                                                                                   |
| `resolved_at`  | When it was resolved, in ISO 8601 UTC; `null` while it is open, a reopened one included                                                                                      |
| `resolved_by`  | The id of the caller who resolved it; `null` while it is open, a reopened one included                                                                                       |
| `resolved_how` | `acted`, done as it asked, or `dismissed`, closed without acting; `null` while it is open, a reopened one included                                                           |
| `reopened_at`  | When it was last reopened, in ISO 8601 UTC; `null` until it is first reopened, and kept when it is resolved again                                                            |
| `reopened_by`  | The id of the caller who last reopened it; `null` until it is first reopened, and kept when it is resolved again                                                             |
| `studio`       | The comment's place in Studio, which opens its address and shows the comment beside it, as [Links to Studio](#links-to-studio) says; left out where Studio would not open it |

Studio shows `text` as Markdown, and any HTML in it as text, as a page shows its Markdown ([Markdown, not HTML](page-format.md#markdown-not-html)).

### Making a comment

`make_comment` takes:

- `address`, the address of what the comment is about, in one of the [forms a comment takes](addresses.md#the-forms), naming this playbook, at most 512 characters;
- `text`, Markdown of at most 4,000 characters as sent, counted before the white space around it is dropped, and stored without that white space; it cannot be empty or all white space, and holds no control character but a tab and a line break, no unpaired surrogate and no noncharacter;
- `anchor`, optional, where on the thing the person dropped the comment: `{ x, y }`, each a number from 0 to 1 with at most 4 decimals, the fraction of the thing's box as Studio draws it, `x` from its left edge to its right and `y` from its top to its bottom. It is left out for a comment made without a pin, as a reply in a thread is, so the pins of a thread do not pile up, and an `anchor` of `null` is taken as left out. The runtime keeps it as given and never reads what it points at.

An `anchor` out of that range or with more than 4 decimals is refused with `invalid_input` at `/anchor`, `Expected x and y, each a number from 0 to 1 with at most 4 decimals`, and one that is neither an object nor `null` there too, `Expected object | null`. One of another shape is refused at the field within it: a missing `x` or `y` at `/anchor/x` or `/anchor/y`, `Missing key`; an `x` or `y` that is not a number there, `Expected number`; and a key it does not take, such as `z`, at `/anchor/z`, `Expected no excess property`.

It records one fact, `comment_made`, on the comment's own stream, `playbook/<org>/<playbook>/comments/<id>`, and answers `201` with the comment. The runtime checks the address's form, never that the thing exists, so a comment on a retired definition is still a comment ([What the runtime checks](addresses.md#what-the-runtime-checks)).

```http
POST /v1/orgs/acme/playbooks/finance/comments
Authorization: Bearer <key>
Content-Type: application/json

{
  "address": "finance/definitions/workflow/close-the-week/4/steps/do/1/review",
  "text": "Flag any entry over $10,000 for Priya before the week closes.",
  "anchor": { "x": 0.6125, "y": 0.4 }
}
```

```json
{
  "id": "019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f",
  "address": "finance/definitions/workflow/close-the-week/4/steps/do/1/review",
  "text": "Flag any entry over $10,000 for Priya before the week closes.",
  "anchor": { "x": 0.6125, "y": 0.4 },
  "by": "person:user_7kLm2",
  "by_name": "Priya Raman",
  "at": "2026-11-02T10:14:03.218Z",
  "open": true,
  "resolved_at": null,
  "resolved_by": null,
  "resolved_how": null,
  "reopened_at": null,
  "reopened_by": null,
  "studio": "https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&playbook=finance&workflow=close-the-week&version=4&step=do%2F1%2Freview&comment=019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f"
}
```

### Listing comments

`list_comments` returns `comments`, newest first by `at`, each with its `anchor` or `null`, with `has_more` and `next_cursor`.

| Parameter | Rule                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address` | An address of this playbook, or on the organization's routes of the organization's things: keep the comments on it. Left out, every comment of the playbook, or of the organization's own                                     |
| `under`   | `true` keeps the comments on `address` and on what is under it, as the list below says; `false` when left out. With `under`, `address` may also name a definition without its version, `<playbook>/definitions/<type>/<name>` |
| `open`    | `true` keeps the open comments, `false` the resolved ones; `true` when left out                                                                                                                                               |
| `limit`   | 1 to 200, and 50 when left out                                                                                                                                                                                                |
| `cursor`  | The `next_cursor` of the page before                                                                                                                                                                                          |

- `under` on any address keeps the comments on it and on its parts, `<address>/parts/<part>`.
- `under` on a run also keeps the comments on its events and the blocks of its result. The request of the run, `<playbook>/<run_id>`, is not under it.
- `under` on a definition at a version also keeps the comments on each of its steps.
- `under` on a definition without its version keeps the comments on every version of it, their parts and their steps.
- `under` on the playbook, `playbooks/<playbook>`, keeps the comments on the playbook itself and its parts, and none on what it holds. `under` on `org` keeps those on the organization itself and its parts, and none on its connections, members or pages of Settings.
- `under` on a step, an event, a block or a request, which take no parts, keeps the comments on that address alone: a step nested in it is not under it.
- Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`. Cursors are opaque, and each names its playbook, or the organization: one of another playbook, one of the organization's comments on a playbook's route or the reverse, or one that does not decode, is refused.
- `open=false` lists the resolved comments, each with `open: false`, so a resolved comment stays readable here, as its link reads it. The [activity](#the-organization-s-activity) lists only open ones.

```http
GET /v1/orgs/acme/playbooks/finance/comments?address=finance%2Fruns%2F019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e&under=true
Authorization: Bearer <key>
```

```json
{
  "comments": [
    {
      "id": "019a4122-0c1d-7e2f-8a3b-4c5d6e7f8091",
      "address": "finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/result/2",
      "text": "This total leaves out the refunds.",
      "anchor": null,
      "by": "person:user_3pQr8",
      "by_name": "Tomás Ortega",
      "at": "2026-11-02T10:31:44.902Z",
      "open": true,
      "resolved_at": null,
      "resolved_by": null,
      "resolved_how": null,
      "reopened_at": null,
      "reopened_by": null,
      "studio": "https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&playbook=finance&ledger=&run=019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e&block=2&comment=019a4122-0c1d-7e2f-8a3b-4c5d6e7f8091"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Resolving a comment

`resolve_comment` takes the comment's `id` in its path, a UUID read in lower case, so `019A4120-…` names the same comment as `019a4120-…`, and `how`: `acted` once what the comment asked is done, or `dismissed` to close it without acting. It records one fact, `comment_resolved`, on the comment's stream, and answers the comment, closed.

- Resolving a comment that is resolved already records nothing and answers it as it stands, with the `how` it was resolved with.
- A resolved comment leaves the activity: its row is no longer listed or counted.
- A comment that was [reopened](#reopening-a-comment) is resolved again as any open comment is, with a new `comment_resolved`.

```http
POST /v1/orgs/acme/playbooks/finance/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f/resolve
Authorization: Bearer <key>
Content-Type: application/json

{ "how": "acted" }
```

```json
{
  "id": "019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f",
  "address": "finance/definitions/workflow/close-the-week/4/steps/do/1/review",
  "text": "Flag any entry over $10,000 for Priya before the week closes.",
  "anchor": { "x": 0.6125, "y": 0.4 },
  "by": "person:user_7kLm2",
  "by_name": "Priya Raman",
  "at": "2026-11-02T10:14:03.218Z",
  "open": false,
  "resolved_at": "2026-11-02T11:02:57.640Z",
  "resolved_by": "person:user_7kLm2",
  "resolved_how": "acted",
  "reopened_at": null,
  "reopened_by": null,
  "studio": "https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&playbook=finance&workflow=close-the-week&version=4&step=do%2F1%2Freview&comment=019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f"
}
```

A request with several faults is refused for the first: a retired playbook before any field, then the fields in the order the table lists them, except that the input is checked as a whole before the form of its `address`. So a request with both a bad `anchor` and an `address` of no form a comment takes is refused for the anchor, and `errors` names each field the check of the whole input refused, such as `/text` and `/anchor` together.

| Case                                                                                                                                                                                                               | Response                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `make_comment`, `resolve_comment` or `reopen_comment` in a retired playbook                                                                                                                                        | `conflict` with the kind `retired`                                                                      |
| An `address` that is not of a form a comment takes, names another playbook, is the organization's on a playbook's route or a playbook's on the organization's, or is over 512 characters                           | `invalid_input` at `/address`                                                                           |
| A `text` that is empty, all white space or over 4,000 characters as sent, or that holds a control character other than a tab or a line break, an unpaired surrogate or a noncharacter                              | `invalid_input` at `/text`                                                                              |
| An `anchor` that is neither an object nor `null`, or whose `x` or `y` is not from 0 to 1 with at most 4 decimals; one with a missing `x` or `y`, an `x` or `y` that is not a number, or another key, at that field | `invalid_input` at `/anchor`; at `/anchor/x`, `/anchor/y` or the key's own pointer, such as `/anchor/z` |
| `under` without `address`                                                                                                                                                                                          | `invalid_input` at `/under`                                                                             |
| A `limit` outside 1 to 200                                                                                                                                                                                         | `invalid_input` at `/limit`                                                                             |
| A `cursor` that does not decode, or that names another playbook, or the organization on a playbook's route or a playbook on the organization's                                                                     | `invalid_input` at `/cursor`                                                                            |
| A `how` that is not `acted` or `dismissed`                                                                                                                                                                         | `invalid_input` at `/how`                                                                               |
| An `id` that is not a UUID                                                                                                                                                                                         | `invalid_input` at `/id`                                                                                |
| A UUID no comment of the playbook has                                                                                                                                                                              | `not_found`                                                                                             |
| A `resolve_comment` or `reopen_comment` that meets another of either of the same comment at the same moment                                                                                                        | `conflict`; send it again                                                                               |

### Reopening a comment

`reopen_comment` takes the comment's `id` in its path, read as `resolve_comment` reads it, and no body. A person reopens a comment that was resolved before what it asked was done. It records one fact, `comment_reopened`, on the comment's stream, whose context says who reopened it and when and which holds no data, and answers the comment, open again: `open` is `true`, `resolved_at`, `resolved_by` and `resolved_how` are `null`, and `reopened_at` and `reopened_by` say when and by whom.

- Reopening a comment that is open, one never resolved or one reopened already, records nothing and answers it as it stands.
- A reopened comment is open as any other: `list_comments` lists it among the open ones, and `resolve_comment` resolves it again.
- The [activity](#the-organization-s-activity) lists it again, at the time it was reopened, as new to everyone but who reopened it, as [Seen and counted](#seen-and-counted) says.
- [`list_playbook_changes`](#changes) names it as a comment change, and `list_org_changes` one of the organization's own.
- Its `text`, `anchor`, `by` and `at` stay as it was made: a comment is never edited.

It is refused as `resolve_comment` is, by the table above: a retired playbook, an `id` that is not a UUID, a UUID no comment of the playbook has, and one that meets another change to the same comment at the same moment.

```http
POST /v1/orgs/acme/playbooks/finance/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f/reopen
Authorization: Bearer <key>
```

```json
{
  "id": "019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f",
  "address": "finance/definitions/workflow/close-the-week/4/steps/do/1/review",
  "text": "Flag any entry over $10,000 for Priya before the week closes.",
  "anchor": { "x": 0.6125, "y": 0.4 },
  "by": "person:user_7kLm2",
  "by_name": "Priya Raman",
  "at": "2026-11-02T10:14:03.218Z",
  "open": true,
  "resolved_at": null,
  "resolved_by": null,
  "resolved_how": null,
  "reopened_at": "2026-11-02T14:37:12.085Z",
  "reopened_by": "person:user_3pQr8",
  "studio": "https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&playbook=finance&workflow=close-the-week&version=4&step=do%2F1%2Freview&comment=019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f"
}
```

### The organization's comments

The organization's own comments, those on the [organization's things](addresses.md#the-organization-s-things) and their parts, have the same four operations, relative to `/v1/orgs/{org}`:

| Operation         | Method and route              | Permission                    | Input                                                     |
| ----------------- | ----------------------------- | ----------------------------- | --------------------------------------------------------- |
| `make_comment`    | `POST /comments`              | `org:read` or `playbook:read` | `address`, `text` and an optional `anchor`                |
| `list_comments`   | `GET /comments`               | `org:read` or `playbook:read` | Optional `address`, `under`, `open`, `limit` and `cursor` |
| `resolve_comment` | `POST /comments/{id}/resolve` | `org:read` or `playbook:read` | Comment id in path; `how`                                 |
| `reopen_comment`  | `POST /comments/{id}/reopen`  | `org:read` or `playbook:read` | Comment id in path                                        |

They take, answer and refuse as a playbook's do, with these differences:

- `make_comment` takes only an address of the organization's things: `org`, `org/connections/<connection>`, `org/members/<member>` or `org/settings/<page>`, each with or without `/parts/<part>`. It records `comment_made` on the comment's own stream, `org/<org>/comments/<id>`, `resolve_comment` records `comment_resolved` there and `reopen_comment` records `comment_reopened`.
- `list_comments` without `address` lists the organization's own comments, and none of its playbooks'. An agent that reads every open comment reads these and each playbook's.
- A comment of the organization's own belongs to no playbook, so none is refused as `retired`, and a caller who may act on some playbooks alone makes, reads, resolves and reopens them as any other.
- `resolve_comment` or `reopen_comment` of an id the organization's own comments do not hold, a playbook's comment among them, is `not_found`.
- On `/mcp`, `list_comments` and `resolve_comment` without `playbook` are these operations ([MCP reference](mcp.md#comments)).

```http
POST /v1/orgs/acme/comments
Authorization: Bearer <key>
Content-Type: application/json

{
  "address": "org/connections/019a3f10-2b4c-7d5e-8f60-718293a4b5c6",
  "text": "The CRM stopped answering on Friday. Can you get it connected again?",
  "anchor": { "x": 0.18, "y": 0.5 }
}
```

```json
{
  "id": "019a4131-9d2e-7f40-8a51-6b7c8d9e0f12",
  "address": "org/connections/019a3f10-2b4c-7d5e-8f60-718293a4b5c6",
  "text": "The CRM stopped answering on Friday. Can you get it connected again?",
  "anchor": { "x": 0.18, "y": 0.5 },
  "by": "person:user_3pQr8",
  "by_name": "Tomás Ortega",
  "at": "2026-11-02T11:20:09.511Z",
  "open": true,
  "resolved_at": null,
  "resolved_by": null,
  "resolved_how": null,
  "reopened_at": null,
  "reopened_by": null,
  "studio": "https://studio.on.auto/?server=https%3A%2F%2Fruntime.example.com&settings=connections&comment=019a4131-9d2e-7f40-8a51-6b7c8d9e0f12"
}
```

## Changes

A client learns of changes by asking what changed since the cursor of its last answer. The runtime holds the request until something changes, so the client does not poll. These two routes are served over HTTP alone; no MCP tool serves them.

| Operation               | Method and route                                  | Permission                    | Input                       |
| ----------------------- | ------------------------------------------------- | ----------------------------- | --------------------------- |
| `list_org_changes`      | `GET /v1/orgs/{org}/changes`                      | `org:read` or `playbook:read` | Optional `since` and `wait` |
| `list_playbook_changes` | `GET /v1/orgs/{org}/playbooks/{playbook}/changes` | `playbook:read`               | Optional `since` and `wait` |

Each returns `cursor`, `changes` and `more`:

```json
{
  "cursor": "WyIxMjMiLCIwNmJhYjQ1YS0wNTVhLTU4ZTQtOWQ0Zi1mNmRkYTk0MDJjZjgiXQ",
  "changes": [
    { "kind": "definition", "type": "reasoning", "name": "summary" },
    { "kind": "run", "run_id": "0199f7a2-6c1e-7b3a-9d40-5e8f1a2b3c4d" }
  ],
  "more": false
}
```

- Without `since`, the response comes at once, with the cursor of now and no changes, so a client starts from now.
- A change names only what the caller may read, as the routes that read it decide. `list_org_changes` names a playbook only to a caller that may access it, as `list_playbooks` lists it, a connection only to a caller with `org:read`, and a comment of the organization's own to every caller, as its `list_comments` reads it. What the caller may not read ends no held request. A response that lists nothing and says no `more` gives back the cursor it was given, so the caller learns nothing of what it may not read.
- With `since`, the cursor of an earlier response, the response comes at once when something changed after it. Otherwise the runtime holds the request until the next change, or until `wait` seconds pass and it answers no changes with the cursor it was given. A server that stops answers every request it holds at once, the same way.
- `wait` is 0 to 25 seconds, 25 when left out. A larger or negative `wait` returns `invalid_input` at `/wait`.
- `cursor` is opaque: the ledger's point after the last change listed. Give it back as `since`. A cursor the ledger does not hold, such as one of another database or of another playbook, returns `invalid_input` of the type `https://on.auto/problems/cursor_not_held`; ask again without `since`.
- `changes` lists at most 200 resources, in the order the ledger recorded what changed them, each once; one record may name several. When `more` is `true`, more changed already: ask again at once with the new `cursor`.
- Each change names a resource and its identity, nothing else. Read the resource through its own route.

| Route                   | `kind`        | Identity                                                              | What names it                                                                                                                                                                      |
| ----------------------- | ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_org_changes`      | `playbook`    | `playbook`                                                            | A playbook created, updated or retired                                                                                                                                             |
| `list_org_changes`      | `connection`  | `connection`                                                          | A connection added, connected, broken or removed, asked for more, given the organization's own OAuth client, or its playbooks set                                                  |
| `list_org_changes`      | `comment`     | `comment_id`                                                          | A [comment of the organization's own](#the-organization-s-comments) made, resolved or reopened                                                                                     |
| `list_playbook_changes` | `playbook`    | None, since the playbook is the route's own: `{ "kind": "playbook" }` | The playbook's page saved or removed; `list_org_changes` names the `playbook` of its own change                                                                                    |
| `list_playbook_changes` | `definition`  | `type`, `name`                                                        | A function or workflow saved, paused, resumed or retired                                                                                                                           |
| `list_playbook_changes` | `run`         | `run_id`                                                              | A run started, given an input or an event, or ended                                                                                                                                |
| `list_playbook_changes` | `interaction` | `run_id`                                                              | Everything the run of an interaction function records: its request opened, answered, expired, undelivered or cancelled, beside the run                                             |
| `list_playbook_changes` | `event`       | `event_id`                                                            | An event published to the playbook, a refusal of its reactions, a call of a tool by hand and a telling or a read of a conversation, by the `id` `list_playbook_events` lists it by |
| `list_playbook_changes` | `comment`     | `comment_id`                                                          | A [comment](#comments) made, resolved or reopened, so a client that shows it learns when someone resolves or reopens it                                                            |

A run's own records, its steps and its tool calls name the run; read them with `get_run_history` given its `run_id`, or with `list_playbook_events` given the `run_id` of the run at the top of its tree. A new link or consent of a connection names nothing until the connection is connected.

## The organization's activity

The organization's activity is what its playbooks did that a person may want to see: the requests that wait on an answer, the definitions whose latest run broke, the runs, definitions and playbooks that are new, and the open [comments](#comments) people made on them and on the organization's own things. The runtime keeps it for the whole org, with what each caller has seen, so a client shows it with one read however many playbooks the org holds, and what a person marks seen on one device shows on every other. These two routes are served over HTTP alone; no MCP tool serves them. They are relative to `/v1/orgs/{org}`:

| Operation            | Method and route      | Permission                    | Input                                                              |
| -------------------- | --------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `list_activity`      | `GET /activity`       | `org:read` or `playbook:read` | Optional `kind`, `playbook`, `mine`, `since`, `limit` and `cursor` |
| `mark_activity_seen` | `POST /activity/seen` | `org:read` or `playbook:read` | `items`, `through` or both                                         |

Each reads and marks only the activity of the playbooks the caller may access, as `list_playbooks` lists them, and the organization's own comments, which belong to no playbook, only for a caller who may access every playbook of the org; a caller who may access some playbooks alone reads the organization's comments with `list_comments` on the org's route ([The organization's comments](#the-organization-s-comments)) and sees none of them in the activity, while [`list_org_changes`](#changes) names each of them to every caller, as that route reads them. What a caller marks seen is theirs alone and changes nothing for anyone else.

### The rows

`list_activity` returns `rows`, newest first by `at`, with `has_more`, `next_cursor`, `counts` and `through`. Each row is one item of one of four kinds:

| `kind`      | The item                                                                                                                                                                                                                                                                           | Its `at`                                                       | Listed                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `needs_you` | A request of an interaction function that takes an answer, a request a workflow's call made included                                                                                                                                                                               | When the request was made                                      | Until it is answered, expires or ends with its run                                                                          |
| `broken`    | A definition whose latest run at its current version failed or was rejected. One row per definition, naming the version it broke on and its latest failing run. A cancelled run is neither a failure nor a success, and a request that expires unanswered closes its request alone | When its latest failing run ended                              | Until a run at that version or a later one succeeds, a new version of the definition is saved, or the definition is retired |
| `new`       | A run no other run started that succeeded; a function or workflow saved, each version its own item; or a playbook created or updated, each change its own item                                                                                                                     | When the run ended, or the version or the change was saved     | Always                                                                                                                      |
| `comment`   | A [comment](#comments) on something of a playbook, or of the organization's own                                                                                                                                                                                                    | When it was made, or, once reopened, when it was last reopened | Until it is resolved, and again from when it is reopened                                                                    |

A run that a workflow's call started has no `new` or `broken` row of its own: the row of the workflow's run stands for what it did. A request, a broken definition or a comment is listed only while open, and nothing is served about it once it is resolved: `get_run` says what became of a request, and `list_comments` reads a resolved comment. A definition that breaks again opens its row again, at the time of the new break, and a comment that is reopened opens its row again, at the time it was reopened.

The rows of playbooks come from the org's register of playbooks, which `list_activity` reads beside the other rows and merges with them by `at`: the newest 100 changes of the register, so an older change has no row.

Each row has these fields:

| Field           | Contents                                                                                                                                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | `needs_you`, `broken`, `new` or `comment`                                                                                                                                                                                                                                                                                                    |
| `address`       | The item's address, which `mark_activity_seen` takes                                                                                                                                                                                                                                                                                         |
| `cursor`        | The row's place in the activity, which `since`, `cursor` and `through` take                                                                                                                                                                                                                                                                  |
| `playbook`      | The id of the playbook the item belongs to; `null` for a comment of the organization's own                                                                                                                                                                                                                                                   |
| `at`            | When the item came about, by its kind, in ISO 8601 UTC                                                                                                                                                                                                                                                                                       |
| `by`            | The id of the caller who started the run, saved the version or changed the playbook; for a request, who started the run that asked; for a comment, who made it, a reopened one's included                                                                                                                                                    |
| `by_name`       | For `comment`, the name of who made it, as the runtime names them; otherwise `null`                                                                                                                                                                                                                                                          |
| `change`        | For a version or a playbook, `created` or `updated`; otherwise `null`                                                                                                                                                                                                                                                                        |
| `trigger`       | For a run a trigger started, its `kind`, `event`, `cron` or `every`, and its `reference` in the document; otherwise `null`                                                                                                                                                                                                                   |
| `definition`    | The `type`, `name` and `version` of the definition: the run's, the version saved, or for `broken` the version it broke on; for a comment, the definition and the version its address names, a step's workflow among them; `null` for a playbook, and for a comment whose address names no definition                                         |
| `run_id`        | The run that asked, the latest run that broke, or the run that succeeded; for a comment, the run its address names, that of an event, a block or a request among them; `null` for a version, a playbook, and a comment whose address names no run                                                                                            |
| `output_shape`  | For a run that succeeded, the [output shape](output-shapes.md#what-a-run-shows) its output takes, where it takes one; otherwise `null`. Read the run with `get_run` for its result and headline                                                                                                                                              |
| `message`       | For `needs_you`, the first line of the request's message, and for `comment`, the first line of the comment's text, cut, where it is longer, to 200 characters: 199 and an ellipsis (`…`); otherwise `null`                                                                                                                                   |
| `answer_schema` | For `needs_you`, the JSON Schema the answer takes, as the request carries it, where it is at most 8 KiB as JSON, so a client can answer a yes or no, a choice or a line in the row; `null` for a larger one, which the run's request holds whole, and for the other kinds                                                                    |
| `detail`        | For `broken`, the `detail` of the latest failing run's rejection, cut, where it is longer, to 200 characters: 199 and an ellipsis; `null` for a run that failed inside the runtime or a rejection without one, and for the other kinds                                                                                                       |
| `status`        | For `broken`, how the latest failing run ended: `failed`, a run that failed inside the runtime, or `rejected`; otherwise `null`                                                                                                                                                                                                              |
| `waits_on`      | For `needs_you`, whom the request waits on: the person its party names by id, such as `person:user_7kLm2`; the address its party names, in lower case, where the party is one, holding an `@`; or `any_member` where it names none. See [Whom a request waits on](interaction-format.md#whom-a-request-waits-on). `null` for the other kinds |
| `expires_at`    | For `needs_you`, when the request expires unanswered, in ISO 8601 UTC; otherwise `null`                                                                                                                                                                                                                                                      |
| `about`         | For `comment`, the [address](addresses.md) of what the comment is about; otherwise `null`. Its `definition` and `run_id` are read from this address, so a comment on a run names its run and no definition. Read the comment whole with [`list_comments`](#listing-comments)                                                                 |
| `seen`          | For `new` and `comment`, whether the caller has seen it, as [Seen and counted](#seen-and-counted) says; `null` for the other kinds, which nothing a caller marks seen changes                                                                                                                                                                |

An address is the playbook, or the organization, and the row's key in the activity, in the forms [Addresses](addresses.md) sets out:

| Item                          | `address`                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------- |
| A request                     | `<playbook>/<run_id>`                                                        |
| A broken definition           | `<playbook>/<type>/<name>`                                                   |
| A run that succeeded          | `<playbook>/runs/<run_id>`                                                   |
| A version saved               | `<playbook>/definitions/<type>/<name>/<version>`                             |
| A playbook created or updated | `playbooks/<playbook>/<at>`, `at` in milliseconds since 1970-01-01T00:00:00Z |
| A comment                     | `<playbook>/comments/<id>`                                                   |
| A comment of the organization | `org/comments/<id>`                                                          |

### Reading the activity

| Parameter  | Rule                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`     | One kind, or several separated by commas, such as `needs_you,broken`: keep the rows of those kinds; `comment` keeps the open comments                    |
| `playbook` | A playbook id: keep the rows of one playbook, which leaves out the organization's own comments                                                           |
| `mine`     | `true` keeps, of the `new` and `comment` rows, those whose `by` is the caller, and leaves the rows of the other kinds as they are; `false` when left out |
| `since`    | A `cursor`: keep the rows newer than the row it names                                                                                                    |
| `limit`    | 1 to 200, and 50 when left out                                                                                                                           |
| `cursor`   | The `next_cursor` of the page before                                                                                                                     |

- Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`.
- Cursors are opaque. One that does not decode, or that names a playbook of another org, is refused.
- A caller who may access only some playbooks names one of them in `playbook`; a read that names none answers `forbidden`. A caller who may access every playbook of the org reads them all without it.
- A retired playbook has no rows: `playbook` naming one answers no rows.
- `counts` and `through` are the same whatever the filters and the page.
- The rows are kept as each fact is recorded, so a read is as current as the playbooks' history. A client reads again when it wants the counts current; [`list_org_changes`](#changes) does not name the activity.

```http
GET /v1/orgs/acme/activity?limit=3
Authorization: Bearer <key>
```

```json
{
  "rows": [
    {
      "kind": "new",
      "address": "finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e",
      "cursor": "eyJhdCI6MTc5MzU1MjU2MTUxMiwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicnVucy8wMTlhNDAxMi03YzNlLTdkMTAtOWIyYS00ZTZmOGExYzJkM2UifQ",
      "playbook": "finance",
      "at": "2026-11-01T17:02:41.512Z",
      "by": "person:user_7kLm2",
      "by_name": null,
      "change": null,
      "trigger": null,
      "definition": { "type": "workflow", "name": "close-the-week", "version": 4 },
      "run_id": "019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e",
      "output_shape": "table",
      "message": null,
      "answer_schema": null,
      "detail": null,
      "status": null,
      "waits_on": null,
      "expires_at": null,
      "about": null,
      "seen": false
    },
    {
      "kind": "needs_you",
      "address": "finance/019a400e-1f2b-7a44-8c5d-6b7e9f0a1b2c",
      "cursor": "eyJhdCI6MTc5MzU1MjI5MjIwNCwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoiMDE5YTQwMGUtMWYyYi03YTQ0LThjNWQtNmI3ZTlmMGExYjJjIn0",
      "playbook": "finance",
      "at": "2026-11-01T16:58:12.204Z",
      "by": "person:user_7kLm2",
      "by_name": null,
      "change": null,
      "trigger": null,
      "definition": { "type": "interaction", "name": "approve-payment", "version": 2 },
      "run_id": "019a400e-1f2b-7a44-8c5d-6b7e9f0a1b2c",
      "output_shape": null,
      "message": "Approve the payment of $4,200 to Northwind Supplies?",
      "answer_schema": {
        "type": "object",
        "required": ["choice"],
        "properties": { "choice": { "type": "string", "enum": ["approve", "reject"] } }
      },
      "detail": null,
      "status": null,
      "waits_on": "priya@acme.example",
      "expires_at": "2026-11-03T16:58:12.204Z",
      "about": null,
      "seen": null
    },
    {
      "kind": "broken",
      "address": "finance/reasoning/categorize-invoice",
      "cursor": "eyJhdCI6MTc5MzU0NzYwNzg4MSwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicmVhc29uaW5nL2NhdGVnb3JpemUtaW52b2ljZSJ9",
      "playbook": "finance",
      "at": "2026-11-01T15:40:07.881Z",
      "by": "person:user_7kLm2",
      "by_name": null,
      "change": null,
      "trigger": null,
      "definition": { "type": "reasoning", "name": "categorize-invoice", "version": 7 },
      "run_id": "0199fe31-2a4b-7c5d-8e6f-7a8b9c0d1e2f",
      "output_shape": null,
      "message": null,
      "answer_schema": null,
      "detail": "The tool ledger/post_entry is not offered to this playbook.",
      "status": "rejected",
      "waits_on": null,
      "expires_at": null,
      "about": null,
      "seen": null
    }
  ],
  "has_more": true,
  "next_cursor": "eyJhdCI6MTc5MzU0NzYwNzg4MSwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicmVhc29uaW5nL2NhdGVnb3JpemUtaW52b2ljZSJ9",
  "counts": { "needs_you": 1, "broken": 1, "new": 6, "comments": 2 },
  "through": {
    "cursor": "eyJhdCI6MTc5MzUyMzYwMzExNywicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicnVucy8wMTk5ZmUzMS0yYTRiLTdjNWQtOGU2Zi03YThiOWMwZDFlMmYifQ",
    "seen_at": "2026-11-01T09:14:55.020Z"
  }
}
```

### Seen and counted

Only `new` and `comment` rows are seen or unseen. Such a row is seen by the caller when its `by` is the caller, or, for a comment that was reopened, when the caller is who last reopened it, whoever made it; when the caller marked it seen; or when it is at or before the caller's `through`, the place they marked everything seen through. So a reopened comment's row keeps its maker as its `by` and takes the reopening's time as its `at`: it is new again to everyone but who reopened it, its maker among them, since a mark of the row before names the `at` it had then, and the one who reopened it has seen it from the start. A caller who has never sent a `through` reads as if their `through` were 7 days before the read, so a first read shows the last week as new. Each caller has its own seen: a person, a key or the local developer.

A request waits on the caller when its `waits_on` is `any_member` or the caller's own id. The runtime knows a caller by their id, never by an address, so a request whose `waits_on` is an address, which waits on the member who signs in with it, is counted for no caller; a client that knows the person's address, as Auto Studio does from their sign-in, tells them it is theirs. In local mode every client is the local developer, so every open request waits on them, and Auto Studio and an agent on that machine share one seen: what one marks seen, and the `through` it moves, are the other's too. A request that waits on someone else is listed all the same, to everyone who may read its playbook, as `list_interactions` lists it.

`counts` holds what the caller has to look at, over every playbook the caller may access and, for a caller who may access them all, the organization's own comments:

| Count       | The rows it counts                                                                      |
| ----------- | --------------------------------------------------------------------------------------- |
| `needs_you` | The requests that wait on the caller                                                    |
| `broken`    | The `broken` rows                                                                       |
| `new`       | The `new` rows the caller has not seen                                                  |
| `comments`  | The open comments the caller has not seen, each made, or last reopened, by someone else |

Marking items seen never changes `needs_you` or `broken`: a request leaves them when it is answered or expires, and a broken definition when it is resolved. A comment leaves `comments` when the caller has seen it or anyone resolves it, and comes back when someone else reopens it.

`through` is where the caller marked everything seen, its `cursor` and `seen_at`, when they marked it, or `null` before they first did.

### Marking items seen

`mark_activity_seen` takes:

- `items`, the `new` and `comment` rows the caller has seen, each its `address` and its `at` as the row gives them, at most 200;
- `through`, a `cursor` from a read: everything at or before it is seen.

It records one fact, `activity_seen`, on the caller's own stream, and answers `counts` and `through` after it, as `list_activity` gives them. It answers `200`, and `conflict` when another mark of the same caller is recorded at the same moment; send it again.

- An item the activity holds no `new` or `comment` row for, such as a request, an item whose `at` is before its row's, as a mark made before a comment was reopened is, or an item of a playbook the org does not hold, is accepted: the mark is recorded and marks nothing.
- A `through` older than the caller's own is accepted and leaves theirs unchanged, and the answer gives the one kept: `through` never moves back.
- Each request is recorded, even one that repeats an earlier one.
- The runtime keeps, for each caller, their `through` and their marks of the 1,000 items newest in the activity after it. An item at or before `through` is seen by `through` alone.

```http
POST /v1/orgs/acme/activity/seen
Authorization: Bearer <key>
Content-Type: application/json

{
  "items": [
    {
      "address": "finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e",
      "at": "2026-11-01T17:02:41.512Z"
    }
  ]
}
```

```json
{
  "counts": { "needs_you": 1, "broken": 1, "new": 5, "comments": 2 },
  "through": {
    "cursor": "eyJhdCI6MTc5MzUyMzYwMzExNywicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicnVucy8wMTk5ZmUzMS0yYTRiLTdjNWQtOGU2Zi03YThiOWMwZDFlMmYifQ",
    "seen_at": "2026-11-01T09:14:55.020Z"
  }
}
```

To mark everything seen, send the `cursor` of the newest row read as `through`.

A request with several faults is refused for the first, the fields in the order the table lists them. A field given twice, such as `kind` repeated in the query string, is `bad_request`, as for every route ([Requests and access](#requests-and-access)).

| Case                                                                                                                                                                        | Response                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A `kind` that is not `needs_you`, `broken`, `new` or `comment`                                                                                                              | `invalid_input` at `/kind`                                                                                                                  |
| A `limit` outside 1 to 200                                                                                                                                                  | `invalid_input` at `/limit`                                                                                                                 |
| An `address` that holds no `@`                                                                                                                                              | `invalid_input` at `/address`                                                                                                               |
| A `since`, `cursor` or `through` that does not decode, or that names a playbook of another org                                                                              | `invalid_input` at the field                                                                                                                |
| A `playbook` the org does not have                                                                                                                                          | `not_found`                                                                                                                                 |
| A `playbook`, or an item of a playbook, the caller may not access; a comment of the organization's own, `org/comments/<id>`, for a caller who may not access every playbook | `forbidden`; for the comment, "The caller may not mark the organization's comments, which only a caller who may access every playbook sees" |
| A `mark_activity_seen` with neither `items` nor `through`, or with an empty `items` and no `through`                                                                        | `invalid_input` at `/items`                                                                                                                 |
| More than 200 `items`                                                                                                                                                       | `invalid_input` at `/items`                                                                                                                 |
| An item whose `address` is not of a form above or whose `at` is not a time                                                                                                  | `invalid_input` at the item, such as `/items/2`                                                                                             |

## Analytics

| Operation                | Method and route | Permission      | Input                                                           |
| ------------------------ | ---------------- | --------------- | --------------------------------------------------------------- |
| `get_playbook_analytics` | `GET /analytics` | `playbook:read` | Optional `days`, or `from` and `to`; optional `type` and `name` |

The route is relative to `/v1/orgs/{org}/playbooks/{playbook}`. `get_playbook_analytics` returns what the playbook's runs did over a window of days, in UTC.

| Parameter      | Rule                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `days`         | `7`, `14` or `30`: the last days, ending today. `7` when nothing is given                                                     |
| `from`, `to`   | The first and the last day, as `YYYY-MM-DD`, both included: at most 366 days, with `to` not before `from` and not after today |
| `type`, `name` | Keep the runs of one definition, as they do for `list_runs`                                                                   |

- A day must exist in the calendar, so `2026-02-30` is refused rather than read as 2 March.
- These are refused with `invalid_input`, pointing at the parameter: `days` with `from` or `to`, `from` without `to`, any other `days`, and any other parameter.

```http
GET /v1/orgs/acme/playbooks/sales/analytics?days=7&type=reasoning
Authorization: Bearer <key>
```

```json
{
  "days": 7,
  "runs": { "total": 12, "succeeded": 9, "failed": 1, "rejected": 2 },
  "tokens": { "input": 18400, "output": 2950, "cached": 12000 },
  "cost_usd": 0.0874,
  "duration_ms": { "p50": 1840, "p95": 6210 },
  "by_day": [
    {
      "day": "2026-09-30",
      "runs": { "total": 0, "succeeded": 0, "failed": 0, "rejected": 0 },
      "tokens": { "input": 0, "output": 0, "cached": 0 },
      "cost_usd": null,
      "duration_ms": null
    }
  ],
  "by_function": [
    {
      "type": "reasoning",
      "name": "triage",
      "runs": 12,
      "tokens": { "input": 18400, "output": 2950, "cached": 12000 },
      "cost_usd": 0.0874
    }
  ]
}
```

The example shortens `by_day`. It holds every day of the window, oldest first, including days with no runs.

| Field         | Contents                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `days`        | How many days the window covers                                                                                                                                                                                                                |
| `runs`        | The runs that ended, by how they ended, and their `total`                                                                                                                                                                                      |
| `tokens`      | The `input` and `output` tokens the models of reasoning functions used, a rejected run's included when its model answered before the rejection; `cached` is the part of `input` read from the provider's cache; `0` where nothing was recorded |
| `cost_usd`    | What the runs' model calls cost, in US dollars: those of reasoning functions, a rejected run's included, and those of generation functions; `null` when no run of the period recorded a cost                                                   |
| `duration_ms` | `p50` (the median) and `p95` (the 95th percentile) of how long the runs that succeeded or failed took, in milliseconds from their latest start to their end; `null` when no run of the period has a duration                                   |
| `by_day`      | The same `runs`, `tokens`, `cost_usd` and `duration_ms` for each `day`                                                                                                                                                                         |
| `by_function` | Each definition by `type` and `name`, with `runs`, how many of its runs ended, and their `tokens` and `cost_usd`; the most runs first, then by `type` and `name`                                                                               |

How runs are counted:

- A run counts on the day it first started, also when it was started again later.
- A run counts once it has ended: `succeeded`, `failed` or `rejected`. A run still going counts nowhere.
- A run started again under its `run_id` counts once. Its tokens and its cost add up over every attempt that ended, while its duration is that of its last attempt.
- Rejected runs count in `runs`, `tokens` and `cost_usd`, never in `duration_ms`.
- `cost_usd` adds up the runs that recorded a cost and leaves out those that did not, so it is `null` only when no run did. A run records a cost when its model gateway answers one, in the header the gateway's `cost_header` names (see [Gateway fields](model-settings.md#gateway-fields)). A self-hosted runtime whose model gateway names no cost header records no cost, so the field is `null`.
- Workflow runs count in `runs` and in `duration_ms`, from when the run started to when the workflow ended.
- A percentile is the nearest rank: the duration at place ⌈p × n⌉ of the n durations in order.

The result comes from a table the runtime updates as each run is recorded, so it is as current as the runs themselves. A playbook that does not exist returns `not_found`; a retired playbook works like any other.

## Tool servers

Six operations find and call the tools of the tool servers of a playbook: those the operator set up, and the [connections](#connections) people added to its org, MCP servers and HTTP APIs described by an OpenAPI document alike. A [reasoning function](reasoning-format.md#tools) names their tools in `tools` as `server/tool` or `server/*`, a connection by its name. These routes are relative to `/v1/orgs/{org}`:

| Operation            | Method and route                                                         | Permission                    | Input                                                      |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| `search`             | `GET /tool-servers/search`                                               | `org:read` or `playbook:read` | Optional `playbook`, `terms`, `server` and `only`          |
| `search`             | `GET /playbooks/{playbook}/tool-servers/search`                          | `playbook:read`               | Playbook id in path; optional `terms`, `server` and `only` |
| `introspect`         | `GET /playbooks/{playbook}/tool-servers/{server}/tools/{tool}`           | `playbook:read`               | Server and tool in the path                                |
| `validate`           | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/validate` | `playbook:read`               | Server and tool in the path; `arguments` in the body       |
| `dry_run`            | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/dry-run`  | `playbook:read`               | Server and tool in the path; optional `arguments`          |
| `query_connection`   | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/query`    | `playbook:write`              | Server and tool in the path; optional `arguments`          |
| `execute_connection` | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/execute`  | `playbook:write`              | Server and tool in the path; optional `arguments`          |

- `query_connection` and `execute_connection` need `playbook:write` for every tool, since a call acts as the playbook, under the credential of the server's entry or of the connection.
- `validate` and `dry_run` are routed by `POST` because their `arguments` are an object a query string cannot carry. They are still reads: they change nothing, call no tool and need only `playbook:read`. A query string beside their body returns `bad_request`.
- The four reads ask each server they need for its tool list when you call them, as a run does, with the same time limits to connect and to list. They record nothing. An HTTP API is not asked, since its OpenAPI document is the list. The org route of `search` is the one exception, as [below](#searching-the-tools) says: it answers a server's tools from what it listed for the org within the last five minutes.
- On a playbook route, a playbook that does not exist returns `not_found`. A retired playbook serves the reads like any other. It refuses `query_connection` and `execute_connection` with `conflict` of the kind `retired`, as it refuses every command.

### Searching the tools

`search` returns the servers of the playbook, those set up in the configuration and the connections of its org that serve it, and the tools of each that its entry allows.

- Without `terms`, it lists every tool when the servers offer at most 100 in total, in the order of the servers and of each server's own list. When they offer more, it returns only the servers, each with its count of tools; search them with `terms`.
- `terms` is up to 8 words of up to 64 characters each, separated by spaces. Tools with a score come best first, those with the same score by name and then by server, at most 100.
- `only: read` keeps the tools marked `reads`, and `only: write` the others, which may change something.
- `server` keeps the server of that name and asks no other. A name no server of the playbook has returns `invalid_input` at `/server`.

Each word of `terms`, and each part of it split at `_`, `.`, `-` and case changes, scores in any letter case:

| Where the word appears                            | Score |
| ------------------------------------------------- | ----- |
| A word of the tool's name, split the same way     | 3     |
| A word of the name of one of the tool's arguments | 2     |
| A word of the tool's description                  | 1     |

```http
GET /v1/orgs/acme/playbooks/sales/tool-servers/search?terms=invoice
Authorization: Bearer <key>
```

```json
{
  "servers": [
    { "name": "billing", "type": "openapi", "record_content": true, "provider": null, "tool_count": 5 },
    {
      "name": "notes",
      "type": "stdio",
      "record_content": true,
      "provider": null,
      "unavailable": "The tool server notes could not be used: The tool server could not be reached",
      "because": "unreachable"
    }
  ],
  "tools": [
    { "server": "billing", "tool": "getInvoice", "summary": "Reads one invoice.", "mark": "reads" },
    {
      "server": "billing",
      "tool": "listCustomers",
      "summary": "Lists the customers, with the invoice each owes.",
      "mark": "reads"
    }
  ],
  "scopes": ["billing", "notes"]
}
```

| Field       | Contents                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `servers`   | The servers searched, sorted by name                                                                                      |
| `tools`     | The tools found                                                                                                           |
| `scopes`    | The names of the servers searched                                                                                         |
| `providers` | On the org route, where the caller may add a connection: the providers it may connect that no server serves yet, as below |

Each server has these fields:

| Field            | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`           | The name a function writes before the slash                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `connection`     | For a connection a person added, its id; absent for a server of the configuration. A connection whose name the configuration now sets up is listed beside that server, unavailable                                                                                                                                                                                                                                                                                                                                                         |
| `provider`       | The name of the [provider](#providers) a connection was added from, or an entry of the configuration names, or `null` for a server given by hand                                                                                                                                                                                                                                                                                                                                                                                           |
| `type`           | `mcp` for a remote MCP server, `stdio` for an MCP server the runtime starts as a process, or `openapi` for an HTTP API described by an OpenAPI document                                                                                                                                                                                                                                                                                                                                                                                    |
| `record_content` | Whether the content of its calls is kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tool_count`     | How many tools of the server the operator allows, of those `only` keeps                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `unavailable`    | Instead of `tool_count`: why the server could not be asked for its tools, in words cut to 1 KiB. The other servers are still searched                                                                                                                                                                                                                                                                                                                                                                                                      |
| `because`        | With `unavailable`: `key_refused` when the server did not accept the key the runtime gives it, which only the operator can fix; `scope_lacking` when it answered `403` for a scope its credential lacks, which the words name, so asking again will not help until a credential is granted it; `failing`, `rate_limited` or `unreachable` when asking again later may work; for a connection, `connection_pending`, `connection_broken`, `connection_not_allowed` or `connection_unavailable`, as [below](#a-connection-that-is-not-ready) |
| `playbooks`      | On the org route only: the playbooks of the org whose functions may use it, or `["*"]` for every playbook of the org                                                                                                                                                                                                                                                                                                                                                                                                                       |

Each tool has these fields:

| Field     | Contents                                                       |
| --------- | -------------------------------------------------------------- |
| `server`  | The server's name                                              |
| `tool`    | The tool's name                                                |
| `summary` | The first sentence of its description, cut at 300 characters   |
| `mark`    | Its [mark](#the-mark-of-a-tool): `reads`, `acts` or `unmarked` |

What the result never contains:

- A server set up for another org, or for other playbooks of the org, is neither searched nor asked.
- The runtime adds no header, environment value, address, command or credential of a server to the result.
- What a server returns, such as its tools' names, descriptions and schemas, is passed on with two kinds of value scrubbed out. They are the values of the operator's `${...}` references and the tokens minted for a server. A referenced value shorter than 8 characters is not scrubbed.

On the org route, `search` covers the org's playbooks. So you can see what the operator set up before a playbook exists, or without naming one:

- Without `playbook`, it searches every server set up for the org, each with `playbooks`.
- With `playbook`, it returns only the servers that serve that playbook, as the playbook's own route does, with `playbooks` included.
- A key limited to some playbooks must pass `playbook`, and sees in `playbooks` only the playbooks it may access. Without `playbook` it is refused with `forbidden`, whose detail says to name one of its playbooks in `playbook`.
- A `playbook` the org does not have returns `not_found`, as the playbook's own route does, and no server is asked.
- A `server` that no server of the org, or of the playbook given, has returns `invalid_input` at `/server`.
- A server it listed for the org within the last five minutes is not asked again: its tools are the ones it listed then, kept for this org alone. A connection connected again since, as with a new credential, is asked again, a connection removed is gone at once, and nothing is kept of a server that could not be listed or of a connection that is not ready. What `playbooks` holds, and so which servers `playbook` keeps, is read anew each time. The playbook's own route asks each server each time.

On the org route, `search` also returns `providers`: the [providers](#providers) the caller may connect here that no server of the org serves yet, each with its `name`, which `add_connection` takes as `provider`, its `title`, its `description` and, where its way offers groups of scopes beyond its first consent, `more`, each group by the `name` `add_connection` takes as `more` and what it is `for`, whether or not a client set up here covers it; `add_connection` refuses a group no client covers as `conflict`. So an agent asked for a service that no server serves can offer to connect one, and ask with it for what setting the service up takes.

- A provider is served, and left out, while a connection made from it is pending, connected or broken, or while an entry of the configuration names it. That connection or that entry is in `servers`, with `provider` set and, while it is not ready, its `because`.
- A provider none of whose ways is offered is left out too, such as one whose ways each need a value that whoever runs Auto has not set. `list_providers` still lists it, each way `offered: false`.
- Without `terms`, it lists every such provider, sorted by name, while there are 100 or fewer, and none when there are more.
- With `terms`, it lists the providers whose name, title or description holds a word, scored as tools are, a word of the title counting as a word of the name. They come best first, those with the same score by name, at most 100.
- It covers the whole org, whatever `playbook` narrows the servers to, and is left out with `server`.
- It is present exactly where the caller may add a connection, as `may_add` of `list_providers` says: a signed-in person, or the local developer in local mode, with `org:write`, on a runtime whose `connections.people_may_add` is not `false`. It is then empty when every provider listed is served or left out. A key, a caller who may only read and a runtime where nobody may add get no `providers`. The playbook route never returns it.

### The mark of a tool

Every tool the runtime lists carries one mark: `reads` when it only reads, `acts` when it may change something, and `unmarked` when nothing marks it, which counts as `acts`, as the MCP specification's own default for a tool that declares nothing says. `marked_by` says what gave it:

| `marked_by` | The mark is                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`    | The one the server's hints give: `reads` for `readOnlyHint: true`, `acts` for `readOnlyHint: false` or `destructiveHint: true`, and `unmarked` else |
| `method`    | The one the HTTP method of an operation of an HTTP API gives: `reads` for `GET` and `HEAD`, `acts` for `POST`, `PUT`, `PATCH` and `DELETE`          |
| `catalogue` | The one the entry of its [provider](#providers) gives it, in place of its server's or its method's, as for an operation that reads through `POST`   |
| `settings`  | The one its entry in the [configuration](../self-host/configuration.md#the-mark-of-a-tool) gives it, in place of its server's or its method's       |

`search` and `dry_run` answer it as `mark`, and `introspect` and `list_connection_tools` answer `mark` and `marked_by`.

### Reading one tool

`introspect` returns one tool in full, as its server lists it:

- its `description`, cut to 4 KiB;
- its `input_schema`, the JSON Schema of the arguments it takes;
- its `annotations`, the hints its server gives it (`readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`), left out when the server gives none;
- its `mark` and `marked_by`, as [The mark of a tool](#the-mark-of-a-tool) sets out.

A tool of an HTTP API takes one object: each path and query parameter by its name, and `body` for a JSON body. The schemas from the document's `components` that it refers to are placed under `$defs`.

```http
GET /v1/orgs/acme/playbooks/sales/tool-servers/billing/tools/getInvoice
Authorization: Bearer <key>
```

```json
{
  "server": "billing",
  "tool": "getInvoice",
  "description": "Reads one invoice.",
  "input_schema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": true },
  "mark": "reads",
  "marked_by": "method"
}
```

`validate` checks `arguments`, at most 16 KiB as JSON, against the tool's input schema. It returns `valid` (`true` or `false`) and `issues`. Each issue has the JSON Pointer of the argument at fault as `path`, and what is wrong there as `message`. It lists at most 20 issues, then one saying how many more there are. For a schema the runtime's checker cannot handle, such as one with a regular expression, it returns `valid: null` with one issue saying why; the arguments may still be right. An argument out of a `format` the runtime checks, `date`, `date-time`, `time`, `email`, `uri` or `uuid`, is an issue at its pointer, such as `Expected a string in the format date, such as 2026-04-01`, and a `format` other than those, such as `int64`, is left unchecked while the rest of the schema is checked, so `valid` can be `true`.

```http
POST /v1/orgs/acme/playbooks/sales/tool-servers/billing/tools/getInvoice/validate
Authorization: Bearer <key>
Content-Type: application/json

{ "arguments": { "id": 42 } }
```

```json
{ "valid": false, "issues": [{ "path": "/id", "message": "Expected string" }] }
```

`dry_run` reports what `execute_connection` would check for the tool and its `arguments`, without calling the tool:

| Field              | Contents                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `would_run`        | Whether `execute_connection` would call the tool now: the caller may, the playbook is not retired, the operator allows the tool, and its server responded                                      |
| `needs`            | `playbook:write`, the permission `query_connection` and `execute_connection` need whatever the tool does                                                                                       |
| `caller_may`       | Whether the caller has that permission                                                                                                                                                         |
| `playbook_retired` | Whether the playbook is retired. `query_connection` and `execute_connection` refuse a retired playbook, since it cannot change until it is restored                                            |
| `allowed`          | Whether the operator allows the tool on its server's entry, for runs and for calls made by hand alike                                                                                          |
| `mark`             | The tool's [mark](#the-mark-of-a-tool), `reads`, `acts` or `unmarked`; `null` when the tool's listing was not read, for a tool the operator does not allow or a server that could not be asked |
| `arguments`        | The `arguments` checked as `validate` checks them, `valid: null` with one issue saying why when the tool's input schema was not read; `null` when none were given                              |
| `server`           | `reachable` (`yes` or `no`) and, with `no`, the `because` field that says why the server could not be asked                                                                                    |

`dry_run` returns `would_run: true` even for arguments the tool's schema does not accept. `query_connection` and `execute_connection` do not check arguments, and the tool returns its own error for them. The `arguments` field reports the problem beforehand.

When a server or a tool cannot be used, the reads respond as below. Each refusal is `unavailable`, and no tool is called:

| Case                                 | `introspect` and `validate`                                                                  | `dry_run`                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A server not set up for the playbook | Kind `tool_not_offered`, `because: "tool_server_not_configured"`, before any server is asked | The same                                                                                                         |
| A tool the operator does not allow   | Kind `tool_not_offered`, `because: "tool_not_allowed"`, before any server is asked           | Returns `allowed: false`                                                                                         |
| A tool the server does not list      | Kind `tool_not_offered`, `because: "tool_not_listed"`                                        | The same                                                                                                         |
| A connection that is not ready       | Kind `tool_not_offered`, with its `because`, as [below](#a-connection-that-is-not-ready)     | The same, or `server.reachable: "no"` with `because: "connection_not_allowed"` for an address its document names |
| A server that cannot be asked        | Kind `tool_server_failed`, with its `because`, as `execute_connection` returns it            | Returns `server.reachable: "no"`, with its `because`                                                             |

### Calling a tool by hand

`query_connection` and `execute_connection` call one tool of one tool server with the `arguments` given, as a run of a reasoning function would call it. Each returns what that run's model would see, and the document an interaction function's call reads. They take the same input and return the same fields.

- `query_connection` calls only a tool marked `reads`. Use it to see what a tool returns before a function names it, or to find an id a prompt needs. It refuses a tool with any other mark as `unavailable` of the kind `tool_not_read_only`, before anything is sent, in words that say `execute_connection` calls it.
- `execute_connection` calls a tool whatever its mark. Use it to do what the person asked of a tool that may change something, such as sending, creating or deleting, without first creating a function.

`arguments` is the object the tool's `input_schema` takes, `{}` when left out. It may be at most 16 KiB as JSON; larger arguments return `invalid_input` at `/arguments` before anything is called.

```http
POST /v1/orgs/acme/playbooks/sales/tool-servers/billing/tools/getInvoice/execute
Authorization: Bearer <key>
Content-Type: application/json

{ "arguments": { "id": "inv-2041" } }
```

```json
{
  "call_id": "0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b",
  "server": "billing",
  "tool": "getInvoice",
  "outcome": "result",
  "text": "{\"id\":\"inv-2041\",\"total\":1200}",
  "answer": { "id": "inv-2041", "total": 1200 },
  "result_bytes": 98,
  "duration_ms": 312,
  "called_at": "2026-10-08T09:00:00.000Z"
}
```

| Field               | Contents                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call_id`           | The id of the call, a UUID, under which its two events are recorded                                                                                                                                                                                               |
| `outcome`           | How the call ended, from the table below                                                                                                                                                                                                                          |
| `text`              | What a reasoning function's model would see, scrubbed of the server's secrets and cut at 64 KiB with a note. Text content is text; structured content is JSON only when there is no text; other content is a placeholder. For a failure, the words the model gets |
| `answer`            | The document a call's `read` points into, scrubbed of the server's secrets: the structured content, else the first text block parsed as JSON, else that text. Absent when the tool returned neither, or when it is larger than 64 KiB as JSON                     |
| `result_bytes`      | The size of the whole result as the playbook keeps it, scrubbed of the server's secrets, before the cut; `null` when there is none                                                                                                                                |
| `duration_ms`       | How long the call took                                                                                                                                                                                                                                            |
| `server_request_id` | The server's own id of the request, when the operator's `request_id` setting says where the server carries one                                                                                                                                                    |
| `called_at`         | When the call was made, in ISO 8601 UTC                                                                                                                                                                                                                           |

| `outcome`        | Means                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `result`         | The tool returned a result                                                               |
| `tool_error`     | The tool returned an error or refused the arguments; a run's model may recover from this |
| `server_failure` | The server failed on the call                                                            |
| `timed_out`      | The server did not respond within 30 seconds                                             |
| `too_large`      | The tool's result was larger than one call may return                                    |

The response is `200` whenever the call was made, whatever the tool returned. Nothing is called when:

- the operator does not allow the tool, the server is not set up for the playbook, or the server does not list the tool: `unavailable` with kind `tool_not_offered` and `because` set to `tool_not_allowed`, `tool_server_not_configured` or `tool_not_listed`, or for a connection that is not ready `connection_pending`, `connection_broken`, `connection_not_allowed` or `connection_unavailable`;
- the server cannot be used: `unavailable` with kind `tool_server_failed`;
- `query_connection` names a tool not marked `reads`: `unavailable` with kind `tool_not_read_only`.

A call is live: a tool that is not marked `reads` may change something. That is why `execute_connection` is marked destructive over MCP, and `query_connection`, which calls only a tool marked `reads`, is marked read-only.

Each call is recorded in the playbook's history: as `tool_call_started` before it is sent, with `connection_id` beside `server` for a connection, and as `tool_call_answered` or `tool_call_failed` after. These are the same facts a run's tool calls record, with the caller who made the call as the one who acted.

- The call is recorded on a stream of its own, with no run. `list_runs` and `get_run_history` never show it, while `list_playbook_events` does.
- The arguments and the result are kept unless the operator turns `record_content` off for the server.
- A caller that disconnects during the call leaves a start without an answer.
- When no run holds a connection to the server, each call opens one and closes it once the call ends.

## Connections

A connection is a tool server that a person adds to the org through their agent, a [provider](#providers) by its name or a server given by hand, which every playbook of the org may use, or the playbooks its entry names. The agent adds it without its credential; the person approves it, and gives its credential where it takes one, on Studio's page, which its link opens. [Let people add connections](../self-host/connections.md) sets out the flow, the kinds of credential and the rules the operator sets. These routes are relative to `/v1/orgs/{org}`:

| Operation                  | Method and route                      | Permission                                                 | Input                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_connection`           | `POST /connections`                   | `org:write`                                                | `provider` and `placeholders`, or `name`, `type`, `entry` and `credential` for a server given by hand, `credential` left out for an MCP server, which says how it authenticates; optional `more`, with `provider`, a group of the scopes its way offers, by its name |
| `list_connections`         | `GET /connections`                    | `org:read`                                                 | Optional `include_removed`                                                                                                                                                                                                                                           |
| `get_connection`           | `GET /connections/{id}`               | `org:read`                                                 | Connection id in path                                                                                                                                                                                                                                                |
| `reconnect_connection`     | `POST /connections/{id}/link`         | `org:write`                                                | Connection id in path; optional `more`, a group of the scopes the connection may still be granted, by its name                                                                                                                                                       |
| `remove_connection`        | `DELETE /connections/{id}`            | `org:write`                                                | Connection id in path                                                                                                                                                                                                                                                |
| `set_connection_playbooks` | `PUT /connections/{id}/playbooks`     | `org:write`                                                | Connection id in path; `playbooks`, the ids of the playbooks that may use it, or `null` for every playbook                                                                                                                                                           |
| `list_connection_tools`    | `GET /connections/{id}/tools`         | `org:read`                                                 | Connection id in path; optional `limit` and `cursor`                                                                                                                                                                                                                 |
| `read_link`                | `GET /connections/{id}/link/{token}`  | `org:write`, with the link's token                         | Connection id and token in path                                                                                                                                                                                                                                      |
| `approve`                  | `POST /connections/{id}/approve`      | `org:write`, with the link's token and the adder's session | `token`; optional `playbooks`, the ids of the playbooks that may use it, or `null` for every playbook                                                                                                                                                                |
| `give_credential`          | `POST /connections/{id}/credential`   | `org:write`, with the link's token and the adder's session | `token`, and `value` for a `secret`, or `client_secret`, or `private_key` with `algorithm`, for `client_credentials`, with `client_id` where the connection's credential holds none; optional `playbooks`, as for `approve`                                          |
| `give_client`              | `POST /connections/{id}/client`       | `org:write`, with the link's token and the adder's session | `token`, `client_id` and `client_secret` of the organization's own OAuth client, for a connection under it                                                                                                                                                           |
| `start`                    | `POST /connections/{id}/consent`      | `org:write`, with the link's token and the adder's session | `token`; optional `playbooks`, as for `approve`                                                                                                                                                                                                                      |
| `finish`                   | `POST /connections/{id}/consent/code` | `org:write`, with the link's token and the adder's session | `token`, `code`, `state`, and `iss` where the authorization server sent one; or `token`, `state` and `handle` for a consent begun through Auto's consent service                                                                                                     |

Every operation answers the connection, which holds these fields:

| Field                  | Contents                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | A UUIDv7                                                                                                                                                                                                                                                                                                                                                                                                    |
| `name`                 | What a function names it by, as `name/tool`                                                                                                                                                                                                                                                                                                                                                                 |
| `type`                 | `mcp` or `openapi`                                                                                                                                                                                                                                                                                                                                                                                          |
| `provider`             | The name of the provider it was added from, or `null` for a server given by hand                                                                                                                                                                                                                                                                                                                            |
| `placeholders`         | The values given for the provider's placeholders, or `null`                                                                                                                                                                                                                                                                                                                                                 |
| `entry`                | The server without its credential, as the rules below set out                                                                                                                                                                                                                                                                                                                                               |
| `credential`           | How it is credentialled, never its value, and for a connection connected by consent the client it was made with; for a `secret`, how the person makes the key and what it looks like, `instructions`, `key_page`, `example` and `pattern`, for Studio's page to show beside the field of the key                                                                                                            |
| `status`               | `pending`, `connected`, `broken` or `removed`                                                                                                                                                                                                                                                                                                                                                               |
| `added_by`             | The caller who added it, by `id` and `name`                                                                                                                                                                                                                                                                                                                                                                 |
| `added_at`             | When it was added, in ISO 8601 UTC                                                                                                                                                                                                                                                                                                                                                                          |
| `connected_at`         | When it was connected, in ISO 8601 UTC, or `null`                                                                                                                                                                                                                                                                                                                                                           |
| `connected_by`         | The caller who connected it, by approving it or giving its credential, by `id` and `name`, or `null`                                                                                                                                                                                                                                                                                                        |
| `asked_scopes`         | The scopes its credential asks, in their order, and after them those each consent that asked more added, each `{ name, says }`. `says` is the sentence of the provider's way, or of its group of more, that says what the connection can do through the scope, as it stood when the connection was added or the consent started, or `null` for a server given by hand. Empty where the credential asks none |
| `granted_scope`        | For a connection connected by consent, the scope the server granted at its latest consent, which may be fewer scopes than that consent asked, as when the person unticks one on the provider's page; else `null`                                                                                                                                                                                            |
| `granted_scopes`       | The scopes of `granted_scope`, each `{ name, says }` with the words of the scope asked of that name, and `says` `null` for a scope the server granted beyond those asked, such as `offline_access`; `null` where `granted_scope` is                                                                                                                                                                         |
| `credential_ends_with` | The last four characters of a secret or client secret of twelve characters or more, which the secret store keeps beside the value; else `null`                                                                                                                                                                                                                                                              |
| `broken`               | `{ kind, detail, at }` while it is broken, else `null`. `kind` is why, for a client to word, as the table below lists; `detail` is the runtime's sentence, which says what mends it; and `at` is when the runtime recorded the break, in ISO 8601 UTC, so a page says since when in the person's own words                                                                                                  |

| `kind`                  | The connection is broken because                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `credential_refused`    | its server answered `401`, or a code its provider's `failure_codes` names for a refused credential, to the credential it holds |
| `credential_wanted`     | its server answered so to a connection of `none`, which holds no credential, asking for one                                    |
| `credential_gone`       | its credential is no longer in the secret store                                                                                |
| `credential_not_tokens` | its credential is not the tokens of a consent                                                                                  |
| `consent_ended`         | its consent was revoked or has ended                                                                                           |
| `client_gone`           | the client it was made with is no longer registered                                                                            |
| `key_unknown`           | Auto's consent service does not know its key                                                                                   |

`add_connection` answers `201` with the connection and `connect`, `{ url, expires_at }`. `url` is Studio's page `connect` under the Studio the person can reach: `<the runtime's origin>/studio/connect?connection=<id>&token=<token>` where the runtime serves Studio, as it does in local mode, since that page knows the runtime that serves it and asks it for the org, and `<the Studio host>/connect?server=<the runtime's origin>&org=<org>&connection=<id>&token=<token>` otherwise. The Studio host is `STUDIO_ORIGIN`, or `https://studio.on.auto` when it is not set. The runtime's origin is `PUBLIC_URL`, or the server's own address in local mode, and the link expires 24 hours on.

Given `more`, the name of a group the provider's way names, as `search` lists it under the provider and `list_providers` under the way, `add_connection` gives the link for that group too. The first consent asks the way's scopes with the group's, so the person allows both at once, and `read_link` answers the group as it does for a link `reconnect_connection` gave for one. It refuses a group the way does not name, and any group of a way that names none, as `invalid_input` at `/more`, and `more` for a server given by hand there too, since that offers no group. It refuses a group no client set up here covers as `conflict`.

`reconnect_connection` answers `200` with the connection and `connect` alike: a new link that replaces any link before it, open or not.

`list_connections` answers the connections newest first in `connections`, the removed ones only with `include_removed`. It and `get_connection` answer each with `more`, the groups of scopes its provider's way names that it does not hold yet and a client set up here can ask, each `{ name, for }`: `name` is what `reconnect_connection` takes, and `for` what the group is for in the person's words. `more` is empty where there is none.

`read_link` answers the connection with:

- `link`, `{ expires_at, more? }`: when its link expires, and, for a link `add_connection` or `reconnect_connection` gave for a group of more, the group, `{ name, for }`, whose scopes the connection's `asked_scopes` then hold beside those asked before, with their words. A link whose group the provider no longer names is `conflict` here and at its `start`.
- `asked_scopes`: the scopes the connection asked that its provider's way still asks or offers, and beside them those the link's consent asks, each with its words. A scope the provider dropped is left out, since the consent does not ask it.
- `consent`, `{ started_at, expires_at }`, while a consent is started and not finished.
- For a connection whose credential is `authorization`, `client_source`: the source of the client a start would take now, by the rule the start takes it by, `auto` where it would begin through Auto's consent service. It is left out where the runtime has no client the provider's way takes.
- `asked_by`, `{ id, name, domain }`: the client the link was asked through, by `add_connection` for the link of an addition and by `reconnect_connection` for a new one, where the access token of that call was issued to one. `id` is its `client_id`; `name` its `client_name`, or `null` where the token gives none; and `domain` the host of a `client_id` that is the `https` address of its metadata document, or `null`. It is left out for a link asked for with an API key, with a session or with a token that names no client ([Authentication](authentication.md#the-client-a-person-calls-through)).

`approve`, `give_credential` and `finish`, which use the link up, answer the connection alone, and `give_credential` beside it `pattern_unmatched: true` where the key given misses the `pattern` of a credential given by hand.

- With `provider`, the provider gives the server and how it is credentialled. `name` is the provider's when left out; `placeholders` gives the value of each placeholder the provider takes; `credential` may give its `kind` alone, which names one of the provider's ways, since a provider offers one way of each kind, and when it is left out the addition takes the first way `list_providers` marks offered, or the provider's first where it offers none, which the addition then refuses in its words; and `entry` may give `playbooks`, `allowed` and `record_content` alone. `type`, the server's fields of `entry` and every field of `credential` but `kind` and `oauth_client` are refused, each at its field, since the provider gives them; `credential.client_id` is refused since the person gives the client id on the page. The connection's `entry` and `credential` are the provider's with each value in its place, and every rule below applies to them as to a server given by hand. Without `provider`, `name`, `type` and `entry` are each required, and `credential` too for an HTTP API, since an MCP server says how it authenticates, and `placeholders` is refused.
- `entry` holds the server without its credential: `url` for `mcp`; `document` and `base_url` for `openapi`; and `headers`, `query_params`, `allowed`, `playbooks`, `record_content` and `request_id`, as an entry of the configuration file has them. `url` and `document` are each an `https` URL, or an `http` URL on a loopback address.
- `credential` is one object: its `kind` and the fields that kind takes. Each field is optional in the schema, and is refused as `invalid_input` at the field where its kind lacks it or does not take it:

  | `kind`               | Takes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `none`               | No other field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
  | `secret`             | `name` and `in`. `in` is `header`, `query` or `security`. `name` is the header, the query parameter or the security scheme of the document the value is sent as. Only an `openapi` connection takes `query` or `security`. Given by hand, it also takes `instructions` and `key_page`, and optionally `example` and `pattern`, as below                                                                                                                                                                                                                                                                                        |
  | `reference`          | `variable`, `name` and `in`. `variable` is a variable of the runtime such as `CRM_API_KEY` that the operator lists in `connections.variables`. Its value is sent where `name` and `in` say, as a secret's is                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `client_credentials` | `issuer`, an optional `client_id` and an optional `scope`. `issuer` is an `https` URL or an `http` URL on a loopback address                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `authorization`      | With this kind, the person signs in at an authorization server and allows Auto. It takes `issuer`, and, as the provider gives them, `scope`, `parameters`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `pkce` and `clients`. `pkce` is `none` where the server of those endpoints takes no PKCE challenge. `clients` names the client sources the provider's authorization server takes: `registered`, `metadata_document` or `dynamic`. Once connected, it takes `client_id` and `client_source`, the client the connection was made with, while `scope` stays the scope the way's first consent asked |

  The same object is what every operation answers and what the org's record keeps.

- An MCP server given by hand says how it authenticates. As the connection is added, and before anything is recorded, the runtime asks it once, with one request that carries no token. It reads the protected resource metadata the answer names, or that the server's well-known paths publish where the answer names none. [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) says how.
  - Where that metadata names an authorization server the runtime takes, the connection records `authorization`. It records that server as its issuer, the scope the server asks and the client the runtime makes for itself there: `dynamic` where the authorization server registers clients dynamically, and else `metadata_document`.
  - So the agent leaves `credential` out, or gives `authorization` with its `kind` alone. Any other field beside the kind is refused at its field.
  - For such a server, `none`, `secret` and `reference` are refused at `/credential/kind`, in words that name the authorization server and say to leave the credential out. `client_credentials` stand, since they take their token from an authorization server too.
  - Where the server names no authorization server, the kind given stands, except `authorization`, which is refused at `/credential/kind`. A `credential` left out is refused at `/credential`, in words that say the server names no way of its own and ask how its credential is sent.
- An HTTP API given by hand, whose document names no authorization server, takes its `credential`. It is refused the kind `authorization` at `/credential/kind`.
- A `secret` or a `reference` sent in a header may name its `scheme`, such as `Bearer`, which the runtime writes, with a space, before the value it sends, so the person gives the token alone, the variable of a reference holds the token alone, and the server receives `Authorization: Bearer <token>`. A `scheme` holds the characters of a header name and no `$`, and a credential that places no value in a header takes none. `give_credential` refuses a value that already starts with the scheme and a space, in any case, at `/value`.
- A `secret` says how the person makes its key, for Studio's page to show beside the field of the key, and the record keeps it in the open with the rest of the credential, never beside the value. A provider's way gives it; `read_link` answers it in the connection's `credential`, and `provider`, the provider's name or `null`, says whether the provider or the agent wrote it.
  - `instructions` is Markdown without HTML, from 1 to 1,000 characters: where the key is made, with a link to that page, the plan or role it needs, the permissions it needs and its format. A `<` before a letter, `/`, `!` or `?`, which starts a tag, is refused.
  - `key_page` is the `https` address of the page where the key is made, written out from `https://`, with no user name or password in it.
  - `example`, optional, is what a key looks like, in at most 100 characters, with an ellipsis, `…`, in place of the key's characters, such as `ghp_…`, so that it never reads as a key.
  - `pattern`, optional, is the regular expression from `^` to `$` a key matches, of at most 200 characters, read as JavaScript reads it with the `u` flag: characters, `.`, `\d`, `\w` and character classes, each repeated with `?`, `*`, `+`, `{n}`, `{n,}` or `{n,m}` of at most 1,000, and no group, alternative, lookaround, back reference or lazy repeat. The runtime matches it in time in proportion to the key's length, never by backtracking, and matches it to no key of more than 8,192 characters.
  - With `provider`, the agent gives none of the four, and each is refused at its field. For a server given by hand, `instructions` and `key_page` are required, each refused at its field in words that say what to write, and every other kind refuses the four.
  - `give_credential` matches the value of a `secret` to its `pattern` before it keeps it. For a provider's way, a value of another format is refused at `/value`, `Paste the key itself: this value is not in the format of the provider's keys`, nothing is kept and the link stays open. For a server given by hand, whose pattern the agent wrote and may have wrong, the value is kept, the connection connected, and the answer carries `pattern_unmatched: true`.
- The `client_id` of client credentials is the org's, so the agent may leave it out and the person gives it on Studio's page with the client secret or the private key: a connection whose credential holds none answers its record without it, `give_credential` takes `client_id`, and the record holds it from then on. `give_credential` refuses a `client_id` at `/client_id` where the credential holds one, refuses one missing where it holds none, and refuses one that looks like a credential, since the record keeps the client id in the open and the secret or the key goes in its own field, where it is sealed. `add_connection` refuses a `client_id` that looks like a credential at `/credential/client_id`.
- `get_connection` and the six routes of the link are served over HTTP alone, and no MCP endpoint serves them. `get_connection` reads one connection of the org by its id; an agent sees whether the person approved a connection in the `status` `list_connections` answers for each. The six routes of the link are Studio's page's alone. Each takes the token, which the runtime keeps only as its SHA-256, and matches it to the open link of the connection: the newest one given, less than 24 hours ago, that nothing has used up.
- `start` and `finish` connect a connection whose credential is `authorization`.
  - `start` answers `201` with `authorize`, `{ url, expires_at }`, and `client_source`, the source of the client it started with.
  - `url` is the page of the connection's authorization server where the person signs in and allows Auto. It carries the client, the return address, the scope, a state and a challenge.
  - The return address is the page `connect-return` of the Studio the connection's link opens. It is the Studio host's `/connect-return`: `STUDIO_ORIGIN` followed by `/connect-return`, or `https://studio.on.auto/connect-return` unless `STUDIO_ORIGIN` is set. Where the runtime serves Studio, it is instead `/studio/connect-return` on the runtime's own address.
  - `expires_at` is ten minutes on, the time the consent has of its own. A second start replaces the first.
  - The server sends the person back to the return address with a code, the state and its issuer. Studio sends them to `finish` with `token`, `code`, `state` and `iss`.
  - `finish` redeems the code, keeps the tokens sealed in the runtime's secret store and connects the connection. It is bound to the start and not to the link's 24 hours.
  - `finish` refuses a state the consent was not started with at `/state`, an issuer that is not the server's at `/iss`, and a code the server refuses at `/code`, in Auto's own words. A refused code leaves the start open.
  - The scope `finish` records as `granted_scope` is the one the server granted, its scopes separated by single spaces, or the one asked where the server says none.
  - A grant of no scope where one was asked, or of a scope that is not one, is refused. An empty grant where none was asked records none. A finish refused once the tokens exist revokes them first.
  - A connection connected by consent then serves its tools, and the runtime renews its tokens. [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) says how.
- A start of `client_source` `auto` began through Auto's consent service, with Auto's client at the vendor. [Consent through Auto](../self-host/connections.md#consent-through-auto) says when a runtime starts one.
  - The start's `url` is the page Auto's consent service made, whose return is the Studio host. The Studio host sends the person back to the Studio the link opened, with a handle and the state.
  - `finish` then takes `token`, `state` and `handle`, takes the tokens from the service and connects the connection.
  - A finish of the other shape than its start's is refused as `invalid_input` at the field it gave, `/code` or `/handle`, saying which the consent answers. A handle the service refuses is refused as `invalid_input` at `/handle`.
- `approve` connects a connection whose credential is `none` or `reference` and uses its link up. `give_credential` keeps the value sealed in the runtime's secret store, connects the connection and uses its link up: giving the credential is its approval.
- With `provider`, `credential` may be `{ kind: authorization, oauth_client: own }`, so the connection runs under the organization's own OAuth client. That is a client the organization registers with the provider, which bills and limits it. [A connection under the organization's own OAuth client](../self-host/connections.md#a-connection-under-the-organization-s-own-oauth-client) sets it out.
  - The connection's credential holds `client_source: own` from the start. A way whose `oauth_client` is `required`, as the way says or since no client here covers it, takes the organization's own OAuth client without `oauth_client`.
  - `oauth_client` beside another kind is refused at `/credential/oauth_client`, and so is `oauth_client` without `provider`.
  - The page of the connection's link gives the client ID and the client secret, `client_id` and `client_secret`, through `give_client` before the sign-in. `give_client` keeps the secret sealed in the runtime's secret store, records the client ID in the connection's `credential`, leaves the link open and answers the connection.
  - A second `give_client` of a connection that holds no tokens replaces the client given before and forgets its secret.
  - A connection that holds tokens, `connected` or `broken`, takes a client through a link `reconnect_connection` gave. The client ID it runs under, given with a new secret, replaces that secret at once and drops a next client given before.
  - Another client ID given to such a connection is kept as its next client, which its record does not show. The next `start` takes it. Once that consent's `finish` connects the connection, the connection runs under that client. The tokens before are then revoked with the client they were given to, whose secret is forgotten.
  - A next client given again replaces the one before, whose secret is forgotten.
  - `read_link` answers `client_source: own`, and the credential's `client_id` once the client is given. It answers `return_address`, the address the runtime sends the authorization server as `redirect_uri`, which the client registers as an authorized redirect URI. While the connection keeps a next client, it answers `next_client_id`, which `give_client` answers too.
  - `start` is refused as `conflict` until the client is given. It starts the consent with that client at the provider's authorization server, never through Auto's consent service.
  - `finish` takes the client its `start` took. The renewal of the tokens and their revocation take the client the connection runs under.
  - `remove_connection` forgets the client's secret and a next client's.
  - A `start` or `finish` under a client given again meanwhile is refused as `conflict`. The person then signs in again under the client given last.
- A connection is added by a person: on a runtime that signs people in, `add_connection` refuses a key, and a runtime of API keys alone, which signs nobody in, refuses every connection, since no person could approve it.
- On a runtime that signs people in, `approve`, `give_credential`, `give_client`, `start` and `finish` need the session of the person who added the connection. In local mode the token alone binds.
- `reconnect_connection` gives a new link to a connection that is `broken`, `connected`, or `pending`, whether or not its link is still open. It changes nothing else of the connection. A removed connection is added again rather than reconnected.
  - The new link replaces the one before, so only the newest works. The token of the link before is answered `not_found` by `read_link`, `approve`, `give_credential`, `start` and `finish`, in words that say so: `There is no open link of this token: a newer link of the connection crm replaced it`. So the page can send the person to the newest.
  - A broken connection of a `reference` takes no link. Where the runtime finds its variable set, it answers the connection `connected` at once, without `connect`. While the variable is not set, it refuses the connection with `conflict`, since the runtime reads its variables when it starts.
  - A pending or connected connection of a `reference` takes a link as any other kind does.
  - On a runtime that signs people in, only the person who added the connection may reconnect it, as only they may use its link.
  - Through the new link, `read_link`, `approve`, `give_credential`, `start` and `finish` take the connection, pending, connected or broken alike.
  - Connecting the connection again replaces its credential. The runtime forgets the secret it held, and answers it `connected`, with `broken` `null` and the new `connected_by` and `connected_at`.
  - Where the new consent took another client, the tokens of a consent the connection held are revoked as `remove_connection` revokes them. Where it took the same one, they are forgotten without a revocation, since some authorization servers end the person's whole grant to that client on one revocation.
  - A client of the MCP tool that opens links is asked to open the new link, as for `add_connection`. Its retry answers `link_ran_out` where the link ran out unused, and `link_replaced` where a newer link that is still open replaced it.
  - The consent a link without `more` starts asks the scopes the provider's way asks now, with those of the scopes the connection asked since that it was granted and the way still asks or offers. So a connection granted a group of more keeps it while the provider offers it, and is never asked a scope the provider dropped. Where no client set up here covers the rest, the consent asks the way's scopes alone. A server given by hand asks the scopes of its credential.
  - That consent never asks a scope the server granted beyond what the connection asked, such as a grant of another connection to the same client, nor one a consent the person abandoned asked.
- Given `more`, the name of a group `list_connections` offers the connection, `reconnect_connection` gives a connection that is `pending`, `connected` or `broken` a link for that group. [A consent that asks more](../self-host/connections.md#a-consent-that-asks-more) says how a provider names its groups.
  - The consent that link starts asks the scopes the connection asked that it was granted and the provider's way still asks or offers, or those the way asks now while it holds none of them, with the group's. So the person keeps what they allowed before.
  - That consent carries the parameters of the provider's way, as any consent of the way does.
  - The finish records what the server granted as `granted_scope`.
  - `reconnect_connection` refuses a group the connection's way does not name, and any group of one that names none, as `invalid_input` at `/more`. It refuses a group the connection holds every scope of already, or one no client set up here covers, as `conflict`.
- `remove_connection` removes a connection for good, and the runtime forgets its credential, and what a consent started for it keeps, having first revoked at the provider the tokens of a connection connected by consent; tokens it cannot read or revoke now are logged and left to end on their own, and the removal goes on. Removing a removed connection succeeds and records nothing. Its name may then be given to a new connection.
- `set_connection_playbooks` sets which playbooks of the org may use a connection. `playbooks` names them by id, and `null` gives the connection to every playbook of the org, those made later among them, its `entry` then naming none.
  - A list names at least one playbook: an empty one is refused as `invalid_input` at `/playbooks`, and a malformed id at its place. The ids are not looked up, as those of `add_connection`'s `entry.playbooks` are not.
  - It sets them for a connection `pending`, `connected` or `broken` alike, records nothing where the connection serves those playbooks already, and refuses a removed connection with `conflict`. It needs `org:write`, as `remove_connection` does, and any caller who holds it may set them, not the person who added the connection alone. A caller that may access only some playbooks of the org, such as a key limited to some playbooks, is refused as `forbidden`, since it could otherwise give a connection to playbooks it may not access.
  - A run opens its tools once, as it starts, and keeps them until it ends, so a run under way finishes with the connection. A run that opens its tools afterwards in a playbook the connection no longer serves is refused as `unavailable`, `tool_not_offered` because `tool_server_not_configured`, as for a server the playbook does not have; so is a call by hand there, and that playbook's `search` no longer lists the connection.
- `approve`, `give_credential` and `start` take `playbooks` too, so the call that approves a connection, or that starts its consent, also sets which playbooks may use it. The playbooks are recorded with the approval or the start, only where they differ from those the connection serves, and a call the link or its binding refuses changes none. The playbooks given to `start` are set when the consent starts, whether or not it finishes. Left out, the connection keeps the playbooks it has. A caller that may access only some playbooks of the org is refused as `forbidden` when it gives `playbooks`, as `set_connection_playbooks` refuses it. `read_link` answers them, in `entry`, before.

| Case                                                                                                                                                                                                                                                                                                                                                | Response                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| An entry that holds a value that looks like a credential, a reference such as `${NAME}`, or a field another entry would refuse                                                                                                                                                                                                                      | `invalid_input`                            |
| A `provider` the runtime does not have, at `/provider`: `There is no provider named crm here; search lists the providers a person may connect`                                                                                                                                                                                                      | `invalid_input`                            |
| A placeholder the provider does not take, one missing, or a value its pattern or its choices refuse, that looks like a credential or that would move the address, at `/placeholders/<name>`                                                                                                                                                         | `invalid_input`                            |
| A `credential.kind` the provider does not offer, at `/credential/kind`                                                                                                                                                                                                                                                                              | `invalid_input`                            |
| What the checks of an entry refuse in what the provider resolved, at `/provider`, or in a `name` the caller gave, at `/name`                                                                                                                                                                                                                        | `invalid_input`                            |
| A kind of credential there is not, or a field its kind lacks or does not take                                                                                                                                                                                                                                                                       | `invalid_input`                            |
| A `scheme` beside a credential that is not sent in a header, or one that holds a `$` or a character a header name does not                                                                                                                                                                                                                          | `invalid_input`                            |
| An MCP server given by hand that names an authorization server the runtime takes, with a `credential` of the kind `none`, `secret` or `reference`, at `/credential/kind`                                                                                                                                                                            | `invalid_input`                            |
| An MCP server given by hand that names no authorization server, with its `credential` left out, at `/credential`, or of the kind `authorization`, at `/credential/kind`                                                                                                                                                                             | `invalid_input`                            |
| An MCP server given by hand with `authorization` or its `credential` left out that names another resource or a malformed scope, or whose authorization server cannot be read, names another issuer, takes no S256 challenge or registers no client, at `/credential/kind`, and with `none`, `secret` or `reference` alike, but for another resource | `invalid_input`                            |
| An MCP server given by hand that does not answer, whatever its `credential`, or whose authorization server does not answer, unless its `credential` is `client_credentials`                                                                                                                                                                         | `unavailable`                              |
| A `secret` given by hand without `instructions` or `key_page`, `instructions` past 1,000 characters or holding a tag, a `key_page` that is no `https` page, an `example` without `…`, or a `pattern` the runtime does not take, at its field; any of the four with `provider`, or of another kind                                                   | `invalid_input`                            |
| `give_credential` with a value of another format than the `pattern` of its provider's way, at `/value`, keeping nothing                                                                                                                                                                                                                             | `invalid_input`                            |
| `give_credential` with a value that starts with the credential's `scheme`, a `client_id` where the credential holds one, none where it holds none, or one that looks like a credential                                                                                                                                                              | `invalid_input`                            |
| A connection the operator's rules do not take: no one may add one, its host, its kind of credential or the variable its reference names                                                                                                                                                                                                             | `forbidden`, with the sentence of the rule |
| A name of an entry of `tool_servers`, or of a connection of the org that is not removed                                                                                                                                                                                                                                                             | `conflict`                                 |
| An org that holds 50 connections that are not removed, the most it may                                                                                                                                                                                                                                                                              | `conflict`, kind `connections_full`        |
| A token that is unknown, used up, expired or replaced by a newer link, or an id the org does not have                                                                                                                                                                                                                                               | `not_found`                                |
| `add_connection` or `reconnect_connection` by a key where people sign in, or by anyone on a runtime of API keys alone                                                                                                                                                                                                                               | `forbidden`                                |
| `approve`, `give_credential` or `give_client` with the session of another person, where people sign in                                                                                                                                                                                                                                              | `forbidden`                                |
| `start` or `finish` of a connection whose credential is not `authorization`, a server that names a resource other than its own address, or an authorization server that names another issuer, takes no S256 challenge, publishes no metadata or takes none of Auto's clients                                                                        | `conflict`                                 |
| `start` or `finish` where a host of the authorization server is one the rules do not allow                                                                                                                                                                                                                                                          | `forbidden`, with the sentence of the rule |
| `finish` with a client no longer registered, or, once the tokens it got are revoked, tokens the runtime's secret store refuses, a grant of no scope where one was asked, or a grant that is not a scope                                                                                                                                             | `conflict`                                 |
| `finish` with no consent started, or one started more than ten minutes ago                                                                                                                                                                                                                                                                          | `not_found`                                |
| `finish` with a state the consent was not started with, at `/state`, an issuer that is not the server's, at `/iss`, or a code the server refuses, at `/code`                                                                                                                                                                                        | `invalid_input`                            |
| `start` or `finish` where the authorization server does not answer                                                                                                                                                                                                                                                                                  | `unavailable`                              |
| `give_credential`, `give_client`, `start` or `finish` where the runtime's secret store cannot keep or read now what it needs, in the store's words; a `finish` whose code was redeemed then says the person starts again, its tokens revoked                                                                                                        | `unavailable`                              |
| `start` whose client, registered by the runtime at the authorization server, is one its secret store refuses to keep, in the store's words                                                                                                                                                                                                          | `conflict`                                 |
| `approve` of a connection whose credential is to be given, or `give_credential` of one that takes none                                                                                                                                                                                                                                              | `conflict`                                 |
| `give_client` of a connection that does not run under the organization's own OAuth client, or `start` of one under it whose client is not given, or whose client secret is no longer in the secret store, or a `start` or `finish` under a client given again meanwhile                                                                             | `conflict`                                 |
| `give_client` with a client secret the runtime's secret store refuses, at `/client_secret`                                                                                                                                                                                                                                                          | `invalid_input`                            |
| `add_connection` with `credential.oauth_client` beside a kind other than `authorization`, or without `provider`, at `/credential/oauth_client`                                                                                                                                                                                                      | `invalid_input`                            |
| `reconnect_connection` of a connection removed, or of a broken `reference` whose variable is not set                                                                                                                                                                                                                                                | `conflict`                                 |
| `reconnect_connection` by another person than the one who added the connection, where people sign in                                                                                                                                                                                                                                                | `forbidden`                                |
| `reconnect_connection` with a `more` the way of the connection does not name, at `/more`                                                                                                                                                                                                                                                            | `invalid_input`                            |
| `reconnect_connection` with a `more` the connection holds already or no client set up here covers, or `read_link` or `start` of a link given for a group its provider no longer names                                                                                                                                                               | `conflict`                                 |
| `set_connection_playbooks`, `approve`, `give_credential` or `start` with an empty list of `playbooks`, at `/playbooks`, or a malformed playbook id, at its place                                                                                                                                                                                    | `invalid_input`                            |
| `set_connection_playbooks` of a connection removed                                                                                                                                                                                                                                                                                                  | `conflict`                                 |
| `set_connection_playbooks`, or `approve`, `give_credential` or `start` with `playbooks`, by a caller that may access only some playbooks of the org                                                                                                                                                                                                 | `forbidden`                                |

### The tools of a connection

`list_connection_tools` answers the tools a connection's server offers now, those its entry's `allowed` names where it names any, so a page or an agent shows what one connection can do without searching the whole org. The runtime asks the server for its tools when it is called, as `search` does, and sends nothing to a tool. It answers `connection`, the id given, `server`, the connection's name, which a function writes before the slash, `tools`, sorted by name, `has_more` and `next_cursor`, read as [Paging](#paging) reads a list: `limit` from 1 to 100, 20 when left out, and `cursor` the `next_cursor` of the page before; a cursor no page gave is refused as `invalid_input` at `/cursor`. Each tool holds:

| Field               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | The tool, as a function names it after the slash                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `title`             | What a person reads as its name, where its server gives one: an MCP tool's `title`, or the `title` of its annotations; an operation of an HTTP API has none, its summary opening its description                                                                                                                                                                                                                                                                                                                                            |
| `description`       | What it does, as its server describes it, whole up to 4 KiB, as `introspect` answers it; empty where it gives none                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `hints`             | The hints its server gives, `destructiveHint`, `idempotentHint` and `openWorldHint` of the MCP specification as it gives them, each left out where the server gives none and `hints` left out where it gives none of them, which the specification reads as a tool that may destroy what it changes, may not be repeated safely and reaches outside; an operation of an HTTP API is `destructiveHint` for `DELETE`, `idempotentHint` for `GET`, `HEAD`, `PUT` and `DELETE`, and `openWorldHint` always. Whether it only reads is its `mark` |
| `mark`, `marked_by` | Its [mark](#the-mark-of-a-tool) and what gave it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

A connection that is not connected, or whose server cannot be reached, is refused as `unavailable`, with the `kind`, the `because` and the words a function's refusal and `search` give: `tool_not_offered` and the `because` [A connection that is not ready](#a-connection-that-is-not-ready) lists, or `tool_server_failed` where its server fails. An id the org has no connection of, or one removed, is `not_found`.

### Providers

A provider is a service Auto knows by its name, an MCP server or an HTTP API with how a credential reaches it, which a person connects by its name and the values its placeholders take. `list_providers` lists those a person may connect here, and [`search`](#searching-the-tools) on the org route lists to a caller who may add a connection those that no server serves yet; [Let people add connections](../self-host/connections.md#the-providers-auto-ships) lists those Auto ships, and whoever runs Auto adds providers of their own in its settings file, [`connections.providers`](../self-host/connections.md#add-providers-of-your-own). The route is relative to `/v1/orgs/{org}` and served over HTTP alone, for a page to read:

| Operation        | Method and route | Permission | Input |
| ---------------- | ---------------- | ---------- | ----- |
| `list_providers` | `GET /providers` | `org:read` | None  |

It answers `providers`, sorted by name, `may_add`, `refusal` and `return_address`. A provider holds:

| Field          | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`         | Its name, the default name of a connection to it, given as `provider` to `add_connection`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `title`        | What a person reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `description`  | What a function may do with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `website`      | Where a person reads about the server and makes a credential                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `type`         | `mcp` or `openapi`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `credentials`  | The ways a credential reaches the server, the first the default: `kind`, `secret`, `client_credentials`, `none` or `authorization`; for `secret`, `in` and `name`, where the person's value is sent, and `scheme`; for `client_credentials` and `authorization`, `issuer`; `scopes`, the scopes the way's first consent asks, in their order, each `{ name, says }`, `says` one sentence of at most 120 characters that says what a connection can do through the scope, such as `Read Gmail messages, threads, drafts, labels and settings.`, empty where the way asks none; `more`, the groups of scopes a later consent of a connection made this way may add, each `{ name, for, scopes }`, `for` what the group is for in the person's words, empty where the way names none; a `description` for the person, for `secret` the short name of the key, the label of its field, such as `GitHub fine-grained personal access token`, whose instructions and key page the connection's `credential` holds once it is added; for `authorization`, `oauth_client`, `optional` where a person may connect it under the organization's own OAuth client beside the client here, with `client_source`, the source of the client a start takes without it, as `read_link` names it, and `required` where it connects under the organization's own OAuth client alone, as the way says or since no client here covers it; `offered`, whether a person may connect it this way here, and `because`, why not, or why only under the organization's own OAuth client |
| `placeholders` | The values a person gives: `name`, `description`, `pattern` and `example`, or `choices`, each a `value` and a `title`, and `required`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- A provider is listed where the operator's rules could allow it: a way is listed where `credential_kinds` takes its kind and the hosts it reaches could pass `allowed_hosts`, a host that holds a placeholder judged by its shape, a fixed host that is an address inside the network, such as `10.0.0.5`, passing only where `allowed_hosts` names it by itself, and a provider with no way left is not listed. Whether a connection is allowed is still checked when it is added and on every request it makes.
- A way is `offered: false` while a value whoever runs Auto sets for it is not set, and `because` says so. Every way of the kind `authorization` offers the organization's own OAuth client: where Auto has none of the clients its provider's authorization server takes, as [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) sets out, its `oauth_client` is `required`, and `because` says why: `The provider drive takes consent through a client whoever runs Auto registers, which is not set up here`, or, where a client is set up there but covers not every scope the way asks, `The provider drive takes consent through a client whoever runs Auto registers, and no client set up here covers every scope its way asks, files.read files.write`. `add_connection` connects such a way under the organization's own OAuth client without `oauth_client`. A provider lists such a way after its ways a client here covers or that take no client, a token or a secret, so the default, the first way offered, is one a person can take now where the provider has one. A client here covers a way where it covers the scopes of its first consent, whether or not one covers a group of its `more`. [Searching the tools](#searching-the-tools) says what `search` does with a provider none of whose ways is offered.
- `may_add` says whether this caller may add a connection here, and `refusal` why not, in the sentence the first rule that refuses gives, in the order `add_connection` refuses: a caller without `org:write`; a key where people sign in, or every caller where the runtime signs nobody in; `connections.people_may_add` set to `false`. It is `null` where the caller may add. The providers are listed whatever `may_add` says.
- `return_address` is the address the runtime sends a provider's authorization server as `redirect_uri` for a connection under the organization's own OAuth client, which that client registers as an authorized redirect URI before a person connects under it, the one `read_link` answers for such a connection.

### A connection that is not ready

A connected connection is a tool server of its org: `search` lists it with `connection`, its id, `list_connection_tools` lists its tools, a function names it by its name as `name/tool`, and `introspect`, `validate`, `dry_run`, `query_connection` and `execute_connection` reach it, as [Tool servers](#tool-servers) describes. The runtime checks the operator's rules and the entry, as `add_connection` checks them, and reads its credential when it is first used after the runtime starts. A connection that is not ready is refused as `unavailable` of the kind `tool_not_offered`, and `search` lists it unavailable with the same `because` and words:

| `because`                | The connection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connection_pending`     | Nobody has approved it yet; the person who added it opens its link, or reconnects it for a new link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `connection_broken`      | Its server answered `401`, or a code its provider's `failure_codes` names for a refused credential, as a listing or a call met it, its credential is gone from the secret store or is not the tokens of a consent, its consent was revoked or has ended, or its client is no longer registered; the runtime recorded it `broken`, with why and since when in `broken`, once, in words that say what puts it right, most often that the person reconnects it with `reconnect_connection`. A `403` naming `insufficient_scope` breaks nothing and fails that call alone, in words that name the scope the call lacks |
| `connection_not_allowed` | The runtime does not use it, in the words of why: a rule of the operator no longer takes it, in the sentence `add_connection` would give; `connections.people_may_add` is `false`; its entry is no longer one the runtime takes; the variable its reference names is not set; the configuration now sets up a server of its name; or a request it would make goes to a host the rules do not allow                                                                                                                                                                                                                 |
| `connection_unavailable` | Its credential cannot be read just now, in the words of why: the runtime's secret store cannot unwrap it or does not answer, which whoever runs the runtime puts right. The connection stays connected, and a later call reads the credential again                                                                                                                                                                                                                                                                                                                                                                |

## License

A runtime without a key runs 100 free runs, then at most 15 a UTC day and 75 a UTC calendar month; with a key it runs on the credits of an org at Auto, starting each run itself against a license Auto signed and reporting what it started every hour. [License a self-hosted runtime](../self-host/licenses.md) sets out how a key is had and the ways to activate it, and the [self-hosted licensing reference](../self-host/licensing.md) how a licensed runtime runs. These routes are relative to `/v1/orgs/{org}`; the license covers the whole runtime, whatever org the route names.

| Operation             | Method and route                  | Permission                    | Input                                                                                          |
| --------------------- | --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `get_license`         | `GET /license`                    | `org:read` or `playbook:read` | None                                                                                           |
| `activate_license`    | `POST /license`                   | `org:write`                   | `key`, the key Studio gave, `alk.<org>.<runtime id>.<secret>`                                  |
| `activate_allocation` | `POST /license/allocation`        | `org:write`                   | `allocation`, the offline credits an operator of Auto signed: `payload`, `signature` and `kid` |
| `report_allocation`   | `POST /license/allocation/report` | `org:write`                   | Optional `allocation`, the id of the offline credits the report is of                          |

`get_license` answers where the runtime stands, to every member of an org, and is served over HTTP alone:

| Field                              | Value                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                            | `unregistered` while it holds no key; `licensed` while it runs on its license; `out_of_touch` from the license's `warn_at` while it has not reached Auto, still running on it; `limited` while it runs at the free rate though it holds a key; `offline` while it spends offline credits; `invalid` once they have stopped                            |
| `limited_because`                  | While it is `limited`: `credits`, `cap`, `out_of_touch`, `key_rotated`, `key_revoked`, `org_closed` or `not_activated`; `null` otherwise                                                                                                                                                                                                              |
| `runtime_id`                       | The runtime's id, which an admin of the organization registers in Studio; a runtime that has no id yet takes one as it is first read                                                                                                                                                                                                                  |
| `free_runs`                        | `{ used, of }`: the first runs it used of its 100, while it has never held a license; `null` once it has                                                                                                                                                                                                                                              |
| `org`, `plan`                      | The org at Auto and its plan, of the license of the key in force; `null` without one                                                                                                                                                                                                                                                                  |
| `org_name`                         | The name of that org at Auto, as Auto signed it into the license, on one line of at most 80 characters; `null` without one, or where Auto named none or a blank one                                                                                                                                                                                   |
| `features`                         | The features of the license in force, which work that needs one checks before it starts; `[]` without a license in force: without a key, before its key is activated, once the license lapsed at its `limit_at` while no live offline credits stand, once its key was replaced or removed or its org closed, or once offline credits it holds stopped |
| `standing`                         | Where the org's credits stood when Auto signed the license: `ok`, `low`, `empty`, `overage`, `near_cap` or `capped`; `null` without one                                                                                                                                                                                                               |
| `licensed`                         | The runs it started on a license, in all                                                                                                                                                                                                                                                                                                              |
| `runs_left`                        | The runs it may still start on its license; `0` while it is limited, `null` without a license                                                                                                                                                                                                                                                         |
| `credits`                          | `{ available, owed, overage_cap }` of the org when Auto signed the license; `null` without one                                                                                                                                                                                                                                                        |
| `issued_at`, `warn_at`, `limit_at` | When Auto signed the license, from when it is out of touch and from when it runs at the free rate, unless it reports first; `null` without one                                                                                                                                                                                                        |
| `last_report_at`                   | When it last took a license from Auto, as it activated or reported; `null` without one                                                                                                                                                                                                                                                                |
| `fallback`                         | `{ per_day, per_month, used_today, used_this_month, lifts_at }` while it runs at the free rate, `lifts_at` being when it can run again once it has used the rate; `null` otherwise                                                                                                                                                                    |
| `key_source`                       | Where the key in force came from: `environment`, `configuration` or `activated`; `null` without a key. A key in the environment or the configuration file wins at each start                                                                                                                                                                          |
| `offline`                          | `{ credits, spent, usable_until }` while it holds offline credits; `null` otherwise                                                                                                                                                                                                                                                                   |
| `invalid_because`                  | While it is `invalid`, the `detail` a run is refused in; `null` otherwise                                                                                                                                                                                                                                                                             |
| `summary`                          | Where it stands in plain words, and how to put it right, as it says in its terminal                                                                                                                                                                                                                                                                   |

`activate_license` answers `200` with the same document. The runtime keeps the key in its secret store, so it stands after a restart, unless `AUTO_RUNTIME_LICENSE_KEY` or the configuration file gives another, which wins at each start. A key that is not one of Studio is refused as `invalid_input`; one Auto does not know, rotated away, removed or for another runtime, and a license not signed by Auto, as `license_invalid`; a key of an org whose account is closed as `account_closed`; and an account service that cannot be reached as `unavailable` of the kind `meter_unavailable`. Activating the same key again takes a fresh license.

`activate_allocation` and `report_allocation` serve a [runtime on offline credits](../self-host/licensing.md#offline-credits), and are served over HTTP alone. `activate_allocation` answers `200` with `allocation`, its id, `installation`, the runtime's id, `credits`, `spent`, what the runtime admitted on them, and `refresh_by`, the date Auto signed into them: 30 days after they were issued or last refreshed, or 90 where Auto chooses it under an Enterprise order, and never past the earliest expiry of the credits they took. Offline credits not signed by Auto, for another runtime or past their date are refused as `license_invalid`, and what is not their JSON as `invalid_input`. Giving the same credits again changes nothing but a later `refresh_by`. `report_allocation` answers `200` with `report`, `{ allocation, installation, sequence, spent, at }`, the next number and all spent so far, and `signature`, its HMAC-SHA256 under the runtime's key, the JSON an admin of the organization uploads in Studio; a runtime with no offline credits, with no key to sign with, or holding others than those named, is refused as `conflict`.

## Responses and errors

A successful operation responds with JSON and `Cache-Control: no-store`. The create operations, `create_playbook`, `create_definition`, `make_comment` and `add_connection`, and a connection's consent `start`, return `201`; other successful operations return `200`.

An error is an RFC 9457 problem document, with `Content-Type: application/problem+json`. Inspect its `reason` and `detail`:

- `invalid_input` includes an `errors` list of JSON pointers, and the kind `input_schema` when the input schema of the function or workflow refused the input it was given, before it ran, or `cursor_not_held` for a cursor of [changes](#changes) the ledger does not hold.
- A rejection that has a `kind` carries it.
- An `unavailable` or `conflict` rejection that has a `because` carries it.
- A `conflict` may have the kind `oversized`, for a workflow whose output is larger than a run can record, or for an asset a generation function made that is larger than the runtime keeps of one asset or would take the playbook's assets past their total.
- A `conflict` may have the kind `blocked_by_moderation`, for a generation function whose request the provider of its model refused under its moderation.
- A run rejected as `unavailable` may have the kind `generation_timed_out`, for a generation the provider finishes later that it had not made when the run had waited as long as it may.
- A refusal a person resolves somewhere carries `resolve_at`, the absolute URL of that page, and a refusal of a self-hosted runtime's license or meter, other than `account_closed`, carries `runtime_id`, the runtime's id, once it has one. A self-hosted runtime's refusal at the free rate also carries `lifts_at`, when the limit lifts, and, where the runtime holds a key, `limited_because`, why it is limited to the free rate. The [license refusals](#the-refusals-of-the-meter) below say which carry what.

A refusal of the input of a function or a workflow says each issue in its `detail`, one sentence each, in the words of the input schema. A sentence names the field, then its `description` and `examples`, then the rule it broke. Each entry of `errors` holds one sentence and the field's pointer, so a reader can show it at its field:

```json
{
  "type": "https://on.auto/problems/invalid_input",
  "title": "Invalid input",
  "status": 422,
  "detail": "month, The month to report on, such as \"April 2026\" or \"2026-04\": expected at least 6 characters.",
  "reason": "invalid_input",
  "errors": [
    {
      "detail": "month, The month to report on, such as \"April 2026\" or \"2026-04\": expected at least 6 characters.",
      "pointer": "/input/month"
    }
  ],
  "kind": "input_schema"
}
```

A nested field is named by its path, such as `address, then city`, and an item of a list by its place, such as `lines, then item 2`. A missing field is named at the field that holds it, such as `The input: expected the field month`. A value of another kind is told the kind it was given, such as `lines: expected a list of records; it was given text`. A workflow whose step refused its input is rejected with that step's `errors`, at the pointers the step saw.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict` or `cancelled`                  |
| 410    | `unanswered`                               |
| 413    | `content_too_large`                        |
| 415    | `unsupported_media_type`                   |
| 416    | `range_not_satisfiable`                    |
| 422    | `invalid_input`                            |
| 500    | `internal`                                 |
| 503    | `unavailable`                              |

A problem document's `type` is a URI that names its kind of problem:

| Type                                              | Status | Means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://on.auto/problems/bad_request`            | 400    | The request is malformed, such as a field given twice or a body that is not a JSON object                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `https://on.auto/problems/unauthenticated`        | 401    | Credentials are missing or invalid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `https://on.auto/problems/forbidden`              | 403    | The credentials may not do that                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `https://on.auto/problems/origin_not_allowed`     | 403    | A browser sent the request from an origin the server does not allow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `https://on.auto/problems/not_found`              | 404    | Something the request names does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `https://on.auto/problems/method_not_allowed`     | 405    | The path does not take that method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `https://on.auto/problems/conflict`               | 409    | The request clashes with what is there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `https://on.auto/problems/tools_called`           | 409    | A run that may have called tools is not run again under its id; its `reason` is `conflict`. When every tool the run called only reads, it has `because: "only_read"`, and its words say nothing was changed                                                                                                                                                                                                                                                                                                                                                                                            |
| `https://on.auto/problems/effect_unknown`         | 409    | A run called a tool not marked `reads`, and could not finish. Whether the tool changed something is not known. Its `reason` is `conflict`; a person, or a workflow rule that names it, decides what happens next                                                                                                                                                                                                                                                                                                                                                                                       |
| `https://on.auto/problems/credits_exhausted`      | 409    | The org's account has no credits left for the run; on a self-hosted runtime, one that runs at the free rate since its org has no credits or owes its cap and has used the rate, or one whose offline credits are spent; its `reason` is `conflict`. Nothing of the run is recorded, and it can be run again once the account has credits or the rate lifts                                                                                                                                                                                                                                             |
| `https://on.auto/problems/license_required`       | 409    | The runtime holds no key and has used its free runs, the 100 it runs first and the 15 a UTC day or 75 a UTC month after; its `reason` is `conflict`. Nothing of the run is recorded, and it can be run again once the rate lifts or a key is activated                                                                                                                                                                                                                                                                                                                                                 |
| `https://on.auto/problems/license_invalid`        | 409    | The runtime runs at the free rate since its license can't be used right now, its key rotated or removed, its org closed, out of touch past its license's `limit_at` or not yet activated, and has used the rate; or its offline credits stopped; or a key given to activate is invalid; its `reason` is `conflict`. Nothing of the run is recorded                                                                                                                                                                                                                                                     |
| `https://on.auto/problems/account_closed`         | 409    | On hosted Auto, the account of the run's org is closed: its runs are refused, `because: "org_deleted"`, until Auto's support restores the org, which a person asks for at the `resolve_at` page until the date its `detail` gives. After that date the org is purged and its runs never run again, `because: "org_purged"`. Its `reason` is `conflict`, and nothing of the run is recorded. A self-hosted runtime answers it only to `activate_license` given the key of a closed org; the runtime of a closed org runs at the free rate instead, and refuses runs past that rate as `license_invalid` |
| `https://on.auto/problems/cancelled`              | 409    | The run was cancelled, with the `kind` of its cancellation; its `reason` is `cancelled`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `https://on.auto/problems/unanswered`             | 410    | Nobody answered the request a run waited on, of an interaction function, with the `kind` `expired` or `undelivered`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `https://on.auto/problems/content_too_large`      | 413    | The body is larger than the operation accepts: 1,048,576 bytes of JSON                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `https://on.auto/problems/unsupported_media_type` | 415    | The body is not sent as the media type the operation accepts, `application/json` in UTF-8 unless the route says otherwise, or is sent compressed                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `https://on.auto/problems/range_not_satisfiable`  | 416    | The `Range` of a [content at a signed address](#content-at-a-signed-address) starts at or past its end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `https://on.auto/problems/invalid_input`          | 422    | The input does not fit, with the `errors` that point at it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `https://on.auto/problems/cursor_not_held`        | 422    | The `since` of `list_org_changes` or `list_playbook_changes` is not a cursor the ledger holds; its `reason` is `invalid_input`; ask again without `since`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `https://on.auto/problems/client_closed_request`  | 499    | The client disconnected before the response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `https://on.auto/problems/internal`               | 500    | Something went wrong inside the server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `https://on.auto/problems/unavailable`            | 503    | Something the server relies on cannot serve now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `https://on.auto/problems/tools_unfinished`       | 503    | A run called only tools marked `reads`, and could not finish; its `reason` is `unavailable`, and running it again under a new id is safe                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `https://on.auto/problems/rebuilding`             | 503    | What a function keeps of the playbook's history is still being built; its `reason` is `unavailable`; try again later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### The refusals of the meter

A run the runtime's meter refuses carries, beside its `detail`, where a person resolves it and, on a self-hosted runtime, which runtime it is, as the table says, so a client can offer the way out rather than print the sentence. A problem a client does not know these members on still reads whole by its `detail`.

| Kind                | `resolve_at`                                                                                                                | `runtime_id`               | `because`                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `license_required`  | `https://studio.on.auto/licenses?installation={runtime_id}`, where an admin of the organization gets the free key           | Always                     | `free_daily_limit` or `free_month_used`, the limit it reached                                                                                      |
| `license_invalid`   | The same page of Studio, or `https://studio.on.auto/licenses` before the runtime has an id                                  | Once the runtime has an id | At the free rate, `free_daily_limit` or `free_month_used`; activating a key, `key_rotated` or `installation_revoked`, where Auto's account says so |
| `credits_exhausted` | Billing of the org in Studio at the free rate, the runtime's page offline, or where Auto's account says in Cloud            | On a self-hosted runtime   | At the free rate, `free_daily_limit` or `free_month_used`; offline, `none_left`; in Cloud, the case the account names                              |
| `account_closed`    | Studio's Support page, where a person asks Auto's support to restore the org; `detail` gives the date until which it can be | Never                      | `org_deleted` while the org can still be restored, for a limited time, or `org_purged`, after which its runs never run again                       |

A refusal at the free rate, one whose `because` is `free_daily_limit` or `free_month_used` from a self-hosted runtime, also carries:

- `lifts_at`, when the limit lifts, in ISO 8601 UTC: 00:00 UTC on the next day for `free_daily_limit`, and on the first of the next month for `free_month_used`, such as `"2026-10-29T00:00:00.000Z"`;
- `limited_because`, on `credits_exhausted` and `license_invalid`, why a runtime that holds a key is limited to the free rate, as `GET /v1/orgs/{org}/license` says it: `credits` or `cap` on `credits_exhausted`, and `out_of_touch`, `key_rotated`, `key_revoked`, `org_closed` or `not_activated` on `license_invalid`. A runtime without a key has none, and hosted Auto's refusals carry neither member.

The origin of Studio is the one `STUDIO_ORIGIN` names. [Refusals](../self-host/licensing.md#refusals) gives the words of each.

[When a tool-calling run cannot finish](reasoning-format.md#when-a-tool-calling-run-cannot-finish) explains when a run ends as `tools_unfinished` or `effect_unknown`. [Retrying under a run id](#retrying-under-a-run-id) says when a request returns `tools_called`.

Inside a workflow, three rejections of a run the workflow called differ from their HTTP form:

- `invalid_input` is status 422 over HTTP, but a workflow raises it as a `validation` error of status 400. A `catch` for it matches status 400 or the `validation` type, never 422.
- A cancellation of a called run that the workflow does not catch rejects the workflow as `invalid_input`, not as `cancelled`, since the workflow itself was not cancelled.
- `credits_exhausted`, `license_required`, `license_invalid` and `meter_unavailable`, when the meter would not start the run, reach the workflow only 24 hours on: until then its step waits and asks again ([When the runtime will not start the run for now](workflow-format.md#when-the-runtime-will-not-start-the-run-for-now)).

[When the function's run does not succeed](workflow-format.md#when-the-function-s-run-does-not-succeed) has the full table of what a workflow `catch` sees.

A `500` response contains an incident reference: its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. A malformed HTTP request can get a bare status before the API handles it.

### When to retry

`Retry-After` comes only with an `unavailable` response that a retry of the same request may resolve. It never comes:

- with the kinds `tools_unfinished`, `tool_not_offered`, `tool_not_read_only` or `model_not_offered`;
- with `because` set to `stalled`, which no wait resolves;
- with `cancelled`.

### Models and tools a function may not use

| Case                                                                                                                     | Response                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| A function names a model outside the deployment's allow list                                                             | `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before the provider is called |
| A function names a model whose provider is missing, on a runtime that has other providers                                | `unavailable` with kind `model_not_offered` and `because: "provider_not_configured"`                          |
| A function names a model whose provider is missing, on a runtime that has no provider                                    | `unavailable` without a kind, and so with `Retry-After`; its `detail` says `No model provider is configured`  |
| A generation function names a model gateway the runtime is not given                                                     | `unavailable` with kind `model_not_offered`                                                                   |
| A function names a tool the playbook's servers do not offer                                                              | `unavailable` with kind `tool_not_offered`                                                                    |
| `introspect`, `validate`, `dry_run`, `query_connection` or `execute_connection` names a tool the playbook is not offered | `unavailable` with kind `tool_not_offered`                                                                    |
| `query_connection` names a tool not marked `reads`                                                                       | `unavailable` with kind `tool_not_read_only`                                                                  |

Use `list_models` to see the model references the server offers, and `search` to see the servers and tools a function may name.
