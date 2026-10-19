<div v-pre>

# Recall function format

A recall function keeps a view: a JSON value that its module folds from the playbook's events, one event at a time. The fold starts from the first event of the playbook's history. A run returns what the view holds as it stands. So the playbook can tell what it decided before, such as the reviews of each campaign, the latest verdict per region or the refusals of a quarter. A recall function is the playbook's memory: what a person wants kept so that the playbook can be asked about it again, shared by everyone who asks the playbook and by its workflows, and distinct from whatever notes an agent keeps for itself. The API stores a recall function as a definition of the type `recall`.

The view depends on the playbook's events alone:

- Nothing a run passes in is kept, and no run changes the view.
- The same history folds to the same view on every server and on either store.
- Nothing has to write into a recall function. The playbook's events already hold every run of each function and workflow: its start, and its ending, with its output when it succeeded and fit its event. They also hold the definitions saved and every event published to the playbook. So a view over a function's runs sees each run, whoever started it.
- The events a fold sees hold no run's input and no tool call, although the playbook's history records both; see [The events](#the-events). A view keeps what a run returned, never what it was given or what it called. For a view to keep what a function posted, the function returns what it posted.

## A function document

The source is Markdown with YAML front matter, followed by the module. This example keeps, for each campaign, the reviews that the reasoning function `review-brief` wrote. It keeps the last 20 reviews of each of the 50 campaigns reviewed most recently, and a run returns the last few reviews of the campaign it names:

<!-- prettier-ignore -->
```markdown
---
description: The reviews of each campaign, latest last, as the review-brief function wrote them
language: typescript
source:
  events:
    - type: run_succeeded
      subject: reasoning/review-brief
view:
  initial: {}
  schema:
    type: object
    maxProperties: 50
    additionalProperties:
      type: array
      maxItems: 20
      items: { type: object, required: [at, verdict, run], properties: { at: { type: string }, verdict: { type: string }, run: { type: string } } }
input:
  schema:
    type: object
    required: [campaign]
    properties:
      campaign: { type: string }
      last: { type: integer, minimum: 1, maximum: 50 }
output:
  schema:
    type: array
    items: { type: object, required: [at, verdict], properties: { at: { type: string }, verdict: { type: string }, run: { type: string } } }
---
type Review = View[string][number];

export function reviewsOf(view: View, campaign: string): Review[] {
  const kept = Object.hasOwn(view, campaign) ? view[campaign] : undefined;
  return Array.isArray(kept) ? kept : [];
}

export function fold(view: View, event: Event): View {
  const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
  const lastAt = (reviews: Review[]): string => reviews.at(-1)?.at ?? '';
  const output = fieldOf(event.data, 'output');
  const named = fieldOf(output, 'campaign');
  const campaign = typeof named === 'string' ? named.slice(0, 100) : 'unknown';
  const given = fieldOf(output, 'verdict') ?? 'none';
  const verdict = (typeof given === 'string' ? given : JSON.stringify(given)).slice(0, 60);
  const reviews = [...reviewsOf(view, campaign), { at: event.time ?? '', verdict, run: event.source }].slice(-20);
  const latest = Object.entries({ ...view, [campaign]: reviews })
    .toSorted(([, first], [, second]) => (lastAt(first) < lastAt(second) ? -1 : lastAt(first) > lastAt(second) ? 1 : 0))
    .slice(-50);
  return Object.fromEntries(latest);
}

export function answer(view: View, input: Input): Output {
  return reviewsOf(view, input.campaign.slice(0, 100)).slice(-(input.last ?? 5));
}
```

`View`, `Input` and `Output` are the view, input and output schemas as TypeScript types. `Event` is the playbook's event and `Json` any JSON value. The runtime declares all of them for the module; see [The module](#the-module).

To save the function, `create_definition` takes `type: "recall"`, a function `name` such as `campaign-reviews`, and the document as `source`. To run it, `run_definition` takes the same type and name, with an `input` object. The input holds the `campaign`, and optionally `last`, how many reviews to return. Both operations also require the playbook id unless the MCP connection is scoped to that playbook.

After three runs of `review-brief`, the view is:

```json
{
  "autumn-launch": [
    {
      "at": "2026-09-30T14:02:11.000Z",
      "verdict": "approve",
      "run": "/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71"
    }
  ],
  "spring-sale": [
    {
      "at": "2026-10-01T09:15:42.000Z",
      "verdict": "reject: the budget is not stated",
      "run": "/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72"
    },
    {
      "at": "2026-10-03T16:40:05.000Z",
      "verdict": "approve",
      "run": "/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73"
    }
  ]
}
```

Given this input:

```json
{ "campaign": "spring-sale", "last": 1 }
```

the run succeeds with this output:

```json
[
  {
    "at": "2026-10-03T16:40:05.000Z",
    "verdict": "approve",
    "run": "/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73"
  }
]
```

### Guard the fold

The fold runs once for every run of `review-brief` that succeeds, whatever the model returned. So it guards against every output it may meet:

- An output that is not an object, such as a text or a list, counts for the campaign `unknown`. So does a campaign that is not a text, such as a number.
- A missing verdict reads `none`. A verdict that is not a text, such as a number, reads as its JSON text.
- An output too large for the playbook's event counts for `unknown` with the verdict `none`, since the event then carries the output's size instead of the output.
- An object keeps its keys in the order they were written. So the fold sorts the campaigns by the time of each one's last review, then keeps the last 50.

A fold that raises an error on an ordinary output stops its view at that event. So does a view that outgrows its bound or its schema; see [When a view stalls](#when-a-view-stalls). Guard the fold, and bound the view, before you save it.

### Look up keys with Object.hasOwn

A key that comes from an event or an input can name a property that every object inherits, such as `constructor`, `toString` or `__proto__`. Then `view[key]` reads that inherited value instead of an entry of the view. A fold that spreads it into a list raises an error and stalls the view. An answer that calls `slice` on it ends its run `conflict`, `unworkable`.

So whenever a fold or an answer looks up a key that came from an event or an input, read the entry only when the view holds it itself:

- `reviewsOf` takes a campaign's entry only when `Object.hasOwn(view, campaign)` holds and the entry is a list. Otherwise the campaign has no reviews yet.
- The fold writes the next view with a computed key, `{ ...view, [campaign]: reviews }`, and `Object.fromEntries`. Both make even `__proto__` an entry of the view's own. An assignment such as `view[campaign] = reviews` would change the object's prototype instead when the campaign is `__proto__`.

A campaign named `constructor` therefore starts with no reviews and keeps an entry of its own, and a run for it returns its reviews as for any other.

### Bound the size of the view

A view may take 512 KiB as JSON: 524,288 bytes in UTF-8, checked after every fold. A view past that stalls at the event that made it too large. So bound every list and every text a fold keeps, then work out the largest view from those bounds. The example bounds its view this way:

- It keeps at most 20 reviews of a campaign and 50 campaigns, and drops the oldest beyond them. `maxItems` and `maxProperties` in `view.schema` say the same.
- It cuts a campaign's name at 100 characters and a verdict at 60. `slice` counts UTF-16 code units, so an emoji takes two. JSON writes each unit in at most 6 bytes, as `\u0000` for a control character.
- Auto writes a run's time and its address at a fixed length. `at` holds 24 characters, such as `2026-10-03T16:40:05.000Z`, and `run` holds 42: `/runs/` and the run's UUID.
- `answer` cuts the campaign it is given at 100 characters too, so a run finds the entry of a longer name. Two names that agree in their first 100 characters share one entry. So do a campaign named `unknown` and outputs that name no campaign.

The largest view, in bytes of JSON:

| Part               | Largest size                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ |
| A verdict          | 60 × 6, and 2 quotes: 362                                                                  |
| A review           | The verdict, the time (24), the run (42), and 29 bytes of field names and punctuation: 457 |
| A campaign's list  | 20 reviews, 19 commas and 2 brackets: 20 × 457 + 21 = 9,161                                |
| A campaign's name  | 100 × 6, and 2 quotes: 602                                                                 |
| A campaign's entry | The name, a colon and the list: 602 + 1 + 9,161 = 9,764                                    |
| The view           | 50 entries, 49 commas and 2 braces: 50 × 9,764 + 51 = 488,251                              |

So the view takes at most 488,251 bytes, about 477 KiB, under the 524,288 a view may take. With ordinary names and verdicts it is far smaller. Bound any view the same way: multiply the largest entry by the most entries, add the punctuation, and keep the total under 524,288 bytes.

### Keep what one function returned

The common case keeps what one function returned. This document keeps the output of each run of the reasoning function `post-announcement` that succeeds, the last 50, oldest first:

<!-- prettier-ignore -->
```markdown
---
description: What the post-announcement function returned, oldest first, the last 50
language: typescript
source:
  events:
    - type: run_succeeded
      subject: reasoning/post-announcement
view:
  initial: []
  schema: { type: array, maxItems: 50 }
---
export function fold(view: View, event: Event): View {
  const bytesOf = (text: string): number => encodeURIComponent(text).replace(/%[0-9A-F]{2}/gu, '_').length;
  const data = event.data;
  const output = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data['output'] ?? null) : null;
  const kept = bytesOf(JSON.stringify(output)) <= 8192 ? output : null;
  return [...view, { at: event.time ?? '', run: event.source, output: kept }].slice(-50);
}
```

- The filter writes out the type and the subject: `reasoning/post-announcement` names the runs of that reasoning function.
- An output larger than 8 KiB (8,192 bytes) as JSON, or too large for its event, is kept as `null`. `get_run` of the run that an entry names reads the whole output.
- An entry then takes at most 8,286 bytes: the output, the time (24), the run (42) and 28 bytes of field names and punctuation. So the view takes at most 50 × 8,286 + 51 = 414,351 bytes, about 405 KiB, under the 512 KiB a view may take.
- Every run of `post-announcement` is in the playbook's history, whoever started it, so this view misses none. A log that workflows write into would miss each run that does not write to it.

## Fields

| Field           | Purpose                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `description`   | Optional; 1 to 1,000 characters                                                                          |
| `language`      | Required; `typescript`, the playbook's one language                                                      |
| `source.events` | Required; 1 to 8 filters, each naming events the fold takes; see [The events](#the-events)               |
| `view.initial`  | Optional; the view before any event, any JSON value within the bound on a view; `null` when left out     |
| `view.schema`   | Optional; a JSON Schema the view must match after every fold; `initial` must match it too                |
| `input.schema`  | Optional; a JSON Schema of a run's input; a run given no input runs with `{}`                            |
| `output.schema` | Optional; a JSON Schema of a run's output; an output that does not match it ends the run as a `conflict` |

- Unknown fields are rejected. Among them are the fields of a reasoning function that do not apply here: `model`, `config`, `tools`, `output.format` and `input.default`.
- The body after the front matter is the module. A document without one is rejected.
- A module that exports a function `answer` computes a run's output with it. One that does not returns the view itself.
- The saved function has the `media_type` `text/markdown`. Its `description`, `input_schema` and `output_schema` come from the document.

## The events

A recall function folds the events of its own playbook, in the order the playbook recorded them, from the first. These events are not the whole of the playbook's history:

| What                    | The events a fold sees                                                                                         | The playbook's history                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Who reads them          | A recall function's fold, and also a workflow's event triggers and `listen` filters and a prediction's dataset | A person or an agent, with `list_playbook_events` and `get_event`                                                                             |
| What they hold          | The facts in the table below, and the events published to the playbook or emitted by its workflows             | Everything recorded: those facts and events, each run's input on its `run_started`, tool calls, workflow steps, requests, answers, deliveries |
| The shape of each event | A CloudEvent, with the attributes below                                                                        | `id`, `type`, `summary`, `data` and `metadata`                                                                                                |

So `run_started` is in both, with the run's input in the history and with no data for a fold. A tool call, a step or an answer is in the history alone, and a fold never sees it. The events a fold sees:

| Events                                                           | `source`                     | `subject`       | `data`                                                                                          |
| ---------------------------------------------------------------- | ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `run_started`, `run_failed`                                      | `/runs/<run id>`             | `<type>/<name>` | none                                                                                            |
| `run_succeeded`                                                  | `/runs/<run id>`             | `<type>/<name>` | `output`; or `output_bytes`, its size, when the output would make the event larger than 240 KiB |
| `run_rejected`                                                   | `/runs/<run id>`             | `<type>/<name>` | `reason`, and `kind` where the rejection has one                                                |
| `definition_created`, `definition_updated`, `definition_retired` | `/definitions/<type>/<name>` | none            | none                                                                                            |
| An event published to the playbook, of any other type            | as its publisher gave it     | as given        | as given; see [Publishing events](http.md#publishing-events)                                    |

Each event is a CloudEvent with its `id`, `type`, `source`, `time` and `data`. Its `time` is when it happened, as the playbook recorded it. An event the playbook recorded as the effect of another names that one in `causationid`, and the run at the top of its chain in `correlationid`. The playbook's own events also carry extension attributes that say how they came about, each where the playbook has it:

| Attribute           | Holds                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `caller`            | Who acted: a caller's id; or `playbook:` and the playbook's id, for a run a trigger started and the runs it calls |
| `definitionversion` | The version of the definition the run runs or the event is about, a whole number from 1                           |
| `depth`             | On a run a reaction started, how many reactions are above it, a whole number from 1                               |
| `calldepth`         | On a run a workflow's call started, how many calls are above it, a whole number from 1                            |
| `calledby`          | The id of the run whose call started the run                                                                      |
| `triggerkind`       | The kind of the trigger that started the run: `event`, `cron` or `every`                                          |
| `triggerreference`  | Where that trigger is in its workflow's document                                                                  |

- No published event carries one of these attributes, nor `causationid` or `correlationid`, since `publish_event` refuses them.
- A recall function never folds the events of its own runs.
- An event the runtime cannot read, such as one whose data nests deeper than 512 levels, is passed over and reported to the operator once.

### Filters

A filter names the events it takes. Every value except `data` is written out, never computed:

| Key                 | What an event must have                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | Required; exactly this type                                                                                                                                                              |
| `source`            | Optional; exactly this source                                                                                                                                                            |
| `subject`           | Optional; exactly this subject, such as `reasoning/review-brief` for the runs of one reasoning function                                                                                  |
| Any other attribute | Optional; exactly this value, such as `triggerkind: event` or `caller: playbook:finance`: a whole number from 1 for `depth`, `calldepth` and `definitionversion`, and text for any other |
| `data`              | Optional; data equal to this value, or data for which an expression such as `'${ $data.revenue > 100 }'` holds; the expression reads the event's data as `$data` and nothing else        |

- An event is folded when it matches any of the filters, and once only.
- A filter that names an attribute the event does not have does not match it. A filter for runs that no reaction or no call started therefore leaves `depth` or `calldepth` out.
- A filter that names `depth`, `calldepth` or `definitionversion` as 0 is refused when the document is saved.
- An expression holds unless it returns `false` or `null`.
- An attribute is named as CloudEvents names it, in at most 20 lowercase letters and digits. Any other key is rejected, and so is a computed attribute.
- A `data` expression that names anything but `$data` is refused when the document is saved, with the compiler's `Cannot find name`.

## The module

The body is one TypeScript module, as a [computation function's program](computation-format.md#the-program) is. It may export two functions:

| Export                                     | What it does                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `fold(view: View, event: Event): View`     | Required; takes the view and one event and returns the next view                                              |
| `answer(view: View, input: Input): Output` | Optional; takes the view and the run's input and returns the run's output; without it, a run returns the view |

The runtime declares these types for the module:

- `View`, `Input` and `Output` are `view.schema`, `input.schema` and `output.schema` as TypeScript types. Without a schema, each is `Json`, any JSON value. The types follow the rules of a [computation function's types](computation-format.md#types):
  - An object schema with `properties` is a closed type of them, the `required` ones required, unless `additionalProperties` opens it. One without `properties` is an object of any JSON values.
  - `enum`, `const`, `anyOf` and `oneOf` give unions. An array gives its `items` as the type of its elements.
  - A definition under `$defs` or `definitions` is a type named after its schema and the definition, such as `Input_address`.
  - What a type cannot say, such as `minimum` or `format`, is checked when the run checks its input and output, and the view when it is kept. A `format` is one of `date`, `date-time`, `time`, `email`, `uri` and `uuid`, as [Answers that are JSON](reasoning-format.md#answers-that-are-json) sets out, so an input of April for a `date` is refused before the run, with the words `expected a date such as 2026-04-01`. A `pattern`, and any other `format`, are refused when the document is saved.
- `Event` is the playbook's event. It has the CloudEvents attributes `specversion`, `id`, `type`, `source`, `subject`, `time`, `datacontenttype` and `dataschema`, and `data` as `Json`. It also has `causationid`, `correlationid` and the playbook's own extensions: `caller`, `definitionversion`, `depth`, `calldepth`, `calledby`, `triggerkind` and `triggerreference`. Each is optional except `id`, `type` and `source`.

A fold reads the definition of a run's event from `event.subject`, and who acted from `event.caller`. `Event` names no other extension. Read another through a type that names it, such as `(event as Event & { region?: string }).region`, so that a misspelt attribute is refused rather than read as an extension.

The module may declare types of its own and exported functions, and nothing else at the top level. A module that kept state between two folds would make a view depend on where a page of events ends. Write a helper inside the function that uses it, or export it.

The document is checked when it is saved, as a computation function's is: with the TypeScript compiler in strict mode with `exactOptionalPropertyTypes`, against these types and the sandbox's own library. Each problem is refused with its line and the compiler's words. The check refuses:

- a module without `fold`, or a `fold` or `answer` of another signature, with the signature it needs;
- a top-level statement other than a type or an exported function, such as `let`, a class or a function the module does not export;
- `import`, `require`, `eval`, `new Function`, `import()`, `import.meta` and declared names such as `declare global`;
- `async`, `await` and an exported generator, since a fold returns at once;
- an `enum`, a `namespace`, a parameter property or a decorator;
- more than 500 assignments to variables in one function;
- a name the sandbox lacks, as listed below.

The module runs in the QuickJS sandbox that [computation functions](computation-format.md#the-sandbox) run in, with the same library and numbers:

- The library is the language's own, ES2023 and more, such as `toSorted`, `Map.groupBy`, `Object.groupBy`, `Set.prototype.union`, the iterator helpers and `BigInt`.
- Absent: `Math.random`, `eval`, `Function`, `WeakRef`, `FinalizationRegistry`, `Promise`, `console`, `fetch`, timers, `Intl`, modules and every local-time method of `Date`.
- `new Date(number)`, `new Date(date)`, a date alone such as `new Date("2026-01-01")`, and a date and time with its offset work.
- These raise: a `Date` from several numbers, a date and time without an offset, `Date` called without `new`, `String(date)` and `toLocaleString()`. Use `Date.UTC`, the `getUTC…` methods and `toISOString()`.
- Strings compare and sort by UTF-16 code unit, and `localeCompare` reads no locale. An object keeps its keys in the order they were written.
- Numbers are IEEE 754 doubles. Integers are exact up to 2^53, and `0.1 + 0.2` is not `0.3`. There is no decimal type, so keep amounts in whole minor units, such as cents. End a division with `Math.floor`, `Math.ceil` or `Math.round`.
- A view and an output are JSON. A `Date`, a `Map`, a `Set`, a class instance, a function, a `BigInt`, a symbol, `NaN`, `Infinity`, `undefined` and a cycle are not. A fold that returns one stalls its view. An answer that returns one ends its run.

A view does not depend on where a page of events begins or ends:

- In a fold, `Date.now()` and `new Date()` return the time of the event being folded, so a fold gives the same view on every server. In an answer, they return the moment the run started.
- The view stays inside the fold's sandbox for a whole page of events. Each fold is given the view the fold before it returned, as JSON gives it back. What JSON does not keep never reaches the next fold: an object two members share, a negative zero, or a member keyed by a symbol.
- The sandbox is frozen once the module is loaded, the prototypes of iterators and generators among it. So nothing a fold writes outside its view reaches the next fold, whether to `Math`, to a prototype or to the module.

## How the view is kept

The server that runs the playbook's workflows keeps the views:

- It is woken by every event the playbook records through it. A view follows its playbook by the time it takes to fold a page, and by up to a pass (a second) for an event another server recorded.
- It reads the playbook's history in pages of up to 1,000 records. It folds each page in a worker apart from the server, kept ready between pages.
- It writes each view once a page, so a restart folds at most one page again, to the same view.

Saving a recall function, or a new version of one, builds its view from the start of the playbook's history:

- Until the view has caught up, a run is refused `unavailable` with the kind `rebuilding`. The refusal says how many events the view has folded and how far it is behind, and carries `Retry-After`.
- The previous version does not serve runs meanwhile, since a run records the latest version.
- A playbook builds at most four views at once, the setting `RECALL_MAX_REBUILDS`. The others wait in the order they were saved, and their runs say so.
- A newer version replaces an older one that is being built, waiting or stalled.

### What a run read

A run never waits for the view: it reads what the playbook has folded so far. Its record says where that is, so a caller who recorded an event a moment ago and does not see it can tell why:

| Record field         | What it says                                                                   |
| -------------------- | ------------------------------------------------------------------------------ |
| `view.version`       | The version of the recall function the view is of                              |
| `view.checkpoint`    | Where in the playbook's history the view has read to, an opaque cursor         |
| `view.checkpoint_at` | When the playbook recorded the last record the view read                       |
| `view.last_event`    | The `id` and `time` of the last event the view folded, `null` before the first |
| `view.folded`        | How many events the view has folded                                            |

The record also holds `language`, `work` (the checkpoints the answer spent), `duration_ms`, `input_bytes` and `output_bytes`. `get_run` returns it with the output.

### The standing of a view

`get_definition` of a recall function adds its view's `standing`:

| Field                                                 | What it says                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state`                                               | `live` once caught up, `rebuilding` while it is built, `waiting` for its turn to be built, or `stalled`                                                      |
| `version`                                             | The version the view is of                                                                                                                                   |
| `checkpoint`, `checkpoint_at`, `last_event`, `folded` | As in a run's record                                                                                                                                         |
| `lag_ms`                                              | How far the view is behind: the time of the playbook's newest record less `checkpoint_at`, to the second on SQLite                                           |
| `newest_record_at`                                    | When the playbook last recorded anything                                                                                                                     |
| `stalled`                                             | For a stalled view: the `event` it stopped at, with its `id`, `type` and `time`; the `kind` of stall; the fold's own `error`; and its `line` in the document |

## When a view stalls

A fold that cannot take an event stops its view at that event. The view keeps what it folded before, its other events wait, and the playbook's other views go on. The standing names the kind of stall:

| Kind      | At that event                                                               |
| --------- | --------------------------------------------------------------------------- |
| `raised`  | The fold raised an error, a stack overflow among them                       |
| `work`    | The fold did more than its work                                             |
| `memory`  | The fold used more memory than its sandbox                                  |
| `unfit`   | The fold returned what JSON cannot carry, or a value deeper than 512 levels |
| `size`    | The fold returned a view larger than 512 KiB                                |
| `schema`  | The fold returned a view that `view.schema` refuses                         |
| `refused` | The module does not load                                                    |
| `time`    | The fold ran out of its 10 seconds twenty times                             |
| `crash`   | The worker folding the page crashed at this event twenty times              |

- The view is checked after every fold, so it stalls at the event that broke it, however the playbook's history falls into pages.
- A fold that runs longer than 10 seconds is tried again on later passes, since its time depends on the machine, without holding back the playbook's other views. It stalls once it has run out of time twenty times.
- Each fold has its own 10 seconds. The folds of the playbook's other views on the same event never count against it, and the view keeps what it folded before that event.
- A filter's `data` expression runs under a budget of its own, as large as the fold's, and shares the fold's 10 seconds. One that does more than its work stalls the view. One that raises does not take the event. One that runs out of time is tried again, as a slow fold is.
- A filter is bounded beside its fold, so one that goes past its bounds stalls its view as a fold does, and a new version is the remedy. The 3 stops in a row and the 200 milliseconds of a workflow's filter do not apply here.

While its view is stalled, a run is refused `conflict` with the kind `stalled`. Its detail names the type and time of the event and what went wrong, with the line of the fold, in fixed words. It never gives the fold's own message or the event's values; the standing shows those. The history is the source of the view, so the repair is a corrected version. Saving it builds the view again from the start.

## How a run ends

A run checks the input against `input.schema`, reads the view, and calls `answer` when the module exports it. It then checks that the answer is JSON and matches `output.schema`. It ends in one of these ways:

| Ending                           | When                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                      | The answer, or the view, is JSON that matches the output schema                                                            |
| `invalid_input`                  | The input does not match the input schema, with a sentence and a pointer for each problem, or nests deeper than 512 levels |
| `unavailable`, kind `rebuilding` | The view of the latest version is not built yet, or waits to be built; try again later                                     |
| `conflict`, kind `stalled`       | The view stopped at an event its fold could not take; save a corrected version                                             |
| `conflict`, kind `unworkable`    | The answer could not give an output, as listed below                                                                       |
| `unavailable`                    | The answer took longer than a run may, or found no turn to run within its time                                             |
| `failed`                         | The runtime itself broke down                                                                                              |

A `conflict` of the kind `unworkable` means that the answer:

- raised an error, a stack overflow among them;
- did more work or used more memory than a run may;
- returned what JSON cannot carry, or a value deeper than 512 levels;
- returned what the output schema refuses, or what does not fit the run's record.

It names the answer's own error and its line in the document, such as `The answer raised an error on line 53: Error: no such campaign`. The same view and input give the same result, so running it again does not help.

## Bounds

| Bound                             | Value                                                                                                                        | When it is reached                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Document                          | 65,536 bytes in UTF-8, as every definition                                                                                   | Refused when saved                                                                                                                     |
| Assignments                       | 500 to variables in one function, as for a computation function                                                              | Refused when saved, `invalid_input`                                                                                                    |
| The check at save                 | 2 seconds of the server's wall-clock time on the check's own worker, counted once it is ready, as for a computation function | `invalid_input`: simplify the types, split the module, or save again when the server is less busy; `unavailable` with no checker ready |
| Filters                           | 8                                                                                                                            | Refused when saved                                                                                                                     |
| Events a view folds               | The playbook's whole history, in the order it was recorded, selected by the filters                                          | Not bounded                                                                                                                            |
| Work of one fold                  | 500 checkpoints, what one workflow input may do                                                                              | The view stalls at that event                                                                                                          |
| Memory of one fold                | 64 MiB, the maximum of the view's sandbox for a page of events                                                               | The view stalls at that event                                                                                                          |
| Duration of one fold              | 10 seconds; the one stall that depends on the machine's speed                                                                | Tried again on twenty passes, then the view stalls                                                                                     |
| View                              | 512 KiB as JSON, checked after every fold, so that a view returned whole fits a run's record                                 | The view stalls at that event                                                                                                          |
| Depth of a value                  | 512 levels, in a view and in an answer; the stack 1 MiB, as for a computation function                                       | The view stalls; an answer ends `conflict`, `unworkable`                                                                               |
| Work of one answer                | 500 checkpoints                                                                                                              | `conflict`, `unworkable`                                                                                                               |
| Output                            | 1,046,528 bytes as JSON: 1 MiB less 2,048 bytes kept for the run's record                                                    | `conflict`, `unworkable`                                                                                                               |
| Duration and memory of a run      | 10 seconds and 256 MiB, as for a computation function                                                                        | `unavailable`; `conflict`, `unworkable`                                                                                                |
| Recall functions a playbook keeps | 32, the setting `RECALL_MAX_FUNCTIONS`; lowering it below what a playbook keeps refuses saves and nothing else               | Refused when saved, `conflict`                                                                                                         |
| Views built at once               | 4 a playbook, the setting `RECALL_MAX_REBUILDS`; a stalled view counts for none                                              | The save succeeds; the standing says `waiting`                                                                                         |
| Folding time of a page            | 2 seconds from its first fold, checked before each fold                                                                      | The page ends before its next fold; the rest waits for the next page                                                                   |
| Pages a pass                      | 10 a playbook                                                                                                                | The playbook goes on at the next pass                                                                                                  |
| Playbooks followed at once        | 4, the setting `RECALL_PLAYBOOKS_AT_ONCE`                                                                                    | The others wait for their turn                                                                                                         |
| Lag                               | Reported in the standing and the record                                                                                      | Never bounded                                                                                                                          |

A run's output and its record share 1 MiB, as for every run; see [Runs and results](http.md#runs-and-results). A recall function's record also says where its view had read to, so it keeps more room than most. The [configuration reference](../self-host/configuration.md) describes the settings.

Work is counted in checkpoints, as for a computation function. The engine counts one every 10,000 of its steps, where a call or the jump of a loop is a step. So the same fold spends the same checkpoints on every server and at every size of page.

As a measure, the example's fold built a view of 100,000 matching events, over runs of 100 campaigns, in 42.7 seconds: about 0.43 ms a fold. It read pages of up to 1,000 events in a worker kept between pages. Much of that time went to writing the view out after each fold, which grows with the size of the view. Each fold spent no checkpoint. 3,000 of the events gave the same view and the same checkpoints in pages of 7 and of 1,000. Measured on 2026-10-10 on Node 26.10.0 on an Apple M4 Max.

## In a workflow

A workflow calls a recall function as it calls any function, with `call: run_definition` and `type: recall`; see [Calling a function](workflow-format.md#calling-a-function). The task's output is the run's output. It typically goes to a reasoning function whose prompt reads it as any input. A recall function reaches nothing outside the playbook, so a workflow may run it again freely.

- A view follows its playbook by up to a pass and a page's folds. A workflow that recalls what it recorded a moment before may not see it yet. A step sees only the output, not the checkpoint.
- A run rejected with `conflict` of the kind `stalled` or `unworkable` raises a `runtime` error with status 409 and that `kind`. Running it again gives the same result, so a retry policy should not match it.
- A view still being built raises the problem type `https://on.auto/problems/rebuilding` with status 503, which a retry may resolve.

This workflow recalls the verdicts the playbook reached on a campaign before. A reasoning function advises on the campaign with those verdicts in front of it, and a computation function counts them. The recall function `campaign-reviews` is the document at the top of this page. The reasoning function `advise-on-campaign`:

```markdown
---
description: Advises whether to approve a campaign, given the verdicts the playbook reached on it before
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      reviews: { type: array }
    required: [reviews]
output:
  format: json
  schema: { type: object, properties: { approve: { type: boolean } }, required: [approve], additionalProperties: false }
---

Given the verdicts this playbook reached on the campaign before, {{ input.reviews | json }}, should it approve the campaign?
```

The computation function `tally-verdicts`:

<!-- prettier-ignore -->
```markdown
---
description: Counts the approvals and rejections among the reviews, beside the advice
language: typescript
input:
  schema:
    type: object
    required: [reviews, advice]
    properties:
      reviews: { type: array, items: { type: object, required: [verdict], properties: { verdict: { type: string } } } }
      advice: { type: object, required: [approve], properties: { approve: { type: boolean } } }
---

export default function (input: Input): Json {
  return {
    approvals: input.reviews.filter((review) => review.verdict === 'approve').length,
    rejections: input.reviews.filter((review) => review.verdict.startsWith('reject')).length,
    approve: input.advice.approve,
  };
}
```

The workflow `decide-on-campaign`:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-reviews
  name: decide-on-campaign
  version: '1.0.0'
  summary: Recalls the verdicts on a campaign, asks for advice with them, and counts them.
input:
  schema:
    document:
      type: object
      properties:
        campaign: { type: string }
      required: [campaign]
do:
  - recall:
      try:
        - remember:
            call: run_definition
            with:
              type: recall
              name: campaign-reviews
              input: { campaign: '${ $data.campaign }', last: 20 }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: { seconds: 5 }
          limit:
            attempt: { count: 3 }
        do:
          - give-up:
              raise:
                error:
                  type: https://example.com/errors/reviews-unavailable
                  status: 503
                  title: The campaign's reviews could not be recalled
                  detail: The recall function was still unavailable after three retries
      export:
        as: '${ ({ reviews: $data }) }'
  - advise:
      call: run_definition
      with:
        type: reasoning
        name: advise-on-campaign
        input: { reviews: '${ $context.reviews }' }
  - tally:
      call: run_definition
      with:
        type: computation
        name: tally-verdicts
        input: { reviews: '${ $context.reviews }', advice: '${ $data }' }
```

`run_definition` of `decide-on-campaign` takes an input such as `{"campaign": "spring-sale"}`. While the view is still being built, the `recall` task retries up to three times, 5 seconds apart. Then `give-up` raises an error that names what failed, and the run ends `rejected` as `unavailable`; [Errors, retries and timeouts](workflow-format.md#errors-retries-and-timeouts) explains this pattern. A view that has stalled ends the run `rejected` at once, and its history shows the recall function's run with the stall.

## The overview

`get_definition` returns a saved function with its `overview`: the function in plain words, for a person who does not read TypeScript or YAML. Auto Studio shows it before the document. The overview says, in order:

1. The `description`, or that the function has none yet.
2. What the function remembers: each filter as a sentence, such as "each time a run of the reasoning function **review-brief** succeeds" for the example at the top of this page. A filter without a `subject` names every run, and one for a definition's event without a `source` names every definition. Each other attribute and the `data` a filter names are said with it, an expression as it is written.
3. What it keeps: the view's schema in words, with its bounds, such as `maxProperties` and `maxItems`, and `view.initial` unless it is empty.
4. What it answers: each field of `input.schema` and `output.schema`, or the view itself for a module without `answer`.
5. How the view is kept: a diagram from each filter to the view and from the view to the answer, with one line that the program is TypeScript and is shown under Source. The module itself is not described.
6. **Used by**: the active definitions of the playbook that use this function, read each time it is returned, and left out when there are none.

The overview is composed from the document when it is saved, and each read adds the definitions that use the function, so the rest says only what the document says. Write the `description` for the person who will read it, and give each field of the schemas a `description`, so the overview can say it. A function without them still has an overview, with the types alone.

## Availability

Recall functions are available in every runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
