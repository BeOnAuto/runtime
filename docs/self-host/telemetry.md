# Send telemetry

The ledger records what happened in a playbook. With telemetry on, the server also exports how it happened. It sends three kinds of signal over OTLP, the OpenTelemetry protocol, to any OpenTelemetry collector or backend:

- a trace of every request, run and outbound call: a tree of timed steps called spans;
- metrics of the server, its models, its tools and its runs;
- logs, including one record for each event the ledger keeps.

Telemetry is off until you name where it goes. Until then the server exports no telemetry.

By default, telemetry exports identifiers and operational metadata, but no content:

- It exports the ids of orgs, playbooks, callers, runs and definitions, and the names of functions, tools and models. It also exports event types, outcomes, token counts, sizes and timings.
- It leaves out prompts, instructions and model answers, the arguments and results of tool calls, and the data of events.

`TELEMETRY_CONTENT=true` adds that content. [What is recorded](#what-is-recorded) has the details.

## Turn it on

Point the server at your collector's OTLP/HTTP receiver:

```bash
echo 'OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.internal:4318' >> auto-runtime.env
```

At start the server logs `Telemetry is on, exported over OTLP`. The line names:

- the service;
- where traces, metrics and logs go, as an origin and a protocol;
- whether content is recorded.

It never logs the headers. A setting it cannot read stops it at start, naming the setting and what it expects.

## Settings

| Variable                                                                                                        | Default                 | Purpose                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                                   | none                    | The base URL of the collector, `http` or `https`. Traces go to `/v1/traces` under it, metrics to `/v1/metrics` and logs to `/v1/logs`                                                                                                   |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | none                    | The URL of one kind of signal, used as given. A kind with neither this nor the base URL is not exported. With no kind exported, telemetry is off                                                                                        |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, and the same for each kind, such as `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`         | `http/protobuf`         | `http/protobuf` or `http/json`. The server exports over HTTP only, so `grpc` stops it at start                                                                                                                                          |
| `OTEL_EXPORTER_OTLP_HEADERS`, and the same for each kind                                                        | none                    | Headers sent with every export, such as a backend's API key, as `name=value` pairs separated by commas. The server never logs them                                                                                                      |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`                                           | `otlp`                  | `none` leaves that kind out                                                                                                                                                                                                             |
| `OTEL_SERVICE_NAME`                                                                                             | `auto-runtime`          | The `service.name` of everything the server exports                                                                                                                                                                                     |
| `OTEL_RESOURCE_ATTRIBUTES`                                                                                      | none                    | Attributes added to everything the server exports, as `name=value` pairs separated by commas, such as `deployment.environment.name=production`                                                                                          |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`                                                                | `parentbased_always_on` | Which traces are kept: `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off` or `parentbased_traceidratio`. The argument is the ratio kept, from 0 to 1                                          |
| `OTEL_METRIC_EXPORT_INTERVAL`                                                                                   | `60000`                 | Milliseconds between exports of metrics, from 1,000 to 3,600,000                                                                                                                                                                        |
| `OTEL_SDK_DISABLED`                                                                                             | `false`                 | `true` turns telemetry off, whatever else is set                                                                                                                                                                                        |
| `TELEMETRY_CONTENT`                                                                                             | `false`                 | `true` adds content: what was sent to models and what they returned, and the data of each event on its log record, cut to 2,048 characters. Identifiers and metadata are exported either way. See [What is recorded](#what-is-recorded) |

More rules:

- The settings are read from the environment only.
- The exporters also read `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_CERTIFICATE`, `OTEL_EXPORTER_OTLP_CLIENT_KEY` and `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`, and the same for each kind, from the server's environment.
- As it stops, the server waits at most a second for what it has left to send. A collector that cannot be reached does not hold up a restart.
- Each server process names itself with a `service.instance.id` of its own, so several servers sharing a database are told apart.

## Traces

A request is a trace:

- Its span is named for the method and the route, such as `POST /v1/orgs/:org/playbooks/:playbook/definitions/:type/:name/run`.
- Its response carries the trace's id in the `x-trace-id` header.
- A request with a W3C `traceparent` header continues the caller's trace.
- A tool an agent calls over MCP is a `tools/call <tool>` span beneath the request that carried the call. It is linked to the agent's trace when the call carries `traceparent` in its `_meta`.
- `GET /health` is not traced.
- Its `url.full` carries the token of a connection's link, the segment after `/connections/<id>/link/`, as `REDACTED`, so a link that is still open never reaches the collector.

Beneath the request:

| Span                                                  | What it is                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The operation, such as `run_definition` or `get_run`  | The work the request asked for, with `auto.on.org`, `auto.on.playbook`, `auto.on.caller` and `auto.on.outcome`. A rejection adds `error.type` and the rejection's `kind` and `because`                      |
| `eventStore.appendToStream`, `eventStore.readStream`  | The ledger's appends and reads. An append names the run in `auto.on.run_id`, and its chain in `messaging.message.correlation_id` and `messaging.message.causation_id`                                       |
| `invoke_agent <model>`, `step <n>`, `chat <model>`    | Each call of its model a reasoning function's run makes, the one round of it, and each request to the provider. They carry the provider, the model, the tokens and why it finished                          |
| `execute_tool <tool>`                                 | A tool the model called, made by the run between its model calls. Where its tool server is reached over HTTP, the HTTP request is beneath it                                                                |
| `tools/call <tool>`                                   | A tool of an MCP server called once, for an interaction function or for `execute`. It names the tool server and how the call ended                                                                          |
| `POST`, `GET` and the other methods                   | Each HTTP request the server sends, to a model provider, a gateway or a tool server. Every value of its query is replaced by `REDACTED`                                                                     |
| `S3.GetObject`, `S3.PutObject` and the other commands | Each request to the bucket of the [object store](object-storage.md), naming the bucket and never a key                                                                                                      |
| `program <kind>`, `model <kind>`                      | A job of the server's workers, or of a prediction function's model process, with how it ended. A job is, for example, a computation, a recall function's answer, a fold of views or a check of a definition |

### Workflow spans

A workflow adds its own spans:

- Each input that a run takes is a span named for its kind, with `auto.on.run_id`. The kinds are `started`, `timer_fired`, `call_answered`, `event_received`, `event_offered` and `cancel_requested`.
- A call the workflow makes is `call <function>`, beneath the input that made it.
- Beneath the call are the run of the function and the input that brings back its result. Beneath that input is the `settle` that records the end of the workflow's run.

So a workflow started by a request is one trace, from the request to the end of everything it calls without waiting.

A run is never one long trace:

- An input that comes later begins a trace of its own. Examples are a timer that fires, an event a run listened for, or a call that completes after a wait.
- Every span of the workflow names its run in `auto.on.run_id`, so a search on it finds a run's spans across its traces.
- A record that starts a workflow through a trigger, or reaches a listener, is a `follow <type>` span. It is linked to the trace of the request that recorded it.
- A start that waited for a later minute is a `deferred_start` span, with the same link.

### From a run's history to its trace

The events the playbook keeps record the trace and the span of the append that recorded them: `trace_id` and `span_id` in their [metadata](../reference/http.md#run-history-and-playbook-events). So a row of a run's history leads to its trace. A trace that was not sampled has real ids, which your backend never received.

## Metrics

| Metric                                                                                                                            | What it measures                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `http.server.request.duration`, `http.server.active_requests`                                                                     | The requests the server handles, by method, route and status                                                              |
| `http.client.request.duration`                                                                                                    | The HTTP requests the server sends                                                                                        |
| `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`                                                                   | Each call of a model, by provider and model, with the kind of failure of a call that failed; the tokens sent and received |
| `mcp.client.operation.duration`                                                                                                   | Each tool of an MCP server called once, by tool and tool server, with how a call that failed ended                        |
| `auto.on.runs.ended`                                                                                                              | The runs that ended, by the type of their definition and by outcome: `succeeded`, `rejected` or `failed`                  |
| `auto.on.pool.job.duration`                                                                                                       | The jobs of the server's workers, by kind and by how each ended                                                           |
| `emmett.event.appending.count`, `emmett.stream.appending.duration`, `emmett.stream.reading.duration` and the event store's others | The ledger's appends and reads                                                                                            |
| `nodejs.eventloop.delay.*`, `nodejs.eventloop.utilization`, `v8js.gc.duration`, `v8js.memory.heap.*`                              | The Node.js process: its event loop, its garbage collection and its heap                                                  |

## Logs

Every line the server logs is also a log record over OTLP. Where it was logged within a trace and a span, the record carries them.

Every event the ledger appends is a log record too:

- It comes from the logger `@on.auto/ledger`.
- It is named for the event's type, such as `run_started` or `tool_call_answered`, and its line is that type.
- It carries the trace of its append, and the attributes below, each where the event has it.

| Attribute                                                                          | Contents                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `auto.on.type`                                                                     | The event's type, also kept as an attribute for backends that do not keep a record's name  |
| `auto.on.stream`, `auto.on.position`, `auto.on.message_id`                         | Where the event is kept and its id, as its `metadata` shows them                           |
| `auto.on.by`, `auto.on.run_id`                                                     | Who acted, and the run the event belongs to                                                |
| `auto.on.definition.type`, `auto.on.definition.name`, `auto.on.definition.version` | The definition of the run                                                                  |
| `auto.on.depth`, `auto.on.call_depth`, `auto.on.trigger.kind`                      | How the run was started: reactions above it, calls above it, and the kind of its trigger   |
| `auto.on.correlation_id`, `auto.on.causation_id`                                   | The run at the top of the event's chain, and the event that led to it                      |
| `auto.on.data_bytes`                                                               | The size of the event's data as JSON                                                       |
| `auto.on.data`                                                                     | The event's data as JSON, cut to 2,048 characters, only when `TELEMETRY_CONTENT` is `true` |

In Loki, for example, `{service_name="auto-runtime"} | auto_on_type="run_failed"` lists the runs that failed, each with the trace it failed in.

The records are sent in batches, and may be lost when the collector is down. The ledger stays the record.

## What is recorded

Telemetry always exports operational data. It exports content only when `TELEMETRY_CONTENT` is `true`.

Exported whatever `TELEMETRY_CONTENT` is:

- the org, playbook and caller of each operation, how it ended, and a rejection's `kind` and `because`;
- run ids, definition types, names and versions, and the correlation and causation ids that chain events;
- event types, stream positions, message ids and trigger kinds;
- the names of the functions a workflow calls, of tools and tool servers, and of model providers and models;
- token counts, why a model call finished, the size of each event's data, durations, statuses and request ids;
- every line the server logs, as it writes it to stderr.

Left out unless `TELEMETRY_CONTENT` is `true`:

- the prompt, instructions and messages sent to a model, and what the model returned;
- the arguments and results of the tools a model called;
- the data of each event.

Each caller appears under its recorded name, such as `person:<subject>` for a signed-in person ([The name recorded for a signed-in person](../reference/authentication.md#the-name-recorded-for-a-signed-in-person)). So send telemetry only to a collector you trust with the names of your orgs, playbooks, functions and callers.

Never recorded, whatever `TELEMETRY_CONTENT` is:

- headers;
- the query values of the URLs the server calls, each replaced by `REDACTED`;
- the token of a connection's link in the URL of a request, replaced by `REDACTED`;
- the keys of objects in [object storage](object-storage.md), which is named by its bucket alone;
- the arguments and results of a tool of an MCP server called once, for an interaction function or for `execute`. Its span names the tool and how the call ended.

With `TELEMETRY_CONTENT=true`, the spans of model calls carry what was sent and returned, with the arguments and results of the tools the model called. Each event's log record carries its data in `auto.on.data`, cut to 2,048 characters. Turn it on only for a collector whose readers may read the playbooks.

### The trace the server passes on

The server hands the trace to what it calls:

- a `traceparent` header on its HTTP requests to model providers, gateways and tool servers;
- `traceparent` in the `_meta` of every call of a tool of an MCP server.

The ids are random and carry nothing else. Under the default sampler, a caller that sends a sampled `traceparent` decides that the trace is kept. Set `OTEL_TRACES_SAMPLER=traceidratio` to keep a share of traces whatever callers send.

## Try it with Grafana

The [`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) image runs a collector with Tempo, Loki, Prometheus and Grafana in one container. That is enough to look at the telemetry of a server on your machine.

Run these in the folder from [Run with Docker](docker.md): its `.env` names the release you run, and its `auto-runtime.env` holds your settings. The first line stops and removes the container `auto-runtime` from that guide, since it holds the name and port `5555`.

```bash
docker stop auto-runtime && docker rm auto-runtime
docker network create auto-telemetry
docker run --detach --name lgtm --network auto-telemetry --publish 127.0.0.1:3000:3000 grafana/otel-lgtm
. ./.env
docker run --detach --name auto-runtime --network auto-telemetry --publish 127.0.0.1:5555:5555 \
  --env-file auto-runtime.env \
  --env OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 \
  --volume auto-runtime-data:/data "$IMAGE"
```

Open Grafana at `http://localhost:3000`, then **Explore**:

- Tempo holds the traces.
- Loki holds the logs, with the ledger's events under the service `auto-runtime`.
- Prometheus holds the metrics, with dots in their names turned into underscores, such as `http_server_request_duration_seconds`.
