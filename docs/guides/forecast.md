---
description: Set up a prediction function in your own playbook with an agent that runs code. Choose its data, give the trainer a key, train and review a model, and ask for a forecast.
---

# Forecast with a prediction function

A prediction function forecasts a number for one series at a time, such as next month's orders in one region, from a model trained on your data. This guide sets one up in a playbook you already have. Each step says what to ask your agent and what you should see.

This guide is for developers and technical readers, and for anyone whose agent runs code in a terminal, as Claude Code and Codex do. Training a model needs such an agent, or a person who runs the code. The trainer reads your data and uploads its models over Auto's HTTP routes, web addresses it calls directly; Auto's MCP tools do neither. An agent that only calls Auto's tools, such as Claude Desktop, cannot upload data or train a model. It can still find a build, answer its request and ask for forecasts once a model is active.

[Developer example: forecast sign-ups](../tutorials/first-forecast.md) runs a forecast on sample data, with the runtime's own models. [Prediction function format](../reference/prediction-format.md) holds every field and rule.

## Before you start

- Your agent is connected to Auto with permission to change your playbook (`playbook:write`). It runs terminal commands on a machine that reaches Auto over HTTP and has, or can install, the libraries it trains with.
- You know the number to forecast and how many periods ahead you will ask. A period is a day, a week, a month, a quarter or a year.
- You can restart Auto to give the trainer a key, or you can ask whoever runs it to. An Auto in [local mode](../self-host/security.md#local-mode) needs no key.

A prediction function calls no language model. Until a model version is active, it answers from the runtime's default forecast, and a build of a function that names no trainer fits [the runtime's own models](../reference/prediction-format.md#the-runtime-s-own-models) from your data. A trainer fits models of its own outside the playbook and uploads them. The playbook scores them, keeps the best as a model version and forecasts with that version. [How a prediction function learns](../reference/prediction-format.md#how-a-prediction-function-learns) sets out each stage.

Two kinds of version appear on this page. The function's document has versions, like any definition, counted from 1 each time it is saved. Its models have versions of their own, counted from 1 each time a build keeps one. A forecast comes from the active model version, or from the default forecast before one is active.

## 1. Choose where the data comes from

A function learns from one of two sources:

- The playbook's history, when the playbook records an event for each thing you count, such as `order.placed`, with a time and its series. New events join the data as the playbook records them, so each build trains on the latest periods.
- An uploaded dataset, when the history is short or the numbers live elsewhere, such as in a spreadsheet or a warehouse export. You upload a CSV file, which never changes. To train on newer rows, you upload a new file.

Ask your agent:

```text
I want to forecast <the number, such as orders> for each <series, such as
region>, <how many> <periods> ahead, in my "<playbook name>" playbook. Does
its history record an event for each <thing counted>, with its time and its
<series>, over enough periods to train on? If not, I will upload a CSV file.
```

You should see the agent name the events it found, or say that you should upload a file. A model needs enough periods to train on and to be scored on, and [Bounds](../reference/prediction-format.md#bounds) says how many. A playbook without that much history can start from an upload.

[The dataset](../reference/prediction-format.md#the-dataset) has the fields for history, and [An uploaded dataset](../reference/prediction-format.md#an-uploaded-dataset) has the file format.

## 2. Give the trainer a key {#arrange-a-trainer}

The trainer calls Auto's HTTP routes. So it needs your org id, which the routes name, and an API key that may read and write the playbook. Your agent's own sign-in stays inside its connection, so a script in a terminal cannot use it. On an Auto in [local mode](../self-host/security.md#local-mode), which is how Auto runs on your own computer unless you set `PUBLIC_URL`, the org is `local` and calls need no key, so skip this step. Adding a key would turn local mode off.

Ask your agent:

```text
Find the org id that my "<playbook name>" playbook belongs to. Then write out
the command that makes an API key for that org, which may read and write only
this playbook. Do not run it.
```

Run the command yourself, in a terminal. It prints the key, which is a secret, so keep it out of your agent's conversation. Add the entry it prints to `API_KEYS` and restart Auto, as [API keys](../self-host/security.md#api-keys) describes.

Then give the key to your agent's terminal as the variable `AUTO_KEY`: set it in the shell you start your agent from, and start the agent again. Never paste the key into a prompt.

::: details The key command

The command, with your org id and the playbook's id in place of `<org>` and `<playbook>`:

```bash
npx @on.auto/runtime key --org <org> --permissions playbook:read,playbook:write --playbooks <playbook>
```

The trainer reads the brief and the rows with `playbook:read`, and uploads with `playbook:write`. [Find the org and playbook ids](../self-host/tool-servers.md#find-the-org-and-playbook-ids) says where your org id shows.

:::

## 3. Save the function and train a model

With `AUTO_KEY` set, or on an Auto in local mode, one prompt does the rest. Your agent finds the org, uploads your file and drafts the function. Once you approve it, the agent starts a build and trains a model. Ask:

```text
In my "<playbook name>" playbook, set up a prediction function named
"<function name>" and train its first model. Read Auto's guide to prediction
functions first, and send the key in AUTO_KEY with every HTTP call.
1. Find the org id the playbook belongs to.
2. If the data is in a file, upload <file>.csv to the playbook as a dataset,
   and show me the figures Auto read from it.
3. Draft the function. It forecasts <the number> per <period> for each
   <series>, <how many> periods ahead, from <the events, or the file>. Hold
   back the last <n> periods to score models. Show me the document and explain
   each setting before saving it.
4. Once I approve it, start a build and act as its trainer in a terminal. Read
   the brief and the training rows, fit a model as the brief says, write it in
   a format the brief lists, upload it, and answer the build's request with the
   candidates, a recipe and their limitations.
```

Settle the choices in the draft with whoever owns the forecast. The agent stops to show you the draft, and then reports on the build.

### Check the data

For an upload, you should see how many rows, series and periods Auto read, and the first and last period. The agent names the upload in the function's `data.dataset` by its SHA-256, a fingerprint of the file's exact contents. [An uploaded dataset](../reference/prediction-format.md#an-uploaded-dataset) has the file format and the route, and the [developer example](../tutorials/first-forecast.md) shows the upload command.

### Check the document

You should see a document with its settings at the top, as YAML front matter between `---` lines, followed by the brief: the text a trainer reads first. Check that the target, the period, the horizons and the holdout are the ones you meant.

::: details What the document settles

- `predicts`: the `target`, its `period`, its `horizons` (how many periods ahead a question may ask) and its `unit`. Name a `season` when the numbers repeat, such as 52 for weeks over a year. For a total to the end of a period, name `accumulates` in place of `horizons`.
- `data`: the source you chose in step 1, and the `window` of periods a model trains on.
- `evaluation`: the `holdout`, the last periods held back to score candidates, and `activate`. Use `automatic`, or `{ approved: <interaction function> }` to have a person approve each model version.
- `source`: `expires`, how long a build waits for its trainer, and where its request goes. By default it waits in the inbox for the party `trainer`. `to` names another party, and `through` names an interaction function that sends the request where the trainer works. Leave `source` out and a build asks no trainer: it fits the runtime's own models from the rows.
- `rules`: what the trainer must follow, one line each.
- The brief: what the trainer needs to know that the rows do not say, such as what the target means and what a good model must not do.

[A function document](../reference/prediction-format.md#a-function-document) shows a full example. [Fields](../reference/prediction-format.md#fields) lists every field, including the optional `metric`, `coverage_floor`, `confidence`, `baselines` and `shadow_periods`.

:::

Approve it, and the agent saves it with `create_definition`, under a name of lowercase words joined by hyphens, which it uses in later steps. A save that breaks a rule is refused at its line, and nothing is saved.

The function is saved at version 1 of its document. It forecasts at once, from the default forecast, until a build makes a model version and that version is activated.

### Check the build and the training

A build asks the trainer for models and keeps the best as the function's next model version. The agent starts one by running the function with the input `{ "build": {} }`, as a schedule or a workflow step would. You should see the run `started`, waiting for its trainer for at most `source.expires`, and a request for the trainer. By default the request waits in the playbook's inbox for the party `trainer`. It names the build's run id and the routes the trainer calls, and ends with the brief.

The agent then trains. You should see it report each candidate it uploaded, and that it answered the request. The playbook then scores each candidate, which takes a few seconds.

The trainer can also be a person, or another agent with a key of its own. Then leave the training out of step 4 of the prompt, and the request waits for them where `source` sends it. [The trainer's path](../reference/prediction-format.md#the-trainer-s-path) sets out what a trainer does. A function that names no trainer needs none of this step: its build fits the runtime's own models, as the developer example shows.

## 4. Review the model version

Ask:

```text
Show me how the build of the "<function name>" function ended, the new model
version's card and its scores against the baselines, and which model version is
active.
```

You should see the build's output, `{ version, winner, candidates }`. `version` is the new model version, or null when no candidate won. Each candidate has a `verdict`: `won`, `scored`, or why it was disqualified.

The **card** is the model version's record of how it was built and scored: the `version_built` event on the function's models stream, `models/<name>`, which `list_playbook_events` lists. For each horizon, check three figures:

- The model's error, under `scores`, is lower than each baseline's, under `baselines`.
- Its `coverage` is at least 0.7, the default `coverage_floor`.
- Its `p_better` against each baseline, under `against`, is at least 0.9, the default `confidence`.

Every figure describes the held-back periods alone, not how the model will do on periods to come. [How a candidate is scored](../reference/prediction-format.md#how-a-candidate-is-scored) defines each figure.

How the model version becomes active depends on `evaluation.activate`:

- With `automatic`, it activates on its own once it passes. A later model version may first run a shadow, as [Keep it current](#keep-it-current) describes.
- With `{ approved: <interaction function> }`, that function asks a person. The model version activates when the answer's `decision` is `approve`.
- By hand, whatever its shadow or approver decided. Ask your agent to activate it from a terminal, with the key in `AUTO_KEY`. Activating an earlier model version again rolls back. [Activating a version](../reference/prediction-format.md#activating-a-version) has the route and the rules.

`get_definition` shows where the function stands. `standing.models` holds the active model version, the latest one and any challenger in its shadow. `standing.build` holds any build not yet settled.

## 5. Ask for a forecast

Ask:

```text
Ask the "<function name>" function in my "<playbook name>" playbook for
<series>'s <number> <how many> <periods> ahead.
```

The agent runs the function with a question, such as `{ "series": "north", "horizon": 1 }`, and the run returns the forecast at once. Without `horizon`, it forecasts every horizon the function names. The forecast is a series, which Auto Studio draws on the run's page. Read it like this:

- `origin` is the last observed period.
- The `observed` line holds the last periods of the data up to the origin, twice the longest horizon unless the document's `predicts.history` says how many.
- The `predicted` line holds a point for each period forecast. Its `value` is the likely value, the model's 50th percentile.
- Its `low` and `high` are the 10th and 90th percentiles. The true value should fall between them about eight times in ten.
- The run's record holds `version`, the model version that made the forecast, not the version of the function's document, and `coverage`, always 0.8, the share of truths such an interval should hold. The card's `coverage` says how often it held on the held-back periods. Before a model version is active, `version` is null, `runtime` is `series` and `default_forecast` is true: [the default forecast](../reference/prediction-format.md#the-default-forecast) answered.

A question also gives a value for each feature the document names under `given`, and a function that predicts a total to the end of a period takes no horizon; [A question](../reference/prediction-format.md#a-question) has both. A workflow asks the same question in a task. [In a workflow](../reference/prediction-format.md#in-a-workflow) shows how, including what to do when the data changed since the active model version was built.

## Keep it current

To train a new model version, ask your agent to start a build of the function and act as its trainer, as in step 3. Or ask for builds on a schedule. A scheduled workflow can run the function with `{ build: {} }`, as [Run a workflow on a schedule or event](triggers.md) shows, and your trainer answers each request. A function builds at most 4 times a day unless the setting `PREDICTION_BUILDS_PER_DAY` allows more.

Over the playbook's history, you can trial each new model version in a shadow before it replaces the active one. Set `evaluation.shadow_periods` to the number of periods it predicts beside the active one. With `shadow_periods: 0`, the default, and over an uploaded dataset, a new model version passes at once. [How a build ends](../reference/prediction-format.md#how-a-build-ends) has the rules of a shadow.

To refresh an uploaded dataset, ask your agent to upload the new file and give its digest to the function's `data.dataset`. It does so with `update_definition`, which saves a new version of the document. Then start a build. Until the new model version is active, questions are refused `data_changed`, since the active model was built for the old rows. The same holds after any edit to the data part, the horizons, the `given` features or `accumulates`.

## If something goes wrong

- **An upload or a trainer's call gets `401`.** It sent no key, or Auto does not list the key yet. Add it as [API keys](../self-host/security.md#api-keys) describes.
- **An upload or a trainer's call gets `403`.** The key is for another org, or does not cover this playbook or permission. Check its `--org`, `--playbooks` and `--permissions`.
- **Starting a build is refused.** `build_in_flight` means an earlier build still waits for its trainer, so answer its request or cancel it with `cancel_run`. `builds_full` means the function has had its builds of the day, or Auto is scoring as many builds as it may. [A build](../reference/prediction-format.md#a-build) lists every refusal.
- **A candidate is refused at upload.** Its format is not one the brief lists, or it names none where the brief lists several, which `?format=` settles; or the model runtime of its format cannot load it, `failed_to_load`, or finds its signature does not take what the function feeds, and the refusal says why. [The signature of a candidate](../reference/prediction-format.md#the-signature-of-a-candidate) has the rules.
- **The build succeeds with `version: null`.** No candidate won. Each candidate's `verdict` says why, such as `coverage_below_floor` when its interval held too few truths, or `not_better` when it did not beat every baseline.
- **A question is refused `data_changed`.** The data changed since the active model version was built. Run a build.

[How a run ends](../reference/prediction-format.md#how-a-run-ends) lists every refusal.

## Next

- [Developer example: forecast sign-ups](../tutorials/first-forecast.md) runs the whole path on sample data, with the runtime's own models.
- [Prediction function format](../reference/prediction-format.md) covers features, values a question supplies (`given`), totals to the end of a period, shadows and approvals.
- [API keys](../self-host/security.md#api-keys) covers rotating and revoking the trainer's key.
