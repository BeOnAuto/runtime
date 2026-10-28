---
description: A hands-on example for developers. Start a separate runtime in local mode, upload a small dataset of weekly sign-ups, have your agent train a model, read how it scored and ask for a forecast.
---

# Developer example: forecast sign-ups

This page is for developers and technical readers: it runs a training script, calls HTTP routes and starts a second Auto Runtime. To set up a forecast for your own data through your agent, read [Forecast with a prediction function](../guides/forecast.md) instead. If you are new to Auto, go back to [Build your first workflow](first-workflow.md).

This hands-on example runs every step of that guide on sample data.

You forecast next week's sign-ups for three regions. You upload a small dataset of weekly sign-ups and save a prediction function that learns from it. Your agent then acts as the **trainer**, whoever fits the model: it trains one in its terminal and uploads it. The playbook scores the model on weeks the trainer never saw, and you ask it for a forecast.

The example uses a terminal, runs a Python training script through uv, and starts a second Auto Runtime beside your own. Your agent does that work. Each step says what to ask it and shows the command it runs, so you can see what happens. You start the second runtime yourself, and you read and check the results.

The sign-ups are sample data. A prediction function calls no language model, so this example needs no model provider key.

## Why a separate runtime

Two parts of this example run in a terminal, not through your agent's Auto tools: uploading the data, and the trainer's script that sends Auto a model. No Auto tool uploads data, reads a build's training rows or takes a model file. Those are HTTP routes, web addresses that a program calls directly. On a runtime with sign-in on, each call needs your organization's id (your org id) and an API key, since your agent's sign-in stays inside the agent.

A runtime in [local mode](../self-host/security.md#local-mode), which is how Auto runs on your computer unless you turned sign-in on, needs neither: its org is always `local`, and it asks for no key. This example starts a second runtime in local mode, beside the one from the quick start, so its practice data stays out of your own playbooks. It has its own directory, port and agent connection, and its own ledger file, where it keeps its playbooks and runs. You remove it at the end. [Do this on your own runtime](#do-this-on-your-own-runtime) says how to forecast on your own runtime.

## Before you start

- You followed the [quick start](../get-started/local.md), so Node.js and your agent are installed.
- Your agent runs terminal commands, as Claude Code and Codex do. Claude Desktop runs no terminal commands on its own, so use Claude Code or Codex.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) is installed. It runs a Python script with the packages the script needs. If it is missing, ask your agent to install it. The first time the training script runs, uv downloads Python and the packages the script needs (scikit-learn and onnx) into an environment of its own.
- `curl` and `shasum` are available, as they are on macOS. On Linux, your agent uses `sha256sum` in place of `shasum -a 256`.

Until a model version is active, a function answers from the runtime's default forecast, and a build of a function that names no trainer fits [the runtime's own models](../reference/prediction-format.md#the-runtime-s-own-models) itself. This example trains a model of its own instead: a trainer fits one outside the playbook, exports it as an ONNX file (a standard file format for models) and uploads it. [The trainer's path](../reference/prediction-format.md#the-trainer-s-path) sets out each step.

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

The agent reports the playbook, created by `local`. It gives the playbook an id, most likely `forecasts`, which the commands in steps 3 and 6 use. If it chose another id, it puts that one in their place.

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

The file covers 24 weeks because the function holds back the last 8 weeks to score each model and forecasts up to 4 weeks ahead. Its window must hold the held-back weeks plus twice the longest horizon, so at least 16 weeks. With 24, the trainer gets 16 weeks to learn from. [Bounds](../reference/prediction-format.md#bounds) lists every limit.

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
source:
  expires: P1D
rules:
  - Train on the rows given and on nothing else
  - Predict every week up to four weeks ahead, with a 10th, 50th and 90th percentile for each
---
Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},
from {{ dataset.periods.first }} to {{ dataset.periods.last }}.
Each row counts the accounts opened in one region in one week.
Predict {{ dataset.horizons | join: " and " }} weeks ahead.
{% for rule in function.rules %}- {{ rule }}
{% endfor %}
```

:::

In this document:

- `predicts` names the column to forecast, `signups`, counted per `week`. A question may ask one or four weeks ahead (`horizons`).
- `data.dataset` names the upload, and `window: 24` uses its 24 weeks.
- `evaluation.holdout: 8` holds the last 8 weeks back from the trainer and scores each model on them. With `activate: automatic`, a model version that passes becomes active without anyone approving it.
- `source.expires: P1D` lets a build wait a day for its trainer. The document names no `to`, so a build's request goes to the party `trainer` in the playbook's inbox.
- The text after the settings, below the second `---` line, is the **brief**, the instructions a trainer reads first. It lists the `rules`.

Ask your agent, with the document pasted after the prompt:

```text
Use the auto-forecast connection. In the "Forecasts" playbook, save this prediction function as "Weekly sign-ups".
```

The agent saves it with `create_definition`. A function's name is lowercase words joined by hyphens, so the agent saves it under a name like `weekly-signups`; if it chose another, it uses that one in later steps. The playbook derives what the function takes. A question is `{ series, horizon }`, with a horizon of 1 or 4, and a build is `{ build: {} }`.

The agent reports the function saved at version 1 of its document. That number counts the saves of the document, as for any definition. It is not a model. The function has no model version yet, and it already forecasts: asked for north's sign-ups one week ahead now, it answers from the runtime's default forecast, the last week's 206 sign-ups, between about 197 and 215, and its run's record says `default_forecast: true` and names no version. A build makes the first model, which the playbook numbers as model version 1, and that model version answers once it is active. Steps 5 to 7 do that.

## 5. Start a build

A **build** asks the trainer for candidate models, scores each on the held-back weeks and keeps the best as the function's next model version. Ask your agent:

```text
Use the auto-forecast connection. Start a build of the "Weekly sign-ups" function in the
"Forecasts" playbook: run it with the input { "build": {} }. Show me the request it sends
to the trainer.
```

The run returns `status: started` and waits for its trainer. Its request names the build's run id, the id Auto gave this run, which the agent uses in the next step. It also names three HTTP routes: the brief, the training rows and the upload. It ends with the brief, with the data's figures filled in:

```text
Fit a model of the weekly signups of each of 3 regions, in sign-ups,
from 2026-W17 to 2026-W32.
Each row counts the accounts opened in one region in one week.
Predict 1 and 4 weeks ahead.
- Train on the rows given and on nothing else
- Predict every week up to four weeks ahead, with a 10th, 50th and 90th percentile for each
```

The training rows end at 2026-W32, since the last 8 weeks are held back.

## 6. Train a model and upload it

Ask your agent to save the script below as `train.py` in `auto-forecast`, exactly as shown. You can paste it after your request:

::: details train.py

```python
import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request

import numpy as np
from onnx import TensorProto, helper, numpy_helper, save_model
from sklearn.linear_model import LinearRegression

SERVER = os.environ.get("AUTO_URL", "http://localhost:5556")
PLAYBOOK = os.environ.get("AUTO_PLAYBOOK", "/v1/orgs/local/playbooks/forecasts")
KEY = os.environ.get("AUTO_KEY", "")
BUILD = f"{PLAYBOOK}/runs/{sys.argv[1]}/build"
LAGS = 4
STEPS = 4


def call(method, path, body=None):
    request = urllib.request.Request(SERVER + path, data=body, method=method)
    if KEY:
        request.add_header("Authorization", f"Bearer {KEY}")
    if body is not None:
        request.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(request) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        sys.exit(f"{method} {path} was refused: {error.read().decode()}")


print(call("GET", f"{BUILD}/brief").decode())

weeks = {}
for row in csv.DictReader(io.StringIO(call("GET", f"{BUILD}/rows").decode())):
    weeks.setdefault(row["series"], []).append(float(row["signups"]))

inputs, targets = [], []
for values in weeks.values():
    for end in range(LAGS, len(values) - STEPS + 1):
        inputs.append(values[end - LAGS : end])
        targets.append(values[end : end + STEPS])
inputs, targets = np.array(inputs), np.array(targets)

model = LinearRegression(fit_intercept=False).fit(inputs, targets)
spread = (targets - model.predict(inputs)).std(axis=0) * 1.64

weights = np.repeat(model.coef_.T, 3, axis=1).astype(np.float32)
offsets = np.stack([-spread, np.zeros(STEPS), spread], axis=1).reshape(-1).astype(np.float32)

graph = helper.make_graph(
    [
        helper.make_node("MatMul", ["y", "weights"], ["mid"]),
        helper.make_node("Add", ["mid", "offsets"], ["flat"]),
        helper.make_node("Reshape", ["flat", "shape"], ["q"]),
    ],
    "weekly-signups",
    [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, LAGS])],
    [helper.make_tensor_value_info("q", TensorProto.FLOAT, [1, STEPS, 3])],
    [
        numpy_helper.from_array(weights, "weights"),
        numpy_helper.from_array(offsets, "offsets"),
        numpy_helper.from_array(np.array([1, STEPS, 3], dtype=np.int64), "shape"),
    ],
)
save_model(
    helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], ir_version=7),
    "candidate.onnx",
)

with open("candidate.onnx", "rb") as file:
    print(json.dumps(json.loads(call("POST", f"{BUILD}/candidates?format=onnx", file.read()))))
```

:::

You do not need to read the script to follow along. In short, the script:

1. Reads the brief and the training rows over the build's routes.
2. Cuts each region's weeks into windows of 4 weeks, each paired with the 4 weeks that follow it.
3. Fits a scikit-learn linear regression of each of the next 4 weeks on the last 4. It pools the regions and fits no intercept, so one model suits regions of any size.
4. Sets the low and the high 1.64 standard deviations of its training errors either side of the likely value. Errors on new weeks run larger than on the weeks a model was fitted to, and a candidate's interval must hold at least 70% of the held-back weeks.
5. Writes the model as ONNX in [the signature of a candidate](../reference/prediction-format.md#the-signature-of-a-candidate). Its one input, `y`, is the last 4 weeks, `[1, 4]`. Its one output, `q`, is the 10th, 50th and 90th percentile of each of the next 4 weeks, `[1, 4, 3]`. It sets opset 13 and IR version 7, since the onnx package otherwise writes an IR version the runtime does not load.
6. Uploads `candidate.onnx` to the build, naming its format, `onnx`, one of the two the brief lists beside `series`, and prints the runtime's response.

The script calls `http://localhost:5556` and the playbook `forecasts` in the org `local`. The environment variables `AUTO_URL` and `AUTO_PLAYBOOK` change those, and `AUTO_KEY` sends a key with each call.

Then ask your agent to act as the trainer. Leave `<the build's run id>` as it is; the agent fills it in:

```text
Act as the trainer for the build of the "Weekly sign-ups" function on the auto-forecast connection.
In the auto-forecast directory, run: uv run --with scikit-learn --with onnx python train.py <the build's run id>
Then answer the build's request with the candidate the script uploaded, and a
recipe that says how the model was trained.
```

The agent takes the run id from step 5, or finds the request with `list_interactions` for the party `trainer`. If the playbook's id is not `forecasts`, it sets `AUTO_PLAYBOOK` when it runs the script. The script prints the brief, then the upload's response:

```json
{
  "candidate": "16c1fbe6753e90dc130cd5b2ce2ef0efa32ae00e4486320c66271986938b406d",
  "bytes": 471,
  "format": "onnx",
  "signature": {
    "opset": 13,
    "inputs": [{ "name": "y", "type": "float32", "shape": [1, 4] }],
    "outputs": [{ "name": "q", "type": "float32", "shape": [1, 4, 3] }]
  }
}
```

The agent answers the request with `answer_interaction`, under the build's run id:

```json
{
  "candidates": ["16c1fbe6753e90dc130cd5b2ce2ef0efa32ae00e4486320c66271986938b406d"],
  "recipe": "A linear regression of each of the next four weeks on the last four weeks, pooled over the regions, without an intercept. The interval is 1.64 standard deviations of the training errors either side."
}
```

The playbook then scores the candidate, which takes a few seconds.

## 7. Read the result

Ask your agent:

```text
Use the auto-forecast connection. Show me how the build of the "Weekly sign-ups" function
ended, the new model version's scores against the baseline, and which model version is active.
```

The build's run has `status: succeeded` and this output. Its `version` is the model version the build kept:

```json
{
  "version": 1,
  "winner": "16c1fbe6753e90dc130cd5b2ce2ef0efa32ae00e4486320c66271986938b406d",
  "candidates": [{ "sha256": "16c1fbe6753e90dc130cd5b2ce2ef0efa32ae00e4486320c66271986938b406d", "verdict": "won" }]
}
```

The figures from here on are those of one run, as an illustration: uv installs the newest scikit-learn, onnx and numpy each time, so a fit on your machine may differ in its last digits. The model version's **card** records how it was built and how it scored. The playbook keeps it as the `version_built` event on the function's models stream, the part of its history about the function's models, which `list_playbook_events` shows. The card scores the model and the `persistence` baseline, which repeats the last week, on the held-back weeks:

| Horizon | Truths scored (`pairs`) | The model's `mase` | `persistence`'s `mase` |
| ------- | ----------------------- | ------------------ | ---------------------- |
| 1 week  | 21                      | 1.279              | 1.627                  |
| 4 weeks | 12                      | 1.396              | 3.589                  |

A lower `mase` is a smaller error, so the model beat `persistence` at both horizons. The card also records a `coverage` of 0.787879 and a `p_better` against `persistence` of 1, above the 0.7 and 0.9 a candidate needs by default. [How a candidate is scored](../reference/prediction-format.md#how-a-candidate-is-scored) explains what each figure measures. All three describe the 8 held-back weeks, not how the model will do on the weeks to come.

The function's rule is `activate: automatic`, so model version 1 is already active, and it now answers the function's questions in place of the default forecast. The models stream holds a `version_activated` event, and `get_definition` shows model version 1 under `standing.models.active`. The document is still at its version 1 too; the two counts are separate. A function whose `activate` names an interaction function waits for a person to approve each model version. To make a model version active by hand, or to roll back, see [Activating a version](../reference/prediction-format.md#activating-a-version).

## 8. Ask for a forecast

Ask your agent:

```text
Use the auto-forecast connection. Ask the "Weekly sign-ups" function in the
"Forecasts" playbook for north's sign-ups one week ahead.
```

The agent runs the function with `{ "series": "north", "horizon": 1 }`. The run succeeds at once with the prediction, a series. Its observed weeks are the data's own; its predicted figures, like the card's, illustrate one run:

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
      "points": [
        { "at": "2026-W41", "value": 212.5055389404297, "low": 204.46560668945312, "high": 220.54547119140625 }
      ]
    }
  ]
}
```

- `origin` is the last week of the data.
- The `observed` line holds north's last 8 weeks, twice the longest horizon, as the data holds them.
- The `predicted` line holds the week forecast. Its `value` is the likely value, the model's 50th percentile: about 213 sign-ups.
- Its `low` and `high` are the model's 10th and 90th percentiles, about 204 and 221.

The run's record holds `version`, 1, the model version that made the prediction, not the version of the document, and `coverage`, 0.8, the share of truths an interval from the 10th to the 90th percentile should hold. The card's `coverage`, 0.787879, is how often this model's interval held on the held-back weeks.

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

Last, ask your agent to delete the `auto-forecast` directory, or delete it yourself. It holds the runtime's settings, its ledger, its model files, the data and the script, so the "Forecasts" playbook and its runs go with it. Your own runtime and its `auto-runtime` connection were never changed.

## If something goes wrong

- **The check in step 1 returns `401`.** Local mode is off. Check that `.env` is in the directory you started the server in. [Local mode](../self-host/security.md#local-mode) lists the settings that turn it off, such as `API_KEYS` or `PUBLIC_URL` set in your shell.
- **The server stops at start with `EADDRINUSE`.** Another program uses port 5556. Ask your agent to choose another port in `.env` and to use it wherever this page says 5556, including the `SERVER` line of `train.py`.
- **The agent cannot find the "Forecasts" playbook, or lists playbooks you built earlier.** It used your own runtime's connection. Ask again, and name the `auto-forecast` connection.
- **The agent has no `auto-forecast` connection.** With Claude Code, start it in the `auto-forecast` directory, where the connection was added, and run `/mcp` to check.
- **The training command cannot reach the network or the runtime.** An agent that runs commands in a sandbox, as Codex can, may block network access. Approve the command when the agent asks, or run it yourself in a terminal in `auto-forecast`.
- **The upload is refused `invalid_input` at a line.** The file breaks the format there. Check the header `series,period,signups`. The rows must be sorted by region and then by week, with one row for each region and week.
- **The save is refused with "This playbook keeps no dataset under …".** `data.dataset` is not the digest of your upload. Ask your agent to put the `dataset` value the upload returned there.
- **The save is refused at `/data/window` or `/evaluation/holdout`.** The window must hold the holdout plus twice the longest horizon, and the holdout may be at most half the window.
- **The script stops with a `401`.** It called a runtime that is not in local mode, such as your own on port 5555. Check the `SERVER` line of `train.py` and that `AUTO_URL` is not set.
- **The candidate is refused `failed_to_load`, with "Unsupported model IR version".** Recent onnx packages, such as 1.23, write IR version 14 unless told otherwise. This release's ONNX Runtime loads IR version 13 or earlier. The script sets the IR version: keep `ir_version=7` in `make_model`. [The signature of a candidate](../reference/prediction-format.md#the-signature-of-a-candidate) has the rule.
- **The candidate is refused with "The model's outputs are … and the playbook feeds [q]".** The model's inputs or outputs are not the signature the function feeds. This function feeds `y` and reads `q`.
- **The build succeeds with `version: null`.** No candidate won. Each candidate's `verdict` says why: `coverage_below_floor` when its interval held too few of the held-back weeks, or `not_better` when it did not beat `persistence`. Change the model and start a new build. A function builds at most 4 times a day unless the server's `PREDICTION_BUILDS_PER_DAY` allows more.
- **Starting a build is refused `build_in_flight`.** An earlier build still waits for its trainer. Answer its request, or cancel it with `cancel_run`.
- **A question is refused `invalid_input` at `/input/series`.** The data holds no such region. The regions are `north`, `south` and `west`.

[How a run ends](../reference/prediction-format.md#how-a-run-ends) lists every refusal.

## Do this on your own runtime

If your own runtime is in local mode, as it is unless you set `PUBLIC_URL`, you can follow the same steps on it through your `auto-runtime` connection on port 5555, with the org `local` and no key. With sign-in on, the upload and the trainer's script still run in a terminal, so they need your org id and an API key for it. [Give the trainer a key](../guides/forecast.md#arrange-a-trainer) shows how to make the key. [Find the org and playbook ids](../self-host/tool-servers.md#find-the-org-and-playbook-ids) says where the org id shows.

To repeat this exercise on a runtime with sign-in on, keep the key in `AUTO_KEY` in the shell you start your agent from, then ask your agent to make two changes:

- In the upload, use `http://localhost:5555` and your org id in place of `local`, and add `-H "Authorization: Bearer $AUTO_KEY"`.
- Run the script with `AUTO_URL=http://localhost:5555` and `AUTO_PLAYBOOK=/v1/orgs/<org>/playbooks/forecasts` before `uv run`, with your org id in place of `<org>`. It sends `AUTO_KEY` with each call.

## Next

- [Forecast with a prediction function](../guides/forecast.md) sets up a forecast for your own data.
- [Prediction function format](../reference/prediction-format.md) covers features, values a question supplies (`given`), totals to the end of a period, shadows and approvals.
- [The dataset](../reference/prediction-format.md#the-dataset) shows how a function learns from the events your playbook records, in place of an upload.
- [In a workflow](../reference/prediction-format.md#in-a-workflow) calls the function from a workflow, and [Run a workflow on a schedule or event](../guides/triggers.md) asks for a build every week.
