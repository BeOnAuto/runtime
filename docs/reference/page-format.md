<div v-pre>

# Page format

Give every workflow and function a page. It shows the person the value of the work: what each run achieved, and what the runs add up to over time. A definition saved without one has none; see [Where the page goes](#where-the-page-goes).

Show numbers over time as a chart keyed by [the period a run is about](#the-time-a-view-is-keyed-by), and anything else in its clearest form: a table, a list or a sentence. Show the value of the work, not telemetry: never how long the runtime took, a model's tokens or a run's id.

What a page shows depends on its subject. The format guide of each type gives its recipe under Its page:

| Subject                                                | `result`, one run                                                  | `runs`, the runs so far                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Workflow](workflow-format.md#its-page)                | The business outcome of the run, as a headline and its key figures | The main number of each period, with its breakdowns                         |
| [Reasoning function](reasoning-format.md#its-page)     | The judgment in a sentence, with the fields that decided it        | The outcomes by category over time                                          |
| [Interaction function](interaction-format.md#its-page) | The decision, who made it and when                                 | The decisions over time, what waits now, and how long people took to answer |
| [Prediction function](prediction-format.md#its-page)   | The forecast as a line, with its horizon                           | The forecast against what happened                                          |
| [Memory function](memory-format.md#its-page)           | What was remembered or recalled                                    | What its runs kept or recalled over time                                    |
| [Computation function](computation-format.md#its-page) | The numbers, as figures or a table                                 | Their series over time                                                      |
| [Lookup function](lookup-format.md#its-page)           | What was found, as a table                                         | The values found over time, where they are numbers                          |
| [Generation function](generation-format.md#its-page)   | The asset the run produced, linked, in the function's own words    | What was produced over time, as a count or a table of the latest            |
| [The playbook](#where-the-page-goes)                   | None, since the playbook has no runs of its own                    | Each workflow's main number, once the playbook has more than one workflow   |

Write the page its type's recipe gives. Where the work fits none of them, start with [a minimal page](#a-minimal-page): a headline for each run, and one chart of the runs so far.

A page presents the results of a workflow, a function or the whole playbook. A definition's page is the `page` key of its own document. It is saved and versioned with the definition it presents, which is its subject. It has two templates:

- `result` shows one run.
- `runs` summarizes runs over time, using views derived from the playbook's events.

Both render Markdown and can include charts in fenced blocks.

A page is not a function, and it never runs:

- `create_definition` and `update_definition` save the page with the rest of the document, so a save that changes only the page is a new version of the definition, as any save is. A document whose page the runtime refuses is not saved.
- The runtime renders a page each time it is read. `get_run` of a run of the subject carries the run rendered through `result`, and `get_definition` of the subject carries `runs` rendered over the views. So Auto Studio, a chat and an agent show the same words.
- The views are a fold of the playbook's events, so `render_page` given a `run_id` renders `runs` over them as they stood when that run ended; see [As of a run](#as-of-a-run).

## A page

A page is a YAML mapping of up to three keys: `data`, the views it keeps, and the two templates, `result` and `runs`, written as block scalars. This example is the page of the workflow `morning-social-content`. Each morning the workflow drafts the day's social posts, asks their owner to approve them, and ends with an output such as:

```json
{
  "date": "2026-11-01",
  "posts": [
    {
      "channel": "LinkedIn",
      "title": "Three things our support team learned from 1,000 tickets in October",
      "url": "https://example.com/drafts/1041"
    },
    {
      "channel": "X",
      "title": "October in one number: 1,000 tickets, a median first reply of 14 minutes",
      "url": "https://example.com/drafts/1042"
    },
    {
      "channel": "Instagram",
      "title": "Meet the team behind the 14-minute reply",
      "url": "https://example.com/drafts/1043"
    }
  ]
}
```

The page lists each run's posts, with a link to each. It keeps two views of the runs so far: the posts of each day, as a series, and the posts of each channel, as categories. It is the `page` key at the top level of the workflow's document, after `do` and its other keys:

<!-- prettier-ignore -->
````yaml
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: workflow/morning-social-content
    views:
      posts_per_day: series
      by_channel: categories
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const posts = fieldOf(fieldOf(event.data, 'output'), 'posts');
        const channels = (Array.isArray(posts) ? posts : []).slice(0, 50).map((post) => {
          const channel = fieldOf(post, 'channel');
          return typeof channel === 'string' && channel !== '' ? channel.slice(0, 64) : 'Other';
        });
        const time = event.time?.slice(0, 10);
        if (time === undefined || channels.length === 0) return view;
        const points = view.posts_per_day?.lines[0]?.points ?? [];
        const last = points.at(-1);
        const day = last !== undefined && last.at > time ? last.at : time;
        const since = new Date(new Date(day).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
        const days = last?.at === day
          ? [...points.slice(0, -1), { at: day, value: last.value + channels.length }]
          : [...points, { at: day, value: channels.length }];
        const counts = new Map((view.by_channel?.values ?? []).map(({ name, value }) => [name, value]));
        for (const channel of channels) counts.set(channel, (counts.get(channel) ?? 0) + 1);
        return {
          posts_per_day: { unit: 'posts', period: 'day', lines: [{ name: 'Posts', points: days.filter(({ at }) => at >= since) }] },
          by_channel: {
            unit: 'posts',
            values: [...counts].toSorted(([, one], [, other]) => other - one).slice(0, 200).map(([name, value]) => ({ name, value })),
          },
        };
      }
  result: |
    {% if run.status == "started" %}
    Waiting for approval of the posts drafted this morning.
    {% else %}
    {{ output.posts | size }} posts drafted for {{ output.date }}.

    {% for post in output.posts -%}
    - [{{ post.channel }}: {{ post.title | clip: 80 }}]({{ post.url }})
    {% endfor %}
    {% endif %}
  runs: |
    {% if views.by_channel -%}
    Since it began, the workflow has drafted {{ views.by_channel.values | sum: "value" }} posts across {{ views.by_channel.values | size }} channels.
    {%- endif %}

    ```chart line
    {{ views.posts_per_day | json }}
    ```

    ```chart bars
    {{ views.by_channel | json }}
    ```
````

`View` is the two views as TypeScript types, each optional: `{ posts_per_day?: Series; by_channel?: Categories }`. `Series` and `Categories` are the [output shapes](output-shapes.md) of those names, and `Event` and `Json` are the playbook's event and any JSON value. The runtime declares all of them for the module; see [The module](#the-module), and [The views' rules](#the-views-rules) for the fields and bounds of each shape.

The page is saved with the workflow, by `create_definition` or `update_definition` of the document that holds it. It has no name, version or `overview` of its own: those are the workflow's.

After three runs of the workflow, on 30 October, 31 October and 1 November, the views are:

```json
{
  "posts_per_day": {
    "unit": "posts",
    "period": "day",
    "lines": [
      {
        "name": "Posts",
        "points": [
          { "at": "2026-10-30", "value": 3 },
          { "at": "2026-10-31", "value": 2 },
          { "at": "2026-11-01", "value": 3 }
        ]
      }
    ]
  },
  "by_channel": {
    "unit": "posts",
    "values": [
      { "name": "LinkedIn", "value": 3 },
      { "name": "X", "value": 3 },
      { "name": "Instagram", "value": 2 }
    ]
  }
}
```

`get_run` of the run of 1 November carries this Markdown as `page.result`. Its first line is the run's headline:

```markdown
3 posts drafted for 2026-11-01.

- [LinkedIn: Three things our support team learned from 1,000 tickets in October](https://example.com/drafts/1041)
- [X: October in one number: 1,000 tickets, a median first reply of 14 minutes](https://example.com/drafts/1042)
- [Instagram: Meet the team behind the 14-minute reply](https://example.com/drafts/1043)
```

While a run still waits for the owner's approval, its `page.result` is `Waiting for approval of the posts drafted this morning.`

`get_definition` of the workflow carries this Markdown as `page.runs`. Auto Studio draws the two blocks as a line and as bars:

<!-- prettier-ignore -->
````markdown
Since it began, the workflow has drafted 8 posts across 3 channels.

```chart line
{"unit":"posts","period":"day","lines":[{"name":"Posts","points":[{"at":"2026-10-30","value":3},{"at":"2026-10-31","value":2},{"at":"2026-11-01","value":3}]}]}
```

```chart bars
{"unit":"posts","values":[{"name":"LinkedIn","value":3},{"name":"X","value":3},{"name":"Instagram","value":2}]}
```
````

### Guard the fold

The fold runs once for every run of the workflow that succeeds, whatever it returned. So it guards against every output it may meet:

- An output that is not an object, or holds no list of posts, adds nothing. So does an output too large for its event, which then carries its size instead.
- A post without a channel, or with one that is not text, counts for `Other`. A channel's name is cut at 64 characters, the most a category's name may hold. At most 50 posts of one run count.
- An event without a time adds nothing. An event dated before the last point counts for that point's day, so the points stay in time order, as a series needs.
- The line keeps the 30 days up to the latest run. The channels keep their counts since the first run, at most 200 of them, the most a `categories` view holds.

These views take at most 85,678 bytes of JSON, about 84 KiB, within the 512 KiB limit. That includes 30 points of up to 44 bytes, 200 channels of up to 420 bytes, and their field names and punctuation.

If the fold raises an error or returns a view that does not match its shape, updates stop at that event. See [When the views stall](#when-the-views-stall).

## A minimal page

A page can start small: a headline for each run, and one chart of the runs so far. This page presents the workflow `close-the-month`, which closes a month's books and ends with an output such as:

```json
{ "month": "2026-10", "revenue": 182450 }
```

<!-- prettier-ignore -->
````yaml
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: workflow/close-the-month
    views:
      revenue: series
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const output = fieldOf(event.data, 'output');
        const month = fieldOf(output, 'month');
        const revenue = fieldOf(output, 'revenue');
        if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(month) || typeof revenue !== 'number') return view;
        const others = (view.revenue?.lines[0]?.points ?? []).filter(({ at }) => at !== month);
        const points = [...others, { at: month, value: revenue }].toSorted((one, other) => (one.at < other.at ? -1 : 1));
        return { revenue: { unit: 'USD', period: 'month', lines: [{ name: 'Revenue', points: points.slice(-36) }] } };
      }
  result: |
    {% if run.status == "started" %}
    Closing the month…
    {% else %}
    {{ output.month }} closed with {{ output.revenue | money }} of revenue.
    {% endif %}
  runs: |
    ```chart line
    {{ views.revenue | json }}
    ```
````

`get_run` of the run that closed October carries `2026-10 closed with $182,450 of revenue.` as `page.result`, which is also its headline. `get_definition` of the workflow carries `page.runs`, a line of the revenue of the last 36 months closed. The fold guards what it reads, as [Guard the fold](#guard-the-fold) says: an output without a `month` in the form `YYYY-MM`, or without a `revenue` that is a number, adds nothing.

### The time a view is keyed by

Each point of a series has a time, and the fold chooses where it comes from:

- the time of the run, `event.time`, as the fold of [the first page](#a-page) keys the posts of each day;
- a period the run's output carries, such as `month` here, or a `week` or a `date`.

Use the run's time when the work concerns that moment, such as posts drafted this morning. When the work concerns a specific period, such as the month being closed, include that period in the output and use it to key the view.

This keeps backfilled and late runs in the period they describe. Using the run's time would put a year of months closed in one afternoon under that afternoon's date.

A period the fold reads must be in the form of its series' `period`, such as `YYYY-MM` for a month or `YYYY-Www` for a week; see [Output shapes](output-shapes.md#series). A value in another form would fail the view's shape and stall the views, so the fold passes it over.

A line joins only points in consecutive periods, so the points of weekly runs keyed by their day draw as separate dots a week apart. Key a weekly run's view by its week, `YYYY-Www`, even when the run is about one day.

### One value for each period

A month has one revenue figure, even if the month is closed again after a correction. This fold removes the existing point for that month before adding the new one, so a repeated run replaces the figure.

Adding the figures instead would count a month twice. Add runs together only when each run contributes new data, as the morning-posts example does.

## Fields

| Key                  | Purpose                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.language`      | Required with `data`; `typescript`, the playbook's one language                                                                                            |
| `data.source.events` | Required with `data`; 1 to 8 filters, each naming events the fold takes; see [The filters of the events](#the-filters-of-the-events)                       |
| `data.views`         | Required with `data`; 1 to 8 views, each a name and the shape it takes: `series`, `categories`, `table`, `text` or `memories`; see [The views](#the-views) |
| `data.module`        | Required with `data`; a TypeScript module that exports `fold`; see [The module](#the-module)                                                               |
| `result`             | Optional; the template of one run; see [The templates](#the-templates)                                                                                     |
| `runs`               | Optional; the template of the runs so far, over the views                                                                                                  |

- `data` is optional. A page without it has no views and no `runs`.
- A page has `result`, `runs` or both. Write each as a YAML block scalar, `|`, so that its lines stay as written.
- Unknown keys are refused with their line.
- `page: {}` is no page.

### Where the page goes

A page belongs to its subject, a workflow, a function or the playbook:

- A workflow's page is the top-level `page` key of its YAML document, beside `document`, `do` and its other keys.
- A function's page is the `page` key of its front matter, beside `description`, `input` and its other fields. This reasoning function's page gives each run a headline:

```markdown
---
description: Reviews a campaign brief against the team's criteria
model: anthropic/claude-sonnet-4-5
page:
  result: |
    {{ output | clip: 200 }}
---

Review this brief against the team's criteria: {{ input.brief }}
```

- A definition has at most one page. A document saved without `page`, or with `page: {}`, has none, and the summary of a workflow or a function saved so ends with `It has no page yet; the page guide says how to give it one.`, where its 400 characters have room for it.
- Retiring a definition retires its page with it: the page renders nowhere and its views are no longer kept.
- A renamed definition's runs so far stay under its old name, so a page or a prediction function's data part that reads them keeps its filter on the old name, beside one on the new. [Renaming a definition](mcp.md#renaming-a-definition) gives the steps.
- The playbook's page is the same mapping, with `data` and `runs`. It has no `result`, since the playbook has no runs of its own. `update_playbook` saves it as YAML text in `page`, and `page: null` removes it. Each save is recorded as `playbook_page_saved`, which no fold sees.
- Over MCP, `get_playbook` answers the source of the playbook's page and renders nothing; [`render_playbook_page`](#the-preview) renders it, over HTTP alone.
- A page saved as a definition of its own, of the type `page`, is read as its subject's page, in the form of a `page` mapping, without the `of` line that named the subject. It counts only while the subject's document has no `page` key. For the playbook, a save or removal through `update_playbook`, `null` included, replaces it.

## The views

`data` is a projection: filters that name the events it takes, and a module whose `fold` adds each of those events to the views.

### What the fold sees

The fold sees the events of its own playbook, in the order the playbook recorded them, from the first event of its history:

- the start and the end of every run of each function and workflow, with the output of each run that succeeded and fit its event, and the reason and kind of each run that was rejected;
- the definitions saved, updated, paused, resumed and retired;
- every event published to the playbook, or emitted by its workflows.

These events are not the whole of the playbook's history:

| What                    | The events a fold sees                                                                                       | The playbook's history                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Who reads them          | A page's fold, and also a workflow's event triggers and `listen` filters and a prediction function's dataset | A person or an agent, with `list_playbook_events` and `get_event`                                                                             |
| What they hold          | The facts in the table below, and the events published to the playbook or emitted by its workflows           | Everything recorded: those facts and events, each run's input on its `run_started`, tool calls, workflow steps, requests, answers, deliveries |
| The shape of each event | A CloudEvent, with the attributes below                                                                      | `id`, `type`, `summary`, `data` and `metadata`                                                                                                |

So `run_started` is in both, with the run's input in the history and with no data for a fold. A tool call, a step or an answer is in the history alone, and a fold never sees it. The events a fold sees:

| Events                                                                                                      | `source`                     | `subject`       | `data`                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `run_started`, `run_failed`                                                                                 | `/runs/<run id>`             | `<type>/<name>` | none                                                                                            |
| `run_succeeded`                                                                                             | `/runs/<run id>`             | `<type>/<name>` | `output`; or `output_bytes`, its size, when the output would make the event larger than 240 KiB |
| `run_rejected`                                                                                              | `/runs/<run id>`             | `<type>/<name>` | `reason`, and `kind` where the rejection has one                                                |
| `definition_created`, `definition_updated`, `definition_retired`, `definition_paused`, `definition_resumed` | `/definitions/<type>/<name>` | none            | none                                                                                            |
| An event published to the playbook, of any other type                                                       | as its publisher gave it     | as given        | as given; see [Publishing events](http.md#publishing-events)                                    |

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
- An event the runtime cannot read, such as one whose data nests deeper than 512 levels, is passed over and reported to the operator once.

### The filters of the events

`data.source.events` names the events the fold takes, in 1 to 8 filters. Every value except `data` is written out, never computed:

| Key                 | What an event must have                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | Required; exactly this type                                                                                                                                                              |
| `source`            | Optional; exactly this source                                                                                                                                                            |
| `subject`           | Optional; exactly this subject, such as `workflow/morning-social-content` for the runs of one workflow                                                                                   |
| Any other attribute | Optional; exactly this value, such as `triggerkind: event` or `caller: playbook:finance`: a whole number from 1 for `depth`, `calldepth` and `definitionversion`, and text for any other |
| `data`              | Optional; data equal to this value, or data for which an expression such as `'${ $data.revenue > 100 }'` holds; the expression reads the event's data as `$data` and nothing else        |

- An event is folded when it matches any of the filters, and once only.
- A filter that names an attribute the event does not have does not match it. A filter for runs that no reaction or no call started therefore leaves `depth` or `calldepth` out.
- A filter that names `depth`, `calldepth` or `definitionversion` as 0 is refused when the page is saved.
- An expression holds unless it returns `false` or `null`.
- An attribute is named as CloudEvents names it, in at most 20 lowercase letters and digits. Any other key is rejected, and so is a computed attribute.
- A `data` expression that names anything but `$data` is refused when the page is saved, with the compiler's `Cannot find name`.

### The module

`data.module` is one TypeScript module that exports `fold(view: View, event: Event): View`. The runtime declares these types for it:

| Type                                                | What it is                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `View`                                              | An object of the views `data.views` names, each optional and of its shape's type                             |
| `Series`, `Categories`, `Table`, `Text`, `Memories` | The five [output shapes](output-shapes.md), `series`, `categories`, `table`, `text` and `memories`, as types |
| `Event`, `Json`                                     | The playbook's event, described below, and any JSON value                                                    |

- The fold starts from `{}`, with no views. A view the fold leaves out has no data yet, and `runs` reads it as `null`.
- A module that exports `answer` is refused, since a page never runs.
- The module's lines are counted in the definition's document, so a problem names the line where it is.

`Event` is the playbook's event. It has the CloudEvents attributes `specversion`, `id`, `type`, `source`, `subject`, `time`, `datacontenttype` and `dataschema`, and `data` as `Json`. It also has `causationid`, `correlationid` and the playbook's own extensions: `caller`, `definitionversion`, `depth`, `calldepth`, `calledby`, `triggerkind` and `triggerreference`. Each is optional except `id`, `type` and `source`. A fold reads the definition of a run's event from `event.subject`, and who acted from `event.caller`. `Event` names no other extension. Read another through a type that names it, such as `(event as Event & { region?: string }).region`, so that a misspelt attribute is refused rather than read as an extension.

The module may declare types of its own and exported functions, and nothing else at the top level. A module that kept state between two folds would make the views depend on where a page of events ends. Write a helper inside the function that uses it, or export it.

The module is checked when the page is saved, as a [computation function's program](computation-format.md#the-program) is: with the TypeScript compiler in strict mode with `exactOptionalPropertyTypes`, against these types and the sandbox's own library. Each problem is refused with its line and the compiler's words. The check refuses:

- a module without `fold`, or a `fold` of another signature, with the signature it needs;
- a top-level statement other than a type or an exported function, such as `let`, a class or a function the module does not export;
- `import`, `require`, `eval`, `new Function`, `import()`, `import.meta` and declared names such as `declare global`;
- `async`, `await` and an exported generator, since a fold returns at once;
- an `enum`, a `namespace` or a parameter property;
- more than 500 assignments to variables in one function;
- a name the sandbox lacks, as listed below.

The module runs in the QuickJS sandbox that [computation functions](computation-format.md#the-sandbox) run in, with the same library and numbers:

- The library is the language's own, ES2023 and more, such as `toSorted`, `Map.groupBy`, `Object.groupBy`, `Set.prototype.union`, the iterator helpers and `BigInt`.
- Absent: `Math.random`, `eval`, `Function`, `WeakRef`, `FinalizationRegistry`, `Promise`, `console`, `fetch`, timers, `Intl`, modules and every local-time method of `Date`.
- `new Date(number)`, `new Date(date)`, a date alone such as `new Date("2026-01-01")`, and a date and time with its offset work.
- These raise: a `Date` from several numbers, a date and time without an offset, `Date` called without `new`, `String(date)` and `toLocaleString()`. Use `Date.UTC`, the `getUTC…` methods and `toISOString()`.
- Strings compare and sort by UTF-16 code unit, and `localeCompare` reads no locale. An object keeps its keys in the order they were written.
- Numbers are IEEE 754 doubles. Integers are exact up to 2^53, and `0.1 + 0.2` is not `0.3`. There is no decimal type, so keep amounts in whole minor units, such as cents. End a division with `Math.floor`, `Math.ceil` or `Math.round`.
- The views are JSON. A `Date`, a `Map`, a `Set`, a class instance, a function, a `BigInt`, a symbol, `NaN`, `Infinity`, `undefined` and a cycle are not. A fold that returns one stalls the views.

The sandbox has no time zone. So a fold that keys by the person's own day works the day out itself, with the rule of their zone written once, in the fold or in a function the module exports. This one gives the day in US Pacific time, whose clocks go forward on the second Sunday of March and back on the first Sunday of November, each at 02:00, and a fold keys by `pacificDay(event.time)` once it has checked that `event.time` is there:

```typescript
export function pacificDay(time: string): string {
  const at = Date.parse(time);
  const year = new Date(at).getUTCFullYear();
  const sunday = (month: number, nth: number): number =>
    Date.UTC(year, month, 1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7) + 7 * (nth - 1));
  const summer = at >= sunday(2, 2) + 10 * 3_600_000 && at < sunday(10, 1) + 9 * 3_600_000;
  return new Date(at - (summer ? 7 : 8) * 3_600_000).toISOString().slice(0, 10);
}
```

The views do not depend on where a page of events begins or ends:

- In a fold, `Date.now()` and `new Date()` return the time of the event being folded, so a fold gives the same views on every server.
- The views stay inside the fold's sandbox for a whole page of events. Each fold is given the views the fold before it returned, as JSON gives them back. What JSON does not keep never reaches the next fold: an object two members share, a negative zero, or a member keyed by a symbol.
- The sandbox is frozen once the module is loaded, the prototypes of iterators and generators among it. So nothing a fold writes outside its views reaches the next fold, whether to `Math`, to a prototype or to the module.

### The views' rules

- `data.views` names 1 to 8 views. A name is 1 to 32 lowercase letters, digits and underscores, beginning with a letter, so that a template reads it as `views.<name>`.
- Each name takes the name of a shape: `series`, `categories`, `table`, `text` or `memories`, whose fields and bounds the table below gives.
- After every fold, each view the fold returned must match its shape, with the rules the shape adds, such as the order of a series' points.
- After every fold, the fold returns no name that `data.views` does not declare.
- The views together take at most 512 KiB as JSON: 524,288 bytes in UTF-8, checked after every fold.

| Shape        | Fields                                                                                                                                                                         | Bounds                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series`     | `lines`, each a `name` and `points`, each an `at` and a `value`, with optional `low` and `high`; optional `unit`, `period`, `origin` and `marks`, each a `label` and a `value` | 1 to 20 lines, each name once, and 2,000 points across them, each later than the one before; 8 marks. `at` takes the form of `period`: `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn` or `YYYY`, or, without one, an RFC 3339 time |
| `categories` | `values`, each a `name` and a `value`, with optional `low` and `high`; optional `unit`                                                                                         | 1 to 200 values, each name once                                                                                                                                                                                                    |
| `table`      | `columns`, each a `name` and an optional `unit`; `rows`, each a list of one cell for each column, in their order                                                               | 1 to 50 columns, each name once; 500 rows. A cell is text, a number, `true`, `false` or `null`                                                                                                                                     |
| `text`       | `text`, Markdown                                                                                                                                                               | 65,536 bytes in UTF-8                                                                                                                                                                                                              |
| `memories`   | `memories`, each with its `id`, `scope`, `text`, `tags`, `written_at` and `written_by`, and an optional `about`, as a recall answers them                                      | 16,000 characters of text across them                                                                                                                                                                                              |

A `name`, a `label` and a `unit` are text of 1 to 64 characters. A `value`, a `low` and a `high` are numbers, a `low` at most its `value` and a `high` at least it. [Output shapes](output-shapes.md) gives every rule of each shape.

### How the views are kept

The server that runs the playbook's workflows keeps the views:

- It is woken by every event the playbook records through it. The views follow the playbook by the time it takes to fold a page of events, and by up to a pass (a second) for an event another server recorded.
- It reads the playbook's history in pages of up to 1,000 records. It folds each page in a worker apart from the server, kept ready between pages.
- It writes the views once a page, so a restart folds at most one page again, to the same views.
- Saving a page with `data`, or with its `data` changed, builds its views from the start of the playbook's history. A new version that leaves `data` as it was keeps the views. Until they have caught up, `page.runs` is the one line that says so; see [Lines in place of a render](#lines-in-place-of-a-render).
- A playbook builds the views of at most four pages at once, the setting `PAGE_MAX_REBUILDS`. The others wait in the order they were saved.
- Changed `data` replaces views of the `data` before it that are being built, waiting or stalled.

#### The standing of the views

`get_definition` of a subject whose page has `data` carries its views' standing as `page.standing`, and so does [`render_playbook_page`](#the-preview) for the playbook's page:

| Field                         | What it says                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                       | `live` once caught up, `rebuilding` while they are built, `waiting` for their turn to be built, or `stalled`; [as of a run](#as-of-a-run), also `out_of_reach` |
| `version`                     | The version of the subject whose `data` the views are built from                                                                                               |
| `checkpoint`, `checkpoint_at` | Where in the playbook's history the views have read to, an opaque cursor, and when the playbook recorded the last record they read                             |
| `last_event`, `folded`        | The `id` and `time` of the last event the views folded, `null` before the first, and how many events they have folded                                          |
| `lag_ms`                      | How far the views are behind: the time of the playbook's newest record less `checkpoint_at`, to the second on SQLite                                           |
| `newest_record_at`            | When the playbook last recorded anything                                                                                                                       |
| `stalled`                     | For stalled views: the `event` they stopped at, with its `id`, `type` and `time`; the `kind` of stall; the fold's own `error`; and its `line` in the document  |

### When the views stall

If a fold cannot process an event, updates stop at that event. The views retain their earlier data, and `result` can still render. In place of `page.runs`, the runtime returns a message explaining that updates stopped. The standing identifies the cause:

| Kind      | At that event                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `raised`  | The fold raised an error, a stack overflow among them                                                |
| `work`    | The fold did more work than one fold may, 500 checkpoints                                            |
| `memory`  | The fold used more memory than its sandbox                                                           |
| `unfit`   | The fold returned what JSON cannot carry, or a value deeper than 512 levels                          |
| `size`    | The fold returned views larger than 512 KiB together                                                 |
| `shape`   | The fold returned a view that does not match its shape, or a name that `data.views` does not declare |
| `refused` | The module does not load                                                                             |
| `time`    | The fold ran out of its 10 seconds twenty times                                                      |
| `crash`   | The worker folding the events crashed at this event twenty times                                     |

The history is the source of the views, so the repair is a corrected version. Saving it builds the views again from the start.

## The templates

A page holds two templates:

| Key      | Rendered over          | Carried by                                      |
| -------- | ---------------------- | ----------------------------------------------- |
| `result` | One run of the subject | `get_run` of that run, as `page.result`         |
| `runs`   | The views              | `get_definition` of the subject, as `page.runs` |

The playbook's `runs` is carried by [`render_playbook_page`](#the-preview).

- Each is optional, and a page has at least one.
- The playbook's page has no `result`, since the playbook has no runs of its own.
- `runs` needs `data`, and `data` needs `runs`, since the views are kept for `runs` alone.
- The white space at each end of a rendered template is dropped.

Each is a [Liquid](https://shopify.github.io/liquid/) template, as a reasoning function's prompt is, and renders Markdown; see [Markdown, not HTML](#markdown-not-html).

### `result`

`result` reads five variables and nothing else:

| Variable              | Value                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| `output`              | The run's output; `null` while the run is still going                   |
| `run.status`          | `succeeded`, or `started` while the run is still going                  |
| `run.started`         | When the run started, in ISO 8601, in UTC                               |
| `run.ended`           | When the run ended, in ISO 8601, in UTC; `null` while it is still going |
| `run.version`         | The version of the subject the run used, a whole number from 1          |
| `subject.type`        | The subject's type, such as `workflow`                                  |
| `subject.name`        | The subject's name                                                      |
| `subject.description` | The subject's description; `null` where it has none                     |
| `subject.version`     | The subject's latest version, which may be later than `run.version`     |
| `today`               | The date of the read, `YYYY-MM-DD`, in UTC                              |
| `now`                 | The time of the read, in ISO 8601, in UTC                               |

`result` reads no input, so a headline names what a run was about only where its output carries it. Have a function return what it was asked about beside its answer, such as the campaign whose brief it reviewed. Where the output cannot carry it, as an interaction function's answer or a memory kept cannot, the page of the workflow that calls the function says it, from the workflow's output.

The first line of the rendered result is the run's headline, which cards and lists show alone. Write it as one plain sentence of at most 200 characters. A client cuts a longer one at 200 characters, with an ellipsis (`…`).

A run that was rejected or failed is not rendered through the template. Its `page.result` is a fixed sentence with its reason:

| The run  | `page.result`                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Rejected | `The run was rejected as <reason>, <kind>. <detail>`, written without `, <kind>` where the rejection has no kind |
| Failed   | `The run failed.`                                                                                                |

So a run whose request nobody answered in time shows `The run was rejected as unanswered, expired. Nobody answered the request before it expired at 2026-11-04T09:00:00.000Z` as its headline.

### `runs`

`runs` reads four variables and nothing else:

| Variable       | Value                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views.<name>` | Each view `data.views` names, as the fold left it; `null` while it has no data                                                                     |
| `subject`      | The subject, as `result` reads it. For the playbook, `type` is `playbook`, `name` is the playbook's id, and `description` and `version` are `null` |
| `today`        | The date of the read, `YYYY-MM-DD`, in UTC                                                                                                         |
| `now`          | The time of the read, in ISO 8601, in UTC                                                                                                          |

### Reading values

- A template may also read names it creates itself with `assign`, `for`, `increment` or `decrement`. Any other name is refused when the page is saved, with its line.
- `views.<name>` must name a view that `data.views` declares.
- `run` and `subject` have only the fields the tables above name. Any other, such as `run.cost`, is refused when the page is saved, with its line.
- The fields of `output` are not checked when the page is saved, since the subject may change what it returns from one version to the next.
- A field a value does not have stops the render. Two places may read a missing field without stopping it: a condition of `if`, `elsif` or `unless`, and the `default` filter. So `{% if output.posts %}…{% endif %}` and `{{ post.title | default: "Untitled" }}` read a field that may be absent.
- Only a value's own fields can be read: `output.constructor` is a missing field.
- A list renders as its items with no separators, and an object as `[object Object]`. Use `{{ views.by_channel | json }}` to render JSON.
- A number renders as it is, such as `4.800000000000001`. Round it with `round`, or `round: 1` for one decimal.

### Tags

Available: `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment` and `#`.

Not available: `include`, `render`, `layout` and `block`, since each template stands alone; `capture`, for which use `assign` with `append`; `tablerow`, which writes HTML, which every client shows as text, so write rows with `for`; and `system`, which only a reasoning function's prompt has. A template that names another tag is refused when the page is saved, with its line, and so is one that leaves a tag or an output open.

### Filters

A template may use the filters listed in [Templates](template.md#filters), the `templates` guide, the same in every template. A template that names another filter is refused when the page is saved, with its line.

### Markdown, not HTML

A page renders Markdown, and never HTML:

- Every client shows raw HTML in a rendered page as text. So no value an output carries can add markup, a script or a style to a page.
- A client opens a link only when it is `https:`, `http:` or `mailto:`, and shows any other link as its text.
- A client shows an image as a link to it, and never loads it.

## Chart blocks

A chart is a fenced code block whose info string is the word `chart`, a kind and, optionally, roles. Its body is the JSON of the data it draws. The body is usually a view, written `{{ views.<name> | json }}`. In `result`, it may be the run's output, `{{ output | json }}`, where the subject declares an [output shape](output-shapes.md):

<!-- prettier-ignore -->
````markdown
```chart scatter x=Spend y=Sign-ups color=Channel
{{ views.campaigns | json }}
```
````

- A chart block stands on its own lines, at the top level of the Markdown. One inside a list or a quote is shown as code.
- The info string's words are separated by spaces. A role is written `role=column`, with the column's name in double quotes when it holds a space, such as `y="Sign-ups per day"`.
- Each kind reads data of the shapes the table below names. A kind that reads a table takes roles, which name its columns.

### Kinds

| Kind        | Reads               | Draws                                                                                       | Roles                                         |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `line`      | series              | Each line over time, its `low` and `high` as a band, and its `marks` as levels              | None                                          |
| `bars`      | categories or table | A bar for each category, or for each row of a table, grouped by `color`                     | `x`, `y`; optional `color`                    |
| `stacked`   | series              | The lines stacked over time, so that the top is their total                                 | None                                          |
| `share`     | categories          | Each category's part of their total; every value is at least 0                              | None                                          |
| `histogram` | categories          | The categories as adjoining bins, in their order                                            | None                                          |
| `scatter`   | table               | A point for each row                                                                        | `x`, `y`; optional `color`, `mark`            |
| `bubble`    | table               | A point for each row, sized by `size`                                                       | `x`, `y`, `size`; optional `color`, `mark`    |
| `heatmap`   | table               | A cell for each row, at its `x` and `y`, shaded by its `value`                              | `x`, `y`, `value`                             |
| `range`     | categories or table | Each category's `low` to `high`, with its value marked; a value without them is drawn alone | `x`, `low`, `high`; optional `value`          |
| `funnel`    | categories          | The categories as stages, in their order, each with its part of the first                   | None                                          |
| `calendar`  | series              | A cell for each day, shaded by its value; the series has one line, whose `period` is `day`  | None                                          |
| `timeline`  | table               | A bar for each row, from its `start` to its `end`, on the line its `y` names                | `y`, `start`, `end`; optional `color`, `mark` |
| `table`     | table               | The table                                                                                   | None                                          |
| `figure`    | categories          | Each value as a figure, with its name, the view's unit and its range                        | None                                          |
| `text`      | text                | The text, as Markdown                                                                       | None                                          |

- A kind draws only the shapes it reads. To draw a value for each period as bars, keep the view as `categories` named by period, or as a `table`; a series is drawn by `line`, `stacked` or `calendar`. A `bars` fence over a series is saved, and fails when it renders.
- A line's scale spans all it draws, so one value far above the rest flattens all the others. Cap such values in the fold, and say so in the chart's heading, as `Days of cover, capped at 60`.
- A `figure` block shows each value's name and the view's one `unit`, so put a value's own unit in its name, as `Revenue (USD)`.
- `text` reads a view of the shape text, `{"text": "…"}`, and shows it as Markdown.
- No kind reads `memories`. Write a memories view as a Markdown list instead:

<!-- prettier-ignore -->
```markdown
{% if views.kept %}{% for memory in views.kept.memories -%}
- {{ memory.text | clip: 200 }}
{% endfor %}{% endif %}
```

### Roles

A role names the column of a table that gives one part of the chart:

| Role           | The column of                                                                | Each cell                   |
| -------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `x`            | Each row's place across: its category, its time or its number                | Text, a number or a time    |
| `y`            | Each row's value up the chart; in a heatmap or a timeline, the line it is on | A number; text in those two |
| `color`        | Each row's group: the rows of one group share a color and a legend entry     | Any cell, read as its text  |
| `size`         | Each bubble's size                                                           | A number, at least 0        |
| `value`        | Each cell's value in a heatmap; the value marked in a range                  | A number                    |
| `low`, `high`  | The lowest and the highest of each range                                     | Numbers                     |
| `mark`         | A label, on the rows where it is not `null`                                  | Text                        |
| `start`, `end` | When each bar of a timeline begins and ends                                  | Times                       |

- A time is text in a form that a series' `at` takes: a period, such as `2026-10-15` or `2026-Q4`, or an RFC 3339 date and time.
- A role the kind needs, left out, takes a column by order. The kind's needed roles, in the order the table of kinds lists them, take the table's columns in the order of `columns`, passing over those a written role names. So `chart bars` over a table whose columns are `Channel` and `Posts` draws a bar for each channel.
- An optional role left out is not drawn.
- A row whose cell is `null` in a role the kind needs is not drawn. Any other cell that does not fit its role fails the block, which names the column and the row.
- Roles name columns, so a block with roles over data that is not a table fails.

### When a chart block is checked

- A fence written out in a template is checked when the page is saved. Its kind must be one of the table's, and each role one its kind takes, written once. A fence whose info string the template writes with `{{ }}` or a tag is checked when it renders.
- The body is checked when it renders: its JSON must match a shape the kind reads, and each role must name a column of the table, with cells that fit it.
- A block that fails renders as its data in a table, under one line that says why, such as `Couldn’t display this chart: a line chart requires a series; the data is categories.` A body that is not JSON, or that matches no shape, is shown as code under that line.
- A block whose body is `null`, a view with no data yet, renders as the one line `No data for this chart yet.`

Data becomes a table this way, for a block that fails and for a client that does not draw:

| Shape      | Columns                                                          | Rows                                                                     |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| series     | `at`, then a column for each line, under its name                | One for each `at`, in time order; `low`, `high` and `marks` are left out |
| categories | `name` and `value`, then `low` and `high` where a value has them | One for each value                                                       |
| table      | Its own                                                          | Its own                                                                  |
| text       | None: the text is shown as it is                                 | None                                                                     |

A client that does not draw, such as a chat or an agent, prints each chart block's figures in its place, as that table.

## Rows

A row lays two to four cells side by side, so that the charts that belong together are read at a glance. A line of `::: row` opens it, a line of `---` separates its cells, and a line of `:::` closes it:

<!-- prettier-ignore -->
````markdown
::: row
#### Revenue by channel
```chart stacked
{{ views.by_channel | json }}
```
---
#### Orders each week
```chart bars
{{ views.orders | json }}
```
:::
````

- `::: row` opens a row and `:::` closes it, each alone on its line and at its start. `:::row` opens one too.
- A row stands at the top level of a template's Markdown, outside lists, quotes and fenced blocks. Rows do not nest.
- Inside a row, a line holding only `---` separates two cells. A row holds 2 to 4 cells.
- Each cell is Markdown, usually a short heading and a chart block; a sentence, a list or a table fits a cell too. A chart block in a cell stands at the top level, as a [chart block](#chart-blocks) must.
- A fenced block in a cell keeps its lines: a `---` or a `:::` inside it, such as in a chart's body, is part of the block.
- The Markdown before, between and after the rows stands on its own, across the page. Outside a row, `---` is Markdown's own rule, a line across the page.

In Studio, cells share the row's width equally and stack vertically on narrow screens. A client without layout support, such as a chat or agent, prints them in order with the `::: row`, `---` and `:::` lines.

Leave a blank line between a sentence and a following `---`, so Markdown readers do not interpret the sentence as a heading.

### When a row is checked

- The `::: row`, `---` and `:::` lines a template writes out are checked when the page is saved, as they stand in the template. Each row is closed before its template ends, no row opens inside another, and each `:::` closes a row. A line that starts with `:::` and is neither, such as `::: column`, is refused, and so is a `:::` line with a space before it.
- A row with no tag among its lines is checked whole when the page is saved: it holds 2 to 4 cells, and none is empty. A row with a tag among its lines, such as a `for` that writes its cells, has its cells counted when it renders, since the tag decides how many there are.
- Every row is checked again on the Markdown its template renders, so a row that an output or a tag writes is checked too. The chart blocks are drawn first, so a chart that cannot be drawn keeps its cell, as its line and its table.
- A row that breaks a rule when it renders is shown as its cells one after another, without its `::: row`, `---` and `:::` lines, under one line that says why. A row that is never closed runs to the end of its template.
- A cell that renders empty, such as one whose Markdown a tag leaves out, keeps its place in its row.

| The row             | The line in its place                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Never closed        | `This row could not be laid out: it is not closed by a line of :::.`           |
| Holding another row | `This row could not be laid out: it holds another row, and rows do not nest.`  |
| Holding 1 cell      | `This row could not be laid out: it holds 1 cell, and a row holds at least 2.` |
| Holding more than 4 | `This row could not be laid out: it holds 5 cells, and a row holds at most 4.` |

## Laying out a page

Lead with the result and the figures someone needs to understand it. Group related charts in rows, and put longer tables and lists below them:

- Open `runs` with a `figure` block of the three to five numbers that say how it is going, such as the orders, the revenue and the average order.
- Then rows of two or three charts that belong together, each cell a short heading and its chart.
- Then the long tables and lists, across the page.
- Open `result` with its headline sentence, then the figures of the run, then at most one row of charts. The headline is the first line of `result`, so a row never opens it.
- Write a row's cells without `if`: a chart whose view has no data yet says so in its cell, and the row keeps its shape.

This page presents the workflow `fulfill-order`, which fulfills one order a run and ends with an output such as:

```json
{ "order": "A-1043", "channel": "Web", "total": 132.25 }
```

<!-- prettier-ignore -->
````yaml
page:
  data:
    language: typescript
    source:
      events:
        - type: run_succeeded
          subject: workflow/fulfill-order
    views:
      figures: categories
      revenue: series
      channels: categories
      sizes: categories
      latest: table
    module: |
      export function fold(view: View, event: Event): View {
        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>
          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;
        const textOf = (value: Json | undefined, otherwise: string): string =>
          typeof value === 'string' && value !== '' ? value.slice(0, 64) : otherwise;
        const cents = (value: number): number => Math.round(value * 100) / 100;
        const output = fieldOf(event.data, 'output');
        const total = fieldOf(output, 'total');
        const time = event.time?.slice(0, 10);
        if (time === undefined || typeof total !== 'number' || total < 0) return view;
        const channel = textOf(fieldOf(output, 'channel'), 'Other');
        const points = view.revenue?.lines[0]?.points ?? [];
        const last = points.at(-1);
        const day = last !== undefined && last.at > time ? last.at : time;
        const since = new Date(new Date(day).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
        const days = last?.at === day
          ? [...points.slice(0, -1), { at: day, value: cents(last.value + total) }]
          : [...points, { at: day, value: total }];
        const counts = new Map((view.channels?.values ?? []).map(({ name, value }) => [name, value]));
        counts.set(channel, (counts.get(channel) ?? 0) + 1);
        const bin = total < 25 ? 0 : total < 50 ? 1 : total < 100 ? 2 : 3;
        const sizes = ['Under $25', '$25 to $50', '$50 to $100', '$100 and over'].map((name, at) => ({
          name,
          value: (view.sizes?.values[at]?.value ?? 0) + (at === bin ? 1 : 0),
        }));
        const orders = (view.figures?.values[0]?.value ?? 0) + 1;
        const revenue = cents((view.figures?.values[1]?.value ?? 0) + total);
        const order = [textOf(fieldOf(output, 'order'), 'Unnamed'), channel, total, time];
        return {
          figures: {
            values: [
              { name: 'Orders', value: orders },
              { name: 'Revenue (USD)', value: revenue },
              { name: 'Average order (USD)', value: cents(revenue / orders) },
            ],
          },
          revenue: { unit: 'USD', period: 'day', lines: [{ name: 'Revenue', points: days.filter(({ at }) => at >= since) }] },
          channels: {
            unit: 'orders',
            values: [...counts].toSorted(([, one], [, other]) => other - one).slice(0, 200).map(([name, value]) => ({ name, value })),
          },
          sizes: { unit: 'orders', values: sizes },
          latest: {
            columns: [{ name: 'Order' }, { name: 'Channel' }, { name: 'Total', unit: 'USD' }, { name: 'Day' }],
            rows: [order, ...(view.latest?.rows ?? [])].slice(0, 10),
          },
        };
      }
  result: |
    {% if run.status == "started" %}
    Fulfilling the order…
    {% else %}
    Order {{ output.order }} fulfilled: {{ output.total | money }}, ordered through {{ output.channel }}.
    {% endif %}
  runs: |
    ```chart figure
    {{ views.figures | json }}
    ```

    ::: row
    #### Revenue each day
    ```chart line
    {{ views.revenue | json }}
    ```
    ---
    #### Orders by channel
    ```chart share
    {{ views.channels | json }}
    ```
    ---
    #### Order sizes
    ```chart histogram
    {{ views.sizes | json }}
    ```
    :::

    #### The latest orders

    ```chart table
    {{ views.latest | json }}
    ```
````

The fold guards what it reads, as [Guard the fold](#guard-the-fold) says: an output without a `total` that is a number of at least 0 adds nothing, and an order without a channel counts for `Other`. The line keeps the 30 days up to the latest order, and the table the latest 10 orders.

`get_run` of the run for the order of 1 November carries `Order A-1043 fulfilled: $132.25, ordered through Web.` as `page.result`. After three orders, on 30 October, 31 October and 1 November, `get_definition` of the workflow carries this Markdown as `page.runs`. Auto Studio draws the figures across the top, the three charts of the row side by side, and the table of the latest orders under them:

<!-- prettier-ignore -->
````markdown
```chart figure
{"values":[{"name":"Orders","value":3},{"name":"Revenue (USD)","value":242.75},{"name":"Average order (USD)","value":80.92}]}
```

::: row
#### Revenue each day
```chart line
{"unit":"USD","period":"day","lines":[{"name":"Revenue","points":[{"at":"2026-10-30","value":86.5},{"at":"2026-10-31","value":24},{"at":"2026-11-01","value":132.25}]}]}
```
---
#### Orders by channel
```chart share
{"unit":"orders","values":[{"name":"Web","value":2},{"name":"Marketplace","value":1}]}
```
---
#### Order sizes
```chart histogram
{"unit":"orders","values":[{"name":"Under $25","value":1},{"name":"$25 to $50","value":0},{"name":"$50 to $100","value":1},{"name":"$100 and over","value":1}]}
```
:::

#### The latest orders

```chart table
{"columns":[{"name":"Order"},{"name":"Channel"},{"name":"Total","unit":"USD"},{"name":"Day"}],"rows":[["A-1043","Web",132.25,"2026-11-01"],["A-1042","Marketplace",24,"2026-10-31"],["A-1041","Web",86.5,"2026-10-30"]]}
```
````

## What a saved page shows

A definition's page is in its `source`, as written. `get_definition` adds `page`, what the runtime renders and keeps of it:

| Field      | What it holds                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `runs`     | `runs`, rendered over the views, where the page has it                                           |
| `standing` | The [standing of the views](#the-standing-of-the-views), where the page has `data`               |
| `result`   | In a [preview](#the-preview), `result` rendered over the subject's latest run or a sample output |

- A definition without a page has no `page`. `list_definitions` shows nothing of a page.
- `get_playbook` and `update_playbook` answer the playbook's page as `page: { source }`, its YAML text as saved.

`get_definition` of the workflow of [the first page](#a-page) answers, shown here in part:

````json
{
  "type": "workflow",
  "name": "morning-social-content",
  "version": 4,
  "source": "document:\n  dsl: '1.0.3'\n…\npage:\n  data:\n…",
  "page": {
    "runs": "Since it began, the workflow has drafted 8 posts across 3 channels.\n\n```chart line\n…",
    "standing": { "state": "live" }
  }
}
````

## What reads render

The runtime renders a page each time it is read, with the page as it stands then. The views are as they stand then too, apart from a render [as of a run](#as-of-a-run):

| Read                                       | What it carries                                   |
| ------------------------------------------ | ------------------------------------------------- |
| `get_run` of a run of the subject          | `page.result`: the run, rendered through `result` |
| `get_definition` of the subject            | `page.runs`: `runs`, rendered over the views      |
| The [preview](#the-preview) of the subject | `page.result` and `page.runs`                     |
| The preview [as of a run](#as-of-a-run)    | The run's `page.result`, and `page.runs` then     |
| `render_playbook_page`                     | The playbook's `page.runs`                        |

- `get_run` carries no `page` where the subject has no page, or a page with no `result`. `get_definition` carries no `page.runs` where the page has no `runs`.
- `run_definition`, `list_runs`, `list_definitions`, `get_playbook` and `list_playbooks` render nothing.
- Each read renders the page as it stands. So an older run renders with the current page, and two reads a moment apart can differ by `now`.
- The page of a retired definition renders nowhere, its views are no longer kept, and its preview is refused with `conflict`.

### Lines in place of a render

Where a template cannot be rendered, the read carries one fixed line in its place, and never a render half done:

| When                                                        | The line                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The views are being built, or wait to be built              | `page.runs`: `Building this page's figures from the playbook's history…`                                               |
| The views stalled                                           | `page.runs`: `The figures stopped updating because the page could not process an event. Correct the page to continue.` |
| The views could not be replayed [as of a run](#as-of-a-run) | `page.runs`: `Could not work out this page's figures as they stood when this run ended.`                               |
| `result` stopped, such as at a field the output lacks       | `page.result`: `Could not display this run:`, then the problem and its line                                            |
| `runs` stopped                                              | `page.runs`: `Could not display this page’s figures:`, then the problem and its line                                   |
| A render over 64 KiB, or past a render limit                | The same line, which names the limit                                                                                   |

### The preview

The preview renders a page when asked, so that it can be seen before its subject has run. Over MCP it is `get_definition` of the subject with two more inputs. Over HTTP it is a route of its own, `render_page`, relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Over | Operation                                               | Input                                                                                                        |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| MCP  | `get_definition`, with the subject's `type` and `name`  | `render: true`, and optionally `sample_output`                                                               |
| HTTP | `render_page`, `POST /definitions/{type}/{name}/render` | Optionally, a JSON body `{ "sample_output": … }`, or `{ "run_id": … }` to render [as of a run](#as-of-a-run) |

Both answer the subject as `get_definition` does, with `page.result` and `page.runs`, and need `playbook:read`, as `get_definition` does.

- `sample_output` is an output to render `result` over, as the output of a run that succeeded. It is checked against the subject's output schema, where the subject has one.
- Without `sample_output`, `result` renders over the subject's latest run. `page.result` is left out when the subject has not run.
- A page with no `result` takes `sample_output` too. It is checked as above, and renders nothing.
- Over a sample, `run.status` is `succeeded`, `run.started` and `run.ended` are the moment of the read, and `run.version` is the subject's latest version.
- `runs` renders over the views as they stand, or as the line that says they are being built.
- `render` on a definition without a page is refused as `invalid_input`, and so is `sample_output` without `render`. `render_page` of a definition without a page is refused as `not_found`.

The playbook's page is read with `render_playbook_page`, `POST /render` relative to the playbook, which takes no body, needs `playbook:read` and answers `{ page: { runs, standing } }`, both where the page has `data`. A playbook without a page is refused as `not_found`.

### As of a run

`render_page` given a `run_id` answers `page.result`, `page.runs` and `page.standing` as they stood when that run ended. So a client can show the page of a run from last month as it read that day. This takes HTTP: `get_definition` has no `run_id`.

- The views are not stored for each moment. The runtime folds again from the start of the playbook's history up to the run's last event. It uses the same fold and the same limits that keep the views, and writes nothing.
- `page.result` is what `get_run` of the run answers. `runs` renders with the page of the subject's latest version, like every read. It renders over the views of that run's moment, and its `now` and `today` are that moment.
- `page.standing` says how the replay ended. `checkpoint` and `checkpoint_at` are the run's last event, `folded` and `last_event` count up to there, and `lag_ms` is how far that is behind the playbook's newest record.
- A run still going has no end yet, so it renders over the views as they stand, as the preview does.
- A fold that stalls before the run's last event gives the line for stalled views, as it does for the views themselves. A run that ended before a stall replays as usual.
- Where the replay reaches [its limit](#limits), or no worker can fold it, `page.runs` is the line that says so and `page.standing.state` is `out_of_reach`, with the version alone. `page.result` is still answered.
- A run the playbook does not have is refused as `not_found`. A run of another definition is refused as `invalid_input` at `/run_id`, and so is `run_id` given with `sample_output`.
- The refusals of the preview hold: `not_found` for a definition without a page, and `conflict` for a retired one.

## Saving a page

`create_definition` and `update_definition` check the whole page as they check the rest of the document: its keys, its module, its templates and the chart fences written in them. Each problem is an issue under `/source`, with its line in the document where it has one, and nothing is saved. `update_playbook` checks the playbook's page the same way, with its issues under `/page`. These are refused, each for the reason given:

- A `page` that is not a mapping, or an unknown key in it, with its line: a page takes the keys above.
- `data` without `language`, `source.events`, `views` or `module`; more than 8 views; a view's name not of the form above; or a shape that is not `series`, `categories`, `table`, `text` or `memories`.
- A filter that [The filters of the events](#the-filters-of-the-events) refuse, or a module that [The module](#the-module) refuses, with its line and the compiler's words.
- A module that exports `answer`: a page never runs.
- `data` without `runs`, or `runs` without `data`: the views are kept for `runs` alone.
- A `result` or a `runs` that is not text.
- `result` in the playbook's page: the playbook has no runs of its own.
- A template that does not compile, or names a tag, a filter or a variable it does not have, or a view that `data.views` does not declare, with its line.
- A chart fence written out with a kind that the table of kinds does not list, a role its kind does not take, or a role written twice, with its line.
- A row written out that is never closed, that opens inside another row, or that holds fewer than 2 cells, more than 4 or an empty one; a `:::` that closes no row; or another line that starts with `:::`; each with its line. See [When a row is checked](#when-a-row-is-checked).
- A document over 65,536 bytes, the page included, or templates over 32 KiB together.

## Limits

| Bound                                 | Value                                                           | When it is reached                                   |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Document                              | 65,536 bytes in UTF-8, the page included                        | Refused when saved                                   |
| Templates                             | 32 KiB (32,768 bytes) in UTF-8, the two together                | Refused when saved                                   |
| Names in tags and outputs             | 1,000 in each template, as in a reasoning function's            | Refused when saved                                   |
| Views                                 | 8                                                               | Refused when saved                                   |
| Filters                               | 8                                                               | Refused when saved                                   |
| The check at save                     | 2 seconds of the server's time on the check's own worker        | `invalid_input`; `unavailable` with no checker ready |
| The views together                    | 512 KiB as JSON, checked after every fold                       | The views stall at that event, `size`                |
| Work, memory and duration of one fold | 500 checkpoints, 64 MiB and 10 seconds                          | The views stall at that event                        |
| Views built at once                   | 4 pages a playbook, the setting `PAGE_MAX_REBUILDS`             | The save succeeds; the standing says `waiting`       |
| A replay [as of a run](#as-of-a-run)  | 10 pages of up to 1,000 records, with one page folded at a time | `out_of_reach`, and the line in place of `runs`      |
| Time to render                        | 200 ms for each template                                        | The line in place of the template                    |
| Memory a render may charge            | 5,000,000 characters or items                                   | The line in place of the template                    |
| A rendered template                   | 64 KiB (65,536 bytes) in UTF-8, for `result` and for `runs`     | The line in place of the template                    |
| The headline                          | 200 characters                                                  | A client cuts it there, with an ellipsis             |
| `sample_output`                       | 256 KiB as JSON, nesting at most 512 levels, as a run's input   | `invalid_input` at `/sample_output`                  |
| Cells of a row                        | 2 to 4                                                          | Refused when saved; a line says why when it renders  |

## Availability

Pages are available in every runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
