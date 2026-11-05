# Create and run a playbook over HTTP

Start the runtime using the [local quick start](../get-started/self-hosted.md), without `PUBLIC_URL` or `API_KEYS` in `.env`. These examples use local mode and need `curl` and `jq`. Use an API key and your own org id outside local mode.

Everything an assistant does over MCP is also an operation over HTTP. In local mode every org is open; the playbooks an assistant makes on `/mcp` belong to the org `local`, so these commands use it. Create a playbook, list the org's playbooks, and read one back:

```bash
curl --request POST http://localhost:5555/v1/orgs/local/playbooks \
  --header 'content-type: application/json' \
  --data '{"playbook":"sales","name":"Sales","description":"Answers questions about the pipeline"}'
curl http://localhost:5555/v1/orgs/local/playbooks
curl http://localhost:5555/v1/orgs/local/playbooks/sales
```

`PUT /v1/orgs/local/playbooks/sales` replaces the name and the description, and `POST /v1/orgs/local/playbooks/sales/retire` retires the playbook. `POST /v1/orgs/local/playbooks/sales/restore` brings it back.

A playbook has reusable function and workflow definitions, stored as named, versioned definitions. A reasoning function calls a language model, with the key from your `.env`. Write its definition in `greeting.md`: YAML front matter that names the model, then a Liquid template that renders the prompt from the input. The front matter also holds its page, which shows each greeting and lists the latest ones.

<!-- prettier-ignore -->
````markdown
---
description: Greets a customer
model: anthropic/claude-sonnet-4-5
input:
  schema: { type: object, properties: { name: { type: string } }, required: [name] }
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: reasoning/greeting
    views:
      latest: table
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const greeting = fieldOf(event.data, 'output');
        const day = event.time?.slice(0, 10);
        if (typeof greeting !== 'string' || day === undefined) return view;
        const rows = [[day, greeting.slice(0, 500)], ...(view.latest?.rows ?? [])].slice(0, 10);
        return { latest: { columns: [{ name: 'Day' }, { name: 'Greeting' }], rows } };
      }
  result: |
    {{ output | clip: 500 }}
  runs: |
    ```chart table
    {{ views.latest | json }}
    ```
---

{% system %}You write one warm sentence.{% endsystem %}
Greet {{ input.name }}, whose order shipped today, {{ today }}.
````

Create the reasoning function in the playbook, with a `diagram` of `none`, since a greeting needs no picture. Run it, and read the run back with the record of the call: the rendered prompt, the model, the tokens it used and how long it took. The run also carries the greeting as its page shows it, `page.result`.

```bash
jq --null-input --rawfile source greeting.md '{name: "greeting", source: $source, diagram: "none"}' |
  curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/reasoning \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/reasoning/greeting/run \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
curl http://localhost:5555/v1/orgs/local/playbooks/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

A document with a problem is rejected with every problem and its line. An input that does not match the schema is rejected before any model is called. A provider that is not configured answers `503`; its missing settings are reported to the operator, not exposed to the caller. [Reasoning function format](reasoning-format.md) describes the document and recorded result. [HTTP API](../../reference/http.md) describes the operations. An assistant does the same over [MCP](mcp.md), where tool descriptions explain the supported definition formats.

A workflow coordinates function calls and control steps, including branches, waits and event listeners. The server runs it durably and keeps its history in the ledger. Write `welcome.yaml`, a workflow that runs the greeting above, then waits for the customer's reply. Its page heads each run with the reply, and charts the customers who replied each day:

<!-- prettier-ignore -->
````yaml
document:
  dsl: '1.0.3'
  namespace: acme
  name: welcome
  version: '1.0.0'
  summary: Greets a customer, then waits for their reply.
do:
  - greet:
      call: run_definition
      with:
        type: reasoning
        name: greeting
        input:
          name: ${ $data.name }
      output:
        as: '${ ({ greeting: $data }) }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '${ ({ ...$input, reply: $data[0] }) }'
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: workflow/welcome
    views:
      replied: series
    module: |
      export function fold(view: View, event: Event): View {
        const day = event.time?.slice(0, 10);
        if (day === undefined) return view;
        const points = view.replied?.lines[0]?.points ?? [];
        const last = points.at(-1);
        const at = last !== undefined && last.at > day ? last.at : day;
        const counted = last?.at === at ? [...points.slice(0, -1), { at, value: last.value + 1 }] : [...points, { at, value: 1 }];
        return { replied: { unit: 'customers', period: 'day', lines: [{ name: 'Customers who replied', points: counted.slice(-90) }] } };
      }
  result: |
    {% if run.status == "started" %}
    Greeted the customer, and waiting for their reply.
    {% else %}
    The customer replied: {{ output.reply | json | clip: 200 }}

    {{ output.greeting | clip: 500 }}
    {% endif %}
  runs: |
    ```chart line
    {{ views.replied | json }}
    ```
````

Create it, execute it, and send it the event it waits for:

```bash
jq --null-input --rawfile source welcome.yaml '{name: "welcome", source: $source}' |
  curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/workflow \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/workflow/welcome/run \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b"}'
curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/events \
  --header 'content-type: application/json' \
  --data '{"event":{"type":"com.acme.customer.replied","data":"Thank you!"}}'
curl http://localhost:5555/v1/orgs/local/playbooks/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b
```

Starting the workflow answers `started` at once; the run reads `started` until the workflow ends, and then `succeeded` with `{"greeting": ..., "reply": "Thank you!"}`. The greeting has its own recorded run under an id derived from the workflow's run, made by the caller who started the workflow. Its `within` names the workflow's run and the step, `do/0/greet`. The public [workflow format](../../reference/workflow-format.md) describes the supported steps, and the repository-only [workflow run notes](workflow-format.md) how they run.
