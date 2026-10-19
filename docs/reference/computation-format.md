<div v-pre>

# Computation function format

A computation function is a definition of the type `computation`. Its document declares the input and output contracts, and holds a TypeScript program that computes the output from the input. A run calls the program's function with its input, and the value the function returns is the run's output.

Use one for the arithmetic and data shaping a language model should not do: totals, paces, projections and transformations of rows of figures.

What a run returns depends only on its input and on the moment the run started:

- The program sees nothing but its input. It has no network, no files, no environment and no randomness.
- `Date.now()` and `new Date()` return the moment the run started, which stays the same for the whole run.
- So the same input and the same start time give the same output, on the same build of the runtime.
- A program that never reads the clock gives the same output for the same input on every run. A program that reads it may give a different output on a new run, since each run has its own start time.

Numbers are double-precision floating point. Integers are exact only up to 2^53. There is no decimal type, and nothing rounds to decimal places. So compute money in whole minor units, such as cents, as the example below does. See [Numbers](#numbers).

## A function document

The source is Markdown with YAML front matter followed by the program. This example turns rows of campaign costs into spend, projection and pace per campaign, in cents:

<!-- prettier-ignore -->
```markdown
---
description: Spend, pace and projection per campaign, in cents, for a reporting period
language: typescript
input:
  schema:
    type: object
    required: [rows, period]
    properties:
      rows: { type: array, maxItems: 4000, items: { type: object, required: [campaign, cost_cents, budget_cents], properties: { campaign: { type: string }, cost_cents: { type: integer, minimum: 0, maximum: 5000000 }, budget_cents: { type: integer, minimum: 0, maximum: 1000000000 } } } }
      period: { type: object, required: [days_elapsed, days_total], properties: { days_elapsed: { type: integer, minimum: 1, maximum: 366 }, days_total: { type: integer, minimum: 1, maximum: 366 } } }
output:
  schema:
    type: object
    required: [campaigns, total_spend_cents]
    properties:
      campaigns: { type: array, items: { type: object } }
      total_spend_cents: { type: integer }
---
export default function (input: Input): Output {
  const { days_elapsed, days_total } = input.period;
  if (days_elapsed > days_total) {
    throw new Error(`days_elapsed ${days_elapsed} is past days_total ${days_total}`);
  }
  const campaigns = [...Map.groupBy(input.rows, (row) => row.campaign)]
    .toSorted(([first], [second]) => (first < second ? -1 : 1))
    .map(([campaign, rows]) => {
      const budget_cents = rows[0].budget_cents;
      const spend_cents = rows.reduce((sum, row) => {
        if (row.budget_cents !== budget_cents) {
          throw new Error(`The rows of ${campaign} disagree on its budget: ${budget_cents} and ${row.budget_cents}`);
        }
        return sum + row.cost_cents;
      }, 0);
      const projected_cents = Math.floor((spend_cents * days_total) / days_elapsed);
      const pace_permille = budget_cents === 0 ? null : Math.floor((projected_cents * 1000) / budget_cents);
      return { campaign, spend_cents, budget_cents, projected_cents, pace_permille };
    });
  return { campaigns, total_spend_cents: campaigns.reduce((sum, each) => sum + each.spend_cents, 0) };
}
```

`Input` and `Output` are the input and output schemas as TypeScript types, which the runtime declares for the program; see [Types](#types).

The schema and the program keep the arithmetic exact and the rows consistent:

- The schema bounds the input: at most 4,000 rows, each cost from 0 to 5,000,000 cents, each budget from 0 to 1,000,000,000 cents, and periods of 1 to 366 days. An input outside those bounds is `invalid_input`, with a pointer to each value.
- With those bounds, the largest intermediate value, `projected_cents * 1000`, is at most 4,000 × 5,000,000 × 366 × 1,000 = 7.32 × 10^15. That is below 2^53, so every value stays an exact integer; see [Numbers](#numbers).
- The program checks what a schema cannot say. Rows of one campaign must carry the same budget, and `days_elapsed` may not pass `days_total`. Otherwise it raises an error, and the run ends as a `conflict` of the kind `unworkable`, such as `The program raised an error on line 30: Error: The rows of spring-sale disagree on its budget: 800000 and 750000`.
- A budget of 0 gives a `pace_permille` of `null`.

To save it, call `create_definition` with `type: "computation"`, a function `name` such as `campaign-pace`, and the document as `source`. To run it, call `run_definition` with the same type and name, and with `rows` and `period` in the `input` object. Both operations also take the playbook id, unless the MCP connection is scoped to that playbook.

Given this input:

```json
{
  "rows": [
    { "campaign": "spring-sale", "cost_cents": 125000, "budget_cents": 800000 },
    { "campaign": "spring-sale", "cost_cents": 98050, "budget_cents": 800000 },
    { "campaign": "summer-launch", "cost_cents": 40000, "budget_cents": 300000 }
  ],
  "period": { "days_elapsed": 12, "days_total": 31 }
}
```

the run succeeds with this output, and its record shows that it spent 0 checkpoints of work:

```json
{
  "campaigns": [
    {
      "campaign": "spring-sale",
      "spend_cents": 223050,
      "budget_cents": 800000,
      "projected_cents": 576212,
      "pace_permille": 720
    },
    {
      "campaign": "summer-launch",
      "spend_cents": 40000,
      "budget_cents": 300000,
      "projected_cents": 103333,
      "pace_permille": 344
    }
  ],
  "total_spend_cents": 263050
}
```

## Fields

| Field           | Required | Value                                                                                                                                                             |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | No       | Text of 1 to 1,000 characters                                                                                                                                     |
| `language`      | Yes      | `typescript`, the playbook's one language                                                                                                                         |
| `input.schema`  | No       | A JSON Schema of the input. The input may be any JSON value it allows                                                                                             |
| `output.schema` | No       | A JSON Schema of the output. An output that does not match it ends the run as a conflict                                                                          |
| `output.shape`  | No       | The name of an [output shape](output-shapes.md), `series`, `categories`, `table` or `text`, whose schema is the output schema. Not allowed beside `output.schema` |

- Unknown fields are rejected. Among them are the fields of a reasoning function that do not apply here: `model`, `config`, `tools`, `output.format` and `input.default`.
- The body after the front matter is the program. A document without one is rejected.
- The saved function has the `media_type` `text/markdown`. Its `description`, `input_schema` and `output_schema` come from the document.

## The program

The program is one TypeScript module whose default export is a function `(input: Input): Output`.

- It reads its input as its argument, and its return value is the run's output.
- It may declare types of its own and exported functions, and nothing else at the top level, so that two runs share nothing. Write a helper inside the function that uses it, or export it.
- It sees nothing else: no network, no files, no environment, no randomness and no time zone. The clock it reads is the moment the run started.

### Types

The schemas the document carries are the types the program is checked against. `Input` is `input.schema` and `Output` is `output.schema`, as TypeScript types. A document without a schema gets `Json`, any JSON value, for it.

| Schema                                      | Type                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| An object schema with `properties`          | A closed type of those properties, the `required` ones required, unless `additionalProperties` opens it |
| An object schema without `properties`       | An object of any JSON values                                                                            |
| `enum` and `const`                          | A union of their values                                                                                 |
| `anyOf` and `oneOf`                         | A union of their types                                                                                  |
| An array                                    | Its `items` as the type of its elements, however many `maxItems` allows                                 |
| A definition under `$defs` or `definitions` | A type of its own, named after its schema and the definition, so a `$ref` may refer to itself           |

A definition's type is named such as `Input_address` for `#/$defs/address` of the input schema. A character a name cannot hold is written as its code point between two `$`, as `Input_street$45$address` for `street-address`.

What a type cannot say, such as `minimum`, `maximum`, `multipleOf` and `format`, is checked when the run checks its input and output. A `format` is one of `date`, `date-time`, `time`, `email`, `uri` and `uuid`, as [Answers that are JSON](reasoning-format.md#answers-that-are-json) sets out, so an input of April for a `date` is refused before the run, with the words `expected a date such as 2026-04-01`. A `pattern`, and any other `format`, are refused when the document is saved. The overview names the form.

### Checked when it is saved

The document is checked when it is saved, with the TypeScript compiler, in the strict mode with `exactOptionalPropertyTypes`. It is checked against `Input`, `Output` and the sandbox's own library, so a name the sandbox lacks is a name the compiler lacks. Each problem is refused with its line and the compiler's words:

| Written                                                                                                                                           | Refused with                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A syntax error                                                                                                                                    | The compiler's diagnostic at its line                                                                                                                                              |
| A type error against `Input` or `Output`                                                                                                          | The compiler's diagnostic, such as `Property 'perod' does not exist on type 'Input'. Did you mean 'period'?`                                                                       |
| An `enum`, a `namespace`, a parameter property or a decorator                                                                                     | `This syntax is not allowed when 'erasableSyntaxOnly' is enabled`                                                                                                                  |
| An `import`, `require`, `eval`, `new Function`, `import()`, `import.meta` or a declared name such as `declare global`                             | `A program reads nothing but its arguments: it imports no module and builds no code`                                                                                               |
| A top-level statement other than a type or an exported function, such as `let`, a class or a function the module does not export                  | `A module holds its types and its exported functions and nothing else, so that two calls share nothing`                                                                            |
| No default export, or one whose type is not `(input: Input) => Output`                                                                            | `The program is a module whose default export is a function (input: Input): Output`, and the compiler's words                                                                      |
| `async`, `await` or a generator exported                                                                                                          | `The program is a function that answers at once; it awaits nothing`                                                                                                                |
| More than 500 assignments to variables in one function, counting `+=`, `++` and the like, reported at the 501st                                   | `A function may assign to its variables at most 500 times, since the compiler's analysis of each assignment grows with the others; keep the values in a list, an object or a loop` |
| A name the sandbox lacks: `fetch`, `setTimeout`, `console`, `process`, `Intl`, `Math.random`, `WeakRef`, `Promise`, a local-time method of `Date` | The compiler's `Cannot find name` or `Property does not exist`                                                                                                                     |
| `language` other than `typescript`                                                                                                                | `The playbook's one language is TypeScript; write the program as a TypeScript function`                                                                                            |

A program that passes the check can still raise an error when it runs, such as `throw new Error("no rows")` or reading a field of `null`; see [How a run ends](#how-a-run-ends).

How long the check may take:

- The check runs on a worker of its own beside the runs. The server starts and warms it before it takes a request.
- Its cost is the compiler's, and depends on the server and on how much the types make the compiler work.
- A save allows the check 2 seconds of the server's wall-clock time, counted from a ready checker. A check that does not finish within them leaves the document unsaved, as `invalid_input`: simplify its types or split the program.
- A busy server may also have slowed the check, so a document near the bound may pass when it is saved again later.
- A save that finds no checker ready is `unavailable`; save it again.

### The sandbox

The program runs in QuickJS compiled to WebAssembly. The runtime pins the build `@jitl/quickjs-wasmfile-release-sync` 0.32.0. That build counts the work a program costs, so this page notes any new build.

The library is the language's own, ES2023 and more, such as `Array.prototype.toSorted`, `Map.groupBy`, `Object.groupBy`, `Set.prototype.union`, the iterator helpers and `BigInt`. What would read the host is gone or fixed:

- `Date.now()` and `new Date()` return the moment the run started.
- These dates work: `new Date(number)`, `new Date(date)`, a date alone such as `new Date("2026-01-01")`, and a date and time that names its offset, such as `new Date("2026-01-01T09:00:00Z")`.
- These raise a `TypeError`, since they read the server's time zone: `new Date(2026, 0, 1)`, a date and time without its offset, calling `Date` without `new`, `String(date)`, a template literal of a date, and `toLocaleString()`. Use `Date.UTC(...)`, the `getUTC…` and `setUTC…` methods and `toISOString()`.
- These are absent: `Math.random`, `eval`, `Function`, `WeakRef`, `FinalizationRegistry`, `Promise` and every local-time method of `Date`, and also `console`, `fetch`, timers, `Intl` and modules. A program returns at once, and the sandbox never runs a `Promise`'s callbacks. A `Promise` would only let a program silently do nothing, so the check refuses one at save.
- Strings compare and sort by UTF-16 code unit: `sort()` without a comparator sorts by code unit, and `localeCompare` reads no locale.
- The output keeps the order its keys were written in. A program that wants sorted keys sorts them.

The output is the returned value as JSON. These values cannot be JSON:

- a `Date`, a `Map`, a `Set`, a class instance or a typed array;
- a boxed number, text or boolean;
- a function, a `BigInt` or a symbol;
- `NaN`, `Infinity` and `undefined`;
- an empty place in an array, and a cycle.

Returning one ends the run as a [conflict](#how-a-run-ends) that names where the first was found, such as `The answer holds a Date at $.campaigns[0].at, which JSON cannot carry`.

### Numbers

Every number is an IEEE 754 double:

- Integers are exact up to 2^53, 9,007,199,254,740,992: `9007199254740992 + 1` is `9007199254740992`. A total or an intermediate product past it, such as `spend_cents * days_total`, loses precision.
- Decimal fractions are approximations: `0.1 + 0.2 + 0.3` is `0.6000000000000001`, and `Math.round(1.005 * 100)` is `100`.
- There is no decimal type and no rounding to decimal places. Keep amounts in whole minor units, such as cents. Multiply before you divide, and end a division with `Math.floor`, `Math.ceil` or `Math.round`, as the example's `projected_cents` and `pace_permille` do.
- `NaN` and `Infinity` are not JSON values, so a run whose output holds one ends as a [conflict](#how-a-run-ends).
- `BigInt` computes exactly but cannot be an output; turn it into a number or a string first.
- The functions that approximate, such as `Math.pow` and `Math.log`, give the same result on every run of one build of the runtime. Their last digits may differ between builds.

## How a run ends

A run checks the input against `input.schema`, then calls the program. It checks that the returned value is JSON, then checks it against `output.schema`, or against the shape `output.shape` names with the rules the shape adds, such as the order of a series' points. It ends in one of these ways:

| Ending                        | When                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                   | The program returned a value that is JSON and matches the output schema                                                    |
| `invalid_input`               | The input does not match the input schema, with a sentence and a pointer for each problem, or nests deeper than 512 levels |
| `conflict`, kind `unworkable` | The program raised an error, including a stack overflow                                                                    |
| `conflict`, kind `unworkable` | The program did more work or used more memory than a run may                                                               |
| `conflict`, kind `unworkable` | The program returned what JSON cannot carry, or a value deeper than 512 levels                                             |
| `conflict`, kind `unworkable` | The program returned what the output schema refuses, or what does not fit the run's record                                 |
| `unavailable`                 | The run took longer than a run may, or found no turn to run within its time                                                |
| `failed`                      | The runtime itself broke down                                                                                              |

A `conflict` of the kind `unworkable` says what went wrong:

- It names the program's own error and the line of the document it came from, such as `The program raised an error on line 21: Error: no rows`.
- Or it names the bound the program reached, such as `The program did more work than a run may, 20000 checkpoints, and was stopped`.
- The text of the program's error is cut at 1,024 bytes of UTF-8 and marked with `…`. So are the pointer and the detail of each issue of an output the schema refuses, each on its own.
- Running it again with the same input gives the same result, unless the program reads the clock. So a retry does not help: update the definition, or change the input.
- `get_run` shows the kind on the run's rejection, and `list_runs` shows it in the listing.

A run that succeeds records `language`, `work` (the checkpoints it spent) and `duration_ms`. It also records `input_bytes` and `output_bytes`, the sizes of its input and output as JSON. `get_run` returns that record with the output.

## Bounds

| Bound              | Value                                                                                                                                                                | When it is reached                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document           | 65,536 bytes in UTF-8, as every definition                                                                                                                           | Refused when saved                                                                                                                                        |
| The check at save  | 2 seconds of the server's wall-clock time on the check's own worker, counted once it is ready. The server starts that worker before it takes a request, and keeps it | The save is `invalid_input`: simplify the types or split the program, or save it again when the server is less busy; with no checker ready, `unavailable` |
| Assignments        | 500 to variables in one function, counted before the compiler analyses them. Its analysis grows with their square: 500 cost it 43 ms, and 1,000 cost 249 ms          | Refused when saved, `invalid_input`                                                                                                                       |
| Input              | 256 KiB as JSON, as every run, nested at most 512 levels                                                                                                             | `invalid_input`                                                                                                                                           |
| Work               | 20,000 checkpoints, counted as below the table                                                                                                                       | `conflict`, `unworkable`                                                                                                                                  |
| Memory             | 256 MiB, the maximum of the run's sandbox                                                                                                                            | `conflict`, `unworkable`                                                                                                                                  |
| Stack              | 1 MiB, which a function that calls itself reaches after 5,459 calls. The overflow is an error the program may catch, at the same depth every time                    | `conflict`, `unworkable` when the program does not catch it                                                                                               |
| Depth of a value   | 512 levels, in the input and in the output                                                                                                                           | `invalid_input`; `conflict`, `unworkable`                                                                                                                 |
| Regular expression | Bounded by the work and the duration: the engine interrupts a pattern that backtracks                                                                                | As work                                                                                                                                                   |
| Output             | 1,048,320 bytes as JSON: 1 MiB less 256 bytes kept for the run's record                                                                                              | `conflict`, `unworkable`                                                                                                                                  |
| Text of an error   | 1,024 bytes of the program's error, then `…`. The same cut applies to the pointer and to the detail of each issue of an output the schema refuses                    | Cut, in the `conflict`                                                                                                                                    |
| Duration           | 10 seconds from the start of the run, its wait for a turn included                                                                                                   | `unavailable`                                                                                                                                             |
| Runs at once       | 4 by default, which the operator can change with `COMPUTATION_WORKERS`, and one check at a time beside them; a run waits for its turn within its 10 seconds          | `unavailable`                                                                                                                                             |

A run's output and its record share 1 MiB, as for every run; see [Runs and results](http.md#runs-and-results).

Work is counted in checkpoints of the engine, so it does not depend on the machine. The engine counts one checkpoint every 10,000 of its steps, where a call or the jump of a loop is a step. A checkpoint is about 0.024 ms of a tight loop on the machine measured below. The same program and input spend the same checkpoints on every run and every host of the same build.

- The example above spends no checkpoint on 1,000 or 2,000 rows, and 1 checkpoint on 3,911 or 4,000 rows. The largest input a run takes holds 3,911 such rows (262,092 bytes). So the bound on work stops a program whose work grows faster than its data, never the example.
- A checkpoint counts the engine's steps and not its native work, such as one `JSON.stringify` of a large value. That is why the duration bound stands beside it. A loop whose body is one native operation over a large value, such as `JSON.stringify` or `join`, spends few checkpoints. Such a run ends at its 10 seconds.

Measured on Node 26.10.0 on an Apple M4 Max:

- The example over 3,911 rows took 5.1 ms in a fresh sandbox.
- One checkpoint of a loop that does nothing took 0.042 ms. So the 20,000 checkpoints of a run take from under a second to about eleven seconds of interpretation, depending on what each step does.
- A run took about a millisecond more than its program, with or without an output schema, in a worker the server keeps ready between runs. A worker's first run pays its start, about 200 ms. So does the first run after a minute without runs.
- A run that never returned was stopped 0.6 ms after a deadline of 500 ms.

## In a workflow

A workflow calls a computation function as it calls a reasoning function, with `call: run_definition` and `type: computation`. The task's output is the function's output; see [Calling a function](workflow-format.md#calling-a-function).

- The function reaches nothing outside the playbook, so a workflow may run it again freely: its result does not depend on how often it ran.
- A run rejected with `conflict` raises a `runtime` error with status 409. The error's `kind` is `unworkable`, whether the program raised, did too much work or used too much memory.
- A retry gives the same result for the same input, unless the program reads the clock, so a retry policy should not match status 409. Retry on status 503, which a run that was `unavailable` raises, as the example below does.

This workflow reads a month's campaign costs through a tool server, computes the pace of each campaign and has a reasoning function write a summary:

- The first function is an [interaction function that asks a system](interaction-format.md#asking-a-system). It calls the tool and returns the rows it gives, checked against its output schema, with no model to read them.
- A run of it that called the tool and did not succeed is never run again under its run id. A retry starts a new run, which calls the tool again; see [Retrying under a run id](http.md#retrying-under-a-run-id). A retry on status 503 is safe: such a run raises 503 only before its call, or after a call of a tool its server marks read-only.
- The arithmetic happens in the computation function, and the words in the reasoning function.

The interaction function `read-campaign-costs`:

```markdown
---
description: Reads the cost rows of every campaign for a month
call:
  server: ads
  tool: campaign-costs
  with:
    month: '{{ input.month }}'
  read: /rows
input:
  schema:
    type: object
    properties:
      month: { type: string }
    required: [month]
output:
  schema:
    type: array
    items:
      type: object
      properties:
        campaign: { type: string }
        cost_cents: { type: integer }
        budget_cents: { type: integer }
      required: [campaign, cost_cents, budget_cents]
---
```

The computation function `campaign-pace` is the document at the top of this page. The reasoning function `write-pace-summary`:

```markdown
---
description: Summarizes the pace of each campaign for its owners
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      campaigns: { type: array }
      total_spend_cents: { type: integer }
    required: [campaigns, total_spend_cents]
---

Write three sentences for the campaign owners about this month so far. A pace of 1000 per mille means a campaign is on course to spend exactly its budget. Use the figures as given; they are in cents.
Campaigns: {{ input.campaigns | json }}
Total spend in cents: {{ input.total_spend_cents }}
```

The workflow `campaign-pace-report`:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-reporting
  name: campaign-pace-report
  version: '1.0.0'
  summary: Reads a month's campaign costs, computes each campaign's pace and writes a summary.
input:
  schema:
    document:
      type: object
      properties:
        month: { type: string }
        period: { type: object }
      required: [month, period]
do:
  - read:
      call: run_definition
      with:
        type: interaction
        name: read-campaign-costs
        input: { month: '${ $data.month }' }
      output:
        as: '${ ({ rows: $data, period: $input.period }) }'
  - compute:
      try:
        - pace:
            call: run_definition
            with:
              type: computation
              name: campaign-pace
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
                  type: https://example.com/errors/pace-unavailable
                  status: 503
                  title: The campaigns' pace could not be computed
                  detail: The computation function was still unavailable after two retries
  - write:
      call: run_definition
      with:
        type: reasoning
        name: write-pace-summary
        input:
          campaigns: '${ $data.campaigns }'
          total_spend_cents: '${ $data.total_spend_cents }'
```

`run_definition` of `campaign-pace-report` takes an input such as `{"month": "2026-09", "period": {"days_elapsed": 12, "days_total": 30}}`. The run reads the rows, computes them, and ends with the summary as its output.

When the computation function's run is `unavailable`, the `compute` task retries it up to twice, 2 seconds apart. Then `give-up` raises an error that names what failed, and the run ends `rejected` as `unavailable`; [Errors, retries and timeouts](workflow-format.md#errors-retries-and-timeouts) explains this pattern. When the program raises an error or reaches a bound of its sandbox, the run ends `rejected` at once, and its history shows the computation function's run with its line and error.

## The overview

`get_definition` returns a saved function with its `overview`: the function in plain words, for a person who does not read TypeScript. Auto Studio shows it before the document. The overview says:

1. The `description`, or that the function has none yet.
2. What the function needs and what it produces: each field of `input.schema` and `output.schema` with its type, bounds and default, or the shape `output.shape` names, in a sentence. A record one level down is shown with its fields.
3. In one line, that the program is TypeScript and is shown under Source. The program itself is not described.
4. **Used by**: the active definitions of the playbook that use this function, read each time it is returned, and left out when there are none.

The overview is composed from the document when it is saved, and each read adds the definitions that use the function, so the rest says only what the document says. Write the `description` for the person who will read it, and give each field of the schemas a `description`. The program may give a field a value of its own where the input leaves it out. Write that value as the field's `default` in `input.schema`, so the overview can say it. A function without them still has an overview, with the types alone.

## Availability

Computation functions are available in every runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
