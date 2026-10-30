---
description: A hands-on example for developers. Start a separate runtime in local mode, upload a small dataset of weekly sign-ups, build a model from the runtime's own models, read how it scored and ask for a forecast.
---

# Developer example: forecast sign-ups

This page is for developers and technical readers: it calls an HTTP route and starts a second Auto Runtime. To set up a forecast for your own data through your agent, read [Forecast with a prediction function](../guides/forecast.md) instead. If you are new to Auto, go back to [Build your first workflow](first-workflow.md).

This hands-on example runs every step of that guide on sample data.

You forecast next week's sign-ups for three regions. You upload a small dataset of weekly sign-ups and save a prediction function that learns from it. A build then fits the runtime's own models to the data: simple forecasting recipes that every Auto Runtime executes itself, with no training code. The playbook scores each on weeks it was not fitted on, keeps the best, and you ask it for a forecast.

The example uses a terminal and starts a second Auto Runtime beside your own. Your agent does the terminal work. Each step says what to ask it and shows the command it runs, so you can see what happens. You start the second runtime yourself, and you read and check the results.

The sign-ups are sample data. A prediction function calls no language model, so this example needs no model provider key.

## Why a separate runtime

One part of this example runs in a terminal, not through your agent's Auto tools: uploading the data. No Auto tool uploads data. That is an HTTP route, a web address that a program calls directly. On a runtime with sign-in on, the upload needs your organization's id (your org id) and an API key, since your agent's sign-in stays inside the agent.

A runtime in [local mode](../self-host/security.md#local-mode), which is how Auto runs on your computer unless you turned sign-in on, needs neither: its org is always `local`, and it asks for no key. This example starts a second runtime in local mode, beside the one from the quick start, so its practice data stays out of your own playbooks. It has its own directory, port and agent connection, and its own ledger file, where it keeps its playbooks and runs. You remove it at the end. [Do this on your own runtime](#do-this-on-your-own-runtime) says how to forecast on your own runtime.

## Before you start

- You followed the [quick start](../get-started/local.md), so Node.js and your agent are installed.
- Your agent runs terminal commands, as Claude Code and Codex do. Claude Desktop runs no terminal commands on its own, so use Claude Code or Codex.
- `curl` and `shasum` are available, as they are on macOS. On Linux, your agent uses `sha256sum` in place of `shasum -a 256`.

Until a model version is active, a function answers from the runtime's default forecast. A function may name a **trainer**, a person or an agent that fits models of its own outside the playbook and uploads them, as [The trainer's path](../reference/prediction-format.md#the-trainer-s-path) sets out. This example names none, so each build fits [the runtime's own models](../reference/prediction-format.md#the-runtime-s-own-models) itself.

## 1. Start a second runtime in local mode

Ask your agent to make a directory for this example and write its settings in it. You can paste these commands after your request; the agent runs them in the directory where you keep your work:

```bash
mkdir auto-forecast
cd auto-forecast
cat > .env <<EOF
PORT=5556
LEDGER_FILE=ledger.db
PREDICTION_CACHE_DIR=$PWD/models
EOF
```

Each line of `.env` keeps this runtime apart from your own:

- `PORT=5556` lets it listen beside your own runtime, which uses 5555.
- `LEDGER_FILE=ledger.db` keeps its playbooks and runs in this directory. Without it, both runtimes would use `~/.auto-runtime/ledger.db`.
- `PREDICTION_CACHE_DIR` gives it its own folder for model files, since two servers on one machine should each have one. The setting needs an absolute path, so the shell writes the directory's path in place of `$PWD`.
- No `PUBLIC_URL` or `API_KEYS` line, so the runtime is in [local mode](../self-host/security.md#local-mode): the org `local`, with no sign-in and no key. Use it only on your own computer.

The [configuration reference](../self-host/configuration.md) lists every setting.

Then start the runtime yourself, in a terminal of its own. It must keep running when you start a new agent session in step 2, so it does not run inside your agent. Open a new terminal, change to the `auto-forecast` directory (your agent can tell you its full path), and run:

```bash
npx @on.auto/runtime
```

Keep that terminal open. When the runtime is ready, it prints its address, `http://localhost:5556`. It prints no `Sign-in` line, since local mode signs no one in. Do not run the two commands it prints under "Connect your agent": they name the connection `auto-runtime`, which your own runtime already uses.

Ask your agent to check that the runtime runs in local mode. It runs:

```bash
curl http://localhost:5556/v1/orgs/local/playbooks
```

It should get `{"playbooks":[]}`, an empty list of playbooks. A `401` means local mode is off; see [If something goes wrong](#if-something-goes-wrong).

## 2. Connect your agent to it

Ask your agent to add a second connection, named `auto-forecast`. It runs one of these commands, the one for your agent, in the `auto-forecast` directory:

::: code-group

```bash [Claude Code]
claude mcp add --transport http auto-forecast http://localhost:5556/mcp
```

```bash [Codex]
codex mcp add auto-forecast --url http://localhost:5556/mcp
```

:::

Claude Code adds the connection for the directory the command runs in, its default local scope. So start Claude Code in `auto-forecast`. Codex adds it for every session. No sign-in page opens when the agent connects, since the runtime is in local mode.

Your agent may now have two Auto connections. Each prompt on this page names `auto-forecast`, so the agent works on the second runtime. Start a new agent session in `auto-forecast`, so that the agent picks up the new connection, and ask:

```text
Use the auto-forecast connection to create an Auto playbook named "Forecasts".
```

The agent reports the playbook, created by `local`. It gives the playbook an id, most likely `forecasts`, which the commands in step 3 use. If it chose another id, it puts that one in their place.

## 3. Upload the sample data

Ask your agent to save the file below in `auto-forecast` as `signups.csv`, exactly as shown. You can paste it after your request:

::: details signups.csv

```csv
series,period,signups
north,2026-W17,116
north,2026-W18,125
north,2026-W19,125
north,2026-W20,128
north,2026-W21,128
north,2026-W22,137
north,2026-W23,149
north,2026-W24,149
north,2026-W25,156
north,2026-W26,155
north,2026-W27,160
north,2026-W28,163
north,2026-W29,156
north,2026-W30,175
north,2026-W31,177
north,2026-W32,181
north,2026-W33,172
north,2026-W34,176
north,2026-W35,185
north,2026-W36,191
north,2026-W37,200
north,2026-W38,202
north,2026-W39,209
north,2026-W40,206
south,2026-W17,84
south,2026-W18,86
south,2026-W19,83
south,2026-W20,97
south,2026-W21,93
south,2026-W22,98
south,2026-W23,91
south,2026-W24,92
south,2026-W25,96
south,2026-W26,99
south,2026-W27,105
south,2026-W28,105
south,2026-W29,104
south,2026-W30,103
south,2026-W31,107
south,2026-W32,118
south,2026-W33,110
south,2026-W34,117
south,2026-W35,120
south,2026-W36,113
south,2026-W37,122
south,2026-W38,131
south,2026-W39,116
south,2026-W40,126
west,2026-W17,40
west,2026-W18,40
west,2026-W19,48
west,2026-W20,49
west,2026-W21,46
west,2026-W22,58
west,2026-W23,61
west,2026-W24,65
west,2026-W25,70
west,2026-W26,68
west,2026-W27,70
west,2026-W28,68
west,2026-W29,78
west,2026-W30,77
west,2026-W31,80
west,2026-W32,80
west,2026-W33,84
west,2026-W34,89
west,2026-W35,99
west,2026-W36,89
west,2026-W37,94
west,2026-W38,104
west,2026-W39,112
west,2026-W40,111
```

:::

It holds the weekly sign-ups of three regions over 24 weeks, from 2026-W17 to 2026-W40. Each row is one region and one ISO 8601 week, sorted by region and then by week. The column after `series` and `period` is the number to forecast.

The file covers 24 weeks because the function holds back the last 8 weeks to score each model and forecasts up to 4 weeks ahead. Its window must hold the held-back weeks plus twice the longest horizon, so at least 16 weeks. With 24, a build gets 16 weeks to fit its models to. [Bounds](../reference/prediction-format.md#bounds) lists every limit.

Then ask your agent to upload the file to the "Forecasts" playbook. It runs these commands in `auto-forecast`:

```bash
SHA=$(shasum -a 256 signups.csv | cut -d' ' -f1)
curl -sS -X PUT "http://localhost:5556/v1/orgs/local/playbooks/forecasts/datasets/$SHA" \
  -H 'Content-Type: text/csv' --data-binary @signups.csv
```

The runtime responds with the figures it read:

```json
{
  "dataset": "fcbceaa9e1480739d04f8eb0590d1816d0ce12522e6c978dd0860929babb2c37",
  "bytes": 1335,
  "rows": 72,
  "series": 3,
  "columns": ["signups"],
  "period": "week",
  "first_period": "2026-W17",
  "last_period": "2026-W40"
}
```

`dataset` is the SHA-256 of the file, a fingerprint of its exact contents, and the function names the data by it. A file saved exactly as shown has this digest. If yours differs, for example because the last line break is missing, your agent puts its own in the function's document in the next step. [An uploaded dataset](../reference/prediction-format.md#an-uploaded-dataset) has the format rules.

## 4. Save the prediction function

This is the function's document. You do not need to read it closely; the list after it says what each part does.

::: details The "Weekly sign-ups" document

<!-- prettier-ignore -->
```markdown
---
description: Predicts the weekly sign-ups of each region one and four weeks ahead
predicts:
  target: signups
  period: week
  horizons: [1, 4]
  unit: sign-ups
data:
  dataset: fcbceaa9e1480739d04f8eb0590d1816d0ce12522e6c978dd0860929babb2c37
  window: 24
evaluation:
  holdout: 8
  activate: automatic
---
Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},
from {{ dataset.periods.first }} to {{ dataset.periods.last }}.
Each row counts the accounts opened in one region in one week.
Predict {{ dataset.horizons | join: " and " }} weeks ahead.
```

:::

In this document:

- `predicts` names the column to forecast, `signups`, counted per `week`. A question may ask one or four weeks ahead (`horizons`).
- `data.dataset` names the upload, and `window: 24` uses its 24 weeks.
- `evaluation.holdout: 8` holds the last 8 weeks back from the models a build fits and scores each model on them. With `activate: automatic`, a model version that passes becomes active without anyone approving it.
- The document names no `source`, so it names no trainer: a build fits the runtime's own models itself, and waits for no one.
- The text after the settings, below the second `---` line, is the **brief**, the instructions a trainer reads first. Every prediction function has one. This one names no trainer, so its builds do not render it.

Ask your agent, with the document pasted after the prompt:

```text
Use the auto-forecast connection. In the "Forecasts" playbook, save this prediction function as "Weekly sign-ups".
```

The agent saves it with `create_definition`. A function's name is lowercase words joined by hyphens, so the agent saves it under a name like `weekly-signups`; if it chose another, it uses that one in later steps. The playbook derives what the function takes. A question is `{ series, horizon }`, with a horizon of 1 or 4, and a build is `{ build: {} }`.

The agent reports the function saved at version 1 of its document. That number counts the saves of the document, as for any definition. It is not a model. The function has no model version yet, and it already forecasts: asked for north's sign-ups one week ahead now, it answers from the runtime's default forecast, the last week's 206 sign-ups, between about 197 and 215, and its run's record says `default_forecast: true` and names no version. A build makes the first model, which the playbook numbers as model version 1, and that model version answers once it is active. Steps 5 to 7 do that.

## 5. Start a build

A **build** fits candidate models, scores each on the held-back weeks and keeps the best as the function's next model version. Ask your agent:

```text
Use the auto-forecast connection. Start a build of the "Weekly sign-ups" function in the
"Forecasts" playbook: run it with the input { "build": {} }.
```

The run returns `status: started`, with the build's run id, the id Auto gave this run, which the agent uses in the next steps. Its record says `trainer: null`: the document names no trainer, so the build sends no request and waits for no one. It writes the training rows, which end at 2026-W32, since the last 8 weeks are held back. Then it fits its candidates and scores them, which takes a few seconds.

## 6. Watch the build fit the runtime's own models

The runtime's own models are simple forecasting recipes that every Auto Runtime executes itself, each written as a small JSON document. [The runtime's own models](../reference/prediction-format.md#the-runtime-s-own-models) lists them. Ask your agent:

```text
Use the auto-forecast connection. List the events of the build's run in the "Forecasts"
playbook, and tell me which candidates it fitted and how each was scored.
```

The agent lists them with `list_playbook_events` and the build's run id. The event `candidates_fitted` names the model runtime that fitted the candidates, `series`, and the SHA-256 of each:

```json
{
  "runtime": { "name": "series", "version": "<the release's version>" },
  "candidates": [
    "5023042009e6c7b71d6316f76f6d9da2531cef1ffa23a994b97439d9e383d860",
    "6d5f93cf4a50285e69de64cdac214e2491bc7e12920688024aea88c615b9ef32",
    "11c9bffb5e81908d34fa7c06c44e392c6143c69db1dc42254eb8da0af4cbc44f"
  ]
}
```

Each candidate also has a `candidate_uploaded` event, whose `signature` is its recipe:

1. `mean`, the mean of each region's weeks, the same at every step ahead.
2. `drift`, the line from each region's first week through its last, carried on for each step ahead.
3. `linear`, a regression of each week on the three before it, fitted from the training rows of all three regions together.

Each recipe sets its own low and high, the 10th and 90th percentiles, from its errors on the training weeks. The build fits no `persistence`, which repeats the last week: that is the baseline every candidate must beat, so it could never win. The function names no season, so the build fits no seasonal recipe either.

The scoring events follow. `candidate_disqualified` says the mean's interval held 9% of the truths of the held-back weeks, and the linear model's 69.7%, both under the 70% a candidate needs by default. `candidate_scored` says the drift's held 84.8%, and gives its scores. `baseline_scored` gives the scores of `persistence` on the same weeks.

## 7. Read the result

Ask your agent:

```text
Use the auto-forecast connection. Show me how the build of the "Weekly sign-ups" function
ended, the new model version's scores against the baseline, and which model version is active.
```

The build's run has `status: succeeded` and this output. Its `version` is the model version the build kept, and its `winner` is the drift:

```json
{
  "version": 1,
  "winner": "6d5f93cf4a50285e69de64cdac214e2491bc7e12920688024aea88c615b9ef32",
  "candidates": [
    { "sha256": "5023042009e6c7b71d6316f76f6d9da2531cef1ffa23a994b97439d9e383d860", "verdict": "coverage_below_floor" },
    { "sha256": "6d5f93cf4a50285e69de64cdac214e2491bc7e12920688024aea88c615b9ef32", "verdict": "won" },
    { "sha256": "11c9bffb5e81908d34fa7c06c44e392c6143c69db1dc42254eb8da0af4cbc44f", "verdict": "coverage_below_floor" }
  ]
}
```

The model version's **card** records how it was built and how it scored. The playbook keeps it as the `version_built` event on the function's models stream, the part of its history about the function's models, which `list_playbook_events` shows. Its `trained_by` is the playbook itself, since the build fitted the candidate. The card scores the model and the `persistence` baseline, which repeats the last week, on the held-back weeks:

| Horizon | Truths scored (`pairs`) | The model's `mase` | `persistence`'s `mase` |
| ------- | ----------------------- | ------------------ | ---------------------- |
| 1 week  | 21                      | 1.35937            | 1.62708                |
| 4 weeks | 12                      | 1.48854            | 3.58886                |

A lower `mase` is a smaller error, so the model beat `persistence` at both horizons. The card also records a `coverage` of 0.848485 and a `p_better` against `persistence` of 1, above the 0.7 and 0.9 a candidate needs by default. [How a candidate is scored](../reference/prediction-format.md#how-a-candidate-is-scored) explains what each figure measures. All three describe the 8 held-back weeks, not how the model will do on the weeks to come. The runtime's own models fit the same way from the same rows, so a build of this data gives these figures; `p_better` comes from resamples seeded by the build's run id, so it could differ in its last digits.

The function's rule is `activate: automatic`, so model version 1 is already active, and it now answers the function's questions in place of the default forecast. The models stream holds a `version_activated` event, and `get_definition` shows model version 1 under `standing.models.active`. The document is still at its version 1 too; the two counts are separate. A function whose `activate` names an interaction function waits for a person to approve each model version. To make a model version active by hand, or to roll back, see [Activating a version](../reference/prediction-format.md#activating-a-version).

## 8. Ask for a forecast

Ask your agent:

```text
Use the auto-forecast connection. Ask the "Weekly sign-ups" function in the
"Forecasts" playbook for north's sign-ups one week ahead.
```

The agent runs the function with `{ "series": "north", "horizon": 1 }`. The run succeeds at once with the prediction, a series:

```json
{
  "unit": "sign-ups",
  "period": "week",
  "origin": "2026-W40",
  "lines": [
    {
      "name": "observed",
      "points": [
        { "at": "2026-W33", "value": 172 },
        { "at": "2026-W34", "value": 176 },
        { "at": "2026-W35", "value": 185 },
        { "at": "2026-W36", "value": 191 },
        { "at": "2026-W37", "value": 200 },
        { "at": "2026-W38", "value": 202 },
        { "at": "2026-W39", "value": 209 },
        { "at": "2026-W40", "value": 206 }
      ]
    },
    {
      "name": "predicted",
      "points": [{ "at": "2026-W41", "value": 209.9130401611328, "low": 202.03076171875, "high": 217.79531860351562 }]
    }
  ]
}
```

- `origin` is the last week of the data.
- The `observed` line holds north's last 8 weeks, twice the longest horizon, as the data holds them.
- The `predicted` line holds the week forecast. Its `value` is the likely value, the model's 50th percentile: about 210 sign-ups, the drift's line from north's first week through its last, one week on.
- Its `low` and `high` are the model's 10th and 90th percentiles, about 202 and 218.

The run's record holds `version`, 1, the model version that made the prediction, not the version of the document, its `runtime`, `series`, and `coverage`, 0.8, the share of truths an interval from the 10th to the 90th percentile should hold. The card's `coverage`, 0.848485, is how often this model's interval held on the held-back weeks.

A question for `west` four weeks ahead predicts the week 2026-W44. A question without a horizon predicts both weeks, 2026-W41 and 2026-W44. A question takes only the horizons the function names, 1 or 4.

## 9. Remove the forecast runtime

Keep the second runtime as long as you want to try things on it. When you are done, stop it with Ctrl+C in its terminal.

Then ask your agent to remove its connection to it. With Claude Code, the agent runs the command in the `auto-forecast` directory, where it added the connection:

::: code-group

```bash [Claude Code]
claude mcp remove auto-forecast
```

```bash [Codex]
codex mcp remove auto-forecast
```

:::

Last, ask your agent to delete the `auto-forecast` directory, or delete it yourself. It holds the runtime's settings, its ledger, its model files and the data, so the "Forecasts" playbook and its runs go with it. Your own runtime and its `auto-runtime` connection were never changed.

## If something goes wrong

- **The check in step 1 returns `401`.** Local mode is off. Check that `.env` is in the directory you started the server in. [Local mode](../self-host/security.md#local-mode) lists the settings that turn it off, such as `API_KEYS` or `PUBLIC_URL` set in your shell.
- **The server stops at start with `EADDRINUSE`.** Another program uses port 5556. Ask your agent to choose another port in `.env` and to use it wherever this page says 5556.
- **The agent cannot find the "Forecasts" playbook, or lists playbooks you built earlier.** It used your own runtime's connection. Ask again, and name the `auto-forecast` connection.
- **The agent has no `auto-forecast` connection.** With Claude Code, start it in the `auto-forecast` directory, where the connection was added, and run `/mcp` to check.
- **The upload is refused `invalid_input` at a line.** The file breaks the format there. Check the header `series,period,signups`. The rows must be sorted by region and then by week, with one row for each region and week.
- **The save is refused with "This playbook keeps no dataset under …".** `data.dataset` is not the digest of your upload. Ask your agent to put the `dataset` value the upload returned there.
- **The save is refused at `/data/window` or `/evaluation/holdout`.** The window must hold the holdout plus twice the longest horizon, and the holdout may be at most half the window.
- **The build succeeds with `version: null`.** No candidate won. Each candidate's `verdict` says why: `coverage_below_floor` when its interval held too few of the held-back weeks, or `not_better` when it did not beat `persistence`. The function goes on answering from the default forecast. A build of data other than this page's may end so. A function builds at most 4 times a day unless the server's `PREDICTION_BUILDS_PER_DAY` allows more.
- **Starting a build is refused `build_in_flight`.** An earlier build has not ended yet. Ask again once it has, or cancel it with `cancel_run`.
- **A question is refused `invalid_input` at `/input/series`.** The data holds no such region. The regions are `north`, `south` and `west`.

[How a run ends](../reference/prediction-format.md#how-a-run-ends) lists every refusal.

## Do this on your own runtime

If your own runtime is in local mode, as it is unless you set `PUBLIC_URL`, you can follow the same steps on it through your `auto-runtime` connection on port 5555, with the org `local` and no key. With sign-in on, the upload still runs in a terminal, so it needs your org id and an API key for it. [Give the trainer a key](../guides/forecast.md#arrange-a-trainer) shows how to make a key that may read and write the playbook. [Find the org and playbook ids](../self-host/tool-servers.md#find-the-org-and-playbook-ids) says where the org id shows.

To repeat this exercise on a runtime with sign-in on, keep the key in `AUTO_KEY` in the shell you start your agent from, then ask your agent to change the upload: use `http://localhost:5555` and your org id in place of `local`, and add `-H "Authorization: Bearer $AUTO_KEY"`.

## Next

- [Forecast with a prediction function](../guides/forecast.md) sets up a forecast for your own data.
- [The trainer's path](../reference/prediction-format.md#the-trainer-s-path) has a person or an agent fit models of their own and upload them as candidates beside the runtime's own.
- [Prediction function format](../reference/prediction-format.md) covers features, values a question supplies (`given`), totals to the end of a period, shadows and approvals.
- [The dataset](../reference/prediction-format.md#the-dataset) shows how a function learns from the events your playbook records, in place of an upload.
- [In a workflow](../reference/prediction-format.md#in-a-workflow) calls the function from a workflow, and [Run a workflow on a schedule or event](../guides/triggers.md) asks for a build every week.
