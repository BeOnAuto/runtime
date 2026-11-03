# MCP reference

Auto Runtime serves its playbook, function and workflow operations to agents over the Model Context Protocol (MCP). Each MCP tool runs one operation of the [HTTP API](http.md), with the same fields, limits and refusals. This page maps each tool to its HTTP section, which is the home of those rules. It also covers what only MCP has: the endpoints, authentication from an MCP client, annotations, guides and prompts, model information, and the shape of results and errors.

To connect Claude Code, Claude Desktop or Codex, follow the [quick start](../get-started/cloud.md#connect-your-agent). For a worked example, follow [Build your first playbook](../tutorials/first-playbook.md).

## An inbound interface

MCP here is an inbound interface: an external agent connects to Auto Runtime and calls its operations. It does not configure tools inside a reasoning function.

A reasoning function can call tools itself, through tool servers the runtime's operator configures or through [connections](#connections) people add to their organization. That outbound connection is set up in Auto, never by adding an endpoint to an external agent. The operator lists each server and the tools it allows in [`tool_servers`](../self-host/configuration.md#tool-servers), and a function names those tools in its [`tools`](reasoning-format.md#tools). [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function) explains the difference.

## Endpoints {#endpoint-scope}

For hosted Auto, use `https://mcp.on.auto`. It serves the caller's organization and its playbooks, and handles sign-in through MCP authentication. The paths below describe a self-hosted runtime. The tools a deployment exposes depend on its capabilities and your permissions.

| Path                                   | Acts on                                                                | Tools                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/mcp`                                 | The caller's own org and, through a `playbook` argument, its playbooks | Every tool. A tool that works inside a playbook takes a required `playbook` argument; `search`, `list_comments` and `resolve_comment` take it as an optional one |
| `/orgs/{org}/mcp`                      | One org's playbooks                                                    | Playbook management, `list_models`, `search`, `list_comments` and `resolve_comment` with `playbook` optional, the connection tools and `get_guide`               |
| `/orgs/{org}/playbooks/{playbook}/mcp` | One playbook                                                           | The tools that work inside a playbook, the memory tools among them, with no `playbook` argument, and `search` and `get_guide`                                    |
| `/directory`                           | The caller's own org, as `/mcp` does                                   | The tools of `/mcp`, less what the directory listing leaves out, listed below                                                                                    |

- Every endpoint uses streamable HTTP without sessions and accepts `POST`.
- `/directory` is the directory listing. It leaves out two things.
  - No generation function: the definition tools take no `generation` type, `get_guide` holds no generation guide, and `list_playbook_events` names none of its events. A call that names a generation function is refused as `not_found`.
  - No tool server whose tools pay, refund, transfer or pay out money, which its provider's entry or its configuration marks `handles_money: true`, such as Stripe. `search` lists neither the server nor its provider, and `add_connection`, `list_connection_tools`, `query_connection` and `execute_connection` refuse it as `unavailable`, saying the directory listing does not offer it. Through `/mcp` the same calls work.
- The answer to a request the runtime handles comes as an event stream that carries a heartbeat, an SSE comment, every 5 seconds while the request runs, so an MCP client can tell a call that is still running from a server that has stopped. A request refused before it is handled keeps its JSON answer and its status, and a notification is answered `202 Accepted`. A stream that breaks is not resumed: closing it cancels the request.
- When the runtime stops while it handles a request, it answers the request with the JSON-RPC error `Auto Runtime stopped while it handled this request, so it may or may not have taken effect` before the stream ends, and a request that comes while it stops gets a `503`.
- The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles the negotiation.
- On `/mcp`, the org is the caller's own: an API key's org, or the org a signed-in person's token names. In local mode it is the org `local`. No tool takes an org argument.
- A connection lists only the tools its key or token may call. A read-only key sees the tools that read, and none that creates or runs a function. A key that may only read inside some playbooks is offered `list_playbooks`, which lists those playbooks.
- Which tools a connection lists depends on both the endpoint and the caller's permissions. A missing `create_definition` can mean either. The connection may be to the org endpoint, or its key or token may lack `playbook:write`.
- The org and playbook a scoped endpoint names stay subject to the caller's access. Choosing a more specific endpoint grants no extra permission.
- The five routes of Studio's page that connects a [connection](#connections), `read_link`, `approve`, `give_credential`, `start` and `finish`, are served only over [HTTP](http.md), and so is `list_providers`, which a page reads to show what a person may connect. So are six reads an agent does with another tool or leaves to Studio: `get_connection`, since each connection `list_connections` returns holds the same fields, its `status` among them; `get_run_history`, since `list_playbook_events` with a `run_id` returns the run's events and those of every run it started; `get_playbook_analytics` and `render_playbook_page`, which Studio presents; `render_page`, since `get_definition` with `render` previews the same page; and `validate`, since `dry_run` reports the same check of the arguments in its `arguments` field. Given a run's `run_id`, `render_page` renders that run's page as it stood when the run ended, which Studio's Ledger shows for the chosen run. `make_comment` is served over HTTP alone too, a playbook's and the organization's, since an agent does not comment on its own work, and so is `reopen_comment`, since a person reopens a comment, and so are `transcribe` and `get_voice`, by which Studio writes out what a person says into a comment. No endpoint offers any of them as a tool.

### What a connecting agent is told

An agent that connects receives instructions written for its caller and the tools its key or token may call. They cover:

- first, whom the connection acts as, by name and id, and in which org: `This connection acts as Ada Lovelace (person:user_2ada) in the org acme.` for a signed-in person, the local developer by the name of the account the server runs as and the id `local`, and `This connection acts as the key build-bot in the org acme.` for a key. So an agent that reads who created, added, connected, started, answered, trained, approved or refused something tells the person it acts for from the others;
- then, that a playbook holds work that keeps running after a conversation, in any line of business;
- what a playbook is, in the words of the [terminology](../concepts/terminology.md), with one sentence that names each function type the runtime runs, in the terminology's order and with what it is for in a few words, and two for workflows: what a workflow does, and that a workflow's steps use the playbook's functions, with, where `run_definition` is listed, that it runs the workflow;
- that a lookup function fetches what a reasoning function interprets;
- where the runtime runs memory functions, that a memory function keeps what the playbook recalls later;
- what the connection acts on: the caller's own org on `/mcp`, one org's playbooks on `/orgs/{org}/mcp`, or one playbook on `/orgs/{org}/playbooks/{playbook}/mcp`;
- that `get_guide` holds the format of each definition, and that an overview goes with each definition, or, where the runtime keeps pages, with each function or workflow;
- where the connection can follow the recipe `first-playbook`, that it sets out how a playbook is built and names the guides its steps need;
- where the runtime keeps pages, that every workflow and function takes a page, which shows the person its results, run by run and over time;
- where `list_models` is listed and `search` is not, that `list_models` lists the models a reasoning function can name;
- where `search` and `add_connection` are both listed, that `search` finds the provider of a service by its words and `add_connection` connects it to the org's playbooks, which the person approves on the page it links, and that a service cannot be connected when no provider or server matches;
- that `answer_interaction` answers what a run waits on;
- that a tool that cannot do what was asked says why and what to change.

What the instructions leave out, the tools' descriptions say. The description of `get_guide` names the recipes the connection's tools can follow. That of `run_definition` says that a run that finishes later returns `started` and that `get_run` shows how it ended. Those of `list_models` and `search` say how a reasoning function names its model and its tools, as the reasoning function's guide does. Those of `query_connection`, `execute_connection` and `dry_run` say what each does. Those of `list_runs`, `list_playbook_events` and `list_interactions` say that their pages come one at a time, each read on from the `next_cursor` of the page before. Those of `list_comments` and `resolve_comment` say what each does with what people said in Studio, as [Comments](#comments) sets out.

The sentence of the function types says, of each type the runtime runs, that a reasoning function prompts a model, a lookup function obtains information, a memory function remembers and recalls, an interaction function exchanges information, a prediction function forecasts from history, a computation function runs a program and a generation function produces assets, and the next that a lookup function fetches what a reasoning function interprets. The format of each type carries the rest: the [lookup format](lookup-format.md) says that its tool is one marked `reads`, and the [prediction format](prediction-format.md) sets out its forecaster.

## Authentication

Hosted Auto signs you in when your agent connects; account creation is part of the same flow.

An MCP client sends the same credentials as any HTTP caller, and has the same permissions; see [Requests and access](http.md#requests-and-access). A client connects in one of three ways:

- Signed in. Hosted Auto uses this flow by default. For a self-hosted runtime, the operator enables sign-in with `PUBLIC_URL`. Your agent discovers the identity service and opens the browser for you to sign in.
- With no credential, when a self-hosted server runs in [local mode](../self-host/security.md#local-mode). It listens only on a loopback address and trusts requests from that computer. Never expose local mode through a tunnel or public proxy.
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
- A definition's `type` is `reasoning`, `lookup`, `memory`, `interaction`, `prediction`, `computation`, `generation` or `workflow`. Every runtime, whether started with npx or Docker, serves all eight.

### How a tool describes itself

Every tool supplies a description and the JSON Schema of its input. No tool has an output schema. [Successful results](#successful-results) says what a result contains, and the [OpenAPI document](http.md#the-openapi-document-the-guides-and-the-api-catalog) gives each operation's output schema.

- A description says what the tool does and when to use it.
- The rules of each argument are in the input schema.
- The format of a definition is in its guide, which `get_guide` returns.

Each tool's annotations tell a client how careful to be:

| Annotation        | Means                                                | `true` for                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | The tool only reads                                  | Every tool that reads, including `dry_run`, although its HTTP route uses `POST`, and `query_connection`, which calls only a tool marked `reads`                                                                                                                                                                                                |
| `destructiveHint` | It may change or delete data                         | Every tool that does not only read, `execute_connection` among them                                                                                                                                                                                                                                                                            |
| `idempotentHint`  | Calling it again with the same input changes nothing | Every tool that reads except `query_connection`, and `update_playbook`, `retire_playbook`, `remove_connection`, `activate_license`, `update_definition`, `pause_definition`, `resume_definition`, `retire_definition`, `cancel_run`, `answer_interaction`, `resolve_comment` and `forget`                                                      |
| `openWorldHint`   | It reaches outside the runtime                       | `list_models`, `run_definition`, `create_definition` and `update_definition`, which reach model providers or ask the tool servers what they offer; `search`, `introspect`, `dry_run`, `list_connection_tools`, `query_connection` and `execute_connection`, which reach tool servers; `activate_license`, which reaches Auto's account service |

A client that honours the hints asks the person before it calls a tool marked destructive.

### Playbooks and models

These tools are listed on `/mcp` and the org endpoint. Their routes are relative to `/v1/orgs/{org}`.

| Tool              | HTTP operation                      | What it is for                                                                             |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `create_playbook` | `POST /playbooks`                   | Create a playbook, active and empty                                                        |
| `list_playbooks`  | `GET /playbooks`                    | List the playbooks the caller may access                                                   |
| `get_playbook`    | `GET /playbooks/{playbook}`         | Read a playbook, with the source of its page                                               |
| `update_playbook` | `PUT /playbooks/{playbook}`         | Change a playbook's name, description or page                                              |
| `retire_playbook` | `POST /playbooks/{playbook}/retire` | Retire a playbook for good                                                                 |
| `list_models`     | `GET /models`                       | List the models a reasoning function may name; see [Model information](#model-information) |

Each playbook `list_playbooks` returns holds every field of the playbook but its page, a retired one among them with `include_retired`; `get_playbook` adds the page's `source`, as `update_playbook` answers it. [Playbooks](http.md#playbooks) and [Models](http.md#models) give the fields, limits and refusals.

### The welcome of a new organization

`list_playbooks` of an organization with no playbook yet, active or retired, answers a caller who may make its first playbook, one who may act on every playbook of the org and holds `org:write`, a `welcome` beside the empty `playbooks`, which the agent relays to the person; over MCP the result's text is that welcome, whole, in place of the summary. It reads:

> This organization has no playbooks yet. A playbook keeps work your team can use again. Its workflows coordinate functions that reason, interact, predict and compute. Unless the person has already said what they want, ask what they want done, and offer three starts: set up a first playbook, connect a service they use, or hear what Auto can do for their team. In Studio, your team can review playbooks and run results. You can also manage workflows, connections, members and billing there.

It ends with the link to Studio's home, as [Links to Studio](http.md#links-to-studio) sets out. A caller who may only read, or who acts on some playbooks alone, is answered the empty list and no `welcome`, so it learns nothing more of the organization; and an organization that has a playbook answers no `welcome` to anyone.

### Definitions

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`, where `{type}` is the tool's `type` argument.

| Tool                | HTTP operation                           | What it is for                                                                                                                                          |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_definition` | `POST /definitions/{type}`               | Save a new function or workflow from its document, given as `source`, its `overview` and a function's `diagram`                                         |
| `list_definitions`  | `GET /definitions/{type}`                | List the definitions of one type, without their `overview`, `diagram` and `used_by`                                                                     |
| `get_definition`    | `GET /definitions/{type}/{name}`         | Read a definition, with its document, its `overview`, its `diagram`, `used_by`, and its page's `runs` and `standing`, or preview its page with `render` |
| `update_definition` | `PUT /definitions/{type}/{name}`         | Save a new version from a changed document, overview or diagram                                                                                         |
| `pause_definition`  | `POST /definitions/{type}/{name}/pause`  | Pause a definition, so that nothing starts a run of it until it is resumed, with an optional `reason`                                                   |
| `resume_definition` | `POST /definitions/{type}/{name}/resume` | Resume a paused definition, whose triggers start runs again from the first time or event after it                                                       |
| `retire_definition` | `POST /definitions/{type}/{name}/retire` | Retire a definition for good                                                                                                                            |

`create_definition` and `update_definition` take an `overview` beside `source`: Markdown for the person who runs the business, written from everything the agent knows of them and of the playbook, on why the definition exists, what it does and how it fits, in one to three short paragraphs. The agent writes it after the document and again with every update; one left out of an update stays as saved. A function's saves also take a `diagram`, every time: Mermaid source of a flowchart or a state diagram of how it works, or the word `none` when a picture would add nothing, so the agent always decides whether the function is drawn; a save without it is refused, and so is a workflow's with one, since Auto Studio draws a workflow from its steps. Auto Studio shows a function's diagram at full size in a column, so the agent draws it top to bottom, as `flowchart TD` or a state diagram, in three to eight nodes, each a few plain words for the person who runs the business rather than an expression or code. `get_definition`, `create_definition`, `update_definition`, `pause_definition`, `resume_definition` and `retire_definition` return both as written, and with them `used_by`, the definitions of the playbook, active or paused, that use this one, each with its `type`, its `name` and its `relation`, a workflow with the `steps` that call it, such as `{ "type": "workflow", "name": "weekly-build", "relation": "calls", "steps": [{ "number": 1, "name": "send" }] }`. [Reasoning functions](http.md#reasoning-functions) gives the rules every type of definition follows and each relation of `used_by`, and the section of each type adds its own. A definition's [page](page-format.md), which presents its results, is the `page` key of its document, written with the document and saved with it. Give every workflow and function one: a save without it is accepted, and its summary ends with `It has no page yet; the page guide says how to give it one.` where the summary has room for it, since a summary stops at 400 characters. `get_definition` with `render: true` renders it now, over an optional `sample_output`, as [The preview](page-format.md#the-preview) sets out.

### Runs

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool             | HTTP operation                        | What it is for                                                                                      |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `run_definition` | `POST /definitions/{type}/{name}/run` | Run a function or workflow once, with its `input` and an optional `run_id`                          |
| `get_run`        | `GET /runs/{run_id}`                  | Read a run, with its detailed `record`, its page's `result` and, for a run a step started, `within` |
| `list_runs`      | `GET /runs`                           | List the playbook's runs, newest first; `steps: false` leaves out those a step started              |
| `cancel_run`     | `POST /runs/{run_id}/cancel`          | Cancel a run that is still going                                                                    |
| `send_run_event` | `POST /runs/{run_id}/events`          | Deliver an event to a workflow run that is still `started`                                          |

`create_playbook` answers the playbook's page in Studio as `studio`, `create_definition` and `update_definition` the definition's, and `run_definition` its playbook's Ledger with the run chosen, so the agent gives the person the link without being asked; [Links to Studio](http.md#links-to-studio) says what each link opens.

[Runs and results](http.md#runs-and-results) covers input limits and which runs finish later, and [Retrying under a run id](http.md#retrying-under-a-run-id) what a request under an earlier run's id returns. [Cancelling a run](http.md#cancelling-a-run), [Sending an event to a run](http.md#sending-an-event-to-a-run) and [Run history and playbook events](http.md#run-history-and-playbook-events) give the rest.

### Requests

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool                 | HTTP operation               | What it is for                                                                                             |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_interactions`  | `GET /interactions`          | List the open requests of interaction functions, newest first                                              |
| `answer_interaction` | `POST /runs/{run_id}/answer` | Answer a request in the shape its `answer_schema` gives; the run that asked takes it within about a second |

[Interaction functions](http.md#interaction-functions) lists every field of a request and of an answer, and each refusal. [Answering a request](interaction-format.md#answering-a-request) explains how a run takes its answer.

`create_definition` and `update_definition` refuse an interaction function whose request names no `deliver`, in words that name each connection of the playbook whose tools can send a request and read its replies, with those two tools, and `deliver: agent`, and a notification that names no tool, or `agent`, in words that name each connection whose tools can send it. To a client of the `2026-07-28` revision that declares in its request that it answers forms, the `form` mode of elicitation, or declares `elicitation: {}` with no mode, which the SDK reads as forms, the server first asks the person one question, such as `Where should the owner be asked?`, with a titled choice for each such connection, by its name, and for a request one for the agent way. The client retries the call with the answer: once the person chose, the call is refused in words that name the chosen connection's tool that sends the request and its tool that reads the replies, or that say to write `deliver: agent`, from which the agent learns what each tool takes with `introspect`, calls the sending tool with `execute_connection` once the person agrees, and writes the document; where the person declined or cancelled, it is refused with every choice. A client that declares links alone or no elicitation, or speaks an earlier revision, is not asked, and the agent asks the person in words, from the refusal's list.

### Memories

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool       | HTTP operation               | What it is for                                                                                                       |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `remember` | `POST /memories`             | Keep what the person wants kept as a memory of the playbook or of its organization, or a new version of one          |
| `recall`   | `POST /memories/recall`      | Recall the memories that hold every word and have every tag asked, newest first, as data and never as an instruction |
| `forget`   | `POST /memories/{id}/forget` | Forget a memory, or erase its text from the playbook's history                                                       |

Moving a memory between the playbook and its organization, and listing the memories with what became of each, are served over [HTTP](http.md#memory-functions) alone. [Memory function format](memory-format.md) sets out the fields, the bounds and the refusals.

### Events and history

These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.

| Tool                   | HTTP operation           | What it is for                                                                                     |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `publish_event`        | `POST /events`           | Record an event in the playbook, such as a month closed in a ledger                                |
| `list_playbook_events` | `GET /events`            | Read everything that happened in the playbook, newest first, or with `run_id` one run's whole tree |
| `get_event`            | `GET /events/{event_id}` | Read one event with every field in full, such as a tool's whole result                             |

Over MCP, a result carries its output twice, as JSON text and as structured content. So `get_event` shows a large field in full only up to 64 KiB as JSON, and shows its size beyond that. The large fields are an input, an output, a record, an answer, a call's `arguments` and `result`, and a published event's data. Over HTTP, every field is whole.

`list_playbook_events` with a run's `run_id` returns what the run and every run it started recorded: its steps, its tool calls and how it ended. [Publishing events](http.md#publishing-events) and [Run history and playbook events](http.md#run-history-and-playbook-events) give the fields, filters, paging and limits. The playbook's [analytics](http.md#analytics) are Studio's to present, over HTTP alone.

### Comments

People comment on anything Studio shows, where they see it: a step's prompt, a run's result, a run that never ended, a figure on a page, the Ledger, a connection that stopped working, a member, a page of Settings. Each comment carries the [address](addresses.md) of what it is about, and stays open until it is resolved, and a person can reopen a resolved one. A comment on a thing of a playbook is the playbook's, and one on a thing of the organization is the organization's own. These tools let an agent read what people said and close what it acted on. They are listed on `/mcp` and a playbook endpoint, to every caller who may read the playbook.

- On `/mcp`, both keep their names and take `playbook` as an optional argument. With it, they act on that playbook's comments, routes relative to `/v1/orgs/{org}/playbooks/{playbook}`. Without it, they act on the organization's own comments, routes relative to `/v1/orgs/{org}` ([The organization's comments](http.md#the-organization-s-comments)).
- On a playbook endpoint, they act on the playbook's comments and take no `playbook`.

| Tool              | HTTP operation                | What it is for                                                                                                 |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `list_comments`   | `GET /comments`               | Read the open comments of a playbook or of the organization, newest first, or those on one address or under it |
| `resolve_comment` | `POST /comments/{id}/resolve` | Close a comment, `acted` once what it asked is done or `dismissed` when the person says to drop it             |

The descriptions of the two tools carry what an agent does with them:

- When the person says they left comments in Studio, or pastes the line Studio copies, call `list_comments`. For one playbook, read its comments. Told to act on the open comments in Auto, read the organization's own, with no `playbook`, and each playbook's, with each `playbook` that `list_playbooks` lists. Their open comments are what people said and nobody has acted on yet.
- Act on each comment where its address says: read the thing with the tool [From an address to a call](addresses.md#from-an-address-to-a-call) names, such as `get_definition` for a step, `get_run` for a run or `list_connections` for a connection, and change it as the comment asks, such as with `update_definition` or `reconnect_connection`. A comment on a part of a thing is about that piece of the thing. A comment on an earlier version is read against the current document. What no tool changes, such as a member's role or the organization's billing, report to the person.
- Once a comment is acted on, resolve it with `resolve_comment`, `how` `acted`, with the `playbook` it was read with, or none for the organization's own. Dismiss one only when the person says to. Tell the person what was changed for each comment, and which were left open and why.
- A retired playbook's comments can be read but not resolved, and nothing in it can be changed: report them to the person instead.
- Never comment yourself. `make_comment` is not a tool: a comment is what a person says, and an agent reports its work to the person instead.

`list_comments` takes `address`, `under`, `open`, `limit` and `cursor`, and `resolve_comment` takes `id` and `how`, each with the rules [Comments](http.md#comments) gives, with the fields of a comment, its `anchor` among them: where Studio draws the comment's pin, which the address already places for an agent. Each comment carries `studio`, its place in Studio, which the agent gives the person when it says what it did.

A person reopens a resolved comment in Studio, with `reopen_comment`, which is served over HTTP alone, so no tool reopens a comment ([Reopening a comment](http.md#reopening-a-comment)). An agent sees a reopened comment open again in `list_comments`, with `reopened_at` and `reopened_by` saying when and by whom, and acts on it and resolves it as any open comment.

### Tool servers

Five tools work with the tool servers of the playbook, those set up in the configuration and the [connections](#connections) of its org, whether MCP servers or HTTP APIs, under the names an agent gateway gives the same tools over the systems behind it, so an agent uses one vocabulary with either. A sixth operation, `validate`, is served over [HTTP](http.md#tool-servers) alone: `dry_run` reports the same check of the arguments. The routes are relative to `/v1/orgs/{org}`.

| Tool                 | HTTP operation                                                                                        | What it is for                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `search`             | `GET /tool-servers/search`, or on a playbook endpoint `GET /playbooks/{playbook}/tool-servers/search` | Find the servers and the tools a reasoning function may name in `tools`                           |
| `introspect`         | `GET /playbooks/{playbook}/tool-servers/{server}/tools/{tool}`                                        | Read one tool in full: its description, its arguments' schema, its hints and its mark             |
| `dry_run`            | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/dry-run`                               | See what `execute_connection` would check, without calling the tool                               |
| `query_connection`   | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/query`                                 | Call one tool marked `reads` by hand, live, as the playbook, to see what it returns               |
| `execute_connection` | `POST /playbooks/{playbook}/tool-servers/{server}/tools/{tool}/execute`                               | Call one tool by hand, live, as the playbook, whatever its mark, to see what it returns or to act |

- `search` is listed on every endpoint, and the other four on `/mcp` and a playbook endpoint.
- On `/mcp` and the org endpoint, `search` takes an optional `playbook`. Without it, `search` covers the whole org, so an agent can see what is set up before a playbook exists. On a playbook endpoint, `search` takes no `playbook`.
- `introspect` and `dry_run` change nothing and call no tool, but they ask the servers for their tool lists. So their hints say read-only and open-world, and a key that may read the playbook is offered them.
- Each tool carries its mark: `reads` when it only reads, `acts` when it may change something, and `unmarked` when nothing marks it, which counts as `acts`. `search` and `dry_run` answer it as `mark`, and `introspect` beside the hints its server gives, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` as it gives them, with `marked_by`: `server` for the hints its server lists it with, or the lack of them, `method` for the HTTP method of an operation of an HTTP API, `catalogue` for the entry of its provider, and `settings` for its entry in the [configuration](../self-host/configuration.md#the-mark-of-a-tool). `search` with `only: read` keeps the tools marked `reads`, and with `only: write` the others.
- `query_connection` and `execute_connection` need `playbook:write` whatever the tool does, so a key that may only read is offered neither. Each call is recorded in the playbook's history.
- `query_connection` calls only a tool marked `reads`, and refuses any other as `unavailable` of the kind `tool_not_read_only`, so it is marked read-only. `execute_connection` calls a tool whatever its mark, so it is marked destructive. Many of the tools they call belong to third parties: a connection's MCP server, a provider's API, or an HTTP API an operator set up. The runtime cannot always tell whether such a tool only reads or changes something. `search` with `only: read`, `introspect` and `dry_run` show a tool's mark without calling it.
- A call that names a server or a tool the playbook may not use is refused, and the refusal's words say what `search` shows.
- A connection is listed with `connection`, its id, and named by its name. One that is not ready is refused, and listed unavailable, with `because` `connection_pending` while nobody has approved it, `connection_broken` once its server answered `401`, its credential is gone from the secret store or is not the tokens of a consent, its consent was revoked or has ended, or its client is no longer registered, in words that say what mends it, most often `reconnect_connection`, `connection_not_allowed` when a rule of the operator no longer takes it, or `connection_unavailable` while its credential cannot be read just now, which a later call may find put right.
- Each server carries `provider`: the name of the provider a connection was added from or an entry of the configuration names, or `null` for a server given by hand.
- On `/mcp` and the org endpoint, to a caller who may add a connection, `search` also lists in `providers` the [providers](http.md#providers) a person may connect that no server serves yet, each with its `name`, `title` and `description`, found by `terms` as tools are. A provider none of whose ways is offered, as while a value whoever runs Auto sets for it is not set, is left out. An agent asked to connect a service, or for one no server serves, finds its provider there by the service's words and connects it with `add_connection`. A key, a caller who may only read and a runtime where nobody may add get no `providers`, and neither does `search` with `server`.
- When no server serves the playbook, the words of `search` say that whoever runs the server sets one up. Where people may add connections, they also say that a person adds one, or, where `search` lists a provider, that a person connects a provider it lists.

[Tool servers](http.md#tool-servers) gives the fields, limits and refusals of all six.

### Connections

A connection is a tool server that a person adds to the org through their agent, a provider by its name or a server given by hand, which every playbook of the org may use, or the playbooks its entry names. These tools are listed on `/mcp` and the org endpoint. Their routes are relative to `/v1/orgs/{org}`.

| Tool                    | HTTP operation                | What it is for                                                                                                                                           |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_connection`        | `POST /connections`           | Add a provider or a tool server to the org, pending, and answer the link that approves it                                                                |
| `list_connections`      | `GET /connections`            | List the org's connections, newest first, whether each is pending or connected, and what each may still be granted                                       |
| `list_connection_tools` | `GET /connections/{id}/tools` | List the tools one connection's server offers now, by name, each with its title, its whole description, its hints and its mark                           |
| `reconnect_connection`  | `POST /connections/{id}/link` | Give a connection that is broken, or whose link ran out, a new link on which the person gives its credential or signs in again, or a link that asks more |
| `remove_connection`     | `DELETE /connections/{id}`    | Remove a connection for good, which forgets its credential                                                                                               |

- A connection is added by a person: where the runtime signs people in, `add_connection` refuses a key, and a runtime of API keys alone, which signs nobody in, refuses every connection, since no person could approve it.
- The agent adds a connection without its credential: an entry that holds a value that looks like a credential, or a reference such as `${CRM_API_KEY}`, is refused. The person approves the connection, and gives its credential where it takes one, on Studio's page, which `connect.url` of the answer opens within 24 hours.
- `add_connection` puts the link in its answer to the call that adds the connection. To a client of the `2026-07-28` revision that declares in its request that it opens links, the `url` form of elicitation, it also asks for the link to be opened, with a message that says what to do. The client opens the page or declines, and retries the call, which never adds a second connection and answers the connection as it stands then: `connected`, with no `connect`, in words that say nothing is left to open, once the person approved it; `pending` with its link while the link lasts, as when the person continued without approving it, in words that also say the person declined to open the page where the client declined or cancelled; `pending` with no `connect` once the link has expired, in words that say to reconnect it for a new link; the connection with `link_replaced`, and no `connect`, where a newer link that is still open replaced the one offered, in words that say the person opens the newest and that reconnecting it would replace that one too; and `removed`, in words that say nothing is connected, where the person cancelled on the page. A retry by another caller, or in another org, is refused, and the connection stays added. A client of an earlier revision, whose requests carry no capabilities on this stateless server, is not asked; it shows the person the link from the answer, whose words say to show it as a link named `Approve the <title> connection` with its provider's title, or `Approve the connection` for a server given by hand, never as its address.
- `add_connection` takes one of two inputs. For a provider: `provider`, its name; `placeholders`, the value of each placeholder it takes; and, where they are wanted, `name`, the provider's when left out, `credential` with its `kind` alone, since a provider offers one way of each kind, and when it is left out the first way `list_providers` marks offered, or the provider's first where it offers none, and `entry` with `playbooks`, `allowed` and `record_content` alone. The provider gives the rest, and `type`, the server in `entry` and the other fields of `credential` are refused. For a server given by hand: `name`, the name a function gives the server; `type`, `mcp` for a remote MCP server or `openapi` for an HTTP API; `entry`, the server without its credential; and `credential`, which the agent leaves out for an MCP server, since the server says how it authenticates, and gives for an HTTP API, or for an MCP server whose answer says it names no way of its own; with no `placeholders`.
- With `provider`, `credential` may also be `{ kind: authorization, oauth_client: own }`, where the person connects under the organization's own OAuth client, a client the organization registers with the provider, which bills and limits it, rather than the client Auto or whoever runs it has there: the person gives its client ID and client secret on the page before signing in, and the runtime keeps the secret sealed and starts the consent with that client. A way whose `oauth_client` is `required` in `list_providers`, as the way says or since no client here covers it, takes the organization's own OAuth client with `oauth_client` left out. `oauth_client` beside another kind, or without `provider`, is refused at `/credential/oauth_client`. [A connection under the organization's own OAuth client](../self-host/connections.md#a-connection-under-the-organization-s-own-oauth-client) sets it out.
- A provider the runtime does not have is refused at `/provider`, in words that say `search` lists the providers a person may connect, a placeholder or a value refused at `/placeholders/<name>`, and what the checks of an entry find in what the provider resolved at `/provider`.
- The credential is one object: its `kind` and the fields that kind takes, `variable`, `name` and `in` for `reference`, `name` and `in` for `secret`, each with an optional `scheme` such as `Bearer` where `in` is `header`, which the runtime writes before the value, and `issuer`, an optional `client_id` and an optional `scope` for `client_credentials`. A `client_id` left out is given by the person on Studio's page, with the secret or the key. The kind `authorization` names a way by which the person signs in at an authorization server and allows Auto: it is taken with `provider`, as the kind of its way, and, for an MCP server given by hand, from the server itself. As such a server is added, and before anything is recorded, the runtime asks it once how it authenticates, with one request that carries no token, and reads the protected resource metadata it names: where that metadata names an authorization server the runtime takes, the connection records `authorization` with that server as its issuer, whether the agent left the credential out or gave `authorization` with its `kind` alone, and a `none`, `secret` or `reference` is refused at `/credential/kind`, in words that name the authorization server and say to leave the credential out, while `client_credentials` stand; where the server names none, the kind the agent gave stands, and a credential left out is refused at `/credential`, in words that say the server names no way of its own and ask how its credential is sent; and a server that does not answer, or whose host the operator's rules refuse, is refused whatever the kind. An HTTP API given by hand is refused `authorization`. A field its kind lacks or does not take is refused as `invalid_input` at that field.
- Once connected, a connection is a tool server of the org: a function names it by its name as `name/tool`, `list_connection_tools` lists its tools, and `search`, `introspect`, `dry_run`, `query_connection` and `execute_connection` reach it, as [Tool servers](#tool-servers) describes.
- A link is gone after its 24 hours. `reconnect_connection` gives the connection a new one, as it gives one to a connection that is broken or to a connected one whose credential the person replaces, so the person gives its credential or signs in again on Studio's page; nothing else of the connection changes. The new link replaces the one before, open or not, and the token of the one before is answered in words that say a newer link replaced it. It answers as `add_connection` does, asking a client that opens links to open it, and refuses a removed connection, which is added again instead. A broken connection of a `reference` takes no link: the runtime finds its variable set and connects it again at once, or refuses it while the variable is not set, since it reads its variables when it starts. Where people sign in, only the person who added the connection reconnects it.
- `list_connections` answers each connection with `more`, the groups of scopes its provider's way names that it does not hold yet and a client set up here can ask, each `{ name, for }`, `for` what the group is for in the person's words, as `Change and delete files you already have.` for `edit` of `google-drive`. `reconnect_connection` given `more`, a group's name, gives a connection that is pending, connected or broken a link whose consent asks the scopes the connection asked that it was granted with the group's, so the person allows more and keeps what they allowed before; a connected connection stays connected as it is until the person finishes. A group the way does not name is refused as `invalid_input` at `/more`, and one the connection holds already or no client set up here covers as `conflict`. A plain link asks the scopes the credential asks with those the connection asked since and was granted, so a group allowed once is kept.
- `list_connection_tools` asks the connection's server for its tools when it is called and answers those its entry allows, sorted by name, a page at a time with `limit` and `cursor`: each tool's `name`, its `title` where the server gives one, its `description` whole up to 4 KiB, `hints`, the server's `destructiveHint`, `idempotentHint` and `openWorldHint` as it gives them, left out where it gives none of them, and its `mark` and `marked_by`, as [Tool servers](#tool-servers) sets out, the mark taking the place of the read-only hint. A connection that is not connected, or whose server cannot be reached, is refused as `unavailable` with the `kind`, the `because` and the words `search` gives it, and an id the org has no connection of, or one removed, as `not_found`.
- Each connection answers `asked_scopes`, which grow by a group's scopes as a consent that asks more starts, and `granted_scopes`, each scope with `says`, the sentence of its provider's way or of the group that says what the connection can do through it, or `null` where the way says nothing of it, as for a server given by hand, and `broken`, `{ kind, detail, at }` while it is broken: the kind of the break, the runtime's words and when it broke.
- `add_connection`, `reconnect_connection` and `remove_connection` need `org:write`, and `list_connections` and `list_connection_tools` need `org:read`. `get_connection`, which reads one connection by its id, is served over HTTP alone; `list_connections` shows whether the person approved a connection, in the `status` of each.

[Connections](http.md#connections) gives the fields, limits and refusals, and [Let people add connections](../self-host/connections.md) the flow and the rules the operator sets.

### License

`activate_license` activates the license of the whole runtime with the key Studio gives, `alk.<org>.<runtime id>.<secret>`, the HTTP operation `POST /license`. It is listed on `/mcp` and the org endpoint to a caller who may change the org, and answers where the runtime stands, as `GET /license` does, saying it in words. A key Auto does not know, or one for another runtime, is refused as `license_invalid`. [License](http.md#license) gives the rest, and [Activate the key](../self-host/licenses.md#activate-the-key) the other ways to give a runtime its key.

## Guides and prompts

`get_guide` returns one of the runtime's guides in full, by its name. Every endpoint serves the same guides. It also lists them as Markdown resources, `guide://<name>`, for clients that let a person or a model read them directly. Over HTTP, [`GET /v1/guides/{guide}`](http.md#the-openapi-document-the-guides-and-the-api-catalog) serves the same text.

| Guide                                                                                                                                                                   | Contains                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `terminology`                                                                                                                                                           | What the words of a playbook mean, for the types of function the runtime runs                                                  |
| `reasoning-function`, `lookup-function`, `memory-function`, `interaction-function`, `prediction-function`, `computation-function`, `generation-function` and `workflow` | The reference page of each format, as the documentation publishes it. `reasoning-function` ends with what this runtime offers  |
| `templates`                                                                                                                                                             | The filters every template may use, from [Templates](template.md)                                                              |
| `page`                                                                                                                                                                  | The [page format](page-format.md), with what the page of each type shows. A runtime that keeps no pages serves no `page` guide |
| `first-playbook`, `remember`, `give-tools` and `schedule`                                                                                                               | Recipes for common tasks, listed below                                                                                         |

Two prompts, listed first, are for a person who does not yet know what to ask. Each is offered only where the connection lists every tool it asks for: `get-started` where `create_playbook`, `create_definition` and `run_definition` all are, so on `/mcp` alone, and `connect-a-service` where `add_connection` is, on `/mcp` and the org endpoint. A playbook endpoint offers neither, and a key that may only read gets neither. Each answers one message from the person, with nothing embedded:

| Prompt              | Title                 | Arguments                                                                  | The message                                                                                                                                                                              |
| ------------------- | --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get-started`       | Get started with Auto | None                                                                       | Create a playbook in Auto with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio. |
| `connect-a-service` | Connect a service     | `service`, required: the service to connect, such as Slack or Google Drive | Connect {service} to Auto for my team, then tell me what it can do.                                                                                                                      |

A `connect-a-service` asked without `service` is the JSON-RPC error `-32602`, which names the argument.

The recipes are also prompts, listed after those two. A connection offers a recipe's prompt only when it lists every tool the recipe's steps call, and the description of `get_guide` names the same recipes. So a playbook endpoint offers no `first-playbook`, the org endpoint offers none, and a key that may only read gets none.

| Prompt           | Title                                | Arguments                            | What the recipe does                                                                                                                                                    |
| ---------------- | ------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first-playbook` | Create your first playbook           | None                                 | Creates a playbook with a first reasoning function, runs it once the person agrees, and saves and runs the workflow that does what the person asked, each with its page |
| `remember`       | Make the playbook remember something | `what` to remember                   | Keeps what the person wants kept as memories of the playbook or of its organization, which the playbook and its workflows recall later                                  |
| `give-tools`     | Give the playbook tools              | Optional `server`, a tool server     | Gives a reasoning function the tools of a tool server the playbook may use                                                                                              |
| `schedule`       | Run a workflow on a schedule         | The `workflow`, and `when` to run it | Starts a workflow on a schedule or on an event, and reads how its runs went                                                                                             |

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

| Field               | Contents                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| `content[0].text`   | A plain-language summary of what was done, or the words the agent relays, whole |
| `content[1].text`   | The operation's output as JSON text, for clients that do not read the next one  |
| `structuredContent` | The same output as structured content                                           |

Read `structuredContent`. The first text block is not JSON. No tool advertises an output schema, so a client should use `structuredContent` as it comes rather than validate it against a schema.

- A run's result is the run: its run id, definition version and status, its output when it succeeded, and, for a run a workflow's step started, `within`, which names the workflow run and the step. `get_run` adds the detailed record and, where the run's definition has a page, `page.result`, the run as that page shows it.
- A run that finishes later, such as a workflow's, is `started` when `run_definition` returns; [Runs and results](http.md#runs-and-results) says which runs do and how to read them again.
- The summary repeats a short result in words, and points to `structuredContent` for a long one. It takes at most 400 characters.
- Where the output holds words for the agent to relay, as the [welcome](#the-welcome-of-a-new-organization) of `list_playbooks` does, the first text block is those words, whole up to 1,000 characters.
- A review that recommends Revise still belongs to a succeeded run: the operation completed and produced that recommendation.

These summaries were recorded from a two-step review-and-approval workflow on a self-hosted runtime. Its approval step uses the [example interaction function](interaction-format.md#a-function-document). Only the review's words come from a scripted model:

```text
create_definition: Created the interaction function “approve-campaign-brief”. What it does: Asks the campaign owner, in the team chat, to approve a reviewed brief. It has been saved but has not been run yet.
create_definition: Created the workflow “review-and-approve”. What it does: Reviews a campaign brief, then asks its owner to approve it. It has been saved but has not been run yet. It has no page yet; the page guide says how to give it one.
run_definition: The workflow “review-and-approve” has started and is still running. It carries on by itself, and how it ends can be looked up later.
get_run: The workflow “review-and-approve” is still running; how it ends can be looked up again later.
list_interactions: Found 1 request waiting on this page.
answer_interaction: The request is answered: the run that asked it takes the answer within the host's sweep, a second by default, and get_run shows how it ended.
get_run: The run of the workflow “review-and-approve” finished. Its result: review: “Revise: the audience lacks a job role.” and approval: (verdict: “approve” and note: “Approved for the autumn launch.”)
list_playbook_events: Found 19 events of the run asked for in this playbook, oldest first, each with its fact and its metadata.
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
- A run the runtime's meter refuses, as `license_required`, `license_invalid`, `credits_exhausted` or `account_closed`, has the problem's `resolve_at`, the page where a person resolves it, which the first block points the agent to, and `runtime_id`, the runtime's id, as [The refusals of the meter](http.md#the-refusals-of-the-meter) sets out.

Some failures come before a tool runs, outside any tool result:

- Authentication and origin checks can reject a request with an HTTP problem document.
- Protocol failures return JSON-RPC errors. A call to a tool the connection does not list returns `-32602`.

[Responses and errors](http.md#responses-and-errors) lists the status codes, problem reasons and kinds. [Function availability](../concepts/functions.md#availability) says which function types the runtime runs.
