# MCP reference

Auto Runtime serves its playbook, function and workflow operations to agents over the Model Context Protocol (MCP). Each MCP tool runs one operation of the [HTTP API](http.md), with the same fields, limits and refusals. This page maps each tool to its HTTP section, which is the home of those rules. It also covers what only MCP has: the endpoints, authentication from an MCP client, annotations, guides and prompts, model information, and the shape of results and errors.

To connect Claude Code, Claude Desktop or Codex, follow the [quick start](../get-started/local.md#connect-your-agent). For a worked example, follow [Build your first playbook](../tutorials/first-playbook.md).

## An inbound interface

MCP here is an inbound interface: an external agent connects to Auto Runtime and calls its operations. It does not configure tools inside a reasoning function.

A reasoning function can call tools itself, through tool servers the runtime's operator configures. That outbound connection is set up on the server, never by adding an endpoint to an external agent. The operator lists each server and the tools it allows in [`tool_servers`](../self-host/configuration.md#tool-servers), and a function names those tools in its [`tools`](reasoning-format.md#tools). [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function) explains the difference.

## Endpoints {#endpoint-scope}

| Path                                   | Acts on                                                                | Tools                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/mcp`                                 | The caller's own org and, through a `playbook` argument, its playbooks | Every tool. A tool that works inside a playbook takes a required `playbook` argument; `search` takes it as an optional one |
| `/orgs/{org}/mcp`                      | One org's playbooks                                                    | Playbook management, `list_models`, `search`, the connection tools and `get_guide`                                         |
| `/orgs/{org}/playbooks/{playbook}/mcp` | One playbook                                                           | The tools that work inside a playbook, with no `playbook` argument, and `search` and `get_guide`                           |

- Every endpoint uses streamable HTTP without sessions and accepts `POST`.
- The answer to a request the runtime handles comes as an event stream that carries a heartbeat, an SSE comment, every 5 seconds while the request runs, so an MCP client can tell a call that is still running from a server that has stopped. A request refused before it is handled keeps its JSON answer and its status, and a notification is answered `202 Accepted`. A stream that breaks is not resumed: closing it cancels the request.
- When the runtime stops while it handles a request, it answers the request with the JSON-RPC error `Auto Runtime stopped while it handled this request, so it may or may not have taken effect` before the stream ends, and a request that comes while it stops gets a `503`.
- The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles the negotiation.
- On `/mcp`, the org is the caller's own: an API key's org, or the org a signed-in person's token names. In local mode it is the org `local`. No tool takes an org argument.
- A connection lists only the tools its key or token may call. A read-only key sees the tools that read, and none that creates or runs a function. A key that may only read inside some playbooks is offered `list_playbooks`, which lists those playbooks.
- Which tools a connection lists depends on both the endpoint and the caller's permissions. A missing `create_definition` can mean either. The connection may be to the org endpoint, or its key or token may lack `playbook:write`.
- The org and playbook a scoped endpoint names stay subject to the caller's access. Choosing a more specific endpoint grants no extra permission.
- Five prediction routes are served only over [HTTP](http.md#prediction-functions): the three a build's trainer calls, the upload of a dataset and the activation of a version. So are the five routes of Studio's page that connects a [connection](#connections): `read_link`, `approve`, `give_credential`, `start` and `finish`, and `list_providers`, which a page reads to show what a person may connect. So are five reads an agent does with another tool or leaves to Studio: `get_playbook`, since each playbook `list_playbooks` returns holds the same fields; `get_connection`, since each connection `list_connections` returns holds the same fields, its `status` among them; `get_run_history`, since `list_playbook_events` with a `run_id` returns the run's events and those of every run it started; `get_playbook_analytics`, which Studio presents; and `validate`, since `dry_run` reports the same check of the arguments in its `arguments` field. No endpoint offers any of them as a tool.

### What a connecting agent is told

An agent that connects receives instructions written for the tools its key or token may call. They cover:

- what a playbook is, in the words of the [terminology](../concepts/terminology.md), with a sentence for each function type the runtime runs and one for workflows;
- that what the person wants kept, for anyone or a workflow to ask later, goes in a recall function of the playbook and not in the agent's own notes;
- what the connection acts on: the caller's own org on `/mcp`, one org's playbooks on `/orgs/{org}/mcp`, or one playbook on `/orgs/{org}/playbooks/{playbook}/mcp`;
- that `get_guide` returns the format of each definition;
- how a reasoning function names its model and its tools;
- where `search` and `add_connection` are both listed, that a person's accounts at services are connected through Auto Runtime: asked to connect, link, sign in to or use a service, the agent calls `search` with the service's words, which lists the providers that match, then `add_connection` with a provider's name, which the person approves on the page it links. The agent says that a service cannot be connected only when no provider or server matches;
- that `get_run` shows whether a run that finishes later has ended or is still waiting;
- that when the person answers what a run waits on, such as an approval, the agent answers the request with `answer_interaction` and starts no new run for it. The tool's description gives the shape of the answer;
- how to reply to the person: what was done and what they can do next, in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules. An id or a status appears only where the person needs it to act;
- that a tool that cannot do what was asked says why and what to change.

What the instructions leave out, the tools' descriptions say. The description of `get_guide` names the recipes the connection's tools can follow. Those of `execute` and `dry_run` say what each does. Those of `list_runs`, `list_playbook_events` and `list_interactions` say that their pages come one at a time and are read on only as the person needs.

The recall sentence says that a recall function reads run results, definitions and events from the playbook's history, never a run's input or its tool calls. The prediction sentence says that a prediction function predicts from a model a trainer built on the playbook's history. It also says that a build (the input `{ build: {} }`) returns `started`.

## Authentication

An MCP client sends the same credentials as any HTTP caller, and has the same permissions; see [Requests and access](http.md#requests-and-access). A client connects in one of three ways:

- With no credential, when the server runs in [local mode](../self-host/security.md#local-mode): it listens only on a loopback address, and neither `PUBLIC_URL` nor `API_KEYS` is set. The quick start's MCP entry starts Auto Runtime this way, and relays the agent to its endpoint, `http://localhost:5555/mcp`. It trusts every request on your computer, so never expose it through a tunnel or public proxy.
- Signed in, where the operator sets `PUBLIC_URL`. Your agent signs you in through the Auto identity service when it connects. On your own computer, `PUBLIC_URL=http://localhost:5555` turns this on for a server started in a terminal, and the agent then connects to `http://localhost:5555/mcp` over HTTP, as the [quick start](../get-started/local.md#other-ways-to-run-auto) describes, rather than through the MCP entry.
- With an [API key](../self-host/security.md#api-keys), sent as `Authorization: Bearer <key>`. Keep it in the connection configuration, outside prompts and function documents.

[Authentication and security](../self-host/security.md) says how an operator sets each of these up. The [Sign-in and token reference](authentication.md) gives the rules the server applies.

### Signing in from an MCP client

With sign-in on, each endpoint is an OAuth 2.1 protected resource, as the MCP authorization specification describes. A client that supports that flow signs the person in by itself. So does an agent gateway that obtains tokens on the person's behalf:

1. It connects without a token and gets `401`, with a challenge that points to the endpoint's protected resource metadata.
2. It signs the person in at the identity service the metadata names, and asks for a token for that endpoint.
3. It connects again with `Authorization: Bearer <token>`.

The connection then acts as the person in the org their token names, which is also the org `/mcp` acts in. It lists only the tools the token's granted scopes allow. [Discovery and challenges](authentication.md#discovery-and-challenges) gives the metadata and every challenge. [How scopes grant permissions](authentication.md#how-scopes-grant-permissions) says what each scope allows.

## Tools

Each tool runs one HTTP operation, and its section in the [HTTP reference](http.md) gives its fields, limits and refusals.

- A tool takes as arguments what its route takes in the path, the query string or the body, by the same names. Examples are a definition's `type` and `name`, a `run_id`, an `event_id`, or a `server` and a `tool`.
- On `/mcp`, a tool that works inside a playbook also takes the playbook's id as `playbook`.
- A definition's `type` is `reasoning`, `interaction`, `prediction`, `recall`, `computation` or `workflow`. Every runtime, whether started with npx or Docker, serves all six.

### How a tool describes itself

Every tool supplies a description and the JSON Schema of its input. No tool has an output schema. [Successful results](#successful-results) says what a result contains, and the [OpenAPI document](http.md#the-openapi-document-the-guides-and-the-api-catalog) gives each operation's output schema.

- A description says what the tool does and when to use it.
- The rules of each argument are in the input schema.
- The format of a definition is in its guide, which `get_guide` returns.

Each tool's annotations tell a client how careful to be:

| Annotation        | Means                                                          | `true` for                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | The tool only reads                                            | Every tool that reads, including `dry_run`, although its HTTP route uses `POST`                                                                                                                      |
| `destructiveHint` | What it does cannot be undone, or may change something outside | `retire_playbook`, `remove_connection`, `retire_definition`, `cancel_run` and `answer_interaction`; `run_definition` and `execute` while any tool server is configured or people may add connections |
| `idempotentHint`  | Calling it again with the same input changes nothing           | Every tool that reads, and `update_playbook`, `retire_playbook`, `remove_connection`, `update_definition`, `retire_definition`, `cancel_run` and `answer_interaction`                                |
| `openWorldHint`   | It reaches outside the runtime                                 | `list_models` and `run_definition`, which reach model providers; `search`, `introspect`, `dry_run` and `execute`, which reach tool servers                                                           |

`run_definition` is marked destructive while a tool server is configured or people may add connections, as they may by default, because a function's tools may then change something. An agent can ask the person before it runs a function.

### Playbooks and models

These tools are listed on `/mcp` and the org endpoint. Their routes are relative to `/v1/orgs/{org}`.

| Tool              | HTTP operation                      | What it is for                                                                             |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `create_playbook` | `POST /playbooks`                   | Create a playbook, active and empty                                                        |
| `list_playbooks`  | `GET /playbooks`                    | List the playbooks the caller may access                                                   |
| `update_playbook` | `PUT /playbooks/{playbook}`         | Change a playbook's name and description                                                   |
| `retire_playbook` | `POST /playbooks/{playbook}/retire` | Retire a playbook for good                                                                 |
| `list_models`     | `GET /models`                       | List the models a reasoning function may name; see [Model information](#model-information) |

Each playbook `list_playbooks` returns holds every field of the playbook, a retired one among them with `include_retired`. [Playbooks](http.md#playbooks) and [Models](http.md#models) give the fields, limits and refusals.

### Definitions

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`, where `{type}` is the tool's `type` argument.

| Tool                | HTTP operation                           | What it is for                                                       |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `create_definition` | `POST /definitions/{type}`               | Save a new function or workflow from its document, given as `source` |
| `list_definitions`  | `GET /definitions/{type}`                | List the definitions of one type, without their `overview`           |
| `get_definition`    | `GET /definitions/{type}/{name}`         | Read a definition, with its document and its `overview`              |
| `update_definition` | `PUT /definitions/{type}/{name}`         | Save a new version from a changed document                           |
| `retire_definition` | `POST /definitions/{type}/{name}/retire` | Retire a definition for good                                         |

The `overview` describes a definition in plain words, so an agent can show a person what it does without its source. `get_definition`, `create_definition`, `update_definition` and `retire_definition` return it. It is written each time it is returned, from what the version's document says and what the playbook holds then: for a workflow, **What it calls**, each definition it names with its description; then **Used by**, the active definitions of the playbook that use this one, a workflow with the steps that call it; and last, under **Details**, their exact names with their types. [Reasoning functions](http.md#reasoning-functions) gives the rules every type of definition follows, and the section of each type adds its own.

### Runs

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool             | HTTP operation                        | What it is for                                                             |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `run_definition` | `POST /definitions/{type}/{name}/run` | Run a function or workflow once, with its `input` and an optional `run_id` |
| `get_run`        | `GET /runs/{run_id}`                  | Read a run, with its detailed `record`                                     |
| `list_runs`      | `GET /runs`                           | List the playbook's runs, newest first                                     |
| `cancel_run`     | `POST /runs/{run_id}/cancel`          | Cancel a run that waits                                                    |
| `send_run_event` | `POST /runs/{run_id}/events`          | Deliver an event to a workflow run that is still `started`                 |

[Runs and results](http.md#runs-and-results) covers input limits and which runs finish later, and [Retrying under a run id](http.md#retrying-under-a-run-id) what a request under an earlier run's id returns. [Cancelling a run](http.md#cancelling-a-run), [Sending an event to a run](http.md#sending-an-event-to-a-run) and [Run history and playbook events](http.md#run-history-and-playbook-events) give the rest.

### Requests

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool                 | HTTP operation               | What it is for                                                                                             |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_interactions`  | `GET /interactions`          | List the open requests of interaction functions and of prediction functions' builds, newest first          |
| `answer_interaction` | `POST /runs/{run_id}/answer` | Answer a request in the shape its `answer_schema` gives; the run that asked takes it within about a second |

[Interaction functions](http.md#interaction-functions) lists every field of a request and of an answer, and each refusal. [Answering a request](interaction-format.md#answering-a-request) explains how a run takes its answer.

### Events and history

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool                   | HTTP operation           | What it is for                                                                                     |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `publish_event`        | `POST /events`           | Record an event in the playbook, such as a month closed in a ledger                                |
| `list_playbook_events` | `GET /events`            | Read everything that happened in the playbook, newest first, or with `run_id` one run's whole tree |
| `get_event`            | `GET /events/{event_id}` | Read one event with every field in full, such as a tool's whole result                             |

Over MCP, a result carries its output twice, as JSON text and as structured content. So `get_event` shows a large field in full only up to 64 KiB as JSON, and shows its size beyond that. The large fields are an input, an output, a record, an answer, a call's `arguments` and `result`, and a published event's data. Over HTTP, every field is whole.

`list_playbook_events` with a run's `run_id` returns what the run and every run it started recorded: its steps, its tool calls and how it ended. [Publishing events](http.md#publishing-events) and [Run history and playbook events](http.md#run-history-and-playbook-events) give the fields, filters, paging and limits. The playbook's [analytics](http.md#analytics) are Studio's to present, over HTTP alone.

### Tool servers

Four tools work with the tool servers of the playbook, those set up in the configuration and the [connections](#connections) of its org, whether MCP servers or HTTP APIs, under the names an agent gateway gives the same tools over the systems behind it, so an agent uses one vocabulary with either. A fifth operation, `validate`, is served over [HTTP](http.md#tool-servers) alone: `dry_run` reports the same check of the arguments. The routes are relative to `/v1/orgs/{org}`.

| Tool         | HTTP operation                                                                                        | What it is for                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `search`     | `GET /tool-servers/search`, or on a playbook endpoint `GET /playbooks/{playbook}/tool-servers/search` | Find the servers and the tools a reasoning function may name in `tools`        |
| `introspect` | `GET /playbooks/{playbook}/tool-servers/{server}/tools/{tool}`                                        | Read one tool in full: its description, its arguments' schema and its hints    |
| `dry_run`    | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/dry-run`                               | See what `execute` would check, without calling the tool                       |
| `execute`    | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/execute`                               | Call one tool by hand, live, as the playbook, to see what it returns or to act |

- `search` is listed on every endpoint, and the other three on `/mcp` and a playbook endpoint.
- On `/mcp` and the org endpoint, `search` takes an optional `playbook`. Without it, `search` covers the whole org, so an agent can see what is set up before a playbook exists. On a playbook endpoint, `search` takes no `playbook`.
- `introspect` and `dry_run` change nothing and call no tool, but they ask the servers for their tool lists. So they are marked read-only and open-world, and a key that may read the playbook is offered them.
- `execute` needs `playbook:write` whatever the tool does, so a key that may only read is not offered it. Each call is recorded in the playbook's history.
- A call that names a server or a tool the playbook may not use is refused, and the refusal's words say what `search` shows.
- A connection is listed with `connection`, its id, and named by its name. One that is not ready is refused, and listed unavailable, with `because` `connection_pending` while nobody has approved it, `connection_broken` once its credential is gone from the secret store or is not the tokens of a consent, its consent was revoked or has ended, or its client is no longer registered, `connection_not_allowed` when a rule of the operator no longer takes it, or `connection_unavailable` while its credential cannot be read just now, which a later call may find put right.
- Each server carries `provider`: the name of the provider a connection was added from or an entry of the configuration names, or `null` for a server given by hand.
- On `/mcp` and the org endpoint, to a caller who may add a connection, `search` also lists in `providers` the [providers](http.md#providers) a person may connect that no server serves yet, each with its `name`, `title` and `description`, found by `terms` as tools are. A provider none of whose ways is offered, as while a value whoever runs Auto sets for it is not set, is left out. An agent asked to connect a service, or for one no server serves, finds its provider there by the service's words and connects it with `add_connection`. A key, a caller who may only read and a runtime where nobody may add get no `providers`, and neither does `search` with `server`.
- When no server serves the playbook, the words of `search` say that whoever runs the server sets one up. Where people may add connections, they also say that a person adds one, or, where `search` lists a provider, that a person connects a provider it lists.

[Tool servers](http.md#tool-servers) gives the fields, limits and refusals of all five.

### Connections

A connection is a tool server that a person adds to the org through their agent, a provider by its name or a server given by hand, which every playbook of the org may use, or the playbooks its entry names. These tools are listed on `/mcp` and the org endpoint. Their routes are relative to `/v1/orgs/{org}`.

| Tool                | HTTP operation             | What it is for                                                                            |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `add_connection`    | `POST /connections`        | Add a provider or a tool server to the org, pending, and answer the link that approves it |
| `list_connections`  | `GET /connections`         | List the org's connections, newest first, and whether each is pending or connected        |
| `remove_connection` | `DELETE /connections/{id}` | Remove a connection for good, which forgets its credential                                |

- A connection is added by a person: where the runtime signs people in, `add_connection` refuses a key, and a runtime of API keys alone, which signs nobody in, refuses every connection, since no person could approve it.
- The agent adds a connection without its credential: an entry that holds a value that looks like a credential, or a reference such as `${CRM_API_KEY}`, is refused. The person approves the connection, and gives its credential where it takes one, on Studio's page, which `connect.url` of the answer opens within ten minutes.
- `add_connection` always puts the link in its answer. To a client of the `2026-07-28` revision that declares in its request that it opens links, the `url` form of elicitation, it also asks for the link to be opened, with a message that says what to do. The client opens the page or declines, and retries the call, which answers the connection added once and never adds a second one. A retry by another caller, or in another org, is refused, and the connection stays added. A client of an earlier revision, whose requests carry no capabilities on this stateless server, is not asked; it shows the person the link from the answer.
- `add_connection` takes one of two inputs. For a provider: `provider`, its name; `placeholders`, the value of each placeholder it takes; and, where they are wanted, `name`, the provider's when left out, `credential` with its `kind` alone, and when it is left out the first way `list_providers` marks offered, or the provider's first where it offers none, and `entry` with `playbooks`, `allowed` and `record_content` alone. The provider gives the rest, and `type`, the server in `entry` and the other fields of `credential` are refused. For a server given by hand: `name`, the name a function gives the server; `type`, `mcp` for a remote MCP server or `openapi` for an HTTP API; `entry`, the server without its credential; and `credential`, with no `placeholders`.
- A provider the runtime does not have is refused at `/provider`, in words that say `search` lists the providers a person may connect, a placeholder or a value refused at `/placeholders/<name>`, and what the checks of an entry find in what the provider resolved at `/provider`.
- The credential is one object: its `kind` and the fields that kind takes, `variable`, `name` and `in` for `reference`, `name` and `in` for `secret`, each with an optional `scheme` such as `Bearer` where `in` is `header`, which the runtime writes before the value, and `issuer`, an optional `client_id` and an optional `scope` for `client_credentials`. A `client_id` left out is given by the person on Studio's page, with the secret or the key. The kind `authorization` names a provider's way by which the person signs in to the provider and allows Auto: it is taken with `provider` alone, as the kind of its way, and refused for a server given by hand. A field its kind lacks or does not take is refused as `invalid_input` at that field.
- Once connected, a connection is a tool server of the org: a function names it by its name as `name/tool`, and `search`, `introspect`, `dry_run` and `execute` reach it, as [Tool servers](#tool-servers) describes.
- A link is gone after its ten minutes, and nothing gives a pending connection another: remove the connection with `remove_connection` and add it again.
- `add_connection` and `remove_connection` need `org:write`, and `list_connections` needs `org:read`. `get_connection`, which reads one connection by its id, is served over HTTP alone; `list_connections` shows whether the person approved a connection, in the `status` of each.

[Connections](http.md#connections) gives the fields, limits and refusals, and [Let people add connections](../self-host/connections.md) the flow and the rules the operator sets.

## Guides and prompts

`get_guide` returns one of the runtime's guides in full, by its name. Every endpoint serves the same guides. It also lists them as Markdown resources, `guide://<name>`, for clients that let a person or a model read them directly. Over HTTP, [`GET /v1/guides/{guide}`](http.md#the-openapi-document-the-guides-and-the-api-catalog) serves the same text.

| Guide                                                                                                                         | Contains                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `terminology`                                                                                                                 | What the words of a playbook mean, for the types of function the runtime runs                                                 |
| `reasoning-function`, `interaction-function`, `prediction-function`, `recall-function`, `computation-function` and `workflow` | The reference page of each format, as the documentation publishes it. `reasoning-function` ends with what this runtime offers |
| `first-playbook`, `remember`, `give-tools` and `schedule`                                                                     | Recipes for common tasks, listed below                                                                                        |

The recipes are also prompts, which a client that shows MCP prompts offers in its menu. A connection offers a prompt only when it lists every tool the recipe's steps call, and the description of `get_guide` names the same recipes. So a playbook endpoint offers no `first-playbook`, the org endpoint offers none, and a key that may only read gets none.

| Prompt           | Title                                | Arguments                            | What the recipe does                                                                   |
| ---------------- | ------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `first-playbook` | Create your first playbook           | None                                 | Creates a playbook with a first reasoning function, and runs it once the person agrees |
| `remember`       | Make the playbook remember something | `what` to remember                   | Keeps what the playbook's runs returned or its events recorded in a recall function    |
| `give-tools`     | Give the playbook tools              | Optional `server`, a tool server     | Gives a reasoning function the tools of a tool server the playbook may use             |
| `schedule`       | Run a workflow on a schedule         | The `workflow`, and `when` to run it | Starts a workflow on a schedule or on an event, and reads how its runs went            |

A prompt returns the recipe with the person's words filled in, followed by the format guide it needs.

## Model information

`list_models` lists the model references the server offers, including configured aliases. An agent can then name a model that works instead of guessing. It requires `org:read`, and it only reads. It is served on `/mcp` and the org endpoint, and is not available on a playbook-scoped endpoint. Over HTTP it is [`GET /v1/orgs/{org}/models`](http.md#models), which returns the same result.

Its optional `provider` input selects one provider prefix, such as `anthropic`, or a configured gateway name. The server then lists only what that provider serves, and asks no other provider.

The result has the shape of the OpenAI API's list of models, with fields of its own at the top:

```json
{
  "object": "list",
  "data": [
    {
      "id": "anthropic/claude-sonnet-4-5-20250929",
      "object": "model",
      "created": 1759104000,
      "owned_by": "anthropic",
      "name": "Claude Sonnet 4.5",
      "context_window": 200000,
      "max_tokens": 64000
    },
    {
      "id": "gateway/anthropic/claude-haiku-4-5",
      "object": "model",
      "created": 1760486400,
      "owned_by": "gateway",
      "name": "Claude Haiku 4.5",
      "context_window": 200000,
      "max_tokens": 64000
    },
    {
      "id": "house/fast",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "alias": true,
      "resolved_to": "gateway/anthropic/claude-haiku-4-5"
    },
    {
      "id": "openai/*",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "alias": true,
      "resolved_to": "gateway/openai/*",
      "pattern": true
    },
    { "id": "bedrock/*", "object": "model", "created": 0, "owned_by": "bedrock", "pattern": true }
  ],
  "catalog_status": "complete",
  "narrowed": false,
  "listed_at": "2026-10-01T09:30:00.000Z"
}
```

| Field            | Meaning                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `object`         | `"list"`                                                                                                                                                                                                   |
| `data`           | The entries, sorted by `id`, each `id` once                                                                                                                                                                |
| `catalog_status` | `complete`, or `partial` when a provider could not be asked, so its models are missing or are its last list                                                                                                |
| `narrowed`       | `true` when `allowed_models` or `ALLOWED_MODELS` is set, so the list holds only what the operator allows; `false` when nothing narrows it, and a definition may name any model of the configured providers |
| `listed_at`      | When the oldest provider list in the result was read; the time of the response when no provider was queried                                                                                                |
| `provider_setup` | Only from a runtime started with npx, when no `provider` is given and it lists no model: how the person adds a model provider                                                                              |

Each entry contains `id`, `object: "model"`, `created` and `owned_by`. The last six fields in this table appear only where they apply:

| Field            | Meaning                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | The model as a definition names it, `<provider>/<model id>`, or an alias as its operator wrote it                                                                                                          |
| `created`        | When the provider released or added the model, in seconds since 1970, as the provider says; `0` when it does not say                                                                                       |
| `owned_by`       | The provider prefix that serves the model; for an alias, the prefix of its target. Never the owner a provider reports                                                                                      |
| `name`           | The provider's name for the model, only when the provider reports one                                                                                                                                      |
| `context_window` | The most input tokens, only when the provider reports it                                                                                                                                                   |
| `max_tokens`     | The most output tokens, only when the provider reports it                                                                                                                                                  |
| `alias`          | `true` for every alias its operator named, whether or not `resolved_to` shows its target; no other entry has it                                                                                            |
| `resolved_to`    | For an alias, the reference it is sent to; left out when that is a Bedrock ARN, which names an account and a region                                                                                        |
| `pattern`        | `true` for an id that ends in `*`, which stands for any model id. It is a wildcard alias, or `<provider>/*` for a provider that lists nothing and has no declared models, such as Bedrock, Azure or Vertex |

How to read it:

- Use a concrete `id` as the reasoning function's `model`.
- A wildcard describes a supported prefix; it is not a model to run.
- `catalog_status: "partial"` means a provider's list is missing or stale. It does not mean the server has no models. The caller sees only `partial`; the operator's log says why the list could not be read.
- Model access rules also apply when a function runs. A model the operator does not allow is refused before the provider is called, as [Responses and errors](http.md#responses-and-errors) says.

How long a list is kept:

- The server reads a provider's list the first time it needs it, and keeps it for five minutes. Calls that arrive while the list is being read wait for that read.
- When a list cannot be read again, the server returns the last list it read, marked `partial`. It waits a minute before it asks that provider again; the first call after that minute asks again.

What the list leaves out:

- a model that an alias redirects, since a definition that names it reaches the alias instead. With `anthropic/*` sent to a gateway, the models Anthropic lists are left out, and `anthropic/*` is listed;
- an alias whose target provider is not configured, since a definition cannot call it;
- any model the operator's allow list does not allow;
- an entry whose id is empty, longer than 256 characters, contains a space, a control character or a `*`, or is a Bedrock ARN;
- a `name` longer than 100 characters or on more than one line, though its entry is kept;
- every key, token, base URL, header, query parameter, account, project, region and Bedrock ARN, every price, description or other field a provider adds, and the owner a provider reports.

The plain-language summary of the result follows these rules:

- It names at most 20 models and counts the rest. It names each by the name its provider gives, or else by the last part of its id.
- A name two providers share gets its provider in brackets. A name one provider repeats is replaced by the last part of the id.
- It says which providers accept any model id, such as `It can also call any openai model.`
- When the list is narrowed, it then says `It lists only the models its operator allows.`
- A `partial` result ends with `The list may be incomplete: a provider could not be asked just now.`

A server with six models, for example, says: `This server can call 6 models through anthropic and gateway: Claude Haiku 4.5 (anthropic), Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5 (gateway), and fast.`

[Set up a model provider](../self-host/models.md) explains how an operator sets up a provider. The [Model settings reference](model-settings.md) covers aliases, declared models, the allow list and how each list is built.

This catalog lists language models, not MCP tools. `search` finds the tools of the tool servers a playbook's functions may use. A separately managed tool library is still planned.

## Successful results

A successful tool result carries a plain-language summary, the operation's output as JSON text and the same output as structured content:

| Field               | Contents                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `content[0].text`   | A plain-language summary of what was done                                      |
| `content[1].text`   | The operation's output as JSON text, for clients that do not read the next one |
| `structuredContent` | The same output as structured content                                          |

Read `structuredContent`. The first text block is not JSON. No tool advertises an output schema, so a client should use `structuredContent` as it comes rather than validate it against a schema.

- A run's result is the run: its run id, definition version and status, and its output when it succeeded. `get_run` adds the detailed record.
- A run that finishes later, such as a workflow's, is `started` when `run_definition` returns; [Runs and results](http.md#runs-and-results) says which runs do and how to read them again.
- The summary repeats a short result in words, and points to `structuredContent` for a long one.
- A review that recommends Revise still belongs to a succeeded run: the operation completed and produced that recommendation.

For a workflow, the summaries read like these. They were recorded from a run of the [first-workflow tutorial](../tutorials/first-workflow.md), in the order the tutorial calls the tools. Only the review's words come from a scripted model:

```text
create_definition: Created the interaction function “approve-campaign-brief”. What it does: Asks the campaign owner to approve a reviewed brief. It has been saved but has not been run yet.
create_definition: Created the workflow “review-and-approve”. What it does: Reviews a campaign brief, then asks its owner to approve it. It has been saved but has not been run yet.
run_definition: The workflow “review-and-approve” has started and is still running. It carries on by itself, and how it ends can be looked up later.
get_run: The workflow “review-and-approve” is still running; how it ends can be looked up again later.
list_interactions: Found 1 request waiting on this page.
answer_interaction: The request is answered: the run that asked it takes the answer within the host's sweep, a second by default, and get_run shows how it ended.
get_run: The run of the workflow “review-and-approve” finished. Its result: review: “Revise: the audience lacks a job role.” and approval: (verdict: “approve” and note: “Approved for the autumn launch.”)
list_playbook_events: Found 15 events of the run asked for in this playbook, oldest first, each with its fact and its metadata.
get_run: The run of the interaction function “approve-campaign-brief” finished. Its answer: verdict: “approve” and note: “Approved for the autumn launch.”
list_interactions: No request is waiting.
```

Each event carries a summary too. Given the workflow run's `run_id`, `list_playbook_events` answers its events and those of the two runs it started, and the nine of the workflow run read, oldest first:

```text
run_started: A run of the workflow “review-and-approve” started.
workflow_input_applied: The workflow started, and 1 step moved.
step_waiting: The step “review brief” waits for a function it called.
workflow_input_applied: A function the workflow called answered, and 2 steps moved.
step_finished: The step “review brief” finished.
step_waiting: The step “ask for approval” waits for a function it called.
workflow_input_applied: A function the workflow called answered, and 1 step moved; the workflow ended.
step_finished: The step “ask for approval” finished.
run_succeeded: A run finished.
```

## Errors

An operation failure is a tool result with `isError: true` and no `structuredContent`:

- The first text block explains the failure in words.
- The second contains the JSON problem document. Its `reason` and `detail` distinguish invalid input, permission failures, conflicts and unavailable dependencies.
- Invalid arguments are `invalid_input`, with a pointer at each field, so an agent can correct them. An input that the input schema of the function or workflow it runs refused has the kind `input_schema`.

Some failures come before a tool runs, outside any tool result:

- Authentication and origin checks can reject a request with an HTTP problem document.
- Protocol failures return JSON-RPC errors. A call to a tool the connection does not list returns `-32602`.

[Responses and errors](http.md#responses-and-errors) lists the status codes, problem reasons and kinds. [Function availability](../concepts/functions.md#availability) says which function types the runtime runs.
