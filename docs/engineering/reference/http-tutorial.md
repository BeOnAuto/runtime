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

`PUT /v1/orgs/local/playbooks/sales` replaces the name and the description, and `POST /v1/orgs/local/playbooks/sales/retire` retires the playbook for good.

A playbook has reusable function and workflow definitions, stored as named, versioned definitions. A reasoning function calls a language model, with the key from your `.env`. Write its definition in `greeting.md`: YAML front matter that names the model, then a Liquid template that renders the prompt from the input.

```markdown
---
description: Greets a customer
model: anthropic/claude-sonnet-4-5
input:
  schema: { type: object, properties: { name: { type: string } }, required: [name] }
---

{% system %}You write one warm sentence.{% endsystem %}
Greet {{ input.name }}, whose order shipped today, {{ today }}.
```

Create the reasoning function in the playbook, run it, and read the run back with the record of the call: the rendered prompt, the model, the tokens it used and how long it took.

```bash
jq --null-input --rawfile source greeting.md '{name: "greeting", source: $source}' |
  curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/reasoning \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:5555/v1/orgs/local/playbooks/sales/definitions/reasoning/greeting/run \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
curl http://localhost:5555/v1/orgs/local/playbooks/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

A document with a problem is rejected with every problem and its line. An input that does not match the schema is rejected before any model is called. A provider that is not configured answers `503`; its missing settings are reported to the operator, not exposed to the caller. [Reasoning function format](reasoning-format.md) describes the document and recorded result. [HTTP API](../../reference/http.md) describes the operations. An assistant does the same over [MCP](mcp.md), where tool descriptions explain the supported definition formats.

A workflow coordinates function calls and control steps, including branches, waits and event listeners. The server runs it durably and keeps its history in the ledger. Write `welcome.yaml`, a workflow that runs the greeting above, then waits for the customer's reply:

```yaml
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
```

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

Starting the workflow answers `started` at once; the run reads `started` until the workflow ends, and then `succeeded` with `{"greeting": ..., "reply": "Thank you!"}`. The greeting has its own recorded run under an id derived from the workflow's run, made by the caller who started the workflow. The public [workflow format](../../reference/workflow-format.md) describes the supported steps, and the repository-only [workflow run notes](workflow-format.md) how they run.
