# HTTP API

The HTTP API serves every operation of Auto Runtime. It covers playbooks, function and workflow definitions, runs and their history, and requests. It also covers events, analytics and the tool servers a playbook's functions may use. This page lists every route with its fields, limits and errors.

The [MCP endpoints](mcp.md) serve the same operations as tools. A definition's `type` is `reasoning`, `interaction`, `prediction`, `recall`, `computation` or `workflow`.

## Requests and access

Send requests to the server's address, such as `http://localhost:5555`, with a credential.

- Org routes begin at `/v1/orgs/{org}`. Playbook routes begin at `/v1/orgs/{org}/playbooks/{playbook}`.
- Send the credential, an [API key](../self-host/security.md#api-keys) or a signed-in person's token, as `Authorization: Bearer <key>`. Keep credentials out of prompts and source documents.
- A server in [local mode](../self-host/security.md#local-mode) asks for no credential. The [Sign-in and token reference](authentication.md) gives the rules the server applies to credentials.
- Send command bodies as UTF-8 JSON with `Content-Type: application/json`, at most 1 MiB. Compressed bodies are not accepted.
- Query parameters are for `GET` and `DELETE` requests, which take no body. A field may be supplied in only one place.

Each API key belongs to one org and has permissions for a set of playbooks:

| Permission       | Lets the caller                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `org:read`       | Read the org's playbooks and connections, list models and providers, and search the org's tool servers                         |
| `org:write`      | Create, update and retire playbooks, and add and remove connections                                                            |
| `playbook:read`  | Read definitions, runs, history, events, requests and analytics, and search and read tools                                     |
| `playbook:write` | Create, change, retire or run a function or workflow, cancel a run, send or publish an event, answer a request and call a tool |

Each route table below names the permission a route needs.

When the server [sends telemetry](../self-host/telemetry.md), every response except that of `/health` carries its trace id in the `x-trace-id` header. A request with a W3C `traceparent` header continues the caller's trace.

## The OpenAPI document, the guides and the API catalog

| Method and route               | Returns                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `GET /v1/openapi.json`         | The OpenAPI 3.1.1 document of this API                        |
| `GET /v1/guides/{guide}`       | One guide, as `text/markdown`                                 |
| `GET /.well-known/api-catalog` | The API catalog of this server, as `application/linkset+json` |
| `GET /health`                  | Whether the server is up                                      |

These four need no key. Where sign-in is on, the [protected resource metadata](authentication.md#protected-resource-metadata) needs no key either. It is served at `/.well-known/oauth-protected-resource` and under the path of each MCP endpoint. Where the runtime signs people in at an `https` `PUBLIC_URL`, the [client metadata document](authentication.md#client-metadata-document), by which Auto names its own client when a person connects a provider by consent, needs no key either. It is served at `/oauth/client.json`.

### The OpenAPI document

The server builds the document when it starts, from its operations: the same operations its routes and its MCP tools serve.

- Each operation appears once. Its `operationId` is the operation's name, with `search_in_org` for the org's `search`. Its summary is its title. Its tag names the resource it acts on.
- Its description is its MCP tool's description. An operation served only over HTTP has no tool, so its description is its own: the five prediction routes, the five routes of Studio's connection page, `get_playbook`, `get_connection`, `get_run_history`, `get_playbook_analytics` and `validate`.
- Its input is in the path, and in the query string of a `GET`. A command, or a query routed by `POST` such as `validate` and `dry_run`, takes it in the JSON body. The two uploads take a CSV dataset or a candidate's bytes as the body, and the document gives their maximum size.
- Its schemas are JSON Schema 2020-12. Each has its own `$id` under `https://on.auto/schemas/runtime/`, with its definitions inside it.
- Each problem an operation can return is listed under its status.
- The server URL is the relative `/v1`, so the document stays valid behind any host.

A client library can be generated from the document, and a gateway that accepts OpenAPI documents can add the runtime from it. Each release's document is kept in the repository at [`docs/assets/openapi.json`](https://github.com/BeOnAuto/runtime/blob/main/docs/assets/openapi.json), so a client library can be generated without running a server.

### The guides

`GET /v1/guides/{guide}` returns one of the guides that the MCP endpoints serve as `guide://{guide}`, with the same text. The guides say what the words mean, give the format of each definition type, and hold the recipes for common tasks. The OpenAPI document lists their names. Each guide has its own path. So the server treats an unknown guide name like any other path it does not serve: without a key, the response is `401`.

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

## Playbooks

These routes are relative to `/v1/orgs/{org}`:

| Operation         | Method and route                    | Permission                    | Input                                      |
| ----------------- | ----------------------------------- | ----------------------------- | ------------------------------------------ |
| `create_playbook` | `POST /playbooks`                   | `org:write`                   | `playbook`, `name`, optional `description` |
| `list_playbooks`  | `GET /playbooks`                    | `org:read` or `playbook:read` | Optional `include_retired`                 |
| `get_playbook`    | `GET /playbooks/{playbook}`         | `org:read`                    | Playbook id in path                        |
| `update_playbook` | `PUT /playbooks/{playbook}`         | `org:write`                   | `name` and `description`                   |
| `retire_playbook` | `POST /playbooks/{playbook}/retire` | `org:write`                   | Playbook id in path                        |

| Field         | Rule                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| `playbook`    | The id: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter            |
| `name`        | 1 to 100 characters, stored without the whitespace around it; it cannot be all whitespace |
| `description` | At most 2,000 characters, stored without the whitespace around it                         |

Each operation returns the playbook, with its `id`, `name`, `description`, `status` (`active` or `retired`), `created_at`, `created_by`, the caller who created it, by `id` and `name`, `updated_at` and, once retired, `retired_at`. `list_playbooks` returns them in `playbooks`.

- `list_playbooks` lists the playbooks the caller may access. It leaves out retired ones unless `include_retired` asks for them. It also accepts a key with only `playbook:read`, so a key that may only read inside some playbooks can find them.
- A key limited to a list of playbooks can create only a playbook whose id is on that list.
- `update_playbook` requires both `name` and `description`, even when only one of them changes. An update that changes nothing records nothing.
- Retirement is permanent. A playbook id cannot be reused, and a retired playbook cannot be restored.
- A retired playbook stays readable: `get_playbook` reads it, `include_retired` lists it, and its definitions, runs and history remain readable. Commands inside it return `conflict` with the kind `retired`. Retiring it again succeeds and changes nothing.

| Case                                                                                  | Response                  |
| ------------------------------------------------------------------------------------- | ------------------------- |
| `create_playbook` with an id the org has or had                                       | `conflict`                |
| `update_playbook` of a retired playbook                                               | `conflict`                |
| `get_playbook`, `update_playbook` or `retire_playbook` of an id the org does not have | `not_found`               |
| A change that meets another change to the org's playbooks at the same moment          | `conflict`; send it again |

## Models

| Operation     | Method and route            | Permission | Input               |
| ------------- | --------------------------- | ---------- | ------------------- |
| `list_models` | `GET /v1/orgs/{org}/models` | `org:read` | Optional `provider` |

`provider` is a provider prefix of 1 to 32 lowercase letters, digits or hyphens, starting with a letter. The result is the same over HTTP and MCP; [Model information](mcp.md#model-information) describes its fields, aliases, wildcard entries and incomplete lists.

## Reasoning functions

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation           | Method and route                            | Permission       | Input                                    |
| ------------------- | ------------------------------------------- | ---------------- | ---------------------------------------- |
| `create_definition` | `POST /definitions/reasoning`               | `playbook:write` | `name`, `source`, optional `overview`    |
| `list_definitions`  | `GET /definitions/reasoning`                | `playbook:read`  | Optional `include_retired`               |
| `get_definition`    | `GET /definitions/reasoning/{name}`         | `playbook:read`  | Name in path                             |
| `update_definition` | `PUT /definitions/reasoning/{name}`         | `playbook:write` | `source`, optional `overview`            |
| `retire_definition` | `POST /definitions/reasoning/{name}/retire` | `playbook:write` | Name in path                             |
| `run_definition`    | `POST /definitions/reasoning/{name}/run`    | `playbook:write` | Optional `input`, optional UUID `run_id` |
| `get_run`           | `GET /runs/{run_id}`                        | `playbook:read`  | Run id in path                           |

The `source` is a [reasoning function document](reasoning-format.md). These rules apply to the definitions of every type:

- A name follows the playbook id rule: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter.
- A name is unique within its type and playbook, and cannot be reused after retirement.
- A source document may be at most 65,536 UTF-8 bytes.
- Changing a document or its overview creates a version. Updating it with identical source, and the same overview or none, records no change.
- A run uses the latest active version.
- A retired definition can be read, but cannot be edited or run.
- A definition carries its `input_schema` and `output_schema` where its document declares them. A reasoning function, a computation function or a workflow whose `output.shape` names an [output shape](output-shapes.md) has the shape's schema as its `output_schema`, and the shape's name as `details.shape`, such as `"details": { "shape": "series" }`; `details` is left out otherwise. A prediction function has the `series` shape so, since its questions answer a series. `list_definitions` shows both too.

A definition names the caller who created it as `created_by`, by `id` and `name`, and keeps it across its versions.

`create_definition`, `update_definition`, `get_definition` and `retire_definition` return the definition with its `overview` and its `used_by`; `list_definitions` leaves both out.

- `overview` is Markdown its author gives beside `source` for the person who runs the business: why the definition exists, what it does and how it fits, in one to three short paragraphs, with a Mermaid diagram in a fenced block where a flow is worth a picture. It holds 1 character to 16,384 UTF-8 bytes. The version keeps it as written, and an update that leaves it out keeps the overview saved. A definition saved without one has none.
- `used_by` lists the active definitions of the playbook that use this one, read from the playbook each time the definition is returned, and is left out when none does. Each gives its `type`, its `name` and its `relation`: `calls` for a workflow whose `run_definition` steps call it, with those `steps`, each its `number`, its place among the workflow's tasks in the order of its document, and its `name`; `sends-builds` or `asks-approval` for a prediction function that sends it builds to train or asks it to approve a version; `remembers-runs` or `remembers-changes` for a recall function with a filter on its runs (by their `subject`) or on its changes (by their `source`). A definition that uses this one in two ways is listed for each.

The interaction function `send-build` that a prediction function trains through, that a workflow calls in two steps and that two recall functions follow is returned with this `used_by`, shown here without its other fields:

```json
{
  "used_by": [
    { "type": "prediction", "name": "weekly-orders", "relation": "sends-builds" },
    { "type": "recall", "name": "build-answers", "relation": "remembers-runs" },
    { "type": "recall", "name": "build-changes", "relation": "remembers-changes" },
    {
      "type": "workflow",
      "name": "weekly-build",
      "relation": "calls",
      "steps": [
        { "number": 1, "name": "send" },
        { "number": 3, "name": "again" }
      ]
    }
  ]
}
```

## Interaction functions

Interaction functions use the operations of reasoning functions, with `interaction` in place of `reasoning` in each route, such as `POST /definitions/interaction` and `POST /definitions/interaction/{name}/run`. The `source` is an [interaction function document](interaction-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

A run responds with `200`, `status: started` and its `run_id`. It then waits until its request is answered, expires or is cancelled. Two kinds of run finish within the request instead:

- a notification to the inbox;
- a function that calls a tool, whose output is the tool's result, or which ends in one of the endings its format lists.

| Case                                                         | Response                                       |
| ------------------------------------------------------------ | ---------------------------------------------- |
| A `to` or an argument the function cannot render             | `conflict` with the kind `unworkable`          |
| A server or a tool the playbook may not use                  | `unavailable` with the kind `tool_not_offered` |
| The playbook has as many open requests as the runtime allows | `unavailable` with the kind `requests_full`    |

The requests of a playbook have two routes of their own, relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation            | Method and route             | Permission       | Input                                                   |
| -------------------- | ---------------------------- | ---------------- | ------------------------------------------------------- |
| `list_interactions`  | `GET /interactions`          | `playbook:read`  | Optional `to`, `type`, `function`, `limit` and `cursor` |
| `answer_interaction` | `POST /runs/{run_id}/answer` | `playbook:write` | Run id in path; `answer` and an optional `claimed_for`  |

### Listing open requests

`list_interactions` returns `interactions`, the playbook's open requests newest first, with `has_more` and `next_cursor`. They are the requests of interaction functions and of prediction functions' builds. An answered request leaves the list. Anyone who may read the playbook sees each request's party and message, just as they see a run's input.

- `to` keeps only the requests to one party.
- `type` keeps only those from one type of function.
- `function` keeps only those from functions of one name. A name is unique within its type, so `function` with `type` names one function.

Each request has these fields:

| Field            | Contents                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `run_id`         | The run that asked, which `answer_interaction` takes                                                                               |
| `type`           | The type of the function that asked                                                                                                |
| `function`       | The name of the function that asked                                                                                                |
| `version`        | The version of the function that asked                                                                                             |
| `to`             | The party the request goes to                                                                                                      |
| `delivery`       | The `server` and `tool` the request is sent through, or `null` for the inbox                                                       |
| `message`        | The message of the request                                                                                                         |
| `takes_answer`   | `true` for a question, `false` for a notification                                                                                  |
| `answer_schema`  | The JSON Schema an answer must match, as the request recorded it when it was asked; `null` for a notification                      |
| `requested_at`   | When the request was made, in ISO 8601 UTC                                                                                         |
| `expires_at`     | When the request expires unanswered, in ISO 8601 UTC                                                                               |
| `attempts`       | The delivery attempts made so far                                                                                                  |
| `conversation`   | The conversation the playbook reads replies in, or `null`                                                                          |
| `answerer`       | The party whose reply counts, or `null`                                                                                            |
| `reply_refusals` | How many replies from the answerer the playbook refused                                                                            |
| `standing`       | `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, or `cancelling` once a cancel of its run was asked |

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
- A prediction function's build scores the candidates the answer names, `{ candidates }`, each by the SHA-256 its upload returned. A candidate not uploaded to that build is refused as `invalid_input`.

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

## Recall functions

Recall functions use the operations of reasoning functions, with `recall` in place of `reasoning` in each route, such as `POST /definitions/recall` and `POST /definitions/recall/{name}/run`. The `source` is a [recall function document](recall-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

A recall function keeps a view: a JSON value its module builds from the playbook's events, one event at a time. A run computes its answer from the view as it stands.

- A playbook may have at most 32 active recall functions. Saving one more returns `conflict`.
- A run finishes within the request that starts it.
- `get_definition` adds the view's `standing`. `get_run` adds to the run's `record` the checkpoint the run read at, which says how far into the playbook's history the view had read. See [How the view is kept](recall-format.md#how-the-view-is-kept).

| Case                                                | Response                                                     |
| --------------------------------------------------- | ------------------------------------------------------------ |
| The view of the latest version is still being built | `unavailable` with the kind `rebuilding` and a `Retry-After` |
| The view has stalled                                | `conflict` with the kind `stalled`                           |
| The module's `answer` cannot produce an output      | `conflict` with the kind `unworkable`                        |

## Prediction functions

Prediction functions use the operations of reasoning functions, with `prediction` in place of `reasoning` in each route, such as `POST /definitions/prediction` and `POST /definitions/prediction/{name}/run`. The `source` is a [prediction function document](prediction-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

- A playbook may have at most 32 active prediction functions.
- A question finishes within the request that asks it, and the function's active version makes the prediction. A question such as `{ "series": "north", "horizon": 1 }` answers a [series](output-shapes.md#series) whose `observed` line holds the last periods of the dataset and whose `predicted` line holds the period asked, with its `value`, `low` and `high`; without `horizon` it holds every horizon the function names. The run's `record` holds the model's `version` and the `coverage`. [The input and the output](prediction-format.md#the-input-and-the-output) has every field, and [A question](prediction-format.md#a-question) an answer in full.
- A build (the input `{ build: {} }`) responds with `200` and `status: started`, then waits for its trainer, as [A build](prediction-format.md#a-build) explains.
- `get_definition` adds the dataset's and the models' `standing`.

Five routes are served only over HTTP; no MCP endpoint offers them as tools. They are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation          | Method and route                               | Permission       | Body                                                                            | Returns                                                  |
| ------------------ | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `upload_dataset`   | `PUT /datasets/{sha256}`                       | `playbook:write` | `text/csv` with `Content-Length`, at most 64 MiB                                | `{ dataset, bytes, rows, series, columns, period, ... }` |
| `read_build_brief` | `GET /runs/{run_id}/build/brief`               | `playbook:read`  | None                                                                            | The brief, `text/markdown`                               |
| `read_build_rows`  | `GET /runs/{run_id}/build/rows`                | `playbook:read`  | None                                                                            | The training rows, `text/csv`, streamed                  |
| `upload_candidate` | `POST /runs/{run_id}/build/candidates`         | `playbook:write` | An ONNX model, `application/octet-stream` with `Content-Length`, at most 64 MiB | `{ candidate, bytes, opset }`                            |
| `activate_version` | `POST /definitions/prediction/{name}/activate` | `playbook:write` | `{ version }`                                                                   | `{ function, version, rule, activated_at }`              |

- A body sent without its `Content-Length` gets `411`. A body whose `Content-Length` is larger than the route accepts gets `413`, before the body is read.
- The build itself is answered through `answer_interaction`, with `{ candidates }`: the SHA-256 of each candidate, as `upload_candidate` returned it.

The three build routes work only on a build that is waiting for its answer:

| Case                                  | Response                               |
| ------------------------------------- | -------------------------------------- |
| A run the playbook does not have      | `not_found`                            |
| A run that is not a build             | `conflict` with the kind `not_a_build` |
| A build that took its answer or ended | `conflict` with the kind `build_ended` |

`upload_candidate` refuses a candidate as `invalid_input` when:

- the runtime cannot load it;
- its signature does not match what the function feeds it, or its opset is older than 13;
- the build already has the 8 candidates it accepts.

While every model process available to builds is busy, it returns `unavailable` with the kind `model_process_busy` and a `Retry-After`. The check shares those processes with the builds' scoring, and never takes one a question needs.

`activate_version` returns `not_found` for a version the function did not build, and `conflict` with the kind `already_active` for the version that is already active.

## Workflows

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation           | Method and route                           | Permission       | Input                                                                  |
| ------------------- | ------------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| `create_definition` | `POST /definitions/workflow`               | `playbook:write` | `name`, `source`                                                       |
| `list_definitions`  | `GET /definitions/workflow`                | `playbook:read`  | Optional `include_retired`                                             |
| `get_definition`    | `GET /definitions/workflow/{name}`         | `playbook:read`  | Name in path                                                           |
| `update_definition` | `PUT /definitions/workflow/{name}`         | `playbook:write` | `source`                                                               |
| `retire_definition` | `POST /definitions/workflow/{name}/retire` | `playbook:write` | Name in path                                                           |
| `run_definition`    | `POST /definitions/workflow/{name}/run`    | `playbook:write` | Optional `input`, optional UUID `run_id`                               |
| `get_run`           | `GET /runs/{run_id}`                       | `playbook:read`  | Run id in path                                                         |
| `cancel_run`        | `POST /runs/{run_id}/cancel`               | `playbook:write` | Optional `reason`                                                      |
| `send_run_event`    | `POST /runs/{run_id}/events`               | `playbook:write` | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

### A saved workflow

The `source` is a [workflow document](workflow-format.md). Names, document size, versions and retirement follow the rules for [reasoning functions](#reasoning-functions).

- A saved workflow has the `media_type` `application/yaml`.
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
- the run of an interaction function whose request waits;
- a prediction function's build, whether it is starting, waiting for its trainer or scoring.

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

- the run of a computation or recall function;
- the run of an interaction function that calls a tool;
- a prediction function's question.

A cancelled run's rejection names the kind of its cancellation:

| Kind           | The run was cancelled because                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `requested`    | someone allowed to change the playbook asked, with `cancel_run`                           |
| `deadline`     | the workflow that waited for it ran out of time                                           |
| `overrun`      | it ran as long as a workflow may run                                                      |
| `parent_ended` | the workflow that waited for it ended first, or the branch that waited for it lost a race |

## Runs and results

A run records its `run_id`, `type`, `name`, `definition_version`, `status`, timestamps and `started_by`, the caller who started it, by `id` and `name`. A successful run includes `output`, and a rejected run includes a rejection. `get_run` also returns the detailed `record`. A run whose output takes an [output shape](output-shapes.md#what-a-run-shows) says it as `output_shape`, such as `"output_shape": "series"` on a question to a prediction function; a build of a prediction function, and a run of a definition that declares no shape, has none.

Most runs finish within the request that starts them. These runs finish later, so `run_definition` returns them `started`, unless one ended before its first wait:

- a workflow's run, whose `record` is empty while it is in progress;
- an interaction function's run that asks a person, or that sends a notification through a tool;
- a prediction function's build, the input `{ build: {} }`, which waits for its trainer.

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
| Recall                  | 1,046,528 bytes: the function keeps 2,048 bytes for its record, which also says where the view had read to                                       |
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
| Still waits: a workflow run, an interaction function's request, or a prediction function's build                                       | Returns the run as it stands, still `started`, and starts nothing                                                                                                                               |
| Has no final result: it ended `unavailable`, `conflict` or `failed`, or it is `started` without waiting, such as after an interruption | Runs the definition again, as a new attempt. The attempt may use the latest version, and records the one it used. A `started` run of a reasoning function goes on from what it recorded instead |

The last row has three exceptions.

A workflow runs once for its id. A request with the id of a workflow run that ended without a final result returns `conflict` with the kind `unworkable`, once its input passes the workflow's input schema, which is checked first. Its detail says to use a new run id.

A `started` run of a reasoning function is never started a second time. A request with its id goes on from what the run recorded, at the version it started with, and answers when the run ends. In the server where the run is going, the request waits for it to end. Elsewhere, while the run's last event, by the database's clock, is newer than the longest gap between two events of a run that is still going, the run may still be running, and the request returns `conflict` with the kind `taken`, saying so. [A run performed again](reasoning-format.md#a-run-performed-again) gives the rule, and what a model call or a tool call without an answer becomes.

A run that may have called a tool is never attempted again under its id once it ended. That is a run of a reasoning function with `tools`, or of an interaction function with `call`:

- A run that recorded a tool call and ended without a final result returns `conflict` with the kind `tools_called`. When every tool it called is one its server marks read-only, the rejection adds `because: "only_read"`, and its words say nothing was changed.
- A run of an interaction function with `call` that is still `started` returns `tools_called` too, even before its first recorded call, since it may still be in progress.
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

| Attribute                       | Required | Contents                                                                                                                          | Limit                    |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `source`                        | Yes      | Where the event comes from, a URI reference such as `/ledger/eu` or `https://acme.example/ledger`                                 | 1,024 characters         |
| `type`                          | Yes      | What happened, such as `com.acme.ledger.month-closed`                                                                             | 256 characters           |
| `id`                            | No       | Unique among the events of its source; the runtime makes one when you leave it out                                                | 256 characters           |
| `time`                          | No       | When it happened, in RFC 3339 such as `2026-10-01T09:00:00Z`; when it is left out, the runtime uses the time it records the event |                          |
| `subject`                       | No       | What the event is about within its source                                                                                         | 1,024 characters         |
| `specversion`                   | No       | `1.0`                                                                                                                             |                          |
| `datacontenttype`, `dataschema` | No       | The media type of `data`, such as `application/json`, and the absolute URI of a schema it follows                                 |                          |
| `data`                          | No       | Any JSON value                                                                                                                    | Nests at most 510 levels |

- The event, with its id and time filled in, may be at most 240 KiB as JSON.
- `data` nests at most 510 levels deep, so that a run can keep the event in a list. A deeper one returns `invalid_input` at `/event/data`.
- Any other attribute is an extension, and an event may have at most 32. Its name is 1 to 20 lowercase letters and digits. Its value is a string, a boolean or an integer, and it is kept as given.

As CloudEvents requires:

- no string may contain a control character, a lone surrogate or a noncharacter;
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

The reserved types are `run_started`, `run_deferred`, `attempt_resumed`, `run_succeeded`, `run_rejected`, `run_failed`, `run_cancel_requested`, `tool_call_started`, `tool_call_answered`, `tool_call_failed`, `model_call_started`, `model_call_answered`, `model_call_failed`, `request_answered`, `delivery_started`, `delivery_succeeded`, `delivery_failed`, `delivery_refused`, `reply_refused`, `telling_started`, `telling_succeeded`, `telling_failed`, `replies_read`, `reading_failed`, `interaction_requested`, `dataset_assembled`, `candidate_uploaded`, `candidate_refused`, `candidate_scored`, `candidate_disqualified`, `baseline_scored`, `baseline_not_walked`, `version_built`, `shadow_predicted`, `shadow_graded`, `shadow_passed`, `shadow_failed`, `version_activated`, `activation_refused`, `build_asked`, `build_ended`, `definition_created`, `definition_updated`, `definition_retired`, `event_published`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped` and `reaction_refused`.

A run of a reasoning function also records each call of its model: `model_call_started`, then `model_call_answered` with the tool calls the model asked for, or `model_call_failed` with `because`. [The run's model calls](reasoning-format.md#the-run-s-model-calls) gives their fields.

The reserved attributes are the ones the playbook gives its own events; see [the playbook's events](recall-format.md#the-events). So a published event cannot claim a cause, a caller or a depth it does not have.

## Run history and playbook events

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation              | Method and route             | Permission      | Input                                                             |
| ---------------------- | ---------------------------- | --------------- | ----------------------------------------------------------------- |
| `list_runs`            | `GET /runs`                  | `playbook:read` | Optional `type`, `name`, `status`, `limit` and `cursor`           |
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

### A run's history

`get_run_history` returns the `events` of one run in the order the playbook recorded them, oldest first unless `order` is `desc`. Each event comes after the event that caused it. The events are the facts the runtime recorded about the run: each start and how it ended. A run that does not exist in the playbook returns `not_found`.

Runs that use tools (a reasoning function's, and an interaction function's that calls a tool) also record each call:

- `tool_call_started`, with `read_only: true` when the server marks the tool read-only, and `connection_id` beside `server` when the server is a connection a person added;
- then `tool_call_answered` when the tool answered, with `is_error` when its result is an error of its own;
- or `tool_call_failed` when it never answered, with `because`: `arguments_refused`, `server_failure`, `timed_out`, `cancelled`, or `too_large` when the tool's result was larger than one call may return.

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
| `trace_id`, `span_id` | The trace and span of the append that recorded the event, one pair for every event of one append; with telemetry on, the trace the server exported                                                                  |

### What `data` shows

`data` keeps each event within 4 KiB:

- Large values are shown in full when each is at most 2 KiB as JSON. They are an input, an output, a record, an answer, a call's arguments and result, a model call's messages, response and tool calls, and a published event's data. A larger one is shown as its size in bytes, under its name plus `_bytes`, such as `output_bytes`.
- When the event's data would still be larger than 4 KiB, its largest field is shown as its size first.
- A definition's document and schemas appear as their sizes. Its description shows its first 300 characters, and its warnings as a count.
- A rejection shows its reason, its detail shortened to fit, and for invalid input the number of issues and the first five.
- A rejection that kept a record shows the record as a success does. A run of a reasoning function keeps one when it is rejected after its model answered.

The full values are read elsewhere: `get_run` returns a run's output and record, `get_definition` a definition's document and schemas, and `get_event` one event with every field in full.

Some events show more in `data`:

- `workflow_input_applied` shows the kind and key of the input and how many steps it moved. It lists the first five, each with its task, run and outcome. For a function's rejection that has a kind and a `because`, it shows both, and its summary says them in words. It also shows the kinds of what the run did next. It never shows the run's data.
- A step event shows the step's `name` and its `reference` in the document. It also shows `run`, which counts each time the step starts, and `times`, which counts how often it moved that way in that run.
- `step_waiting` adds what it waits for, `call`, `timer` or `event`. For a call it adds the `run_id` of the run it started, whose `run_started` names that `step_waiting` as its cause.
- `step_failed` adds how it failed, and its error's type and title.
- `event_published` shows the published event's `event_id`, `event_type`, `source`, `subject`, `time` and `data`, and which attributes the runtime `filled` in.
- `reaction_refused` shows how many times in the `minute` a trigger did not start its workflow, as `count`, and the last `reason`.

Some events say more in their `metadata`:

- For an event a workflow emitted, `metadata` names the run in `run_id`, the workflow and its version in `definition`, and its depth in a chain of triggers in `depth`.
- A `reaction_refused` event's `metadata` names the workflow and the version whose trigger refused, in `definition`.
- A run that a trigger started shows `playbook:` and the playbook's id as `by`. Every event of it shows the `trigger` that started it in its `metadata`, with its `kind` and `reference`. Its `run_started` says in words which kind it was, such as "was started by its every schedule".

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
- with `status`, `type` or `name`, a page stops after looking at 1,000 runs or records.

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
  "duration_ms": { "p50": 1840, "p95": 6210 },
  "by_day": [
    {
      "day": "2026-09-30",
      "runs": { "total": 0, "succeeded": 0, "failed": 0, "rejected": 0 },
      "tokens": { "input": 0, "output": 0, "cached": 0 },
      "duration_ms": null
    }
  ],
  "by_function": [
    {
      "type": "reasoning",
      "name": "triage",
      "runs": 12
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
| `duration_ms` | `p50` (the median) and `p95` (the 95th percentile) of how long the runs that succeeded or failed took, in milliseconds from their latest start to their end; `null` when no run of the period has a duration                                   |
| `by_day`      | The same `runs`, `tokens` and `duration_ms` for each `day`                                                                                                                                                                                     |
| `by_function` | Each definition by `type` and `name`, with `runs`, how many of its runs ended; the most runs first, then by `type` and `name`                                                                                                                  |

How runs are counted:

- A run counts on the day it first started, also when it was started again later.
- A run counts once it has ended: `succeeded`, `failed` or `rejected`. A run still going counts nowhere.
- A run started again under its `run_id` counts once. Its tokens add up over every attempt that ended, while its duration is that of its last attempt.
- Rejected runs count in `runs` and in `tokens`, never in `duration_ms`.
- Workflow runs count in `runs` and in `duration_ms`, from when the run started to when the workflow ended.
- A percentile is the nearest rank: the duration at place ⌈p × n⌉ of the n durations in order.

The result comes from a table the runtime updates as each run is recorded, so it is as current as the runs themselves. A playbook that does not exist returns `not_found`; a retired playbook works like any other.

## Tool servers

Five operations find and call the tools of the tool servers of a playbook: those the operator set up, and the [connections](#connections) people added to its org, MCP servers and HTTP APIs described by an OpenAPI document alike. A [reasoning function](reasoning-format.md#tools) names their tools in `tools` as `server/tool` or `server/*`, a connection by its name. These routes are relative to `/v1/orgs/{org}`:

| Operation    | Method and route                                                         | Permission                    | Input                                                      |
| ------------ | ------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| `search`     | `GET /tool-servers/search`                                               | `org:read` or `playbook:read` | Optional `playbook`, `terms`, `server` and `only`          |
| `search`     | `GET /playbooks/{playbook}/tool-servers/search`                          | `playbook:read`               | Playbook id in path; optional `terms`, `server` and `only` |
| `introspect` | `GET /playbooks/{playbook}/tool-servers/{server}/tools/{tool}`           | `playbook:read`               | Server and tool in the path                                |
| `validate`   | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/validate` | `playbook:read`               | Server and tool in the path; `arguments` in the body       |
| `dry_run`    | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/dry-run`  | `playbook:read`               | Server and tool in the path; optional `arguments`          |
| `execute`    | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/execute`  | `playbook:write`              | Server and tool in the path; optional `arguments`          |

- `execute` needs `playbook:write` for every tool, since a call acts as the playbook, under the credential of the server's entry or of the connection.
- `validate` and `dry_run` are routed by `POST` because their `arguments` are an object a query string cannot carry. They are still reads: they change nothing, call no tool and need only `playbook:read`. A query string beside their body returns `bad_request`.
- The four reads ask each server they need for its tool list when you call them, as a run does, with the same time limits to connect and to list. They record nothing. An HTTP API is not asked, since its OpenAPI document is the list.
- On a playbook route, a playbook that does not exist returns `not_found`. A retired playbook serves the reads like any other. It refuses `execute` with `conflict` of the kind `retired`, as it refuses every command.

### Searching the tools

`search` returns the servers of the playbook, those set up in the configuration and the connections of its org that serve it, and the tools of each that its entry allows.

- Without `terms`, it lists every tool when the servers offer at most 100 in total, in the order of the servers and of each server's own list. When they offer more, it returns only the servers, each with its count of tools; search them with `terms`.
- `terms` is up to 8 words of up to 64 characters each, separated by spaces. Tools with a score come best first, those with the same score by name and then by server, at most 100.
- `only: read` keeps the tools their server marks read-only, and `only: write` the others.
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
    { "server": "billing", "tool": "getInvoice", "summary": "Reads one invoice.", "read_only": true },
    {
      "server": "billing",
      "tool": "listCustomers",
      "summary": "Lists the customers, with the invoice each owes.",
      "read_only": true
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

| Field            | Contents                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | The name a function writes before the slash                                                                                                                                                                                                                                                                                                                                 |
| `connection`     | For a connection a person added, its id; absent for a server of the configuration. A connection whose name the configuration now sets up is listed beside that server, unavailable                                                                                                                                                                                          |
| `provider`       | The name of the [provider](#providers) a connection was added from, or an entry of the configuration names, or `null` for a server given by hand                                                                                                                                                                                                                            |
| `type`           | `mcp` for a remote MCP server, `stdio` for an MCP server the runtime starts as a process, or `openapi` for an HTTP API described by an OpenAPI document                                                                                                                                                                                                                     |
| `record_content` | Whether the content of its calls is kept                                                                                                                                                                                                                                                                                                                                    |
| `tool_count`     | How many tools of the server the operator allows, of those `only` keeps                                                                                                                                                                                                                                                                                                     |
| `unavailable`    | Instead of `tool_count`: why the server could not be asked for its tools, in words cut to 1 KiB. The other servers are still searched                                                                                                                                                                                                                                       |
| `because`        | With `unavailable`: `key_refused` when the server did not accept the key the runtime gives it, which only the operator can fix; `failing`, `rate_limited` or `unreachable` when asking again later may work; for a connection, `connection_pending`, `connection_broken`, `connection_not_allowed` or `connection_unavailable`, as [below](#a-connection-that-is-not-ready) |
| `playbooks`      | On the org route only: the playbooks of the org whose functions may use it, or `["*"]` for every playbook of the org                                                                                                                                                                                                                                                        |

Each tool has these fields:

| Field       | Contents                                                     |
| ----------- | ------------------------------------------------------------ |
| `server`    | The server's name                                            |
| `tool`      | The tool's name                                              |
| `summary`   | The first sentence of its description, cut at 300 characters |
| `read_only` | Whether its server marks it read-only                        |

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

On the org route, `search` also returns `providers`: the [providers](#providers) the caller may connect here that no server of the org serves yet, each with its `name`, which `add_connection` takes as `provider`, its `title` and its `description`. So an agent asked for a service that no server serves can offer to connect one.

- A provider is served, and left out, while a connection made from it is pending, connected or broken, or while an entry of the configuration names it. That connection or that entry is in `servers`, with `provider` set and, while it is not ready, its `because`.
- A provider none of whose ways is offered is left out too, as while a value whoever runs Auto sets for it is not set. `list_providers` still lists it, each way `offered: false`.
- Without `terms`, it lists every such provider, sorted by name, while there are 100 or fewer, and none when there are more.
- With `terms`, it lists the providers whose name, title or description holds a word, scored as tools are, a word of the title counting as a word of the name. They come best first, those with the same score by name, at most 100.
- It covers the whole org, whatever `playbook` narrows the servers to, and is left out with `server`.
- It is present exactly where the caller may add a connection, as `may_add` of `list_providers` says: a signed-in person, or the local developer in local mode, with `org:write`, on a runtime whose `connections.people_may_add` is not `false`. It is then empty when every provider listed is served or left out. A key, a caller who may only read and a runtime where nobody may add get no `providers`. The playbook route never returns it.

### Reading one tool

`introspect` returns one tool in full, as its server lists it:

- its `description`, cut to 4 KiB;
- its `input_schema`, the JSON Schema of the arguments it takes;
- its `annotations`, the hints its server gives it (`readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`), left out when the server gives none.

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
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": true }
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

`dry_run` reports what `execute` would check for the tool and its `arguments`, without calling the tool:

| Field              | Contents                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `would_run`        | Whether `execute` would call the tool now: the caller may, the playbook is not retired, the operator allows the tool, and its server responded                       |
| `needs`            | `playbook:write`, the permission `execute` needs whatever the tool does                                                                                              |
| `caller_may`       | Whether the caller has that permission                                                                                                                               |
| `playbook_retired` | Whether the playbook is retired, which `execute` refuses, since a retired playbook can no longer change                                                              |
| `allowed`          | Whether the operator allows the tool on its server's entry, for runs and for `execute` alike                                                                         |
| `read_only`        | Whether the server marks the tool read-only; `null` when the tool's listing was not read, for a tool the operator does not allow or a server that could not be asked |
| `arguments`        | The `arguments` checked as `validate` checks them, `valid: null` with one issue saying why when the tool's input schema was not read; `null` when none were given    |
| `server`           | `reachable` (`yes` or `no`) and, with `no`, the `because` field that says why the server could not be asked                                                          |

`dry_run` returns `would_run: true` even for arguments the tool's schema does not accept. `execute` does not check arguments, and the tool returns its own error for them. The `arguments` field reports the problem beforehand.

When a server or a tool cannot be used, the reads respond as below. Each refusal is `unavailable`, and no tool is called:

| Case                                 | `introspect` and `validate`                                                                  | `dry_run`                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A server not set up for the playbook | Kind `tool_not_offered`, `because: "tool_server_not_configured"`, before any server is asked | The same                                                                                                         |
| A tool the operator does not allow   | Kind `tool_not_offered`, `because: "tool_not_allowed"`, before any server is asked           | Returns `allowed: false`                                                                                         |
| A tool the server does not list      | Kind `tool_not_offered`, `because: "tool_not_listed"`                                        | The same                                                                                                         |
| A connection that is not ready       | Kind `tool_not_offered`, with its `because`, as [below](#a-connection-that-is-not-ready)     | The same, or `server.reachable: "no"` with `because: "connection_not_allowed"` for an address its document names |
| A server that cannot be asked        | Kind `tool_server_failed`, with its `because`, as `execute` returns it                       | Returns `server.reachable: "no"`, with its `because`                                                             |

### Calling a tool by hand

`execute` calls one tool of one tool server with the `arguments` given, as a run of a reasoning function would call it. It returns what that run's model would see, and the document an interaction function's call reads. Use it to see what a tool returns before a function names it, or to find an id a prompt needs. Use it, too, to do what the person asked of the tool without first creating a function.

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
- the server cannot be used: `unavailable` with kind `tool_server_failed`.

A call is live: a tool its server does not mark read-only may change something. That is why `execute` is marked destructive over MCP while a tool server is configured or people may add connections.

Each call is recorded in the playbook's history: as `tool_call_started` before it is sent, with `connection_id` beside `server` for a connection, and as `tool_call_answered` or `tool_call_failed` after. These are the same facts a run's tool calls record, with the caller who made the call as the one who acted.

- The call is recorded on a stream of its own, with no run. `list_runs` and `get_run_history` never show it, while `list_playbook_events` does.
- The arguments and the result are kept unless the operator turns `record_content` off for the server.
- A caller that disconnects during the call leaves a start without an answer.
- When no run holds a connection to the server, each call opens one and closes it once the call ends.

## Connections

A connection is a tool server that a person adds to the org through their agent, a [provider](#providers) by its name or a server given by hand, which every playbook of the org may use, or the playbooks its entry names. The agent adds it without its credential; the person approves it, and gives its credential where it takes one, on Studio's page, which its link opens. [Let people add connections](../self-host/connections.md) sets out the flow, the kinds of credential and the rules the operator sets. These routes are relative to `/v1/orgs/{org}`:

| Operation           | Method and route                      | Permission                                         | Input                                                                                                                                                                               |
| ------------------- | ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_connection`    | `POST /connections`                   | `org:write`                                        | `provider` and `placeholders`, or `name`, `type`, `entry` and `credential` for a server given by hand                                                                               |
| `list_connections`  | `GET /connections`                    | `org:read`                                         | Optional `include_removed`                                                                                                                                                          |
| `get_connection`    | `GET /connections/{id}`               | `org:read`                                         | Connection id in path                                                                                                                                                               |
| `remove_connection` | `DELETE /connections/{id}`            | `org:write`                                        | Connection id in path                                                                                                                                                               |
| `read_link`         | `GET /connections/{id}/link/{token}`  | any, with the link's token                         | Connection id and token in path                                                                                                                                                     |
| `approve`           | `POST /connections/{id}/approve`      | any, with the link's token and the adder's session | `token`                                                                                                                                                                             |
| `give_credential`   | `POST /connections/{id}/credential`   | any, with the link's token and the adder's session | `token`, and `value` for a `secret`, or `client_secret`, or `private_key` with `algorithm`, for `client_credentials`, with `client_id` where the connection's credential holds none |
| `start`             | `POST /connections/{id}/consent`      | any, with the link's token and the adder's session | `token`                                                                                                                                                                             |
| `finish`            | `POST /connections/{id}/consent/code` | any, with the link's token and the adder's session | `token`, `code`, `state`, and `iss` where the authorization server sent one; or `token`, `state` and `handle` for a consent begun through Auto's consent service                    |

Every operation answers the connection: `id`, a UUIDv7; `name`; `type`, `mcp` or `openapi`; `provider`, the name of the provider it was added from, or `null` for a server given by hand; `placeholders`, the values given for the provider's placeholders, or `null`; `entry`; `credential`, how it is credentialled, never its value, and for a connection connected by consent the client it was made with; `status`, `pending`, `connected`, `broken` or `removed`; `added_by`, the caller who added it, by `id` and `name`; `added_at`; `connected_at`; `connected_by`, the caller who connected it, by approving it or giving its credential, by `id` and `name`, or `null`; `granted_scope`, for a connection connected by consent, the scope the server granted, which may be fewer scopes than its credential asked, as when the person unticks one on the provider's page, or `null`; `credential_ends_with`, the last four characters of a secret or client secret of twelve characters or more, which the secret store keeps beside the value, or `null`; and `broken`, why it is broken, or `null`. `add_connection` answers `201` with the connection and `connect`, `{ url, expires_at }`: `url` is Studio's page `connect` under the Studio the person can reach, `<the runtime's origin>/studio/connect?connection=<id>&token=<token>` where the runtime serves Studio, as it does in local mode, since that page knows the runtime that serves it and asks it for the org, and `https://studio.on.auto/connect?server=<the runtime's origin>&org=<org>&connection=<id>&token=<token>` otherwise; the runtime's origin is `PUBLIC_URL`, or the server's own address in local mode, and the link expires ten minutes on. `list_connections` answers them newest first in `connections`, the removed ones only with `include_removed`. `read_link` answers the connection with `link`, `{ expires_at }`, when its link expires, so the page can say how long the person has, `consent`, `{ started_at, expires_at }`, while a consent is started and not finished, and, for a connection whose credential is `authorization`, `client_source`, the source of the client a start would take now, by the rule the start takes it by, `auto` where it would begin through Auto's consent service, left out where the runtime has no client the provider's way takes; `approve`, `give_credential` and `finish`, which use the link up, answer the connection alone.

- With `provider`, the provider gives the server and how it is credentialled. `name` is the provider's when left out; `placeholders` gives the value of each placeholder the provider takes; `credential` may give its `kind` alone, one of the provider's ways, and when it is left out the addition takes the first way `list_providers` marks offered, or the provider's first where it offers none, which the addition then refuses in its words; and `entry` may give `playbooks`, `allowed` and `record_content` alone. `type`, the server's fields of `entry` and every field of `credential` but `kind` are refused, each at its field, since the provider gives them; `credential.client_id` is refused since the person gives the client id on the page. The connection's `entry` and `credential` are the provider's with each value in its place, and every rule below applies to them as to a server given by hand. Without `provider`, `name`, `type`, `entry` and `credential` are each required and `placeholders` is refused.
- `entry` holds the server without its credential: `url` for `mcp`; `document` and `base_url` for `openapi`; and `headers`, `query_params`, `allowed`, `playbooks`, `record_content` and `request_id`, as an entry of the configuration file has them. `url` and `document` are each an `https` URL, or an `http` URL on a loopback address.
- `credential` is one object, `kind` and the fields that kind takes, each optional in the schema and refused as `invalid_input` at the field where its kind lacks it or does not take it: `none` takes no other field; `secret` takes `name` and `in`, `header`, `query` or `security`, so `name` is the header, the query parameter or the security scheme of the document the value is sent as, and only an `openapi` connection takes `query` or `security`; `reference` takes `variable`, a variable of the runtime such as `CRM_API_KEY` that the operator lists in `connections.variables`, whose value is sent where its `name` and `in` say, as a secret's; `client_credentials` takes `issuer`, an `https` URL or an `http` URL on a loopback address, an optional `client_id` and an optional `scope`; and `authorization`, by which the person signs in at an authorization server and allows Auto, takes `issuer`, and as the provider gives them `scope`, `parameters`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint` and `clients`, the client sources the provider's authorization server takes, `registered`, `metadata_document` or `dynamic`, and once connected `client_id` and `client_source`, the client the connection was made with, while `scope` stays the scope the way asked. A server given by hand takes `authorization` with its `kind` alone, for an MCP server that signs people in itself: as the connection is added, the runtime reads from the server's own metadata its authorization server, the scope it asks and the clients the runtime makes for itself there, `metadata_document` then `dynamic`, and refuses any other field beside the kind at its field; an HTTP API given by hand, whose document names no authorization server, is refused the kind at `/credential/kind`. [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) says how. The same object is what every operation answers and what the org's record keeps.
- A `secret` or a `reference` sent in a header may name its `scheme`, such as `Bearer`, which the runtime writes, with a space, before the value it sends, so the person gives the token alone, the variable of a reference holds the token alone, and the server receives `Authorization: Bearer <token>`. A `scheme` holds the characters of a header name and no `$`, and a credential that places no value in a header takes none. `give_credential` refuses a value that already starts with the scheme and a space, in any case, at `/value`.
- The `client_id` of client credentials is the org's, so the agent may leave it out and the person gives it on Studio's page with the client secret or the private key: a connection whose credential holds none answers its record without it, `give_credential` takes `client_id`, and the record holds it from then on. `give_credential` refuses a `client_id` at `/client_id` where the credential holds one, refuses one missing where it holds none, and refuses one that looks like a credential, since the record keeps the client id in the open and the secret or the key goes in its own field, where it is sealed. `add_connection` refuses a `client_id` that looks like a credential at `/credential/client_id`.
- `get_connection` and the five routes of the link are served over HTTP alone, and no MCP endpoint serves them. `get_connection` reads one connection of the org by its id; an agent sees whether the person approved a connection in the `status` `list_connections` answers for each. The three routes of the link are Studio's page's alone. Each takes the token, which the runtime keeps only as its SHA-256, and matches it to the open link of the connection: one given less than ten minutes ago that nothing has used up.
- `start` and `finish` connect a connection whose credential is `authorization`. `start` answers `201` with `authorize`, `{ url, expires_at }`, and `client_source`, the source of the client it started with: `url` is the page of the connection's authorization server where the person signs in and allows Auto, which carries the client, the return address, the page `connect-return` of the Studio the connection's link opens, the Studio host's `/connect-return`, `STUDIO_ORIGIN` followed by it, `https://studio.on.auto/connect-return` unless it is set, or, where the runtime serves Studio, `/studio/connect-return` on the runtime's own address, the scope, a state and a challenge, and `expires_at` is ten minutes on, the time the consent has of its own; a second start replaces the first. The server sends the person back to the return address with a code, the state and its issuer, and Studio sends them to `finish` with `token`, `code`, `state` and `iss`, which redeems the code, keeps the tokens sealed in the runtime's secret store and connects the connection. `finish` is bound to the start and not to the link's ten minutes, and refuses a state the consent was not started with at `/state`, an issuer that is not the server's at `/iss`, and a code the server refuses at `/code`, in Auto's own words; a refused code leaves the start open. The scope it records as `granted_scope` is the one the server granted, its scopes separated by single spaces, or the one asked where the server says none; a grant of no scope where one was asked, or of a scope that is not one, is refused, an empty grant where none was asked records none, and a finish refused once the tokens exist revokes them first. A connection connected by consent then serves its tools, and the runtime renews its tokens; [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) says how. A start of `client_source` `auto` began through Auto's consent service, with Auto's client at the vendor: its `url` is the page Auto's consent service made, whose return is the Studio host, which sends the person back to the Studio the link opened with a handle and the state, and `finish` takes `token`, `state` and `handle`, takes the tokens from the service and connects the connection. A finish of the other shape than its start's is refused as `invalid_input` at the field it gave, `/code` or `/handle`, saying which the consent answers, and a handle the service refuses at `/handle`; [Consent through Auto](../self-host/connections.md#consent-through-auto) says when a runtime starts one.
- `approve` connects a connection whose credential is `none` or `reference` and uses its link up. `give_credential` keeps the value sealed in the runtime's secret store, connects the connection and uses its link up: giving the credential is its approval.
- A connection is added by a person: on a runtime that signs people in, `add_connection` refuses a key, and a runtime of API keys alone, which signs nobody in, refuses every connection, since no person could approve it.
- On a runtime that signs people in, `approve`, `give_credential`, `start` and `finish` need the session of the person who added the connection. In local mode the token alone binds.
- `remove_connection` removes a connection for good, and the runtime forgets its credential, and what a consent started for it keeps, having first revoked at the provider the tokens of a connection connected by consent; tokens it cannot read or revoke now are logged and left to end on their own, and the removal goes on. Removing a removed connection succeeds and records nothing. Its name may then be given to a new connection.

| Case                                                                                                                                                                                                                                                                         | Response                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| An entry that holds a value that looks like a credential, a reference such as `${NAME}`, or a field another entry would refuse                                                                                                                                               | `invalid_input`                            |
| A `provider` the runtime does not have, at `/provider`: `There is no provider named crm here; search lists the providers a person may connect`                                                                                                                               | `invalid_input`                            |
| A placeholder the provider does not take, one missing, or a value its pattern or its choices refuse, that looks like a credential or that would move the address, at `/placeholders/<name>`                                                                                  | `invalid_input`                            |
| A `credential.kind` the provider does not offer, at `/credential/kind`                                                                                                                                                                                                       | `invalid_input`                            |
| What the checks of an entry refuse in what the provider resolved, at `/provider`, or in a `name` the caller gave, at `/name`                                                                                                                                                 | `invalid_input`                            |
| A kind of credential there is not, or a field its kind lacks or does not take                                                                                                                                                                                                | `invalid_input`                            |
| A `scheme` beside a credential that is not sent in a header, or one that holds a `$` or a character a header name does not                                                                                                                                                   | `invalid_input`                            |
| An MCP server given by hand with `authorization` that names no authorization server, another resource or a malformed scope, or whose authorization server cannot be read, names another issuer, takes no S256 challenge or registers no client, at `/credential/kind`        | `invalid_input`                            |
| An MCP server given by hand with `authorization` that, or whose authorization server, does not answer                                                                                                                                                                        | `unavailable`                              |
| `give_credential` with a value that starts with the credential's `scheme`, a `client_id` where the credential holds one, none where it holds none, or one that looks like a credential                                                                                       | `invalid_input`                            |
| A connection the operator's rules do not take: no one may add one, its host, its kind of credential or the variable its reference names                                                                                                                                      | `forbidden`, with the sentence of the rule |
| A name of an entry of `tool_servers`, or of a connection of the org that is not removed                                                                                                                                                                                      | `conflict`                                 |
| An org that holds 50 connections that are not removed, the most it may                                                                                                                                                                                                       | `conflict`, kind `connections_full`        |
| A token that is unknown, used up or expired, or an id the org does not have                                                                                                                                                                                                  | `not_found`                                |
| `add_connection` by a key where people sign in, or by anyone on a runtime of API keys alone                                                                                                                                                                                  | `forbidden`                                |
| `approve` or `give_credential` with the session of another person, where people sign in                                                                                                                                                                                      | `forbidden`                                |
| `start` or `finish` of a connection whose credential is not `authorization`, a server that names a resource other than its own address, or an authorization server that names another issuer, takes no S256 challenge, publishes no metadata or takes none of Auto's clients | `conflict`                                 |
| `start` or `finish` where a host of the authorization server is one the rules do not allow                                                                                                                                                                                   | `forbidden`, with the sentence of the rule |
| `finish` with a client no longer registered, or, once the tokens it got are revoked, tokens the runtime's secret store refuses, a grant of no scope where one was asked, or a grant that is not a scope                                                                      | `conflict`                                 |
| `finish` with no consent started, or one started more than ten minutes ago                                                                                                                                                                                                   | `not_found`                                |
| `finish` with a state the consent was not started with, at `/state`, an issuer that is not the server's, at `/iss`, or a code the server refuses, at `/code`                                                                                                                 | `invalid_input`                            |
| `start` or `finish` where the authorization server does not answer                                                                                                                                                                                                           | `unavailable`                              |
| `give_credential`, `start` or `finish` where the runtime's secret store cannot keep or read now what it needs, in the store's words; a `finish` whose code was redeemed then says the person starts again, its tokens revoked                                                | `unavailable`                              |
| `start` whose client, registered by the runtime at the authorization server, is one its secret store refuses to keep, in the store's words                                                                                                                                   | `conflict`                                 |
| `approve` of a connection whose credential is to be given, or `give_credential` of one that takes none                                                                                                                                                                       | `conflict`                                 |

### Providers

A provider is a service Auto knows by its name, an MCP server or an HTTP API with how a credential reaches it, which a person connects by its name and the values its placeholders take. `list_providers` lists those a person may connect here, and [`search`](#searching-the-tools) on the org route lists to a caller who may add a connection those that no server serves yet; [Let people add connections](../self-host/connections.md#the-providers-auto-ships) lists those Auto ships, and whoever runs Auto adds providers of their own in its settings file, [`connections.providers`](../self-host/connections.md#add-providers-of-your-own). The route is relative to `/v1/orgs/{org}` and served over HTTP alone, for a page to read:

| Operation        | Method and route | Permission | Input |
| ---------------- | ---------------- | ---------- | ----- |
| `list_providers` | `GET /providers` | `org:read` | None  |

It answers `providers`, sorted by name, `may_add` and `refusal`. A provider holds:

| Field          | What it holds                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`         | Its name, the default name of a connection to it, given as `provider` to `add_connection`                                                                                                                                                                                                                                                                                                                                |
| `title`        | What a person reads                                                                                                                                                                                                                                                                                                                                                                                                      |
| `description`  | What a function may do with it                                                                                                                                                                                                                                                                                                                                                                                           |
| `website`      | Where a person reads about the server and makes a credential                                                                                                                                                                                                                                                                                                                                                             |
| `type`         | `mcp` or `openapi`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `credentials`  | The ways a credential reaches the server, the first the default: `kind`, `secret`, `client_credentials`, `none` or `authorization`; for `secret`, `in` and `name`, where the person's value is sent, and `scheme`; for `client_credentials` and `authorization`, `issuer` and `scope`; a `description` for the person; `offered`, whether a person may connect it this way here, and `because`, why not, where it is not |
| `placeholders` | The values a person gives: `name`, `description`, `pattern` and `example`, or `choices`, each a `value` and a `title`, and `required`                                                                                                                                                                                                                                                                                    |

- A provider is listed where the operator's rules could allow it: a way is listed where `credential_kinds` takes its kind and the hosts it reaches could pass `allowed_hosts`, a host that holds a placeholder judged by its shape, and a provider with no way left is not listed. Whether a connection is allowed is still checked when it is added and on every request it makes.
- A way is `offered: false` while a value whoever runs Auto sets for it is not set, and a way of the kind `authorization` while Auto has none of the clients its provider's authorization server takes, as [Let people connect by consent](../self-host/connections.md#let-people-connect-by-consent) sets out, and `because` says so: `The provider drive takes consent through a client whoever runs Auto registers, which is not set up here`. `add_connection` refuses such a way at `/credential/kind` in the same words. [Searching the tools](#searching-the-tools) says what `search` does with a provider none of whose ways is offered.
- `may_add` says whether this caller may add a connection here, and `refusal` why not, in the sentence the first rule that refuses gives, in the order `add_connection` refuses: a caller without `org:write`; a key where people sign in, or every caller where the runtime signs nobody in; `connections.people_may_add` set to `false`. It is `null` where the caller may add. The providers are listed whatever `may_add` says.

### A connection that is not ready

A connected connection is a tool server of its org: `search` lists it with `connection`, its id, a function names it by its name as `name/tool`, and `introspect`, `validate`, `dry_run` and `execute` reach it, as [Tool servers](#tool-servers) describes. The runtime checks the operator's rules and the entry, as `add_connection` checks them, and reads its credential when it is first used after the runtime starts. A connection that is not ready is refused as `unavailable` of the kind `tool_not_offered`, and `search` lists it unavailable with the same `because` and words:

| `because`                | The connection                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_pending`     | Nobody has approved it yet; the person who added it opens its link, or removes it and adds it again for a new link                                                                                                                                                                                                                                                                                 |
| `connection_broken`      | Its credential is gone from the secret store or is not the tokens of a consent, its consent was revoked or has ended, or its client is no longer registered; the runtime recorded it `broken`, with why in `broken`, and the person removes it and adds it again                                                                                                                                   |
| `connection_not_allowed` | The runtime does not use it, in the words of why: a rule of the operator no longer takes it, in the sentence `add_connection` would give; `connections.people_may_add` is `false`; its entry is no longer one the runtime takes; the variable its reference names is not set; the configuration now sets up a server of its name; or a request it would make goes to a host the rules do not allow |
| `connection_unavailable` | Its credential cannot be read just now, in the words of why: the runtime's secret store cannot unwrap it or does not answer, which whoever runs the runtime puts right. The connection stays connected, and a later call reads the credential again                                                                                                                                                |

## Responses and errors

A successful operation responds with JSON and `Cache-Control: no-store`. The create operations, `create_playbook` and `create_definition`, return `201`; other successful operations return `200`.

An error is an RFC 9457 problem document, with `Content-Type: application/problem+json`. Inspect its `reason` and `detail`:

- `invalid_input` includes an `errors` list of JSON pointers, and the kind `input_schema` when the input schema of the function or workflow refused the input it was given, before it ran.
- A rejection that has a `kind` carries it.
- An `unavailable` or `conflict` rejection that has a `because` carries it.
- A `conflict` may have the kind `oversized`, for a workflow whose output is larger than a run can record.

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

A nested field is named by its path, such as `address, then city`, and an item of a list by its place, such as `lines, then item 2`. A missing field is named at the field that holds it, such as `The input: expected the field month`. A workflow whose step refused its input is rejected with that step's `errors`, at the pointers the step saw.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict` or `cancelled`                  |
| 410    | `unanswered`                               |
| 411    | `length_required`                          |
| 413    | `content_too_large`                        |
| 415    | `unsupported_media_type`                   |
| 422    | `invalid_input`                            |
| 500    | `internal`                                 |
| 503    | `unavailable`                              |

A problem document's `type` is a URI that names its kind of problem:

| Type                                              | Status | Means                                                                                                                                                                                                                            |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://on.auto/problems/bad_request`            | 400    | The request is malformed, such as a field given twice or a body that is not a JSON object                                                                                                                                        |
| `https://on.auto/problems/unauthenticated`        | 401    | Credentials are missing or invalid                                                                                                                                                                                               |
| `https://on.auto/problems/forbidden`              | 403    | The credentials may not do that                                                                                                                                                                                                  |
| `https://on.auto/problems/origin_not_allowed`     | 403    | A browser sent the request from an origin the server does not allow                                                                                                                                                              |
| `https://on.auto/problems/not_found`              | 404    | Something the request names does not exist                                                                                                                                                                                       |
| `https://on.auto/problems/method_not_allowed`     | 405    | The path does not take that method                                                                                                                                                                                               |
| `https://on.auto/problems/conflict`               | 409    | The request clashes with what is there                                                                                                                                                                                           |
| `https://on.auto/problems/tools_called`           | 409    | A run that may have called tools is not run again under its id; its `reason` is `conflict`. When every tool the run called only reads, it has `because: "only_read"`, and its words say nothing was changed                      |
| `https://on.auto/problems/effect_unknown`         | 409    | A run called a tool its server does not mark read-only, and could not finish. Whether the tool changed something is not known. Its `reason` is `conflict`; a person, or a workflow rule that names it, decides what happens next |
| `https://on.auto/problems/cancelled`              | 409    | The run was cancelled, with the `kind` of its cancellation; its `reason` is `cancelled`                                                                                                                                          |
| `https://on.auto/problems/unanswered`             | 410    | Nobody answered the request a run waited on, of an interaction function or a prediction function's build, with the `kind` `expired` or `undelivered`                                                                             |
| `https://on.auto/problems/length_required`        | 411    | A body a route streams, a dataset or a candidate, was sent without its `Content-Length`                                                                                                                                          |
| `https://on.auto/problems/content_too_large`      | 413    | The body is larger than the operation accepts: 1,048,576 bytes of JSON, or 64 MiB for a dataset or a candidate. Their `Content-Length` is refused before the body is read                                                        |
| `https://on.auto/problems/unsupported_media_type` | 415    | The body is not sent as the media type the operation accepts, `application/json` in UTF-8 unless the route says otherwise, or is sent compressed                                                                                 |
| `https://on.auto/problems/invalid_input`          | 422    | The input does not fit, with the `errors` that point at it                                                                                                                                                                       |
| `https://on.auto/problems/client_closed_request`  | 499    | The client disconnected before the response                                                                                                                                                                                      |
| `https://on.auto/problems/internal`               | 500    | Something went wrong inside the server                                                                                                                                                                                           |
| `https://on.auto/problems/unavailable`            | 503    | Something the server relies on cannot serve now                                                                                                                                                                                  |
| `https://on.auto/problems/tools_unfinished`       | 503    | A run called only tools their servers mark read-only, and could not finish; its `reason` is `unavailable`, and running it again under a new id is safe                                                                           |
| `https://on.auto/problems/rebuilding`             | 503    | The view of a recall function is still being built; its `reason` is `unavailable`; try again later                                                                                                                               |

[When a tool-calling run cannot finish](reasoning-format.md#when-a-tool-calling-run-cannot-finish) explains when a run ends as `tools_unfinished` or `effect_unknown`. [Retrying under a run id](#retrying-under-a-run-id) says when a request returns `tools_called`.

Inside a workflow, two rejections of a run the workflow called differ from their HTTP form:

- `invalid_input` is status 422 over HTTP, but a workflow raises it as a `validation` error of status 400. A `catch` for it matches status 400 or the `validation` type, never 422.
- A cancellation of a called run that the workflow does not catch rejects the workflow as `invalid_input`, not as `cancelled`, since the workflow itself was not cancelled.

[When the function's run does not succeed](workflow-format.md#when-the-function-s-run-does-not-succeed) has the full table of what a workflow `catch` sees.

A `500` response contains an incident reference: its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. A malformed HTTP request can get a bare status before the API handles it.

### When to retry

`Retry-After` comes only with an `unavailable` response that a retry of the same request may resolve. It never comes:

- with the kinds `tools_unfinished`, `tool_not_offered` or `model_not_offered`;
- with `because` set to `builds_of_the_day`, `stalled`, `not_finite` or `not_in_order`, which no wait resolves;
- with `cancelled`.

### Models and tools a function may not use

| Case                                                                                      | Response                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A function names a model outside the deployment's allow list                              | `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before the provider is called |
| A function names a model whose provider is missing                                        | `unavailable` with kind `model_not_offered` and `because: "provider_not_configured"`                          |
| A function names a tool the playbook's servers do not offer                               | `unavailable` with kind `tool_not_offered`                                                                    |
| `introspect`, `validate`, `dry_run` or `execute` names a tool the playbook is not offered | `unavailable` with kind `tool_not_offered`                                                                    |

Use `list_models` to see the model references the server offers, and `search` to see the servers and tools a function may name.
