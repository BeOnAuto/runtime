---
description: Compute figures that must be exact with a computation function, check them by hand, and have a workflow pass them to a reasoning function that writes about them.
---

# Calculate with a computation function

Compute figures that must be exact, such as totals, paces and projections, with a short TypeScript program instead of a model. A reasoning function can then write about the figures.

## Before you start

- Auto runs, and your agent is connected to it. The [quick start](../get-started/local.md) sets both up.
- You have a playbook, and you know which figures you need and where their inputs come from: your agent, a workflow step or another function's output.
- You can read a little TypeScript, or you let your agent write and explain it. A program for a few figures is a dozen lines.

## Decide what to compute

A model can get arithmetic wrong, and two runs may disagree. So put every figure a reader will check or act on in a computation function: totals, balances, paces, projections and thresholds. Leave the wording to a reasoning function, which can write about the figures afterwards.

Before you ask your agent, know three things:

- The figures you need. Give each a name that says its unit, such as `spend_cents`, and keep the output to what a reader or a later step needs.
- The inputs they come from. The program sees only its input: it has no network, no files and no randomness. A workflow step, or your agent, gathers the data first.
- The date the figures are for, if they depend on one. The program's clock reads the moment the run started, so a program that reads it can give a different output on each run. Pass the date in the input instead, such as `"as_of": "2026-10-10"`, and have the input schema give it `format: date`, so a run with any other text there, such as `"October"`, is refused before it starts. A program that does not read the clock gives the same output for the same input every time.

### Keep every figure exact

A program's whole numbers are exact up to 2^53, which is 9,007,199,254,740,992 (in cents, about USD 90 trillion). Past it they are rounded without warning. Decimal fractions are never exact: 0.10 plus 0.20 is not exactly 0.30. [Numbers](../reference/computation-format.md#numbers) explains why. So:

- Keep money in whole minor units, such as cents, as `integer` in both schemas.
- Give each amount and count a `maximum` in `input.schema`. Keep every number the program forms under 2^53, including the products in the middle of a calculation. Multiplying cents by a number of days, or by 1,000 for a per-mille figure, grows fast.
- Put a `minimum`, such as `minimum: 1`, on each value the program divides by. It refuses an input that would divide by zero.
- End each division with `Math.floor`, `Math.ceil` or `Math.round`, and pick one rounding rule for the function.
- Give a ratio in whole thousandths (per mille) or hundredths of a percent, rather than as a fraction.

## 1. Write the document

Ask your agent:

```text
In my "<playbook name>" playbook, prepare a computation function named
"<function name>". It takes <inputs> and returns <outputs>. Keep money in whole
cents, round each division down, and give each amount and count a maximum so
every figure stays exact. Show me the document before saving it.
```

Check the document before you approve it:

- `language: typescript`, and `input.schema` and `output.schema` with a type for each field. These JSON Schemas are the function's contract. Each run's input is checked against `input.schema` before the program runs, and its result against `output.schema`. They also give the program its types, `Input` and `Output`, so a misspelt field is refused when you save.
- The rules of [Keep every figure exact](#keep-every-figure-exact): a `maximum` on each amount and count, a `minimum` on each value the program divides by, and a whole number at the end of each division. Ask the agent to name the largest number the program forms and show the arithmetic.
- The program is a function from `Input` to `Output`, exported as the default (`export default function`).

## 2. Save it with its overview

The agent saves it with `create_definition` and the type `computation`. Saving checks the program with the TypeScript compiler. A problem is refused with its line, counted from the top of the document, and the compiler's words.

Check that the agent confirms the function at version 1, and that it saved its `overview`: Markdown for the person who runs the business, on why the function exists, what it does and how it fits, for a reader who does not read TypeScript.

## 3. Run it with an input you can check by hand

Ask your agent:

```text
Run the "<function name>" function in my "<playbook name>" playbook with
<input>. Show me the run's status, its output and its record.
```

Check that the run shows `status: succeeded`, and work out one or two figures by hand. Run it again with the same input. A program that does not read the clock gives the same output every time.

The run's record shows `language: typescript` and the sizes of the input and output. It also shows `work`, how much computing the program used in the engine's checkpoints, and `duration_ms`, how long it ran in milliseconds.

Then run it once with an input the schema should refuse, such as an amount with a fraction. The run is refused with `invalid_input`, and the program never runs. Its detail names the field and the rule it broke, and a pointer marks the value at fault (its path in the input, such as `/input/costs/0/cost_cents`).

## 4. Use it from a workflow

A computation function gets the figures right, and a reasoning function puts them into words. A workflow can run one after the other. Ask your agent:

```text
In my "<playbook name>" playbook, prepare a workflow that runs the "<function
name>" function with the workflow's input, tries again if it finds no turn to
run (status 503), and passes its output to the "<reasoning function name>"
function. If it still cannot run after the last try, the workflow should stop
with a clear error. Show me the document before saving it.
```

You do not need to read the workflow's YAML yourself. The agent has the computation step retry on status 503 and then stop the run with a clear error, as [Errors, retries and timeouts](../reference/workflow-format.md#errors-retries-and-timeouts) explains.

Run the workflow. Check that the reasoning function's output uses the figures as given, and keep the figures beside its output so a reader can compare them.

## Example: total a campaign's spend

The "Campaign spend" function, saved as `campaign-spend`, takes a campaign's budget and its daily costs so far, and returns five figures:

- `spend_cents`, the spend so far;
- `remaining_cents`, the budget left;
- `projected_cents`, the spend at the end of the period if the pace so far holds;
- `pace_permille`, the projection in thousandths of the budget, where 1000 means on course to spend exactly the budget;
- `within_budget`, whether the projection stays within the budget.

::: details The "Campaign spend" document

<!-- prettier-ignore -->
```markdown
---
description: Totals a campaign's spend and its pace against budget, in cents
language: typescript
input:
  schema:
    type: object
    required: [campaign, budget_cents, days_elapsed, days_total, costs]
    properties:
      campaign: { type: string }
      budget_cents: { type: integer, minimum: 1, maximum: 100000000000 }
      days_elapsed: { type: integer, minimum: 1, maximum: 366 }
      days_total: { type: integer, minimum: 1, maximum: 366 }
      costs:
        type: array
        maxItems: 366
        items:
          type: object
          required: [day, cost_cents]
          properties:
            day: { type: string }
            cost_cents: { type: integer, minimum: 0, maximum: 10000000 }
output:
  schema:
    type: object
    required: [campaign, spend_cents, remaining_cents, projected_cents, pace_permille, within_budget]
    properties:
      campaign: { type: string }
      spend_cents: { type: integer }
      remaining_cents: { type: integer }
      projected_cents: { type: integer }
      pace_permille: { type: integer }
      within_budget: { type: boolean }
---
export default function (input: Input): Output {
  const spend_cents = input.costs.reduce((sum, row) => sum + row.cost_cents, 0);
  const projected_cents = Math.floor((spend_cents * input.days_total) / input.days_elapsed);
  return {
    campaign: input.campaign,
    spend_cents,
    remaining_cents: input.budget_cents - spend_cents,
    projected_cents,
    pace_permille: Math.floor((projected_cents * 1000) / input.budget_cents),
    within_budget: projected_cents <= input.budget_cents,
  };
}
```

:::

- `minimum: 1` on `budget_cents` and `days_elapsed` refuses an input that would make the program divide by zero.
- Every number in the input has a `maximum`, and `costs` has `maxItems`. A day costs at most 10,000,000 cents (USD 100,000), and there are at most 366 days, so the spend is at most 3,660,000,000 cents.
- The largest number the program forms is `projected_cents * 1000`. With `days_total` at most 366 and `days_elapsed` at least 1, it is at most 3,660,000,000 × 366 × 1,000, which is 1,339,560,000,000,000. That is well under 2^53.
- The budget is at most 100,000,000,000 cents (USD 1 billion), so `remaining_cents` stays exact too. An input past any bound is refused with `invalid_input` before the program runs.
- `Math.floor` ends each division in a whole number, rounding down.
- Writing `row.cost` for `row.cost_cents` is refused when you save, with `Line 35: Property 'cost' does not exist on type '{ day: string; cost_cents: number; }'.`

Run it with ten days of costs out of 31, against a budget of USD 8,000:

::: details The input

```json
{
  "campaign": "Autumn reporting trial",
  "budget_cents": 800000,
  "days_elapsed": 10,
  "days_total": 31,
  "costs": [
    { "day": "2026-10-01", "cost_cents": 24350 },
    { "day": "2026-10-02", "cost_cents": 26120 },
    { "day": "2026-10-03", "cost_cents": 25875 },
    { "day": "2026-10-04", "cost_cents": 27040 },
    { "day": "2026-10-05", "cost_cents": 23990 },
    { "day": "2026-10-06", "cost_cents": 28415 },
    { "day": "2026-10-07", "cost_cents": 26780 },
    { "day": "2026-10-08", "cost_cents": 25505 },
    { "day": "2026-10-09", "cost_cents": 27260 },
    { "day": "2026-10-10", "cost_cents": 26685 }
  ]
}
```

:::

The run succeeds with this output. The program does not read the clock, so it is the same on every run:

```json
{
  "campaign": "Autumn reporting trial",
  "spend_cents": 262020,
  "remaining_cents": 537980,
  "projected_cents": 812262,
  "pace_permille": 1015,
  "within_budget": false
}
```

To check it by hand: ten days cost 262,020 cents, which is USD 2,620.20. Over 31 days at that pace, 262,020 × 31 ÷ 10 is 812,262 cents. That is 1,015 thousandths of the 800,000-cent budget, so the campaign is on course to overspend by USD 122.62. The record shows `work: 0` for this input.

With the first cost written in dollars, as `"cost_cents": 243.5`, the run is refused with `invalid_input`: `costs, then item 1, then cost_cents: expected a whole number, from 0 to 10,000,000.` Its `errors` point at `/input/costs/0/cost_cents`.

## Example: write a note about the figures

The "Write spend note" reasoning function, saved as `write-spend-note`, puts the figures into words for the campaign's owner. The "Spend report" workflow, saved as `spend-report`, runs "Campaign spend", then "Write spend note", naming each by the name it is saved under.

If your model provider is not Anthropic, ask your agent to use one of your provider's models.

::: details The "Write spend note" document

```markdown
---
description: Writes a short note to a campaign's owner about its spend and pace
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      campaign: { type: string }
      spend_cents: { type: integer }
      remaining_cents: { type: integer }
      projected_cents: { type: integer }
      pace_permille: { type: integer }
      within_budget: { type: boolean }
    required: [campaign, spend_cents, remaining_cents, projected_cents, pace_permille, within_budget]
---

{% system %}Write two or three sentences for the campaign's owner about its spend so far. Use the figures exactly as given and do not compute new ones. Amounts are in cents: write them as US dollars with two decimals. A pace of 1000 per mille means the campaign is on course to spend exactly its budget. Say plainly whether it is on course to stay within budget.{% endsystem %}
Figures: {{ input | json }}
```

:::

The "Spend report" workflow's `namespace` is the id of the "Marketing" playbook it is saved in, `marketing`; your agent fills in your own.

::: details The "Spend report" workflow

```yaml
document:
  dsl: '1.0.3'
  namespace: marketing
  name: spend-report
  version: '1.0.0'
  summary: Totals a campaign's spend and pace, then writes a note about them for its owner.
input:
  schema:
    document:
      type: object
      properties:
        campaign: { type: string }
        budget_cents: { type: integer }
        days_elapsed: { type: integer }
        days_total: { type: integer }
        costs: { type: array }
      required: [campaign, budget_cents, days_elapsed, days_total, costs]
do:
  - compute:
      try:
        - total:
            call: run_definition
            with:
              type: computation
              name: campaign-spend
              input: '${ $data }'
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: { seconds: 2 }
          limit:
            attempt: { count: 2 }
        do:
          - give-up:
              raise:
                error:
                  type: https://example.com/errors/figures-unavailable
                  status: 503
                  title: The campaign's figures could not be computed
                  detail: The computation function was still unavailable after two retries
  - write:
      call: run_definition
      with:
        type: reasoning
        name: write-spend-note
        input: '${ $data }'
      output:
        as: '${ ({ figures: $input, note: $data }) }'
```

- `compute` runs "Campaign spend" with the run's input. It tries again up to twice on status 503, then `give-up` stops the run with an error that names what failed.
- `write` passes the figures to "Write spend note". Its `output.as` keeps the figures beside the note, so the run's output holds both.

:::

With the input above, the workflow ends `succeeded`. Its output holds the figures from the program, which are exact, and a note from your model, whose wording varies:

::: details The workflow's output

```json
{
  "figures": {
    "campaign": "Autumn reporting trial",
    "spend_cents": 262020,
    "remaining_cents": 537980,
    "projected_cents": 812262,
    "pace_permille": 1015,
    "within_budget": false
  },
  "note": "Autumn reporting trial has spent USD 2,620.20 of its USD 8,000.00 budget, leaving USD 5,379.80. At this pace it will spend USD 8,122.62 by the end of the period, 101.5% of the budget, so it is not on course to stay within budget."
}
```

:::

## If something goes wrong

- **Saving is refused.** Each problem names its line and what the compiler said. A program may not import a module or use `fetch`, `Math.random` or the local time zone; [Checked when it is saved](../reference/computation-format.md#checked-when-it-is-saved) lists everything that is refused.
- **A run is refused with `invalid_input`.** The input does not match `input.schema`. The detail says each problem in a sentence that names the field and the rule it broke, and each has a pointer to the value at fault, such as `/input/costs/0/cost_cents`. Give each field a `description` and `examples`, so the sentence says what to give.
- **A run ends `conflict` with the kind `unworkable`.** The program raised an error, did more work than a run may, or returned what the output schema refuses. The rejection names the line or the bound. Running it again with the same input does not help, so fix the document or the input.
- **A run ends `unavailable`.** It found no turn to run within its 10 seconds, usually because Auto was busy, or its program ran longer than that. Run it again, or let a workflow retry on status 503.
- **The workflow ends `rejected` with the reason `unavailable`.** The computation step was still unavailable after its last retry, so `give-up` stopped the run before any note was written. Its detail says so: `The campaign's figures could not be computed, at the step give-up: The computation function was still unavailable after two retries.` Run the workflow again when Auto is less busy. If it happens often, Auto may need room for more runs at once: whoever runs it can raise `COMPUTATION_WORKERS`, as [Computation and recall functions](../self-host/configuration.md#computation-and-recall-functions) describes.
- **A figure is a little off for large amounts.** A number the program formed went past 2^53 and was rounded. Lower the `maximum` on the amounts and counts in `input.schema`, or split the calculation, so every number stays under the bound.
- **The output changes between runs with the same input.** The program reads the clock. Pass the date it needs in the input instead.
- **The note gets a figure wrong.** The model wrote the note, and the program wrote the figures. Tighten the reasoning function's prompt, and keep the figures beside the note so a reader can compare them.

## Next

- [Computation function format](../reference/computation-format.md) has the sandbox, the rules for numbers and every bound.
- [Functions](../concepts/functions.md) explains when to choose a computation function over the other types.
- [Workflow format](../reference/workflow-format.md#calling-a-function) describes calling a function from a workflow and catching its errors.
- [Forecast with a prediction function](forecast.md) projects a figure with a model trained on your data, where a straight-line pace is not enough.
