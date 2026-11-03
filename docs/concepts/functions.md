# Functions

A function is one reusable piece of your team's method, saved in a playbook. It defines what goes in, what comes out and what happens in between. A run carries it out once with particular inputs. Your agent can call a function directly, and the same function can be a step in several workflows.

Each function has one of seven types, described below. Workflows coordinate functions around the way your business works; coordination is a capability of its own, not an eighth function type. [Terminology](terminology.md) defines these words.

## Choose a function type

| Type        | Use it to                                          | Example                                              |
| ----------- | -------------------------------------------------- | ---------------------------------------------------- |
| Reasoning   | Interpret, judge or write with a language model    | Review a campaign brief against your team's criteria |
| Lookup      | Read what another system holds right now           | Read a campaign's figures from the reporting tool    |
| Memory      | Remember what the playbook learns, and recall it   | Keep who approves budgets, and recall it when asked  |
| Interaction | Ask a person or a system, and take the answer      | Ask the brief's owner to approve the review          |
| Prediction  | Predict a quantity from the playbook's own history | Forecast next week's sign-ups in each region         |
| Computation | Calculate or transform data exactly, with code     | Total a campaign's spend and its pace against budget |
| Generation  | Produce an image or audio from a prompt            | Make a picture of a product for its listing          |

Choose a type by the function's job, not by how it does it. A function that reads what another system holds right now is lookup, and one that asks a system to do something is interaction. A function whose job is to forecast is prediction, even though its forecaster runs as code. Prompts, tools and models support functions, but they are not function types; [Terminology](terminology.md#supporting-assets) defines them.

Real work often combines types. A budget review might compute the totals, reason about the options and then ask a person to approve. A workflow puts those steps in order; [Workflows and runs](workflows.md) explains how.

## Availability

Hosted Auto runs reasoning, lookup, memory, interaction, prediction, computation and generation functions, and workflows. Pages present their results. Your agent can list the definition types available through its connection.

The self-hosted runtime runs every function type, whether you start it with npx or with Docker. So reasoning, lookup, memory, interaction, prediction and computation functions are available, and generation functions once a model gateway is set in `MODEL_GATEWAYS`. Workflows are available and coordinate the functions above, and pages present the results of both. Tool access is available wherever the runtime's operator has set up tool servers. There is nothing to turn on.

These are planned and not available yet:

- Dream, an optional process that would revisit a playbook's history and suggest ideas worth testing. It would not be a function type.
- Skill references in a reasoning function, and a separately managed tool library.
- Starting one workflow run from several events that belong together.

## Reasoning

A reasoning function gives a language model a piece of work: interpret information, judge it against criteria, classify it or write a response. Its prompt holds the instructions and frames the input.

For example, "Review campaign brief" checks a brief against your team's criteria and recommends Ready or Revise. Each run fills the prompt with one brief, asks the model, and records the answer and the model's usage. The [first-playbook tutorial](../tutorials/first-playbook.md) builds it.

Choose reasoning when the work needs judgment or language. Leave exact arithmetic to a computation function. A reasoning function does not remember earlier runs, so give it what it needs as input. It can also use tools, as [described below](#tool-access-inside-a-reasoning-function).

- [Give a function tools](../guides/tools.md) adds a tool to a reasoning function.
- [Reasoning function format](../reference/reasoning-format.md) describes the document.

## Lookup

A lookup function obtains information that already exists outside the playbook, through one tool that only reads: the replies of a thread, a contact's record, this week's figures from a reporting tool. A run calls the tool once and returns the part of its result the function points at, at once.

Choose lookup when the playbook needs what another system holds right now. A lookup function interprets nothing and changes nothing: it asks no model, and it calls only a tool marked `reads`, so running it again is always safe. A reasoning function then interprets what it read.

- [Lookup function format](../reference/lookup-format.md) describes the document and the mark its tool needs.

## Memory

A memory function works the playbook's memory: it remembers what the playbook learns, or recalls what it kept. A memory is one text with its tags, kept by the playbook or by its organization, which every playbook of the organization recalls from. A recall answers the memories that hold the words and the tags it asks, newest first. Your agent does the same with the tools `remember`, `recall` and `forget`, so what the person wants kept goes there rather than into the agent's own notes.

For example, a workflow that reviews a budget recalls what the organization keeps of who approves budgets, and gives it to a reasoning function. When the person corrects a rule, your agent remembers the new one in place of the old.

Choose memory for facts, decisions and preferences that later work should have in front of it. A memory function calls no model and reaches nothing outside the runtime. To answer from the playbook's recorded runs and events instead, use a recall function.

- [Make a playbook remember](../guides/remember.md) shows how to keep and recall memories.
- [Memory function format](../reference/memory-format.md) describes the document, the operations and the bounds, and [Terminology](terminology.md#memory) defines its words.

## Interaction

An interaction function exchanges information between the playbook and people or other systems. It can ask for an approval, send a notification, collect details from a person or have another system do something.

It asks a system and takes the result straight back, or it asks a person and waits. A request reaches the person through a connection they chose, such as a chat message or an email, or is held for an agent they answer through, and their answer becomes the run's result. For example, once a brief is reviewed, an interaction function asks its owner to approve the review.

Choose interaction when a person must decide or supply something, or when another system must act. An interaction function does not interpret anything: no model reads the answer.

- [Interaction function format](../reference/interaction-format.md) describes the document, and [Terminology](terminology.md#interaction) defines request, delivery and answer.

## Prediction

A prediction function predicts a number over time from the playbook's own history. For example, it can forecast each region's orders next week, or their total to the end of the quarter. Each prediction is a series: the last periods observed, and each period ahead as a likely value with a low and a high.

The built-in forecaster works as soon as the saved function has enough history. It tests simple methods against earlier periods, uses the first supported method, and estimates a range from its past errors. The [forecaster reference](../reference/prediction-format.md#the-forecaster) explains the methods and how they are tested.

The prediction function is the definition you save. Its dataset holds the relevant playbook history, and each run returns a prediction from that data.

Choose prediction for a numeric question that comes back again and again, such as weekly sign-ups, and that past figures can answer. A prediction function uses no language model.

- [Forecast with a prediction function](../guides/forecast.md) shows how to forecast from your own playbook's events.
- [Prediction function format](../reference/prediction-format.md) describes the document and the forecaster, and [Terminology](terminology.md#prediction) defines its words.

## Computation

A computation function runs code you define to calculate or transform data. It gives the same output for the same input every time, unless the code reads the clock, which returns the moment the run started ([The sandbox](../reference/computation-format.md#the-sandbox) has the details). The work need not be mathematics: reshaping data counts too.

For example, a workflow fetches a campaign's figures with a lookup function. A computation function then totals the spend and works out the pace exactly. Finally a reasoning function writes about the numbers.

Choose computation for arithmetic a language model should not do, and for any change to data that must come out the same every time. A computation function reaches nothing outside the playbook and calls no model. Your agent can write the code with you; once saved, the function runs that code as written.

- [Calculate with a computation function](../guides/computation.md) shows how to write and save one.
- [Computation function format](../reference/computation-format.md) describes the document.

## Generation

A generation function produces an asset, an image or audio, from a prompt. A model the runtime reaches through a model gateway makes it, and the playbook keeps the asset until it expires, 90 days unless the function or the runtime says otherwise.

For example, a workflow writes a product's description with a reasoning function, then a generation function makes a picture of the product from it. The run answers a reference to the picture: its id, its size and an address it can be read at for a few minutes. Another generation function can take that id as a reference, to place the same product in a new scene.

Choose generation when the result is a picture or spoken words. Writing the text is reasoning's work. A generation function reaches outside the playbook, and each run asks the model again, so a second run of it makes a second asset.

- [Generation function format](../reference/generation-format.md) describes the document, the models and the limits.

## Tool access inside a reasoning function

A reasoning function can call the tools of tool servers that the runtime's operator configures. A tool server is a service Auto can reach for a playbook, such as an MCP server or an HTTP API. The function names the tools it may use. During a run, the model can call them and read the results before it writes its answer. The run's history records each call.

Your agent's tools are not the function's tools. Connecting an external agent to Auto does not give the function access to that agent's tools, credentials or accounts. Your agent can still gather evidence through its own accounts and pass it in as input.

The person who runs Auto decides which tool servers each playbook may use. A tool server can itself be a gateway, such as Apollo GraphOS Agent Services, that fronts an organization's systems and applies its own policies. Auto's model gateways connect to language models and provide no tools. Skill references and a separately managed tool library are still planned.

- [Give a function tools](../guides/tools.md) walks through finding a tool, trying it and naming it in a function.
- [Reasoning function format](../reference/reasoning-format.md#tools) gives the rules for a run that calls tools, including when it is not run again.
- The [MCP reference](../reference/mcp.md) covers the connection your agent uses to reach Auto.

## Pages

A page presents the results of a workflow, a function or the whole playbook. Studio, a chat and an agent can show the same page. A page is rendered when someone reads it; it does not run as a function.

The page can show one run or summarize results over time, with charts.

For example, a page of the workflow that drafts the morning's social posts lists each run's posts with a link to each, and charts the posts of each day and of each channel since the workflow began.

Give every workflow and function a page, written in its document and saved with it, so the person sees the value of its work: what each run achieved, and what the runs add up to. A definition can be saved without one, and you can add it later.

- [Page format](../reference/page-format.md) describes the document, its templates, its views and its charts, and what the page of each type shows.
