<div v-pre>

# Prediction function format

A prediction function returns numbers learned from the playbook's history or from an uploaded dataset. It predicts one quantity for one series at a time, one or more periods ahead. Each prediction is a [series](output-shapes.md#series): the last periods observed, and each period ahead as a likely value with a low and a high. The API stores the function as a definition of the type `prediction`.

Its document says:

- what it predicts, and over which period of time;
- the data it learns from;
- how a candidate model is judged;
- where a request to train a model goes, and the rules a trainer follows.

## How a prediction function learns

The function's model is a file in a format a [model runtime](model-runtimes.md) of the server executes, such as ONNX. Someone fits the model outside the playbook, and the playbook judges it. The function is the definition; it does not change when its model does. A model goes through these stages:

1. The playbook keeps a **dataset** for the function: one row for each series and period. It builds the rows from its history once the function is saved, or someone uploads them.
2. A **build** is a run that asks for a new version. It writes the training rows from the dataset. It renders the **brief**, the text in the document's body that a trainer reads first.
3. The **trainer** is whoever fits the model: a person, or an agent with an environment that runs code. It reads the brief and the rows and fits models. It uploads each model as a **candidate**, a file in a format the build's brief lists.
4. The playbook scores each candidate on periods the trainer never saw, against simple baselines. The winner becomes the function's next version, with a **card** that records how it was built and how it scored.
5. A later version first runs as a **shadow** beside the current one for some periods. It replaces the current one only when it predicts as well. A person may also have to approve it.
6. The **active version** makes the predictions. A question is a run that asks for one series, and answers its last observed periods and the periods ahead.

## A function document

The source is Markdown with YAML front matter, followed by the brief. This example predicts the orders of each region one and four weeks ahead, from the events `order.placed` the playbook records:

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
  features:
    - { name: basket, of: /total, as: mean }
    - { name: promotion, of: /promotion, as: last }
  given: [promotion]
  window: 156
evaluation:
  holdout: 12
  activate: automatic
source:
  expires: P7D
rules:
  - Train on the rows given and on nothing else
---
Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},
over {{ dataset.window }} weeks from {{ dataset.periods.first }} to {{ dataset.periods.last }}.
Predict {{ dataset.horizons | join: " and " }} weeks ahead. The features are
{% for feature in dataset.features %}{{ feature.name }} ({{ feature.as }}){% unless forloop.last %}, {% endunless %}{% endfor %}.
{% for rule in function.rules %}- {{ rule }}
{% endfor %}
```

`create_definition` takes `type: "prediction"`, a function `name` such as `weekly-orders` and the document as `source`. The saved function has the `media_type` `text/markdown`. The playbook writes its `input_schema` itself, from the document. Its `output_schema` is the [series shape](output-shapes.md#series), what a question answers, and its `details.shape` is `series`; a build's run answers `{ version, winner, candidates }` and says no shape, as [The input and the output](#the-input-and-the-output) sets out. So a document that names `input` or `output` is refused.

Before you write one, settle these with the person:

- The target: the one quantity to predict, and how it is read from each event.
- The grain: the period the target is counted over, a day, a week, a month, a quarter or a year.
- The horizons: how many periods ahead a question asks, such as next week and four weeks out. To ask instead where a whole week, month, quarter or year will land, name that period under `accumulates`.
- The features a trainer may use: the other values of each event a model may learn from, each with how it is aggregated over a period.
- The `given` features: the ones a question supplies for the periods ahead, such as a promotion that is already planned.
- The rules: what the trainer must follow and the model's card must state, one line each.
- Whether a person approves each version. `evaluation.activate` is `automatic` when a version that passes activates on its own. Otherwise it names the interaction function that asks a person to approve.
- Who trains. By default the build waits in the playbook's inbox for the party `source.to` names (`trainer` when left out). `source.through` instead names an interaction function that sends the build where the trainer works.
- How long a build waits for its trainer: `source.expires`, from one minute to 30 days.
- Whether the playbook has enough history. The window must hold the holdout plus two seasons. With no season named, it must hold the holdout plus twice the longest horizon. So weekly periods with a season of 52 need at least the holdout plus 104 weeks. A playbook without that history can upload its rows; see [An uploaded dataset](#an-uploaded-dataset).

## Fields

| Field                       | Meaning                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`               | Optional; what the function predicts, 1 to 1,000 characters                                                                                |
| `predicts.target`           | Required; the name of the quantity, which names its column in the dataset                                                                  |
| `predicts.period`           | Required; `day`, `week`, `month`, `quarter` or `year`                                                                                      |
| `predicts.season`           | Optional; the length of a season in periods, 2 to 366, such as 52 for weeks over a year                                                    |
| `predicts.horizons`         | Required unless `accumulates` is named; the periods ahead a question may ask, 1 to 8 whole numbers from 1 to 52, each once                 |
| `predicts.accumulates`      | Optional, in place of `horizons`; `week`, `month`, `quarter` or `year`, longer than `period`; see [below](#a-total-to-the-end-of-a-period) |
| `predicts.unit`             | Required; text of 1 to 64 characters for the card and the answer, such as `orders`                                                         |
| `predicts.history`          | Optional; how many observed periods a question's answer shows, 0 to 500 and at most the window; twice the longest horizon by default       |
| `data`                      | Required; a projection of the playbook's history or an uploaded `dataset`, with `window` either way; see [The dataset](#the-dataset)       |
| `data.window`               | Required; the periods of history a model is trained on, at most 1,000                                                                      |
| `evaluation.holdout`        | Required; the last periods of the window, held back from the trainer and used to score candidates                                          |
| `evaluation.metric`         | Optional; `mase` (the default), `winkler` or `quantile`                                                                                    |
| `evaluation.coverage_floor` | Optional; 0.5 to 0.99, 0.7 by default: the least share of truths a candidate's interval must hold                                          |
| `evaluation.baselines`      | Optional; the baselines a candidate must beat, `persistence` or `seasonal-naive` or both, each named once                                  |
| `evaluation.confidence`     | Optional; 0.5 to 0.99, 0.9 by default: how sure the playbook must be that a candidate beats a baseline                                     |
| `evaluation.shadow_periods` | Optional; 0 to 52, 0 by default: how many periods a new version runs beside the active one before it replaces it                           |
| `evaluation.activate`       | Required; `automatic`, or `{ approved: <interaction function> }` to have a person approve each version                                     |
| `source.expires`            | Required; how long a build waits for its trainer, an ISO 8601 duration from one minute to 30 days, such as `P7D`                           |
| `source.to`                 | Optional; the party a build's request goes to in the inbox, text of 1 to 256 characters, `trainer` by default                              |
| `source.through`            | Optional; an interaction function that sends the build to its trainer in place of the inbox, so never beside `to`                          |
| `rules`                     | Optional; at most 32 lines in words, each at most 256 bytes                                                                                |

- `evaluation.baselines` is `persistence` when left out, with `seasonal-naive` beside it when a season is named.
- The names of the target and the features are 1 to 64 lowercase letters, digits and underscores, starting with a letter. None may be `series` or `period`, which every row has. No feature may have the target's name.
- The holdout and the window have the bounds under [Bounds](#bounds).
- An approver named under `evaluation.activate` is an active interaction function. Its input schema takes `{ function, version, card }`. Its output schema is an object whose one required property `decision` is `approve` or `reject`.
- A function named under `source.through` is an active interaction function. Its input schema takes `{ build: {} }`. Its answer is an object whose one required property `candidates` is a list of text.
- Both of those functions are checked when the prediction function is saved, so save them first.
- Every problem a save finds is refused with its line, and nothing is saved.

### The input and the output

A run's input has one of two shapes:

- A **question** is `{ series, horizon?, given?, marks? }`:
  - `series` is text of 1 to 256 bytes.
  - `horizon` is one of the function's horizons, to predict that period ahead alone. Without it, the question predicts every horizon the function names.
  - `given` holds a value for each given feature, by name, and for no other, when the function names `given`. The playbook feeds that value to the model for every period ahead.
  - `marks` are at most 8 `{ label, value }`, each label text of 1 to 64 characters, which the answer carries for display and nothing reads. More are refused `invalid_input` at `/input/marks`.
- A **build** is `{ build: {} }`, which asks for a new version.

A question's output is the **prediction**, a [series](output-shapes.md#series) of the function's grain:

| Field      | Value                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`     | `predicts.unit`                                                                                                                                 |
| `period`   | `predicts.period`                                                                                                                               |
| `origin`   | The last observed period                                                                                                                        |
| `lines[0]` | `observed`: the last `predicts.history` periods up to the origin, each value as the dataset's rows hold it; a period with no value is left out  |
| `lines[1]` | `predicted`: one point for each horizon asked, the nearest first, each with its `value`, `low` and `high`; `total` with `accumulates`, as below |
| `marks`    | The question's marks, when it gives them                                                                                                        |

- Each `at` and the `origin` are in the ISO 8601 form of the grain: `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn` or `YYYY`.
- `value` is the 50th percentile, `low` the 10th and `high` the 90th.
- The observed periods are the last of the window the model reads, so the answer reads nothing more.
- The run's record holds `version`, the version of the model that predicted, `runtime`, the model runtime that answered, and `coverage`, 0.8, the share of truths `low` and `high` are meant to hold.

`get_definition` shows the [series shape](output-shapes.md#what-a-saved-definition-shows) as the function's `output_schema`, and `series` as its `details.shape`, as for a reasoning function that declares `output.shape: series`. A build's output is `{ version, winner, candidates }`. `version` and `winner` are null when no candidate beat the baselines.

### A total to the end of a period

Some questions ask where a period will land, such as a quarter's orders from the days so far. That is a total, not a value some periods ahead. `predicts.accumulates` names the enclosing period (`week`, `month`, `quarter` or `year`) in place of `horizons`. A question then asks for the target summed over the rest of an enclosing period. The sum starts at the period after the last observed one. It ends where the enclosing period that holds that period ends. So a question asked as a quarter closes predicts the whole next quarter.

A day sums to a week, a month or a quarter; a week to a quarter or a year; and a month to a quarter or a year. These are refused at save:

- any other pair of grain and enclosing period;
- `horizons` beside `accumulates`, or neither of them;
- a target aggregated as `last` or `mean`, since a sum of such values says nothing.

For the holdout, the window and the history, the longest horizon is then the most periods the enclosing period holds: 7, 31 or 92 days, 14 or 53 weeks, or 3 or 12 months.

Such a question is `{ series, given?, marks? }`, with no horizon. Its `given` holds each given feature's value for the periods summed. Its prediction's second line is named `total`, in place of `predicted`, and holds one point, the total:

- its `at` is the last period the enclosing period holds, in the grain's form, since a series holds one grain: `2026-10-18` for the week 2026-W42 of a daily function;
- its `value`, `low` and `high` are the total from the period after the origin to that one;
- the run's record names the enclosing period as `total_to`, such as `2026-W42`, and the run's words say the total by its end, such as "78 visits by the end of 2026-W42".

The dataset and its files are the same as for horizons. The trainer fits a model of the total. [The signature](#the-signature-of-a-candidate) feeds the model the number of periods it sums, as `h`. The brief reads the enclosing period as `dataset.accumulates`.

## The dataset

The playbook records events one at a time, while a forecast counts by period. So the playbook keeps a dataset for each data part: rows keyed by series and period. A data part has a `window` and takes one of two forms:

- a projection of the playbook's history, with `events`, `time`, `series` and `target`, and optionally `features` and `given`;
- `dataset`, the SHA-256 of an uploaded dataset.

How edits affect the dataset:

- Two functions whose data parts fold the same rows at the same grain share one dataset.
- An edit that leaves the rows alone changes nothing. A wider `window` or other `given` features are such edits, since a build and a question read those from the same rows.
- An edit that changes the rows (a filter, a pointer, an aggregation, a feature or the grain) starts a new dataset from the first event of the history. The old one is dropped once no active function names it.

| Field           | Meaning                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data.events`   | 1 to 8 filters, as a recall function names its events: the event's `type`, any other attribute of the event written out, and optionally a `data` test over `$data` |
| `data.time`     | `event` for the time of the event itself, or a JSON Pointer into its data that holds an ISO 8601 time, such as `/placed_at`                                        |
| `data.series`   | A JSON Pointer to the value that names the series, text of 1 to 256 bytes                                                                                          |
| `data.target`   | `{ as, of }`. `as` is how the target is aggregated over a period: `count`, `sum`, `last` or `mean`. `of` points to the value; `count` leaves it out                |
| `data.features` | At most 40 of `{ name, of, as }`, aggregated as the target is                                                                                                      |
| `data.given`    | The names among the features that a question supplies for the periods ahead                                                                                        |
| `data.dataset`  | In place of the projection: the SHA-256 of an [uploaded dataset](#an-uploaded-dataset), with `features` naming its columns after the target, in order              |

A `time` or `series` pointer is refused at save when none of the named event types holds a value there, such as `/output/region` under `run_rejected`. A recall function's filters are checked the same way.

For each event a filter takes, in the order the playbook recorded them, the dataset:

1. reads the time, in UTC, and finds its period. A week runs from Monday and is numbered as ISO 8601 numbers weeks, so `2026-W01` starts on 2025-12-29. A quarter is three calendar months.
2. reads the series, then the target and each feature.
3. adds the event to the row of that series and period:
   - `count` adds one;
   - `sum` adds the value;
   - `last` takes the value of the latest event by its time, whatever order the events were recorded in;
   - `mean` keeps the sum and the count;
   - a value that is missing or null adds nothing.

The dataset passes over an event, counts it and notes it in the server's log, when:

- its time is not an ISO 8601 time with its offset on a day of the calendar (a date alone among them), or names a leap second;
- its series is not text of 1 to 256 bytes;
- its target or a feature is a value that is not a finite number;
- its data test fails.

Such an event adds to no row.

A data test can also run out of time or memory. No event causes that, so the event is never passed over. Instead:

- The dataset stops before that event. It tries the event again at the server's next sweep, its regular pass over pending work, every second by default.
- After twenty tries without folding a whole page, the dataset stalls. Its phase becomes `stalled`, the server's log notes it, and it folds nothing more.
- A data part that changes starts a dataset of its own.

`get_definition` of a prediction function adds the dataset's `standing`:

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

A function that names an uploaded dataset has the standing `{ kind: "uploaded", sha256 }` and none of the other fields.

### The rows a build reads

A build reads the dataset as two files in CSV, each kept under its SHA-256:

- the **training rows**, which a trainer reads, leave out the last `holdout` periods;
- the **scoring rows**, which only the playbook reads, hold them too.

Both are read at one checkpoint of the dataset, even if it folds further while they are written. Both cover the window: a dense grid of the `window` periods that ends at the last period closed when the build starts. Their format:

- The header is `series,period,` followed by the target and the features in the document's order, such as `series,period,orders,basket,promotion`.
- Each row is one series and one period. Rows are sorted by series, as their UTF-8 bytes sort, and then by period.
- A period is written in the ISO 8601 form of the grain, and each value as a JSON number.
- A period with no event is 0 for `count` and `sum`: a real observation of nothing. For `last` and `mean` it is an empty cell. So is a feature that no event of the period carried.
- A series observed in fewer than the holdout plus one periods of the window is left out.
- The files are UTF-8 CSV as RFC 4180 writes it, each record ended by CRLF.

```text
series,period,orders,basket,promotion
north,2026-W40,2,30,1
north,2026-W41,0,,
"south, coast",2026-W40,1,12.5,
"south, coast",2026-W41,0,,
```

### An uploaded dataset

A playbook that has no history yet can be given its rows. The upload is HTTP alone, not a tool:

- The route is `PUT /v1/orgs/{org}/playbooks/{playbook}/datasets/{sha256}`, under `playbook:write`. `sha256` is the SHA-256 of the body.
- The body is `text/csv` with its `Content-Length`, at most 64 MiB.
- It holds at most 200,000 rows over at most 1,000 series. Each record ends with CRLF or LF.
- It follows the format above, with any target and feature names. The header is `series,period` and then the columns. There is one row for each series and period, sorted by series and then period. Every period has one ISO 8601 form, and each value is a JSON number or empty.

The upload returns `{ dataset, bytes, rows, series, columns, period, first_period, last_period }`. It is refused, and nothing is kept, when:

- the body breaks the format: `invalid_input`, with the line of its first fault;
- the body's digest is not the one in the path: refused with both digests.

A function names the dataset as `data.dataset`. Saving the function checks that:

- this playbook keeps the dataset;
- its rows are of the grain `predicts.period` names;
- its header names `predicts.target` and then the features of `data.features`, in their order.

Each fault is refused at its line. A data part that names an uploaded dataset:

<!-- prettier-ignore -->
```yaml
data:
  dataset: 3f2ac1d0e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d
  features: [basket, promotion]
  given: [promotion]
  window: 156
```

## The brief

The body of the document is the brief, a Liquid template that a build renders for the trainer. It reads two variables, `dataset` and `function`, and nothing else:

| Variable                                            | Value                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `dataset.rows`, `dataset.series`                    | How many rows and series the training rows hold                                                     |
| `dataset.periods`                                   | `grain`; `season`, null when none is named; and the `first` and `last` periods of the training rows |
| `dataset.window`, `dataset.holdout`                 | The window and the periods held back                                                                |
| `dataset.features`                                  | A list of `{ name, as, given }`, `as` null for an uploaded dataset                                  |
| `dataset.horizons`                                  | The horizons, as a list of numbers, empty with `accumulates`                                        |
| `dataset.accumulates`                               | The enclosing period of `accumulates`, null without it                                              |
| `function.name`, `function.target`, `function.unit` | The function's name, its target and its unit                                                        |
| `function.rules`                                    | The rules, as a list of text                                                                        |

- Lists have `first`, `last` and `size`.
- A template may use the filters listed in [Templates](template.md#filters), the `templates` guide, the same in every template.
- The brief is compiled when the function is saved. It is also rendered then, over the largest dataset the bounds admit: 200,000 rows over 1,000 series.
- It is refused at its line when it does not compile, or when it:
  - reads a name not in `dataset` or `function`;
  - writes a list or a mapping where text goes;
  - renders past 64 KiB;
  - stops at a filter that refuses its value, such as `money` over text: `The brief does not render: money takes a number, or text that is a decimal number`;
  - takes longer than the 200 ms a template renders in.

Write what the trainer needs to know that the rows do not say: what the target means, why a feature matters, what a good model must not do.

The build closes the brief with a section `## Candidates` naming the formats an upload takes; the bounds above are the brief's before it.

## A build

A build asks a trainer for candidate models. It scores each against rows the trainer never saw, and keeps the best as the function's next version. To ask for one, run the function with the input `{ build: {} }` through `run_definition`. A person, a schedule and a workflow step all ask this way. The run returns `started` and waits for its trainer; `get_run` shows it until it ends.

A build can be refused as it starts. Its run then records only that it started and was rejected, with no content:

- `conflict`, `build_in_flight`: another build of the function has not ended. The words name its run.
- `unavailable`, `builds_full`: the function used its builds of the day, with `because` `builds_of_the_day`, and the words say when it may ask again; or the server scores as many builds as it may at once.
- `unavailable`, `requests_full`: the build would ask through the inbox, and the playbook already holds as many open requests as it may.
- `unavailable`, `dataset_not_ready`: the dataset is waiting or rebuilding, or it stalled, with `because` `stalled`.
- `conflict`, `dataset_too_large`: the dataset is past the bounds a build reads, with the figures it counted.
- `conflict`, `baseline_perfect`: a baseline already scores 0 on the metric wherever the metric scores it, so no candidate can beat it; see below.
- `conflict`, `unscorable`: no series moved during the training periods, so `mase` can judge no candidate; see below.
- `unavailable`, `model_process_busy`: every model process a build may hold stayed taken for the 30 seconds the build waits to check its baselines. Asking again shortly may succeed.
- `unavailable`, `model_process_failed`, with `because` `baseline_check`: the model process that checks the baselines ended before it answered. Asking for the build again may succeed.
- `conflict`, `unworkable`: the brief renders past 64 KiB over this dataset.

Of these refusals:

- A function has 4 builds a day unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise.
- The server scores at most `PREDICTION_BUILDS_AT_ONCE` builds at once. A build that waits for its trainer or an approval is not counted.
- A build whose version is in its shadow, or awaits its approval, has ended its run, so it is not in flight.
- A build refused for its dataset, its baselines or its brief takes none of the day's builds.
- Before it writes anything, the build reads the builds in flight and the builds of the day from the function's models stream. It claims its place on that stream once its rows and its brief are written.
- Two builds asked at the same moment are decided one after the other, and the second is refused at its claim. The rows and the brief it wrote stay kept under their digests, though no record names them.
- The builds the server is scoring, and the playbook's open requests, are counted before the build is decided. So builds asked at the same moment may pass those two bounds, by up to their number.

Otherwise the build writes the two files of [The rows a build reads](#the-rows-a-build-reads) and scores each baseline it names over the scoring rows, as [How a candidate is scored](#how-a-candidate-is-scored) does, in a model process it waits up to 30 seconds for. A candidate must beat each walked baseline, and no score is below 0. So when a walked baseline scores 0 on `evaluation.metric` wherever that metric is defined, and is defined somewhere, the build is refused `baseline_perfect` before it renders its brief. This happens when the periods held back never move: `persistence` then predicts each one exactly, and its `mase` is 0. When no series moved during the training periods, `mase`, which scales each error by that movement, scores no period held back, so no candidate could be judged against a walked baseline, and the build is refused `unscorable`. A series with nothing held back is left out, and a build whose baselines walk no series goes ahead, judged by its coverage alone; `winkler` and `quantile` judge such series. Either way, a build can be asked again once the series moves. Otherwise the build renders the brief over the two files, closes it with a section `## Candidates` that names the formats the server's model runtimes execute for the function, and asks its trainer:

- With `source.to`, the default, the build is a request in the playbook's inbox. `list_interactions` lists it for its party. Its message, within 8 KiB, names the build's run id, its three routes, the formats an upload takes and the opening of the brief. Its answer is `{ candidates, recipe?, limitations? }`.
- With `source.through`, the build starts that interaction function with the input `{ build: { run_id, function, brief_sha256, routes, formats, expires_at } }`. That function's request is the one the inbox lists, and its answer is the build's.

### Sending a build through an interaction function

The function that `source.through` names is an active interaction function of the playbook, so save it before the prediction function:

- Its message is all the trainer receives of the build. It renders the build's run id, `{{ input.build.run_id }}`, and its three routes: `{{ input.build.routes.brief }}`, `{{ input.build.routes.rows }}` and `{{ input.build.routes.candidates }}`. The save does not read the message.
- The save checks the function against the input `{ build: {} }`. So its input schema declares `build` as an object, without requiring any of its fields.
- Its output schema is an object whose one required property `candidates` is a list of text. `recipe` and `limitations` sit beside it if the function takes them.

This one waits in the inbox for its party. One that names a tool in `deliver` sends the build where the trainer works; see [Sending through a tool](interaction-format.md#sending-through-a-tool).

<!-- prettier-ignore -->
```markdown
---
description: Sends a build of a prediction function to its trainer and takes the candidates back
to: trainer
expires: P7D
input:
  schema:
    type: object
    required: [build]
    properties:
      build: { type: object }
output:
  schema:
    type: object
    required: [candidates]
    properties:
      candidates: { type: array, items: { type: string } }
      recipe: { type: string }
      limitations: { type: string }
---
Build {{ input.build.run_id }} of {{ input.build.function }} waits for its candidates until {{ input.build.expires_at }}.
Read the brief with GET {{ input.build.routes.brief }} and the training rows with GET {{ input.build.routes.rows }},
upload each candidate with POST {{ input.build.routes.candidates }}, and answer with the SHA-256 of each.
```

Save it as `send-build`. The prediction function's `source` then names it as `through: send-build`, beside `expires` and in place of `to`.

### The trainer's path

A trainer is whoever fits the model: a person, or any agent with an environment that runs code. That environment calls the runtime over HTTP, reads the rows, fits a model with the libraries it needs and writes the file it exports. The trainer works outside the playbook:

1. Find the build. `list_interactions` with `to` set to the function's party lists its request; the party is `trainer` unless `source.to` names another. The request's `run_id` is the build's. Its message names the three routes below and how to answer. With `source.through`, the message of that function's request carries the build's `run_id` and routes; see [Sending a build through an interaction function](#sending-a-build-through-an-interaction-function).
2. Read the brief and the training rows over the routes below, sending the key as `Authorization: Bearer <key>`.
3. Fit a model to the rows, as the brief and the rules say.
4. Export it in a format the brief lists, in [the signature of a candidate](#the-signature-of-a-candidate), within 64 MiB.
5. Upload each candidate, at most 8, and keep the SHA-256 each upload returns as `candidate`.
6. Answer the request, under the `run_id` that `list_interactions` gave, through the tool `answer_interaction`, or over HTTP alone with `POST /v1/orgs/{org}/playbooks/{playbook}/runs/{run_id}/answer` and the same key. The answer is `{ "candidates": [<the SHA-256 of each>] }`, with `recipe` and `limitations` in words beside them if the trainer wrote them. Over HTTP, the body is `{ "answer": { "candidates": [...] } }`.

An agent that can only call tools, as an agent connected to the runtime over MCP alone is, cannot train. The three routes are served over HTTP alone, and fitting and exporting a model runs code. It needs an environment that runs code beside it. That environment reaches the runtime over HTTP with a key that may read and write the playbook. It reads, fits, exports and uploads. The agent can still find the build and answer the request itself, with the digests that environment uploaded.

| Route                                  | Returns                                    | Needs            |
| -------------------------------------- | ------------------------------------------ | ---------------- |
| `GET /runs/{run_id}/build/brief`       | The brief, as `text/markdown`, whole       | `playbook:read`  |
| `GET /runs/{run_id}/build/rows`        | The training rows, as `text/csv`, streamed | `playbook:read`  |
| `POST /runs/{run_id}/build/candidates` | `{ candidate, bytes, format, signature }`  | `playbook:write` |

The routes are relative to `/v1/orgs/{org}/playbooks/{playbook}` and served over HTTP alone. Send the caller's own key as `Authorization: Bearer <key>`; a runtime in [local mode](../self-host/security.md#local-mode) does not ask for one. The routes serve only a build that waits for its answer:

- a run the playbook does not hold is refused `not_found`;
- a run that is no build is refused `conflict` with the kind `not_a_build`;
- a build that took its answer or ended is refused `conflict` with the kind `build_ended`.

A candidate is the model's file, sent as `application/octet-stream` with its `Content-Length`, its format in the query, `?format=onnx`:

- A body without a `Content-Length` is refused with 411, and one past 64 MiB with 413, before the body is read.
- `format`, one the brief lists, may be left out when it lists one; another is refused `invalid_input` at `/format` before the body is read.
- The runtime of its format checks the file in a model process within 30 seconds. The playbook refuses it as `invalid_input` when the runtime does not load it or finds its signature is not the one the function feeds, and any file once the build has its 8 candidates.
- It responds `unavailable` with the kind `model_process_busy` while every model process a build may hold is taken. A check holds one of the processes that builds share, never one a question needs.
- The same accepted bytes sent again return the same result, and nothing is recorded for them twice. A refused file sent again is checked again and refused again.
- Uploads checked at the same moment may pass eight. The one recorded past the eighth is refused `conflict`, "The build took its 8 candidates meanwhile", and records nothing.

The answer names at most 8 candidates by their SHA-256, each one uploaded to this build. `recipe` and `limitations` say in words how the candidates were trained and what they do not do well. Each is at most 8 KiB, and both are kept with the version. These are refused `invalid_input` at their pointer:

- a candidate the answer names that was not uploaded;
- a `recipe` or `limitations` past 8 KiB.

An answer that comes through the function of `source.through` is checked the same way. When it fails, the build ends `rejected` with the reason `invalid_input`, its errors under `/answer`.

### The signature of a candidate

A candidate takes the target, and the features the function names, over the periods up to an origin. It returns the 10th, 50th and 90th percentiles of each step ahead. The runtime of a candidate's format checks it against what the function feeds. In ONNX, the release's format, they are tensors:

| Tensor  | Shape       | Type    | What it is                                                                                                       |
| ------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `y`     | `[1, L]`    | float32 | The target over `L` periods up to the origin; `NaN` where a period was not observed                              |
| `x`     | `[1, L, F]` | float32 | The features over the same periods, in the document's order, present when the function names features            |
| `given` | `[1, H, G]` | float32 | The `given` features for the `H` periods ahead, in the document's order, present when the function names `given` |
| `h`     | `[1]`       | int64   | With `accumulates`, how many periods the total sums                                                              |
| `q`     | `[1, H, 3]` | float32 | The output: the 10th, 50th and 90th percentile of each step ahead; with `accumulates`, `[1, 1, 3]`               |

- The leading axis of every tensor is 1 or dynamic.
- `L` may be dynamic, and the playbook feeds the whole window. Or it is fixed, and the playbook feeds the last `L` periods, `NaN` before the first.
- `H` is the longest horizon, fixed or dynamic. With `accumulates`, it is the periods to the end of the enclosing period, so dynamic.
- With `accumulates`, `q` holds the one total.
- The model takes no other input and returns no other output. Its opset is 13 or later.
- Its IR version is one this release's ONNX Runtime loads: 13 or earlier. Recent `onnx` packages write IR version 14 by default, which is refused as `failed_to_load`. Set the model's IR version when you export it.

### How a candidate is scored

The playbook walks each candidate over the scoring rows, one at a time, in a model process, by the runtime of its format. Each held-back period is an origin. At each origin, it feeds the series up to that origin and reads the steps ahead that the holdout holds. It scores each horizon over every series:

- `mase`: the mean absolute error, scaled by the error of the naive forecast over the training periods (one period to the next, or one season when a season is named);
- `winkler`: the width of the interval from the 10th to the 90th percentile, plus ten times how far a truth falls outside it;
- `quantile`: the pinball loss of the three percentiles;
- the coverage: the share of truths the interval holds.

It walks the baselines over the same origins, each with an interval from its own errors over the training periods. `persistence` carries the last observed value forward. `seasonal-naive` takes the value one season earlier. A baseline that no series can be walked by is not walked.

For each baseline, it estimates `p_better`: how sure it is that the candidate is better. It uses a moving-block bootstrap of the differences at each origin, with 1,000 resamples drawn from a seed of the build's run id. A block is a season long when three such blocks fit the origins. Otherwise it is the cube root of the number of origins, rounded up. That way a season as long as the holdout never makes every resample the same.

A candidate is disqualified when:

- no runtime of the server executes its format, as `not_loaded`;
- its model process takes longer than 10 minutes, runs out of memory or ends;
- it returns a tensor of another shape, a number that is not finite, or, at any origin, a 10th percentile above its 50th or a 90th below it, which a question would refuse;
- its interval holds fewer truths than `coverage_floor`;
- it does not beat every walked baseline with the `confidence` asked.

Of the others, the one with the lowest mean of `metric` over the horizons wins.

With `accumulates`, the quantity scored is the total to the end of the enclosing period:

- `persistence` is the run-rate: the mean of the enclosing period's periods so far, times the periods left;
- `seasonal-naive` is the sum of the same periods one season earlier;
- `mase` is scaled by the error of the run-rate over the training periods.

### How a build ends

A build keeps a winner that beats the baselines as the function's next version. The version's card holds, within 4 KiB:

- the build, and who trained it;
- the dataset's digests and figures;
- the file's digest, size, `format` and `signature`, and the `runtime` that scored it;
- the features;
- the scores, the coverage, and `p_better` against each baseline;
- the baselines' scores;
- the rule the version activates under.

The version also keeps its `recipe` and `limitations`.

The run succeeds with `{ version, winner, candidates }`. Each candidate has its `verdict`: `won`, `scored`, or why it was disqualified. `version` and `winner` are null when no candidate won. Otherwise the build ends `rejected`, as [How a run ends](#how-a-run-ends) lists: unanswered, cancelled, or with an answer that fails its check. A build whose baseline is already perfect ends sooner: it is refused `baseline_perfect` as it starts, before it asks its trainer, since every candidate would be `not_better`.

The first version a function builds activates under its rule on its holdout alone. When the function's dataset is a projection, a later version first runs a shadow beside the active version:

- The shadow lasts `shadow_periods` closes of the grain, or of the enclosing period with `accumulates`.
- At each close, both versions predict every series. Once the predicted periods close, the predictions are graded against what happened, over the series both versions predicted.
- Some series are counted apart: a series without a truth, and one for which a version returned no number, a number that is not finite, or a 10th percentile above its 50th or a 90th below it.
- The new version passes its shadow when its `metric` over those series is no higher than the active version's. It fails otherwise. It also fails when it predicted nothing the active version did, and passes when the active version predicted nothing.
- While neither version has a graded series, for example before the first truth arrives, the shadow is undecided. It runs one more close, up to 52 closes in all. A shadow that reaches 52 without a graded series fails. Its `shadow_failed` names the closes that graded nothing, and the version is refused `shadow_failed`.
- A version passes at once when its function reads an uploaded dataset, which gains no rows, or has `shadow_periods: 0`.
- Only the newest version challenges. When a version is built while an earlier one is in its shadow or waits for approval, the earlier one is refused and its approval request cancelled. The new one runs a shadow of its own.

A version that passes activates when `activate` is `automatic`. With `{ approved: <interaction function> }`, that function is asked with `{ function, version, card }`. The version activates when the answer is `approve`, and the fact names who approved. It does not activate when the answer is `reject` or nobody answers. Every outcome is a fact on the function's models stream:

- `version_activated`, with its rule;
- `activation_refused`, with its `because`: `shadow_failed`, `approver_rejected`, `unanswered` or `superseded`.

`get_definition` adds two fields beside the dataset's `standing`:

- `models`: the `active` version and its data digest, the `latest`, how many `versions` the function built, and the `challenger` in its shadow with its predictions, grades and result.
- `build`: the newest build not yet settled (in flight, in its shadow or awaiting its approval). It has its `standing`, `requested_at` and `expires_at`, and its candidates uploaded and scored.

### Activating a version

`POST /v1/orgs/{org}/playbooks/{playbook}/definitions/prediction/{name}/activate` makes a version the function built its active one, whatever its shadow or its approver decided. It is served over HTTP alone, needs `playbook:write` and takes `{ version }`. Activating an earlier version again is a rollback. It returns `{ function, version, rule, activated_at }`. It is refused:

- `not_found` for a version the function did not build;
- `conflict` with the kind `already_active` for the active one.

## A question

A question is `{ series, horizon?, given?, marks? }`, or `{ series, given?, marks? }` with `accumulates`. The active version predicts from the series' last window:

- over a projection, the dataset's rows up to the last closed period at its checkpoint;
- over an uploaded dataset, the rows up to its last period. A model process reads them from the upload, so the server parses none of it.

The model process that holds the version's file returns the prediction within 10 seconds. The output is the prediction of [The input and the output](#the-input-and-the-output). The run's record holds the `version`, the `coverage`, the `origin`, the `dataset_checkpoint` and the `duration_ms`. A question can also be refused, for example before a version is active; [How a run ends](#how-a-run-ends) lists each case.

For example, `{ "series": "north", "given": { "promotion": 1 } }` asks `weekly-orders` for both its horizons, and its answer shows the 8 weeks observed before them:

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
        { "at": "2026-W42", "value": 138.5, "low": 126.25, "high": 151 },
        { "at": "2026-W45", "value": 141, "low": 122.75, "high": 160.5 }
      ]
    }
  ]
}
```

## How a run ends

A question ends within its call and cannot be cancelled while it runs:

| Ending                                                             | When                                                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                                        | The prediction is its output                                                                                                             |
| `invalid_input`                                                    | The input is neither a question the function takes nor `{ build: {} }`, or the series is not in the dataset's window, at `/input/series` |
| `conflict`, kind `no_active_version`                               | No version is active yet                                                                                                                 |
| `conflict`, kind `data_changed`                                    | The data part, `horizons`, the `given` features or `accumulates` changed after the active version's model was built for them             |
| `unavailable`, kind `dataset_not_ready`                            | The dataset is waiting or rebuilding; with `because` `stalled`, it stalled                                                               |
| `unavailable`, kind `model_process_busy`                           | Every model process is taken                                                                                                             |
| `unavailable`, kind `model_process_failed`                         | The model process ended before it returned, such as when it ran out of time or memory                                                    |
| `unavailable`, kind `model_process_failed`, because `not_finite`   | The model returned a number that is not finite, or a shape its signature does not give; asking again does not change it                  |
| `unavailable`, kind `model_process_failed`, because `not_in_order` | The model returned a low above its likely value or a high below it, which no series holds; asking again does not change it               |
| `unavailable`, because `no_model_runtime`                          | Of the kind `model_process_failed`: no runtime of the server executes the active version's format                                        |
| `failed`                                                           | The runtime itself broke down                                                                                                            |

A build finishes later, so `run_definition` returns it `started` and `get_run` shows how it ended:

| Ending                                     | When                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                | It scored every candidate its answer named; its output is `{ version, winner, candidates }`, `version` and `winner` null when none won or none was named                            |
| The refusals of [A build](#a-build)        | It was refused as it started, with one of the kinds listed there                                                                                                                    |
| `rejected` as `unanswered`, kind `expired` | Nobody answered its request before `source.expires`                                                                                                                                 |
| `rejected` as `unanswered`                 | Through `source.through`, the function's run ended without an answer. The kind is that run's own if it ended `unanswered`, and `undelivered` if it ended otherwise or never started |
| `rejected` as `invalid_input`              | Through `source.through`, the answer named a candidate not uploaded to the build, or a `recipe` or `limitations` past 8 KiB; its errors are under `/answer`                         |
| `rejected` as `cancelled`                  | Cancelled while starting, waiting or scoring: by `cancel_run` (kind `requested`), or by the workflow that waited for it, which ran out of time or ended first                       |
| `failed`                                   | The runtime itself broke down                                                                                                                                                       |

A build's history shows:

- `dataset_assembled`, with the digests and the figures of its two files;
- each candidate taken or refused, as `candidate_uploaded` or `candidate_refused`;
- an inbox build's answer, as `request_answered`;
- each candidate's score, as `candidate_scored` or `candidate_disqualified`, and each baseline, as `baseline_scored` or `baseline_not_walked`;
- the run's end.

The function's own facts are on its models stream, `models/<function>`, among the playbook's events:

- `build_asked` when a build starts;
- `build_ended` for a finished build, recorded when the function's next build starts;
- `version_built`, with the card;
- `shadow_predicted` and `shadow_graded` as the shadow's periods close;
- `shadow_passed` or `shadow_failed`;
- `version_activated` or `activation_refused`.

A version's `recipe` and `limitations` are kept as content. `get_event` of its `version_built` shows them whole, beside their digests.

## Bounds

A save is refused past these bounds:

| Bound                    | Value                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horizons                 | 1 to 8, each 1 to 52 periods                                                                                                                                                   |
| History                  | 0 to 500 periods, at most the window                                                                                                                                           |
| A total                  | A day to a week, a month or a quarter, at most 7, 31 or 92 days; a week to a quarter or a year, at most 14 or 53 weeks; a month to a quarter or a year, at most 3 or 12 months |
| Holdout                  | At least twice the longest horizon and at least 8, at most half the window                                                                                                     |
| Window                   | At least the holdout plus two seasons, or plus twice the longest horizon; at most 1,000                                                                                        |
| Season                   | 2 to 366 periods                                                                                                                                                               |
| Shadow periods           | 0 to 52                                                                                                                                                                        |
| Filters, features, rules | 8 filters; 40 features; 32 rules of 256 bytes each                                                                                                                             |
| A build's wait           | One minute to 30 days                                                                                                                                                          |
| The brief                | 64 KiB rendered over the largest dataset, within the 200 ms a template renders in                                                                                              |
| Functions a playbook     | 32 active, unless the server's `PREDICTION_MAX_FUNCTIONS` says otherwise, from 1 to 1,000                                                                                      |

The data and the runs are bounded so:

| Bound                   | Value                                                                                                                                                  | When it is reached              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| A series                | 1 to 256 bytes of text                                                                                                                                 | The event is passed over        |
| A dataset               | 200,000 rows over 1,000 series, 64 MiB as CSV                                                                                                          | A build or an upload is refused |
| A question's run        | 10 seconds once its job holds a model process, after a wait of up to 10 seconds for one; over an uploaded dataset, a window job is bounded alike first | The run ends `unavailable`      |
| A build's run           | Its wait, the scoring of eight candidates at ten minutes each, and a minute to start                                                                   | The run ends                    |
| Builds a function a day | 4, unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise, from 1 to 100                                                                       | The build is refused            |
| Candidates of a build   | 8, each a file of at most 64 MiB with its `Content-Length`                                                                                             | The upload is refused           |
| A candidate's check     | 30 seconds to load in a model process                                                                                                                  | The upload is refused           |
| A candidate's scoring   | 10 minutes in a model process                                                                                                                          | The candidate is disqualified   |
| A recipe, a limitation  | 8 KiB of text each                                                                                                                                     | The answer is refused           |
| A version's card        | 4 KiB as JSON                                                                                                                                          | Its features are kept apart     |

## In a workflow

A workflow calls a prediction function as it calls any function, with `call: run_definition` and `type: prediction`. The task's output is the run's output; see [Calling a function](workflow-format.md#calling-a-function).

- A question written out, such as `{ call: run_definition, with: { type: prediction, name: weekly-orders, input: { series: north, horizon: 1, given: { promotion: 1 } } } }`, ends within its call. Its own maximum is 10 seconds, so the task waits at most 10 seconds plus one minute.
- A build, `input: { build: {} }`, waits for its trainer. Its own maximum is its `source.expires`, plus a minute to start and ten minutes for each of eight candidates. The task waits for that maximum plus one minute, but never past the time the workflow itself has left. It uses no server resources while it waits.
- A build's output is `{ version, winner, candidates }`, so the next task can branch on `version`. It is null when no candidate won.
- A task whose input holds an expression, as the one below does, waits as long as a build. What it asks is known only when it runs.

This workflow forecasts a region's orders for next week from `weekly-orders`, given whether a promotion is planned. The task's output is the series the function answers, and a workflow that needs one number reads the likely value of the first predicted point, `lines[1].points[0].value`. While the function has no active version, the workflow returns no forecast:

```yaml
document:
  dsl: '1.0.3'
  namespace: orders
  name: next-week-orders
  version: '1.0.0'
  summary: Forecasts a region's orders for next week, or returns none while no version is active.
input:
  schema:
    document:
      type: object
      properties:
        region: { type: string }
        promotion: { type: number }
      required: [region, promotion]
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
                given: { promotion: '${ $data.promotion }' }
            output:
              as: '${ ({ forecast: $data.lines[1].points[0].value }) }'
      catch:
        errors:
          with: { status: 409 }
        when: '${ $error.kind == "no_active_version" }'
        do:
          - none: { set: { forecast: null } }
```

`run_definition` of `next-week-orders` takes an input such as `{"region": "north", "promotion": 1}`. Before `weekly-orders` has an active version, its question is refused `conflict` with the kind `no_active_version`. The `catch` takes that, and the run succeeds with `{"forecast": null}`. Once a version is active, the run succeeds with `{"forecast": <the likely value>}`, such as `{"forecast": 138.5}`. To keep the range too, read the whole point, `lines[1].points[0]`, which holds its `at`, `value`, `low` and `high`. Any other refusal ends the workflow's run, as below.

A run that does not succeed raises the error of its rejection:

- A build nobody answered raises the [problem type](http.md#responses-and-errors) `https://on.auto/problems/unanswered`, status 410, with the kind `expired`. Only a `catch` that names that type or status 410, or catches every error, takes it. So a workflow handles an unanswered build only on purpose.
- A refusal raises status 503 for `unavailable` and 409 for `conflict`, with its `kind` and `because`.
- `model_process_busy`, and a dataset still being built, pass with time. So a retry on status 503 suits a build as it suits a question.
- These do not change when tried again: `builds_full` with `because` `builds_of_the_day`, a `stalled` dataset, a `not_finite` or `not_in_order` result, and `no_model_runtime`. Neither do `no_active_version` and `data_changed`, until a build makes a version. So leave 409 out of a retry policy, and read `$error.because` in a `when` to leave out the rest.

A workflow on a [schedule](workflow-format.md#triggers) can ask for a build on that schedule, within the builds a function may ask for in a day.

## The overview

`create_definition` and `update_definition` take an `overview` beside the document: Markdown for the person who runs the business, written from everything known of them and of the playbook. It says why the function exists, what it does and how it fits, in one to three short paragraphs, with a Mermaid diagram in a fenced block where a flow is worth a picture; less technical, more value. Write it after the document, and write it again with every update.

An overview holds 1 character to 16,384 bytes in UTF-8. The version keeps it as written, and `get_definition` returns it so until an update gives another; an update that leaves it out keeps the overview saved. `list_definitions` leaves it out. [Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows, with `used_by`, the definitions of the playbook that use this one.

## Availability

Prediction functions are available in every runtime. The runtime keeps the datasets, scores the candidates and predicts, running each model in a model process of the server, through the [model runtime](model-runtimes.md) of its format. A trainer fits its models outside it. See [Functions and availability](../concepts/functions.md#availability).

</div>
