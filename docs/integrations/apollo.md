---
description: Bring data from your Apollo graph into a playbook, passed in by your agent or read by a function through GraphOS Agent Services.
---

# Use Auto with Apollo

Use data from your Apollo graph in a playbook's reasoning functions, either by having your agent pass it in or by letting a function call the graph itself.

## Choose a path

There are two ways to bring graph data into a function. They use different Apollo services and different credentials, so pick one before you start.

| Path                                                              | Who connects to Apollo                                               | Use it when                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Pass graph evidence in](#pass-graph-evidence-into-a-function)    | Your agent, through Apollo MCP Server, beside its connection to Auto | You want to check the evidence yourself before a function runs        |
| [Let the function call the graph](#let-a-function-call-the-graph) | Auto, through Apollo GraphOS Agent Services added as a tool server   | The function runs without you, such as in a workflow or on a schedule |

In the first path, the function only sees the values your agent passes in. It does not inherit your agent's graph connection, query history or other context. In the second, the function calls the graph through an Auto connection, with a key of its own that is separate from any your agent holds. Auto does not require Apollo for either.

## Before you start

- Your agent is connected to Auto. The [quick start](../get-started/cloud.md) sets this up.
- You have a playbook with a reasoning function to give the data to, or you are about to write one. [Reasoning function format](../reference/reasoning-format.md) describes the document.
- You may read the data you need through your graph.
- For the second path, you have the remote MCP address and application API key from Apollo GraphOS Agent Services, and may connect it to your Auto organization.

Decide which data the function needs, and confirm that it may be sent to Auto and to the function's model provider. A function's inputs and results become part of its recorded run. So do the graph's answers to a function's tool calls, unless the tool server's entry turns `record_content` off.

## Pass graph evidence into a function

Your agent connects to Auto and to Apollo separately. It retrieves the evidence it is allowed to read and passes it to the function as input.

### 1. Connect the business graph

[Apollo MCP Server](https://www.apollographql.com/docs/apollo-mcp-server) exposes GraphQL operations as tools an agent can call. Follow its setup guide, and add that connection to the same agent that uses Auto. Limit it to the operations this task needs.

[GraphOS MCP Server](https://www.apollographql.com/docs/graphos/platform/graphos-mcp-server/install) is a different service. It provides GraphOS management and documentation tools, and does not by itself give an agent access to business data. Choose the connection that exposes the operations your function needs.

Keep credentials in the connection settings, never in function prompts or inputs. The graph and Auto authorize access separately.

Check that your agent lists the graph's operations beside Auto's tools.

### 2. Check the function's inputs

Ask your agent to read your reasoning function and show its required inputs. Then pick an approved graph query that supplies the evidence.

For a budget review, that might be the campaign's spend to date and its agreed budget. The real query and field names depend on your graph. Have the agent inspect the available tools and the graph's schema, the types and fields it offers, rather than invent a query from this example.

Check that each required input has a field in the query that supplies it.

### 3. Retrieve and inspect the evidence

Ask the agent to run the approved read-only query and show the figures it retrieved. Check the campaign, the reporting period and the units. Resolve missing or inconsistent data before you run the function.

Do not grant write access to complete a read-only trial.

### 4. Run the function

Ask the agent to map the evidence onto the function's declared inputs, and to show you that mapping before it calls Auto:

```text
Use the approved <name of the graph query> for this review. Show me the
reporting period, the figures and any missing evidence. Map those values to the
inputs of the "<function name>" function in my "<playbook name>" playbook.
After I confirm the mapping, run the function and show me its recorded result.
Do not change anything in the graph.
```

The function receives the values you confirmed, and nothing else from the agent's connection.

### 5. Verify the recorded run

Have the agent read the run from Auto and show its run id (the id Auto gave this run), the version of the function it used, its recorded prompt and its output. `get_run` returns the prompt with the inputs filled in, as the function's template rendered it, within the run record's size limits. The run's history, from `list_playbook_events` given its `run_id`, shows the input it was given on its `run_started` event, and `get_event` reads that event whole.

Check that the prompt contains the evidence you approved, and that the result covers what you asked for.

## Let a function call the graph

Apollo GraphOS Agent Services fronts the systems your organization connected to it and applies its own policies to the application whose key Auto uses. Connect its remote MCP server to Auto, then follow [Give a function tools](../guides/tools.md) to use it.

### 1. Connect the graph to Auto

Get an application API key from Apollo for the application that should serve your playbook. Keep the key out of the conversation. Ask your agent:

```text
Add an MCP connection named graph to my Auto organization, using
<the remote MCP address Apollo gave me>. It authenticates with a bearer
API key. Show me the connection page so I can enter the key there.
```

Open the Studio link your agent gives you, review the request and enter the key. The connection should show as connected. It belongs to your organization; give individual functions only the tools they need.

If Auto refuses the address or the connection type, ask your agent to show the reason. [Contact Auto](https://on.auto/contact-us) if the service needs configuration you cannot change.

### 2. Find the operations

Ask your agent to call Auto's `search` for your playbook. Agent Services offers tools that search for operations and run them, so a function finds the operation it needs while it runs. Have the agent use `introspect` on a tool before a function relies on it.

Check that `search` lists the server `graph` with the tools Agent Services offers.

### 3. Name the graph in a function

A reasoning function that lists `graph/*` in its `tools` may call every tool of that server that the entry allows; the `*` stands for all of them. During a run it can search for operations and run those the application's policies allow. Ask your agent to add `graph/*` to your function's `tools`, or to save a function such as this one. If your model provider is not Anthropic, ask your agent to use one of your provider's models.

::: details The function's document

```markdown
---
description: Reviews a campaign's spend against its agreed budget, reading both from the graph
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      campaign: { type: string }
      period: { type: string }
    required: [campaign, period]
tools: [graph/*]
---

{% system %}Use the graph tools to read the campaign's spend for the period and its agreed budget. Search for the operations you need before you call one. Report the figures with their units, say which figures you could not read and why, and recommend whether the spend is within budget. Do not invent figures.{% endsystem %}
Campaign: {{ input.campaign }}
Period: {{ input.period }}
```

:::

### 4. Run it and read the calls

Ask your agent to run the function and read the run's history.

Check that each call to the graph appears there, with the tool, its arguments and its answer. A field the policy denies comes back to the model as a tool error, which it can explain in its answer.

## If something goes wrong

- **A required input is missing.** Compare the function's input schema with the mapping your agent made.
- **A graph operation is not available to your agent.** Check which Apollo server the agent is connected to and the permissions of that connection before you change the function.
- **`search` does not show `graph`, or shows it as unavailable.** Check that the entry's `org` and `playbooks` cover the playbook, and the key in `.env`. `key_refused` means Apollo did not accept the key. [Add a tool server](../self-host/tool-servers.md#if-something-goes-wrong) lists the other causes.
- **The function's answer says a field was denied.** The application's policy in Apollo refused it. Change the policy in Apollo, not the function.

## Next

- [Give a function tools](../guides/tools.md) covers finding a tool, trying it with `execute` and checking a run's tool calls.
- [Add a tool server](../self-host/tool-servers.md) covers adding any tool server, for whoever runs Auto.
- [Reasoning function format](../reference/reasoning-format.md#tools) has the rules and limits of `tools`.
- The [configuration reference](../self-host/configuration.md#tool-servers) lists every field of a tool server entry.
- [Calculate with a computation function](../guides/computation.md) totals figures such as a campaign's spend exactly, before a reasoning function writes about them.
