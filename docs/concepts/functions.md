# Functions

A function is one reusable piece of your team's method, saved in a playbook. It defines what goes in, what comes out and what happens in between. A run carries it out once with particular inputs. Your agent can call a function directly, and the same function can be a step in several workflows.

Each function has one of five types, described below. Workflows coordinate functions around the way your business works; coordination is a capability of its own, not a sixth function type. [Terminology](terminology.md) defines these words.

## Choose a function type

| Type        | Use it to                                                       | Example                                              |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Reasoning   | Interpret, judge or write with a language model                 | Review a campaign brief against your team's criteria |
| Interaction | Ask a person or a system, and take the answer                   | Ask the brief's owner to approve the review          |
| Prediction  | Predict a quantity from the playbook's history or uploaded rows | Forecast next week's sign-ups in each region         |
| Recall      | Look up what the playbook has already recorded                  | Bring back the last reviews of one campaign          |
| Computation | Calculate or transform data exactly, with code                  | Total a campaign's spend and its pace against budget |

Choose a type by the function's job, not by how it does it. A function that looks up what the playbook has already recorded is recall. A function that asks another system for what it holds right now is interaction, even when it only reads. A function whose job is to forecast is prediction, even though its model runs as code. Prompts, tools and models support functions, but they are not function types; [Terminology](terminology.md#supporting-assets) defines them.

Real work often combines types. A budget review might recall the last decisions, compute the totals, reason about the options and then ask a person to approve. A workflow puts those steps in order; [Workflows and runs](workflows.md) explains how.

## Availability

Hosted Auto runs reasoning, interaction, computation and recall functions, and workflows. An interaction function there asks a person in Studio's inbox or through a tool of one of the org's connections, and asks a system through such a tool. Your agent lists the definition types its connection supports.

The self-hosted runtime runs every function type, whether you start it with npx or with Docker. So reasoning, interaction, prediction, recall and computation functions are available. Workflows are available and coordinate the functions above. Tool access is available wherever the runtime's operator has set up tool servers. There is nothing to turn on.

These are planned and not available yet:

- Dream, an optional process that would revisit a playbook's history and suggest ideas worth testing. It would not be a function type.
- Skill references in a reasoning function, and a separately managed tool library.
- Recall over documents and other sources beyond the playbook's own history.
- Starting one workflow run from several events that belong together.

## Reasoning

A reasoning function gives a language model a piece of work: interpret information, judge it against criteria, classify it or write a response. Its prompt holds the instructions and frames the input.

For example, "Review campaign brief" checks a brief against your team's criteria and recommends Ready or Revise. Each run fills the prompt with one brief, asks the model, and records the answer and the model's usage. The [first-playbook tutorial](../tutorials/first-playbook.md) builds it.

Choose reasoning when the work needs judgment or language. Leave exact arithmetic to a computation function. A reasoning function does not remember earlier runs, so give it what it needs as input, or look it up first with a recall function. It can also use tools, as [described below](#tool-access-inside-a-reasoning-function).

- [Give a function tools](../guides/tools.md) adds a tool to a reasoning function.
- [Reasoning function format](../reference/reasoning-format.md) describes the document.

## Interaction

An interaction function exchanges information between the playbook and people or other systems. It can ask for an approval, send a notification, collect details from a person or ask another system what it holds right now.

It asks a system and takes the result straight back, or it asks a person and waits. A request reaches the person in the playbook's inbox or through a tool, such as a chat message, and their answer becomes the run's result. For example, once a brief is reviewed, an interaction function asks its owner to approve the review.

Choose interaction when a person must decide or supply something, or when the playbook needs what another system holds right now. An interaction function does not interpret anything: no model reads the answer.

- [Interaction function format](../reference/interaction-format.md) describes the document, and [Terminology](terminology.md#interaction) defines request, inbox and answer.

## Prediction

A prediction function predicts a number over time from the playbook's history, or from rows you upload. For example, it can forecast each region's orders next week, or their total to the end of the quarter. Each prediction is a series: the last periods observed, and each period ahead as a likely value with a low and a high.

The model behind it is one of the runtime's own, which a build fits from the playbook's data when no trainer is named, or one trained outside the playbook, by a person or an agent that can run code. The playbook tests each candidate model on periods it was not fitted on, and keeps the best of those that do better than simple baselines. Before any model is kept, the function answers from the runtime's default forecast. So keep three things apart: the prediction function you define, the predictive model it holds, and the prediction a run gives back.

Choose prediction for a numeric question that comes back again and again, such as weekly sign-ups, and that past figures can answer. A prediction function uses no language model.

- [Forecast with a prediction function](../guides/forecast.md) shows how to forecast from your own playbook, and [Developer example: forecast sign-ups](../tutorials/first-forecast.md) builds one with supplied data.
- [Prediction function format](../reference/prediction-format.md) describes the document and how a model is built, and [Terminology](terminology.md#prediction) defines its words.

## Recall

A recall function looks up what the playbook has already recorded, so a later run can use what earlier runs decided. It keeps a view: a running summary of the events it cares about, which it updates as the playbook records each one. A run reads the view as it stands, within milliseconds.

For example, a recall function can keep every review that "Review campaign brief" wrote. A workflow recalls the last reviews of one campaign and passes them to the reasoning function, so the next review knows what the last one said.

Choose recall when a later run needs what earlier runs found or decided. Today a recall function reads only the playbook's own history; [History and events](history-and-dream.md) describes what that history holds.

- [Make a playbook remember](../guides/remember.md) shows how to add a recall function to a playbook.
- [Recall function format](../reference/recall-format.md) describes the document.

## Computation

A computation function runs code you define to calculate or transform data. It gives the same output for the same input every time, unless the code reads the clock, which returns the moment the run started ([The sandbox](../reference/computation-format.md#the-sandbox) has the details). The work need not be mathematics: reshaping data counts too.

For example, a workflow fetches a campaign's figures with an interaction function. A computation function then totals the spend and works out the pace exactly. Finally a reasoning function writes about the numbers.

Choose computation for arithmetic a language model should not do, and for any change to data that must come out the same every time. A computation function reaches nothing outside the playbook and calls no model. Your agent can write the code with you; once saved, the function runs that code as written.

- [Calculate with a computation function](../guides/computation.md) shows how to write and save one.
- [Computation function format](../reference/computation-format.md) describes the document.

## Tool access inside a reasoning function

A reasoning function can call the tools of tool servers that the runtime's operator configures. A tool server is a service Auto can reach for a playbook, such as an MCP server or an HTTP API. The function names the tools it may use. During a run, the model can call them and read the results before it writes its answer. The run's history records each call.

Your agent's tools are not the function's tools. Connecting an external agent to Auto does not give the function access to that agent's tools, credentials or accounts. Your agent can still gather evidence through its own accounts and pass it in as input.

The person who runs Auto decides which tool servers each playbook may use. A tool server can itself be a gateway, such as Apollo GraphOS Agent Services, that fronts an organization's systems and applies its own policies. Auto's model gateways connect to language models and provide no tools. Skill references and a separately managed tool library are still planned.

- [Give a function tools](../guides/tools.md) walks through finding a tool, trying it and naming it in a function.
- [Reasoning function format](../reference/reasoning-format.md#tools) gives the rules for a run that calls tools, including when it is not run again.
- The [MCP reference](../reference/mcp.md) covers the connection your agent uses to reach Auto.
