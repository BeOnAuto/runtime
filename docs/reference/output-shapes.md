<div v-pre>

# Output shapes

A shape is a JSON Schema that the runtime owns, for what a definition produces: a series over time, values by category, a table or a text. A shape says what the data is, never what it measures. The shape fixes the fields; the playbook supplies the names, the labels and the units. Auto Studio draws any output that declares a shape, whatever its type and its domain.

A reasoning function, a computation function and a workflow can declare one with `output.shape`. The shape's schema is then the definition's output schema, and the runtime checks each output against it, together with the rules a schema cannot state. A run says the shape its own output takes, as [What a run shows](#what-a-run-shows) sets out, and Auto Studio draws a run's output from it.

A prediction function declares no shape, and its questions answer a `series`: each question's answer is the observed periods and the periods ahead of its series, checked against the shape before it is answered, as [The input and the output](prediction-format.md#the-input-and-the-output) sets out, and the function shows the shape as a definition that declares it does. A function that predicts a total to the end of a period answers its total as one point of a line named `total`, at the last period of the grain that the enclosing period holds, since a series holds one grain; its run's record names the enclosing period.

## Declaring a shape

`output.shape` names one of the four shapes: `series`, `categories`, `table` or `text`.

```yaml
output:
  shape: series
```

These are refused when the definition is saved, each with its line:

- `output.schema` beside `output.shape`, at `/output/schema`, since the shape's schema is the output schema;
- a name that is no shape, at `/output/shape`: `Expected the name of a shape: series, categories, table, or text`.

What the shape changes depends on the type, and a prediction function answers one without declaring it:

| Type                 | With `output.shape`                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reasoning function   | The answer is JSON of the shape, so `output.format` is `json` or left out; `text` is refused. The model is asked for the shape's schema, and an answer that does not match fails as `output_invalid`. See [Answers that are JSON](reasoning-format.md#answers-that-are-json)                                                                |
| Computation function | The program's `Output` type is the shape's. An output that does not match ends the run as `conflict` of the kind `unworkable`. See [How a run ends](computation-format.md#how-a-run-ends)                                                                                                                                                   |
| Workflow             | `output.shape` sits beside `output.as`, which shapes the output first. An output that does not match ends the run as `conflict` of the kind `unworkable`. See [How a run ends](workflow-format.md#how-a-run-ends)                                                                                                                           |
| Prediction function  | It declares no `output.shape`. A question answers a `series`, checked against the shape, and an answer whose low is above its likely value or whose high is below it ends the run as `unavailable` with the because `not_in_order`; a build answers no shape. See [The input and the output](prediction-format.md#the-input-and-the-output) |

Each issue is worded as a schema's is, at its JSON pointer, such as `/lines/0/points/2/at: Expected a time later than the point before it`. The rejection of a computation function or a workflow names at most three, and the `output_invalid` of a reasoning function at most 20. A definition without `output.shape` keeps its own `output.schema`, checked as its type checks it.

A reasoning function's shape is sent to the provider as an output schema of the definition's own would be, so the definition carries the shape's [warnings](reasoning-format.md#answers-that-are-json) at the line of `output.shape`: Anthropic models do not receive the shapes' bounds, and the shapes' optional fields are not portable to strict structured outputs.

## What a saved definition shows

`get_definition`, `list_definitions`, `create_definition` and `update_definition` show the shape of a definition that declares one, and of every prediction function:

- `output_schema` is the shape's schema. Its `$id` is `https://on.auto/shapes/` followed by the shape's name, such as `https://on.auto/shapes/series`, and its `title` is the name.
- `details.shape` is the shape's name: what the definition answers.

## What a run shows

`get_run`, `list_runs` and `run_definition` show a run's own shape as `output_shape`, the name of the shape its output takes, and Auto Studio draws the output of a run from it:

- A run of a reasoning function, a computation function or a workflow that declares `output.shape` says that shape.
- A question to a prediction function says `series`. A build of a prediction function, whose output is `{ version, winner, candidates }`, says none.
- A run of a definition that declares no shape says none.

The run says its shape from the moment it starts, so a run that is rejected still says the shape its output would have taken.

## The four shapes

Each shape is a JSON Schema of draft 2020-12 whose every record takes the fields listed and no others. In all of them:

- a `name`, a `label` and a `unit` are text of 1 to 64 characters;
- a `value`, a `low` and a `high` are JSON numbers, and a `low` is at most its `value` and a `high` at least its `value`, where given.

### series

A series over time: one or more lines of points, each point a value at a time.

| Field            | Required | Value                                                                                          |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `unit`           | No       | The unit of every value                                                                        |
| `period`         | No       | The grain of every `at`: `day`, `week`, `month`, `quarter` or `year`                           |
| `origin`         | No       | The `at` of the last point observed, in the form of every `at`                                 |
| `lines`          | Yes      | 1 to 20 lines, with at most 2,000 points across them                                           |
| `lines[].name`   | Yes      | The line's name, which no line before it has                                                   |
| `lines[].points` | Yes      | The line's points, each later than the one before it                                           |
| `points[].at`    | Yes      | When the point is: the period in the form below, or an RFC 3339 date and time without `period` |
| `points[].value` | Yes      | The point's value                                                                              |
| `points[].low`   | No       | The lowest the value may be                                                                    |
| `points[].high`  | No       | The highest the value may be                                                                   |
| `marks`          | No       | At most 8 values marked across the series, each a `label` and a `value`                        |

| `period`  | The form of `at` | For example             |
| --------- | ---------------- | ----------------------- |
| `day`     | `YYYY-MM-DD`     | `2026-10-15`            |
| `week`    | `YYYY-Www`       | `2026-W42`, an ISO week |
| `month`   | `YYYY-MM`        | `2026-10`               |
| `quarter` | `YYYY-Qn`        | `2026-Q4`               |
| `year`    | `YYYY`           | `2026`                  |
| None      | RFC 3339         | `2026-10-15T09:30:00Z`  |

A day is a day of its month, and a week a week its year has: `2026-W53` is one, and `2027-W53` is not. Points are compared in time, so `2026-10-15T10:00:00+01:00` comes before `2026-10-15T09:30:00Z`.

### categories

Values by category, each under a name of its own.

| Field            | Required | Value                                             |
| ---------------- | -------- | ------------------------------------------------- |
| `unit`           | No       | The unit of every value                           |
| `values`         | Yes      | 1 to 200 values                                   |
| `values[].name`  | Yes      | The category's name, which no value before it has |
| `values[].value` | Yes      | The category's value                              |
| `values[].low`   | No       | The lowest the value may be                       |
| `values[].high`  | No       | The highest the value may be                      |

### table

Rows under named columns.

| Field            | Required | Value                                                                                |
| ---------------- | -------- | ------------------------------------------------------------------------------------ |
| `columns`        | Yes      | 1 to 50 columns                                                                      |
| `columns[].name` | Yes      | The column's name, which no column before it has                                     |
| `columns[].unit` | No       | The unit of the column's cells                                                       |
| `rows`           | Yes      | At most 500 rows, each a list of one cell for each column, in the order of `columns` |

A cell is text, a number, `true` or `false`, or `null`.

### text

A text of Markdown.

| Field  | Required | Value                                     |
| ------ | -------- | ----------------------------------------- |
| `text` | Yes      | Markdown of at most 65,536 bytes in UTF-8 |

## Examples

This reasoning function answers values by category. Replace the model reference with one that [`list_models`](mcp.md#model-information) offers:

```markdown
---
description: Estimates the hours each support queue needs next week, with a range for each
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      tickets: { type: string, description: 'The open tickets, one a line, each with its queue' }
    required: [tickets]
output:
  shape: categories
---

{% system %}Estimate from the tickets alone. Name each queue as the tickets name it.{% endsystem %}
For each queue, estimate the hours its team needs next week, with a low and a high, in the unit hours.

{{ input.tickets }}
```

This computation function answers a series of months, with the monthly average marked:

<!-- prettier-ignore -->
```markdown
---
description: Monthly sign-ups, with their monthly average marked
language: typescript
input:
  schema:
    type: object
    required: [months]
    properties:
      months: { type: array, minItems: 1, maxItems: 120, items: { type: object, required: [month, signups], properties: { month: { type: string }, signups: { type: integer, minimum: 0 } } } }
output:
  shape: series
---
export default function (input: Input): Output {
  const points = input.months.map(({ month, signups }) => ({ at: month, value: signups }));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return {
    unit: 'sign-ups',
    period: 'month',
    lines: [{ name: 'Sign-ups', points }],
    marks: [{ label: 'Monthly average', value: total / points.length }],
  };
}
```

Given this input:

```json
{
  "months": [
    { "month": "2026-08", "signups": 40 },
    { "month": "2026-09", "signups": 52 }
  ]
}
```

it answers:

```json
{
  "unit": "sign-ups",
  "period": "month",
  "lines": [
    {
      "name": "Sign-ups",
      "points": [
        { "at": "2026-08", "value": 40 },
        { "at": "2026-09", "value": 52 }
      ]
    }
  ],
  "marks": [{ "label": "Monthly average", "value": 46 }]
}
```

A month written as `2026-9` ends the run as `conflict` of the kind `unworkable`: `The program's output does not match the output schema: /lines/0/points/1/at: Expected a month in the form YYYY-MM`.

This workflow answers the pace of each campaign as a table. It calls the computation function `campaign-pace` of [Computation function format](computation-format.md#a-function-document), and `output.as` makes its output a table before the runtime checks it:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-reporting
  name: campaign-pace-table
  version: '1.0.0'
  summary: Computes the pace of each campaign and answers it as a table.
input:
  schema:
    document:
      type: object
      properties:
        rows: { type: array }
        period: { type: object }
      required: [rows, period]
output:
  shape: table
  as: '${ ({ columns: [{ name: "Campaign" }, { name: "Spend", unit: "cents" }, { name: "Pace", unit: "per mille" }], rows: $data.campaigns.map((each: { campaign: string; spend_cents: number; pace_permille: number | null }) => [each.campaign, each.spend_cents, each.pace_permille]) }) }'
do:
  - pace:
      call: run_definition
      with:
        type: computation
        name: campaign-pace
        input: '${ $data }'
```

</div>
