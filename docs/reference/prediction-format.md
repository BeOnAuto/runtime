<div v-pre>

# Prediction function format

A prediction function forecasts one quantity for one series at a time from the playbook's own history, one or more periods ahead. Each prediction is a [series](output-shapes.md#series): the last periods observed, and each period ahead as a likely value with a low and a high. The API stores the function as a definition of the type `prediction`.

Its document says:

- what it predicts, over which period of time, and how often its ranges are meant to hold the truth;
- the events of the playbook it forecasts from.

## How a prediction function forecasts

A prediction function answers from the moment its dataset is live and its series holds enough history, and needs nothing set up first:

1. The playbook keeps a **dataset** for the function: one row for each series and period, folded from the events it records, from the first event of its history on.
2. A **question** is a run that asks for one series. The runtime's **forecaster** reads the last periods of that series from the dataset as it is folded then, forecasts the series' own past from earlier origins to see how each of its methods would have done, and answers with the first method the history supports.
3. The answer holds the last observed periods and each period ahead with its likely value and a range, the **range** set from that method's own misses so that it holds the truth as often as the document's **coverage** says.

The forecaster keeps nothing between questions, so a question always answers from the dataset as it stands.

## A function document

The source is YAML front matter between two lines of three dashes, with nothing after it. This example predicts the orders of each region one and four weeks ahead, from the events `order.placed` the playbook records:

<!-- prettier-ignore -->
```markdown
---
description: Predicts the orders of each region one and four weeks ahead
predicts:
  target: orders
  period: week
  season: 52
  horizons: [1, 4]
  unit: orders
data:
  events:
    - type: order.placed
  time: /placed_at
  series: /region
  target: { as: count }
  window: 156
---
```

`create_definition` takes `type: "prediction"`, a function `name` such as `weekly-orders` and the document as `source`. The saved function has the `media_type` `text/markdown`. The playbook writes its `input_schema` itself, from the document: the question of [The input and the output](#the-input-and-the-output). Its `output_schema` is the [series shape](output-shapes.md#series), what a question answers, and its `details.shape` is `series`. So a document that names `input` or `output` is refused, as is one with any text after its front matter.

Before you write one, settle these with the person:

- The target: the one quantity to predict, and how it is read from each event.
- The grain: the period the target is counted over, a day, a week, a month, a quarter or a year.
- The horizons: how many periods ahead a question asks, such as next week and four weeks out. To ask instead where a whole week, month, quarter or year will land, name that period under `accumulates`.
- The season: the periods after which the series repeats itself, such as 52 for weeks over a year or 7 for days over a week, if it does.
- The coverage: how often the range of each answer is meant to hold the truth, eight times in ten unless the person wants it surer or tighter.
- The window: how many periods of history a question reads. The forecaster answers once the series' history in the window holds enough periods for its methods, as [The forecaster](#the-forecaster) sets out.

## Fields

| Field                  | Meaning                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`          | Optional; what the function predicts, 1 to 1,000 characters                                                                                                   |
| `predicts.target`      | Required; the name of the quantity, which names its column in the dataset                                                                                     |
| `predicts.period`      | Required; `day`, `week`, `month`, `quarter` or `year`                                                                                                         |
| `predicts.season`      | Optional; the length of a season in periods, 2 to 366, such as 52 for weeks over a year                                                                       |
| `predicts.horizons`    | Required unless `accumulates` is named; the periods ahead a question may ask, 1 to 8 whole numbers from 1 to 52, each once                                    |
| `predicts.accumulates` | Optional, in place of `horizons`; `week`, `month`, `quarter` or `year`, longer than `period`; see [below](#a-total-to-the-end-of-a-period)                    |
| `predicts.unit`        | Required; text of 1 to 64 characters for the answer and its words, such as `orders`                                                                           |
| `predicts.history`     | Optional; how many observed periods a question's answer shows, 0 to 500 and at most the window; twice the longest horizon by default                          |
| `predicts.coverage`    | Optional; 0.5 to 0.95, 0.8 by default: the share of truths each range is meant to hold                                                                        |
| `data`                 | Required; a projection of the playbook's history, with its `window`; see [The dataset](#the-dataset)                                                          |
| `data.window`          | Required; the periods of history a question reads, at least what the forecaster needs at the longest horizon and at most 1,000, as [Bounds](#bounds) sets out |

- The target's name is 1 to 64 lowercase letters, digits and underscores, starting with a letter, and neither `series` nor `period`, which every row has.
- Every problem a save finds is refused with its line, and nothing is saved.

### The input and the output

A run's input is a **question**, `{ series, horizon?, marks? }`:

- `series` is text of 1 to 256 bytes.
- `horizon` is one of the function's horizons, to predict that period ahead alone. Without it, the question predicts every horizon the function names.
- `marks` are at most 8 `{ label, value }`, each label text of 1 to 64 characters, which the answer carries for display and nothing reads. More are refused `invalid_input` at `/input/marks`.

A question's output is the **prediction**, a [series](output-shapes.md#series) of the function's grain:

| Field      | Value                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`     | `predicts.unit`                                                                                                                                 |
| `period`   | `predicts.period`                                                                                                                               |
| `origin`   | The last period of the window, the one before the period the question is asked in                                                               |
| `lines[0]` | `observed`: the last `predicts.history` periods up to the origin, each value as the dataset's rows hold it; a period with no value is left out  |
| `lines[1]` | `predicted`: one point for each horizon asked, the nearest first, each with its `value`, `low` and `high`; `total` with `accumulates`, as below |
| `marks`    | The question's marks, when it gives them                                                                                                        |

- Each `at` and the `origin` are in the ISO 8601 form of the grain: `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn` or `YYYY`.
- `value` is the forecaster's likely value. `low` and `high` are the range meant to hold the truth as often as `predicts.coverage` says, eight times in ten by default.
- The observed periods are the last of the window the forecaster reads, so the answer reads nothing more.

`get_definition` shows the [series shape](output-shapes.md#what-a-saved-definition-shows) as the function's `output_schema`, and `series` as its `details.shape`, as for a reasoning function that declares `output.shape: series`.

### A total to the end of a period

Some questions ask where a period will land, such as a quarter's orders from the days so far. That is a total, not a value some periods ahead. `predicts.accumulates` names the enclosing period (`week`, `month`, `quarter` or `year`) in place of `horizons`. A question then asks for the target summed over the rest of an enclosing period. The sum starts at the period after the last observed one. It ends where the enclosing period that holds that period ends. So a question asked as a quarter closes predicts the whole next quarter.

A day sums to a week, a month or a quarter; a week to a quarter or a year; and a month to a quarter or a year. These are refused at save:

- any other pair of grain and enclosing period;
- `horizons` beside `accumulates`, or neither of them;
- a target aggregated as `last` or `mean`, since a sum of such values says nothing.

For the window and the history, the longest horizon is then the most periods the enclosing period holds: 7, 31 or 92 days, 14 or 53 weeks, or 3 or 12 months.

Such a question is `{ series, marks? }`, with no horizon. Its prediction's second line is named `total`, in place of `predicted`, and holds one point, the total:

- its `at` is the last period the enclosing period holds, in the grain's form, since a series holds one grain: `2026-10-18` for the week 2026-W42 of a daily function;
- its `value`, `low` and `high` are the total from the period after the origin to that one;
- the run's record names the enclosing period as `total_to`, such as `2026-W42`, and the run's words say the total by its end, such as "78 visits by the end of 2026-W42".

## The dataset

The playbook records events one at a time, while a forecast counts by period. So the playbook keeps a dataset for each data part: rows keyed by series and period, a projection of its history with `events`, `time`, `series` and `target`. The forecaster reads the target alone, so the dataset keeps nothing else.

How edits affect the dataset:

- Two functions whose data parts fold the same rows at the same grain share one dataset.
- An edit that leaves the rows alone changes nothing. A wider `window` is such an edit, since a question reads it from the same rows.
- An edit that changes the rows (a filter, a pointer, an aggregation or the grain) starts a new dataset from the first event of the history. The old one is dropped once no active function names it.

| Field         | Meaning                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data.events` | 1 to 8 filters, as a recall function names its events: the event's `type`, any other attribute of the event written out, and optionally a `data` test over `$data` |
| `data.time`   | `event` for the time of the event itself, or a JSON Pointer into its data that holds an ISO 8601 time, such as `/placed_at`                                        |
| `data.series` | A JSON Pointer to the value that names the series, text of 1 to 256 bytes                                                                                          |
| `data.target` | `{ as, of }`. `as` is how the target is aggregated over a period: `count`, `sum`, `last` or `mean`. `of` points to the value; `count` leaves it out                |

A `time`, `series` or `target` pointer is refused at save when none of the named event types holds a value there, such as `/output/region` under `run_rejected`. A recall function's filters are checked the same way.

For each event a filter takes, in the order the playbook recorded them, the dataset:

1. reads the time, in UTC, and finds its period. A week runs from Monday and is numbered as ISO 8601 numbers weeks, so `2026-W01` starts on 2025-12-29. A quarter is three calendar months.
2. reads the series, then the target.
3. adds the event to the row of that series and period:
   - `count` adds one;
   - `sum` adds the value;
   - `last` takes the value of the latest event by its time, whatever order the events were recorded in;
   - `mean` keeps the sum and the count;
   - a value that is missing or null adds nothing.

The dataset passes over an event, counts it and notes it in the server's log, when:

- its time is not an ISO 8601 time with its offset on a day of the calendar (a date alone among them), or names a leap second;
- its series is not text of 1 to 256 bytes;
- its target is a value that is not a finite number;
- its data test fails.

Such an event adds to no row.

A data test can also run out of time or memory. No event causes that, so the event is never passed over. Instead:

- The dataset stops before that event. It tries the event again at the server's next sweep, its regular pass over pending work, every second by default.
- After twenty tries without folding a whole page, the dataset stalls. Its phase becomes `stalled`, the server's log notes it, and it folds nothing more.
- A data part that changes starts a dataset of its own.

`get_definition` of a prediction function adds the dataset's `standing`, as `standing.dataset`:

| Field                          | Meaning                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `kind`                         | `projection`                                                                         |
| `data_sha256`                  | The dataset's digest                                                                 |
| `phase`                        | `waiting` for a slot to be built, `rebuilding` from the history, `live` or `stalled` |
| `checkpoint`, `checkpoint_at`  | Where the dataset has read to in the playbook's history                              |
| `rows`, `series`               | How many rows and series it holds                                                    |
| `first_period`, `last_period`  | Its first and last periods                                                           |
| `events_folded`, `passed_over` | How many events it folded, and how many it passed over                               |
| `stall`                        | Null unless it stalled; then `{ record, detail }`, the event it stopped at and why   |

## The forecaster

The forecaster answers every question in the server's own process, within the question's call, unless an extension fills `capability/prediction`, which then answers every question in its place (see [Extensions](../self-host/configuration.md#extensions)). It reads the series' window from the dataset: each period's value as the dataset folds it, a period with no row being 0 for a `count` or a `sum` and unobserved for a `last` or a `mean`. The series' **history** runs to the origin from its first period with a row in the window, or from the window's first period for a `count` or a `sum` whose series has a row before the window; a period before that holds no history.

### The methods

The forecaster tries its methods in this order and answers with the first that the history supports:

| Method                          | It forecasts                                                                                                                                                                                                                                             | It needs one forecast to have                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `level-adjusted-seasonal-naive` | The value a season earlier, times the level: the mean of the last `k` periods over the mean of the same `k` periods a season before, once for each season the step reaches back; `k` is the longest horizon, or the periods to the end, at most a season | A season and `k` periods, where `predicts.season` is named |
| `seasonal-naive`                | The value a season earlier                                                                                                                                                                                                                               | A season, where `predicts.season` is named                 |
| `persistence`                   | The last observed value, at every step ahead                                                                                                                                                                                                             | One period                                                 |
| `run-rate`                      | A total: the mean of the periods of the enclosing period so far, or of as many periods as are to come where none has passed, times the periods to the end                                                                                                | One period                                                 |

A total is forecast by `level-adjusted-seasonal-naive`, `seasonal-naive` or `run-rate`, the seasonal methods summing each step's own value a season earlier; a question of horizons by the first three.

### The backtest

A method applies when the history lets it forecast the series' own past at enough origins: for each step ahead, at least three earlier origins whose forecast it can make and whose truth was observed, so each step has three misses, each the truth less the forecast. On a series with no period unobserved, a method that needs `N` periods for one forecast so applies `h` steps ahead once the history holds `N + h + 2` periods, so `persistence` answers one week ahead from 4 weeks of history and two days ahead from 5 days.

- A question of horizons is backtested at every origin of the history from which its steps fall within the history, and for its longest horizon, so every horizon it asks is answered by the same method.
- A total is backtested as a total: at the same point of each past enclosing period, its origin as many periods into that period as the question's is into its own, and at its last period but one where that period is shorter; its truth is the sum of the periods that remained to that period's end, and a past total counts only where every one of them was observed.
- A period the history holds unobserved is carried over: `persistence` carries the last observed value across it, a seasonal step whose value a season earlier is unobserved answers as `persistence` does, and a mean is taken over the observed values alone.

The record names the method as `method`, its season as `season`, null for `persistence` and the `run-rate`, `k` for the level-adjusted method alone, and in `history` the periods it backtested on and the origins it backtested at.

### The range

The range of each step is set from the method's own misses at that step. `low` is the value plus the quantile of the misses at `(1 − coverage) / 2`, and `high` the value plus their quantile at `(1 + coverage) / 2`, each interpolated between the misses in order, so at the coverage of 0.8 the range runs from the 10th percentile of the misses to the 90th. The range always holds the value: `low` is at most the value and `high` at least it. Where every observed value of the series is 0 or more, `low` is at least 0.

### Too short a history

A history too short for even `persistence`, or the `run-rate` for a total, is refused as a `conflict` of the kind `history_too_short`. Its detail names the periods the series has up to the origin, those of them without a value, and the first period from which the same question answers. The forecaster finds that period by asking the question again at each later origin, its window moved on by as many periods and each period after the origin holding a value, until one answers. A `count` or a `sum` holds a value in every period, a period without an event being 0, so the question answers from that period. A `last` or a `mean` holds none in a period without a reading, so the detail says the question answers from that period if every period until then holds a value. A total is asked as many periods into its enclosing period as its origin is, so a later origin asks it at another point of its period, and the first that answers can lie in a later enclosing period. The window can hold what the forecaster needs: a save refuses a window under what it needs at the longest horizon, as [Bounds](#bounds) says, so the period named is at most a window's length after the origin.

## A question

A question is `{ series, horizon?, marks? }`, or `{ series, marks? }` with `accumulates`. The forecaster answers it from the series' last window: the dataset's rows from the period `data.window` periods before the period the question is asked in to the one before it, at the dataset's checkpoint. It answers within the question's call, in the server's own process.

The output is the prediction of [The input and the output](#the-input-and-the-output). The run's record holds:

| Field                  | Value                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `method`               | The method that answered, as [The methods](#the-methods) names them                                                        |
| `coverage`             | `predicts.coverage`, the share of truths each range is meant to hold                                                       |
| `season`               | The season the method used, or null for `persistence` and the `run-rate`                                                   |
| `k`                    | For `level-adjusted-seasonal-naive` alone: the periods its level is measured over                                          |
| `history.periods`      | The periods of the series' history to the origin, as [The forecaster](#the-forecaster) says                                |
| `history.first_period` | The first of them                                                                                                          |
| `history.last_period`  | The last, the origin                                                                                                       |
| `history.origins`      | The origins the method was backtested at                                                                                   |
| `decimals`             | The most decimals a value the series observed in the window carries, at most 2, which the run's words write each figure to |
| `total_to`             | With `accumulates` alone: the enclosing period the total runs to                                                           |
| `origin`               | The origin, as the output names it                                                                                         |
| `dataset_checkpoint`   | Where the dataset had read to in the playbook's history when the question read it                                          |

The run's words say each predicted figure with its range, the coverage and the method, such as "From 2026-W41, it predicts 140 orders in 2026-W42 (128 to 151 orders) and 143 orders in 2026-W45 (124 to 161 orders), each range meant to hold the truth 8 times in 10, by repeating the periods a season earlier at the level of the last ones."

For example, `{ "series": "north" }` asks `weekly-orders` for both its horizons, and its answer shows the 8 weeks observed before them:

```json
{
  "unit": "orders",
  "period": "week",
  "origin": "2026-W41",
  "lines": [
    {
      "name": "observed",
      "points": [
        { "at": "2026-W34", "value": 118 },
        { "at": "2026-W35", "value": 124 },
        { "at": "2026-W36", "value": 121 },
        { "at": "2026-W37", "value": 130 },
        { "at": "2026-W38", "value": 127 },
        { "at": "2026-W39", "value": 133 },
        { "at": "2026-W40", "value": 129 },
        { "at": "2026-W41", "value": 136 }
      ]
    },
    {
      "name": "predicted",
      "points": [
        { "at": "2026-W42", "value": 140, "low": 128, "high": 151 },
        { "at": "2026-W45", "value": 143, "low": 124, "high": 161 }
      ]
    }
  ]
}
```

Its record, over 70 weeks of the region's history:

```json
{
  "method": "level-adjusted-seasonal-naive",
  "coverage": 0.8,
  "season": 52,
  "k": 4,
  "history": { "periods": 70, "first_period": "2025-W24", "last_period": "2026-W41", "origins": 11 },
  "decimals": 0,
  "origin": "2026-W41",
  "dataset_checkpoint": "WyJwbGF5Ym9vay9hY21lL2FscGhhLyIsIjgxIl0"
}
```

## How a run ends

A question ends within its call and cannot be cancelled while it runs:

| Ending                                  | When                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                             | The prediction is its output                                                                                                                        |
| `invalid_input`                         | The input is not a question the function takes, or the series is not in the dataset's window, at `/input/series`                                    |
| `conflict`, kind `history_too_short`    | The series' history is too short for the forecaster to backtest an answer; the detail names the periods it has and the period from which it answers |
| `unavailable`, kind `dataset_not_ready` | The dataset is waiting or rebuilding; with `because` `stalled`, it stalled                                                                          |
| `failed`                                | The runtime itself broke down                                                                                                                       |

## Bounds

A save is refused past these bounds:

| Bound                | Value                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horizons             | 1 to 8, each 1 to 52 periods                                                                                                                                                   |
| History              | 0 to 500 periods, at most the window                                                                                                                                           |
| A total              | A day to a week, a month or a quarter, at most 7, 31 or 92 days; a week to a quarter or a year, at most 14 or 53 weeks; a month to a quarter or a year, at most 3 or 12 months |
| Window               | At least the longest horizon and 3 more periods, or for a total 4 times the most periods its enclosing period holds, which the forecaster needs to backtest; at most 1,000     |
| Season               | 2 to 366 periods                                                                                                                                                               |
| Coverage             | 0.5 to 0.95, 0.8 when left out                                                                                                                                                 |
| Filters              | 1 to 8                                                                                                                                                                         |
| Functions a playbook | 32 active, unless the server's `PREDICTION_MAX_FUNCTIONS` says otherwise, from 1 to 1,000                                                                                      |

The data and the runs are bounded so:

| Bound            | Value                       | When it is reached                                         |
| ---------------- | --------------------------- | ---------------------------------------------------------- |
| A series         | 1 to 256 bytes of text      | The event is passed over                                   |
| A question's run | 10 seconds, within its call | A workflow's call waits for it that long and a minute more |

## In a workflow

A workflow calls a prediction function as it calls any function, with `call: run_definition` and `type: prediction`. The task's output is the run's output; see [Calling a function](workflow-format.md#calling-a-function).

- A question, such as `{ call: run_definition, with: { type: prediction, name: weekly-orders, input: { series: north, horizon: 1 } } }`, ends within its call, written out or computed at run time. Its own maximum is 10 seconds, so the task waits at most 10 seconds plus one minute.

This workflow forecasts a region's orders for next week from `weekly-orders`. The task's output is the series the function answers, and a workflow that needs one number reads the likely value of the first predicted point, `lines[1].points[0].value`. While the region's history is too short to forecast from, the workflow returns no forecast:

```yaml
document:
  dsl: '1.0.3'
  namespace: orders
  name: next-week-orders
  version: '1.0.0'
  summary: Forecasts a region's orders for next week, or returns none while its history is too short.
input:
  schema:
    document:
      type: object
      properties:
        region: { type: string }
      required: [region]
do:
  - forecast:
      try:
        - ask:
            call: run_definition
            with:
              type: prediction
              name: weekly-orders
              input:
                series: '${ $data.region }'
                horizon: 1
            output:
              as: '${ ({ forecast: $data.lines[1].points[0].value }) }'
      catch:
        errors:
          with: { status: 409 }
        when: '${ $error.kind == "history_too_short" }'
        do:
          - none: { set: { forecast: null } }
```

`run_definition` of `next-week-orders` takes an input such as `{"region": "north"}`. Once the region's history holds enough weeks, the run succeeds with `{"forecast": <the likely value>}`, such as `{"forecast": 140}`. Before that, its question is refused `conflict` with the kind `history_too_short`; the `catch` takes it, and the run succeeds with `{"forecast": null}`. To keep the range too, read the whole point, `lines[1].points[0]`, which holds its `at`, `value`, `low` and `high`. Any other refusal ends the workflow's run, as below.

A run that does not succeed raises the error of its rejection:

- A refusal raises status 503 for `unavailable` and 409 for `conflict`, with its `kind` and `because`.
- A dataset still being built passes with time, so a retry on status 503 suits a question.
- A `stalled` dataset does not change when tried again, nor does `history_too_short` before the period its detail names. So leave 409 out of a retry policy, and read `$error.because` in a `when` to leave out a stalled dataset.

## The overview

`create_definition` and `update_definition` take an `overview` beside the document: Markdown for the person who runs the business, written from everything known of them and of the playbook. It says why the function exists, what it does and how it fits, in one to three short paragraphs, with a Mermaid diagram in a fenced block where a flow is worth a picture; less technical, more value. Write it after the document, and write it again with every update.

An overview holds 1 character to 16,384 bytes in UTF-8. The version keeps it as written, and `get_definition` returns it so until an update gives another; an update that leaves it out keeps the overview saved. `list_definitions` leaves it out. [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.

## Availability

Prediction functions are available in every runtime. The runtime keeps the datasets and forecasts in its own process, with nothing to install. See [Functions and availability](../concepts/functions.md#availability).

</div>
