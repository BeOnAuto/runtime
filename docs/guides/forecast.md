---
description: Set up a prediction function that forecasts from the events your playbook records, and ask it for a forecast.
---

# Forecast with a prediction function

A prediction function forecasts a number for one series at a time, such as next week's orders in one region, from the events your playbook already records. This guide sets one up in a playbook you already have. Each step says what to ask your agent and what you should see.

A prediction function calls no language model, and needs nothing set up first. The runtime's forecaster answers each question from the series' own history, as soon as that history is long enough. [Prediction function format](../reference/prediction-format.md) holds every field and rule.

## Before you start

- Your agent is connected to Auto with permission to change your playbook (`playbook:write`). The [quick start](../get-started/cloud.md) sets this up.
- You know the number to forecast and how many periods ahead you will ask. A period is a day, a week, a month, a quarter or a year.
- The playbook records an event for each thing you count, such as `order.placed`, with a time and its series, such as the region. Your systems publish them, or its workflows emit them.

## 1. Choose the events

The function forecasts from the playbook's history. New events join its data as the playbook records them, so each question answers from the latest periods.

Ask your agent:

```text
I want to forecast <the number, such as orders> for each <series, such as
region>, <how many> <periods> ahead, in my "<playbook name>" playbook. Does
its history record an event for each <thing counted>, with its time and its
<series>? Which events, and how many periods do they cover?
```

You should see the agent name the events it found, where each holds its time and its series, and how far back they go. [The dataset](../reference/prediction-format.md#the-dataset) has the fields that read them.

## 2. Save the function

Ask:

```text
Draft a prediction function named "<function name>" in my "<playbook name>"
playbook. It forecasts <the number> per <period> for each <series>, <how many>
periods ahead, from <the events>. Show me the document and explain each setting
before saving it.
```

You should see a document of YAML front matter between `---` lines and nothing after it. Check that the target, the period and the horizons are the ones you meant.

::: details What the document settles

- `predicts`: the `target`, its `period`, its `horizons` (how many periods ahead a question may ask) and its `unit`. Name a `season` when the numbers repeat, such as 52 for weeks over a year or 7 for days over a week. For a total to the end of a period, name `accumulates` in place of `horizons`. `coverage` is how often each range is meant to hold the truth, 0.8 unless you name another.
- `data`: the events, where each holds its time and its series, how the target is read and aggregated over a period, and the `window` of periods a question reads.

[A function document](../reference/prediction-format.md#a-function-document) shows a full example, and [Fields](../reference/prediction-format.md#fields) lists every field.

:::

Approve it, and the agent saves it with `create_definition`. A save that breaks a rule is refused at its line, and nothing is saved.

The playbook then builds the function's dataset from its history: one row for each series and period. `get_definition` shows it under `standing.dataset`, `rebuilding` at first and `live` once it has read the history.

## 3. Ask for a forecast

Ask:

```text
Ask the "<function name>" function in my "<playbook name>" playbook for
<series>'s <number> <how many> <periods> ahead.
```

The agent runs the function with a question, such as `{ "series": "north", "horizon": 1 }`, and the run returns the forecast at once. Without `horizon`, it forecasts every horizon the function names. The forecast is a series, which Auto Studio draws on the run's page. Read it like this:

- `origin` is the last observed period, the one before the period you asked in.
- The `observed` line holds the last periods of the data up to the origin, twice the longest horizon unless the document's `predicts.history` says how many.
- The `predicted` line holds a point for each period forecast. Its `value` is the likely value.
- Its `low` and `high` are the range meant to hold the true value eight times in ten, or as often as the document's `coverage` says.
- The run's record names the `method` the forecaster used, the `coverage`, and in `history` the periods it forecast from and the earlier points it checked itself at.

A function that predicts a total to the end of a period takes no horizon; [A question](../reference/prediction-format.md#a-question) has both kinds. A workflow asks the same question in a task. [In a workflow](../reference/prediction-format.md#in-a-workflow) shows how, including what to do while the history is still too short.

## Keep it current

Nothing needs to be done: every question answers from the dataset as the playbook has folded it then. To change what the function forecasts from, update its document. An edit to the events, the target or the grain starts a new dataset from the history; a wider window or other horizons do not.

## If something goes wrong

- **A question is refused `history_too_short`.** The series' history is too short for the forecaster to check its own forecasts on. The refusal names the periods the series has and the first period from which the same question answers, so ask again from then.
- **A question is refused `dataset_not_ready`.** The dataset is still being built from the playbook's history, so ask again once `get_definition` shows it `live`. With `because: stalled`, it stopped at an event its data test could not take; `get_definition` names the event, and a corrected data part starts a dataset of its own.
- **A question is refused at `/input/series`.** The dataset holds no row of that series in its window. Check the series' name, as the events spell it.

[How a run ends](../reference/prediction-format.md#how-a-run-ends) lists every refusal.

## Next

- [Prediction function format](../reference/prediction-format.md) covers totals to the end of a period, the forecaster's methods and its bounds.
- [Run a workflow on a schedule or event](triggers.md) asks for a forecast on a schedule.
