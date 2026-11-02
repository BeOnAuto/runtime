<div v-pre>

# Page format

A page presents results from a workflow, a function or the whole playbook. It has two templates:

- `result` shows one run.
- `lately` summarizes runs over time, using views derived from the playbook's events.

Both render Markdown and can include charts in fenced blocks. The API stores a page as a definition with type `page`.

A page is not a function, and it never runs:

- It belongs to one subject, which it names in `of`: a workflow, a function or the playbook. A subject has at most one active page.
- The runtime keeps, versions and checks a page as it does every definition. Each save makes a version, and a document it refuses is not saved.
- The runtime renders a page each time it is read. `get_run` of a run of the subject carries the run rendered through `result`, and `get_definition` of the subject carries `lately` rendered over the views. So Auto Studio, a chat and an agent show the same words.
- A page is not pinned to a version of its subject: a run of an older version renders with the page as it stands.
- `list_definitions` lists one type at a time, so a page never appears in a list of functions.

To start, give a workflow [a minimal page](#a-minimal-page): a headline for each run, and one chart of the runs so far.

## A page document

The source is Markdown with YAML front matter, followed by the two templates. This example presents the workflow `morning-social-content`. Each morning the workflow drafts the day's social posts, asks their owner to approve them, and ends with an output such as:

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

The page lists each run's posts, with a link to each. It keeps two views of the runs so far: the posts of each day, as a series, and the posts of each channel, as categories:

<!-- prettier-ignore -->
````markdown
---
description: The posts the morning social content workflow drafts, run by run and over time
of: workflow/morning-social-content
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
---
{% result %}
{% if run.status == "started" %}
Waiting for approval of the posts drafted this morning.
{% else %}
{{ output.posts | size }} posts drafted for {{ output.date }}.

{% for post in output.posts -%}
- [{{ post.channel }}: {{ post.title | clip: 80 }}]({{ post.url }})
{% endfor %}
{% endif %}
{% endresult %}

{% lately %}
{% if views.by_channel -%}
Since it began, the workflow has drafted {{ views.by_channel.values | sum: "value" }} posts across {{ views.by_channel.values | size }} channels.
{%- endif %}

```chart line
{{ views.posts_per_day | json }}
```

```chart bars
{{ views.by_channel | json }}
```
{% endlately %}
````

`View` is the two views as TypeScript types, each optional: `{ posts_per_day?: Series; by_channel?: Categories }`. `Series` and `Categories` are the [output shapes](output-shapes.md) of those names, and `Event` and `Json` are as a recall function has them. The runtime declares all of them for the module; see [The module](#the-module).

To save the page, `create_definition` takes `type: "page"`, a `name` such as `morning-posts`, and the document as `source`. It takes no `overview` and no `diagram`. It also requires the playbook id unless the MCP connection is scoped to that playbook.

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

`get_definition` of the workflow carries this Markdown as `page.lately`. Auto Studio draws the two blocks as a line and as bars:

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

The fold runs once for every run of the workflow that succeeds, whatever it returned. So it guards against every output it may meet, as a [recall function's fold](recall-format.md#guard-the-fold) does:

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
````markdown
---
description: The revenue of each month the workflow closed
of: workflow/close-the-month
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
---
{% result %}
{% if run.status == "started" %}
Closing the month…
{% else %}
{{ output.month }} closed with {{ output.revenue | money }} of revenue.
{% endif %}
{% endresult %}

{% lately %}
```chart line
{{ views.revenue | json }}
```
{% endlately %}
````

`get_run` of the run that closed October carries `2026-10 closed with $182,450 of revenue.` as `page.result`, which is also its headline. `get_definition` of the workflow carries `page.lately`, a line of the revenue of the last 36 months closed. The fold guards what it reads, as [Guard the fold](#guard-the-fold) says: an output without a `month` in the form `YYYY-MM`, or without a `revenue` that is a number, adds nothing.

### The time a view is keyed by

Each point of a series has a time, and the fold chooses where it comes from:

- the time of the run, `event.time`, as the fold of [the page document](#a-page-document) keys the posts of each day;
- a period the run's output carries, such as `month` here, or a `week` or a `date`.

Use the run's time when the work concerns that moment, such as posts drafted this morning. When the work concerns a specific period, such as the month being closed, include that period in the output and use it to key the view.

This keeps backfilled and late runs in the period they describe. Using the run's time would put a year of months closed in one afternoon under that afternoon's date.

A period the fold reads must be in the form of its series' `period`, such as `YYYY-MM` for a month or `YYYY-Www` for a week; see [Output shapes](output-shapes.md#series). A value in another form would fail the view's shape and stall the views, so the fold passes it over.

### One value for each period

A month has one revenue figure, even if the month is closed again after a correction. This fold removes the existing point for that month before adding the new one, so a repeated run replaces the figure.

Adding the figures instead would count a month twice. Add runs together only when each run contributes new data, as the morning-posts example does.

## Fields

| Field                | Purpose                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`        | Optional; 1 to 1,000 characters                                                                                                                                                          |
| `of`                 | Required; the subject whose results the page presents: `<type>/<name>`, where the type is `workflow`, `reasoning`, `interaction`, `prediction`, `recall` or `computation`, or `playbook` |
| `data.language`      | Required with `data`; `typescript`, the playbook's one language                                                                                                                          |
| `data.source.events` | Required with `data`; 1 to 8 filters, each naming events the fold takes, as a [recall function's filters](recall-format.md#filters) do                                                   |
| `data.views`         | Required with `data`; 1 to 8 views, each a name and the shape it takes: `series`, `categories`, `table` or `text`; see [The views](#the-views)                                           |
| `data.module`        | Required with `data`; a TypeScript module that exports `fold`; see [The module](#the-module)                                                                                             |

- `data` is optional. A page without it has no views and no `lately`.
- Unknown fields are refused with their line. Among them are the fields of a function that do not apply here: `model`, `language`, `input` and `output`.
- The body after the front matter holds the two templates; see [The templates](#the-templates).
- The saved page has the `media_type` `text/markdown`. Its `description` comes from the document.

### The subject

`of` names the subject as the playbook's events name it, such as `workflow/morning-social-content` or `reasoning/review-brief`, or it is `playbook`:

- The subject must be a definition the playbook has and has not retired, when the page is saved.
- A subject has at most one active page. A page's name is free, as any definition's is, so the playbook's page is the one whose `of` is `playbook`, whatever its name.
- A page presents no page, so `of` never names one.
- `of` stays as it was saved: an update that changes it is refused. To present another subject, retire the page and save a new one.
- Retiring the subject retires its page, which records its own `definition_retired`.
- A page retired on its own frees its subject, which can then take a new page.

## The views

`data` is a projection, as a [recall function](recall-format.md) keeps one: filters that name the events it takes, and a module whose `fold` adds each of those events to the views. Where this page leaves a rule out, the `recall-function` guide gives it.

### What the fold sees

The fold sees what a recall function's fold sees, in the order the playbook recorded it, from the first event of its history:

- the start and the end of every run of each function and workflow, with the output of each run that succeeded and fit its event, and the reason and kind of each run that was rejected;
- the definitions saved, updated and retired, pages among them;
- every event published to the playbook, or emitted by its workflows.

It never sees a run's input or a tool call, although the playbook's history records both. [The events](recall-format.md#the-events) lists each event the fold sees, with its attributes.

### The module

`data.module` is one TypeScript module that exports `fold(view: View, event: Event): View`, and nothing else. The runtime declares these types for it:

| Type                                    | What it is                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `View`                                  | An object of the views `data.views` names, each optional and of its shape's type                 |
| `Series`, `Categories`, `Table`, `Text` | The four [output shapes](output-shapes.md), `series`, `categories`, `table` and `text`, as types |
| `Event`, `Json`                         | The playbook's event and any JSON value, as for a [recall function](recall-format.md#the-module) |

- The fold starts from `{}`, with no views. A view the fold leaves out has no data yet, and `lately` reads it as `null`.
- The module is checked when the page is saved, and runs in the sandbox, as a recall function's module is; see [The module](recall-format.md#the-module) of a recall function.
- A module that exports `answer` is refused, since a page never runs.
- The module's lines are counted in the document, so a problem names the line of the page where it is.

### The views' rules

- `data.views` names 1 to 8 views. A name is 1 to 32 lowercase letters, digits and underscores, beginning with a letter, so that a template reads it as `views.<name>`.
- Each name takes the name of a shape: `series`, `categories`, `table` or `text`. [Output shapes](output-shapes.md) gives each shape's fields and rules.
- After every fold, each view the fold returned must match its shape, with the rules the shape adds, such as the order of a series' points.
- After every fold, the fold returns no name that `data.views` does not declare.
- The views together take at most 512 KiB as JSON: 524,288 bytes in UTF-8, checked after every fold.

### How the views are kept

The server that runs the playbook's workflows keeps the views, as it keeps a recall function's view; see [How the view is kept](recall-format.md#how-the-view-is-kept):

- The views follow the playbook as a recall function's view does, by up to a pass (a second) for an event another server recorded.
- Saving a page with `data`, or a new version of one, builds its views from the start of the playbook's history. Until they have caught up, `page.lately` is the one line that says so; see [Lines in place of a render](#lines-in-place-of-a-render).
- Pages and recall functions share the four views a playbook builds at once, the setting `RECALL_MAX_REBUILDS`. The others wait in the order they were saved.
- A newer version replaces an older one that is being built, waiting or stalled.

### When the views stall

If a fold cannot process an event, updates stop at that event. The views retain their earlier data, and `result` can still render. In place of `page.lately`, the runtime returns a message explaining that updates stopped. The standing identifies the cause:

| Kind      | At that event                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `raised`  | The fold raised an error, a stack overflow among them                                                |
| `work`    | The fold did more than its work                                                                      |
| `memory`  | The fold used more memory than its sandbox                                                           |
| `unfit`   | The fold returned what JSON cannot carry, or a value deeper than 512 levels                          |
| `size`    | The fold returned views larger than 512 KiB together                                                 |
| `shape`   | The fold returned a view that does not match its shape, or a name that `data.views` does not declare |
| `refused` | The module does not load                                                                             |
| `time`    | The fold ran out of its 10 seconds twenty times                                                      |
| `crash`   | The worker folding the events crashed at this event twenty times                                     |

The history is the source of the views, so the repair is a corrected version. Saving it builds the views again from the start.

## The templates

The body after the front matter holds two blocks:

| Block                          | Rendered over          | Carried by                                        |
| ------------------------------ | ---------------------- | ------------------------------------------------- |
| `{% result %}…{% endresult %}` | One run of the subject | `get_run` of that run, as `page.result`           |
| `{% lately %}…{% endlately %}` | The views              | `get_definition` of the subject, as `page.lately` |

- Each block is optional, and a page has at least one.
- A block stands at the top level, outside every other tag. It is written at most once, and its tags take no arguments.
- Nothing but white space stands outside the blocks.
- The playbook's page has no `result`, since the playbook has no runs of its own.
- `lately` needs `data`, and `data` needs `lately`, since the views are kept for `lately` alone.
- The white space at each end of a rendered block is dropped.

Each block is a [Liquid](https://shopify.github.io/liquid/) template, as a reasoning function's prompt is, and renders Markdown; see [Markdown, not HTML](#markdown-not-html).

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

The first line of the rendered result is the run's headline, which cards and lists show alone. Write it as one plain sentence of at most 200 characters. A client cuts a longer one at 200 characters, with an ellipsis (`…`).

A run that was rejected or failed is not rendered through the template. Its `page.result` is a fixed sentence with its reason:

| The run  | `page.result`                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rejected | `The run was rejected as <reason>, <kind>.`, written without `, <kind>` where the rejection has no kind, and followed by the rejection's `detail` where it has one |
| Failed   | `The run failed.`                                                                                                                                                  |

So a run whose request nobody answered in time shows `The run was rejected as unanswered, expired.` as its headline.

### `lately`

`lately` reads four variables and nothing else:

| Variable       | Value                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views.<name>` | Each view `data.views` names, as the fold left it; `null` while it has no data                                                                     |
| `subject`      | The subject, as `result` reads it. For the playbook, `type` is `playbook`, `name` is the playbook's id, and `description` and `version` are `null` |
| `today`        | The date of the read, `YYYY-MM-DD`, in UTC                                                                                                         |
| `now`          | The time of the read, in ISO 8601, in UTC                                                                                                          |

### Reading values

- A template may also read names it creates itself with `assign`, `for`, `increment` or `cycle`. Any other name is refused when the page is saved, with its line.
- `views.<name>` must name a view that `data.views` declares.
- `run` and `subject` have only the fields the tables above name. Any other, such as `run.cost`, is refused when the page is saved, with its line.
- The fields of `output` are not checked when the page is saved, since the subject may change what it returns from one version to the next.
- A field a value does not have stops the render. Two places may read a missing field without stopping it: a condition of `if`, `elsif` or `unless`, and the `default` filter. So `{% if output.posts %}…{% endif %}` and `{{ post.title | default: "Untitled" }}` read a field that may be absent.
- Only a value's own fields can be read: `output.constructor` is a missing field.
- A list renders as its items with no separators, and an object as `[object Object]`. Use `{{ views.by_channel | json }}` to render JSON.

### Tags

Available: `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment` and `#`, and the two blocks.

Not available: `include`, `render`, `layout` and `block`, since a page is a single document; `capture`, for which use `assign` with `append`; `tablerow`, which writes HTML, which every client shows as text, so write rows with `for`; and `system`, which only a reasoning function's prompt has. A template that names another tag is refused when the page is saved, with its line, and so is one that leaves a tag or an output open.

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
| `figure`    | categories          | Each value as a figure, with its name, its unit and its range                               | None                                          |
| `text`      | text                | The text, as Markdown                                                                       | None                                          |

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
- A row stands at the top level of a block's Markdown, outside lists, quotes and fenced blocks. Rows do not nest.
- Inside a row, a line holding only `---` separates two cells. A row holds 2 to 4 cells.
- Each cell is Markdown, usually a short heading and a chart block; a sentence, a list or a table fits a cell too. A chart block in a cell stands at the top level, as a [chart block](#chart-blocks) must.
- A fenced block in a cell keeps its lines: a `---` or a `:::` inside it, such as in a chart's body, is part of the block.
- The Markdown before, between and after the rows stands on its own, across the page. Outside a row, `---` is Markdown's own rule, a line across the page.

A valid row keeps its Markdown structure. In Studio, cells share the row's width equally and stack vertically on narrow screens. A client without layout support, such as a chat or agent, prints them in order with the `::: row`, `---` and `:::` lines.

Leave a blank line between a sentence and a following `---`, so Markdown readers do not interpret the sentence as a heading.

### When a row is checked

- The `::: row`, `---` and `:::` lines a template writes out are checked when the page is saved, as they stand in the template. Each row is closed before its block ends, no row opens inside another, and each `:::` closes a row. A line that starts with `:::` and is neither, such as `::: column`, is refused, and so is a `:::` line with a space before it.
- A row with no tag among its lines is checked whole when the page is saved: it holds 2 to 4 cells, and none is empty. A row with a tag among its lines, such as a `for` that writes its cells, has its cells counted when it renders, since the tag decides how many there are.
- Every row is checked again on the Markdown its block renders, so a row that an output or a tag writes is checked too. The chart blocks are drawn first, so a chart that cannot be drawn keeps its cell, as its line and its table.
- A row that breaks a rule when it renders is shown as its cells one after another, without its `::: row`, `---` and `:::` lines, under one line that says why. A row that is never closed runs to the end of its block.
- A cell that renders empty, such as one whose Markdown a tag leaves out, keeps its place in its row.

| The row             | The line in its place                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Never closed        | `This row could not be laid out: it is not closed by a line of :::.`           |
| Holding another row | `This row could not be laid out: it holds another row, and rows do not nest.`  |
| Holding 1 cell      | `This row could not be laid out: it holds 1 cell, and a row holds at least 2.` |
| Holding more than 4 | `This row could not be laid out: it holds 5 cells, and a row holds at most 4.` |

## Laying out a page

Lead with the result and the figures someone needs to understand it. Group related charts in rows, and put longer tables and lists below them:

- Open `lately` with a `figure` block of the three to five numbers that say how it is going, such as the orders, the revenue and the average order.
- Then rows of two or three charts that belong together, each cell a short heading and its chart.
- Then the long tables and lists, across the page.
- Open `result` with its headline sentence, then the figures of the run, then at most one row of charts. The headline is the first line of `result`, so a row never opens it.
- Write a row's cells without `if`: a chart whose view has no data yet says so in its cell, and the row keeps its shape.

This page presents the workflow `fulfill-order`, which fulfills one order a run and ends with an output such as:

```json
{ "order": "A-1043", "channel": "Web", "total": 132.25 }
```

<!-- prettier-ignore -->
````markdown
---
description: The orders the workflow fulfills, one by one and over time
of: workflow/fulfill-order
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
---
{% result %}
{% if run.status == "started" %}
Fulfilling the order…
{% else %}
Order {{ output.order }} fulfilled: {{ output.total | money }}, ordered through {{ output.channel }}.
{% endif %}
{% endresult %}

{% lately %}
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
{% endlately %}
````

The fold guards what it reads, as [Guard the fold](#guard-the-fold) says: an output without a `total` that is a number of at least 0 adds nothing, and an order without a channel counts for `Other`. The line keeps the 30 days up to the latest order, and the table the latest 10 orders.

`get_run` of the run for the order of 1 November carries `Order A-1043 fulfilled: $132.25, ordered through Web.` as `page.result`. After three orders, on 30 October, 31 October and 1 November, `get_definition` of the workflow carries this Markdown as `page.lately`. Auto Studio draws the figures across the top, the three charts of the row side by side, and the table of the latest orders under them:

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

`get_definition`, `list_definitions`, `create_definition` and `update_definition` show a page with its `description` and its `details`:

- `details.of` is its subject, such as `workflow/morning-social-content`, or `playbook`.
- `details.views` maps each view's name to its shape. A page without `data` has none.

The example page shows:

```json
{
  "details": {
    "of": "workflow/morning-social-content",
    "views": { "posts_per_day": "series", "by_channel": "categories" }
  }
}
```

- A page has no `input_schema`, `output_schema`, `overview` or `diagram`. No definition uses a page, so it has no `used_by`.
- `get_definition` of a page with `data` adds its views' `standing`, with the fields of [a recall function's standing](recall-format.md#the-standing-of-a-view): `state`, `version`, the checkpoint, `lag_ms`, and `stalled` for views that stalled.
- A page's saves are definition events like any other, `definition_created`, `definition_updated` and `definition_retired`, with the source `/definitions/page/<name>`.
- A subject's `used_by` does not list its page. The subject's reads carry the page instead; see [What reads render](#what-reads-render).

## What reads render

The runtime renders a page each time it is read, with the page and the views as they stand then:

| Read                                    | What it carries                                   |
| --------------------------------------- | ------------------------------------------------- |
| `get_run` of a run of the subject       | `page.result`: the run, rendered through `result` |
| `get_definition` of the subject         | `page.lately`: `lately`, rendered over the views  |
| The [preview](#the-preview) of the page | `page.result` and `page.lately`                   |

- A read carries no `page` where the subject has no page, and no `page.result` or `page.lately` where the page has no such block. A read left with neither carries no `page`: `get_definition` of a subject whose page has no `lately` has no `page`.
- `run_definition`, `list_runs` and `list_definitions` carry no `page`.
- Each read renders the page as it stands. So an older run renders with the current page, and two reads a moment apart can differ by `now`.
- A retired page renders nowhere. Its subject's reads carry no `page`, its views are no longer kept, and its preview is refused with `conflict`.

### Lines in place of a render

Where a block cannot be rendered, the read carries one fixed line in its place, and never a render half done:

| When                                                      | The line                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The views are being built, or wait to be built            | `page.lately`: `Building this page's figures from the playbook's history…`                                               |
| The views stalled                                         | `page.lately`: `The figures stopped updating because the page could not process an event. Correct the page to continue.` |
| `result` stopped, such as at a field the output lacks     | `page.result`: `Could not display this run:`, then the problem and its line                                              |
| `lately` stopped                                          | `page.lately`: `Could not display this page’s figures:`, then the problem and its line                                   |
| A block rendered more than 64 KiB, or past a render limit | The same line, which names the limit                                                                                     |

### The preview

The preview renders a page when asked, so that it can be seen before its subject has run. Over MCP it is `get_definition` of the page with two more inputs. Over HTTP it is a route of its own, relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Over | Operation                                                   | Input                                            |
| ---- | ----------------------------------------------------------- | ------------------------------------------------ |
| MCP  | `get_definition`, with `type: "page"` and the page's `name` | `render: true`, and optionally `sample_output`   |
| HTTP | `POST /definitions/page/{name}/render`                      | Optionally, a JSON body `{ "sample_output": … }` |

Both answer the page as `get_definition` does, with `page.result` and `page.lately`, and need `playbook:read`, as `get_definition` does.

- `sample_output` is an output to render `result` over, as the output of a run that succeeded. It is checked against the subject's output schema, where the subject has one.
- Without `sample_output`, `result` renders over the subject's latest run. `page.result` is left out when the subject has not run.
- A page with no `result` takes `sample_output` too. It is checked as above, and renders nothing.
- Over a sample, `run.status` is `succeeded`, `run.started` and `run.ended` are the moment of the read, and `run.version` is the subject's latest version.
- `lately` renders over the views as they stand, or as the line that says they are being built.
- Over MCP, `render` on a definition that is not a page is refused as `invalid_input`, and so is `sample_output` without `render`.
- The playbook has no definition of its own to read, so the preview of its page is how its `lately` is read.

## Saving a page

`create_definition` and `update_definition` check the whole page before saving it: its front matter, its subject, its module, its templates and the chart fences written in them. Each problem is an issue under `/source`, with its line where it has one. These are refused when a page is saved, each for the reason given:

- An `of` that is missing, or that names neither a workflow, a function nor `playbook`: a page presents one subject.
- An `of` that names a page: a page has no results to present.
- An `of` whose subject the playbook does not have, or has retired: a page presents what the playbook has.
- A page whose subject already has an active page, `conflict`: a subject has one page at a time.
- An update that changes `of`: a page belongs to its subject.
- An unknown field, such as `model`, `input` or `output`, with its line: a page takes the fields above.
- `data` without `language`, `source.events`, `views` or `module`; more than 8 views; a view's name not of the form above; or a shape that is not `series`, `categories`, `table` or `text`.
- A filter that a recall function's filters refuse, or a module that a recall function's check refuses, with its line and the compiler's words; see [The module](recall-format.md#the-module) of a recall function.
- A module that exports `answer`: a page never runs.
- `data` without `lately`, or `lately` without `data`: the views are kept for `lately` alone.
- A body with neither block; a block written twice, inside another tag or with arguments; or text outside the blocks: a page shows its blocks and nothing else.
- `result` in the playbook's page: the playbook has no runs of its own.
- A template that does not compile, or names a tag, a filter or a variable its block does not have, or a view that `data.views` does not declare, with its line.
- A chart fence written out with a kind that the table of kinds does not list, a role its kind does not take, or a role written twice, with its line.
- A row written out that is never closed, that opens inside another row, or that holds fewer than 2 cells, more than 4 or an empty one; a `:::` that closes no row; or another line that starts with `:::`; each with its line. See [When a row is checked](#when-a-row-is-checked).
- A document over 65,536 bytes, or templates over 32 KiB together.

A save is also refused for its overview or its diagram, and nothing is saved:

| Case                         | Response                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A page saved with `overview` | `invalid_input` at `/overview`: `A page takes no overview, since Auto Studio shows the page itself; leave overview out` |
| A page saved with `diagram`  | `invalid_input` at `/diagram`: `A page takes no diagram, since Auto Studio shows the page itself; leave diagram out`    |

`run_definition` of a page is refused as `invalid_input`, since a page never runs: run its subject, and read the run with `get_run`.

## The overview

A page takes no `overview` and no `diagram`. Auto Studio shows the page itself where it would show them, and the subject's own overview says why the subject exists. A save that gives either is refused; see [Saving a page](#saving-a-page).

[Reasoning functions](http.md#reasoning-functions) gives the rules every definition follows: its name, its versions and its retirement.

## Limits

| Bound                                 | Value                                                                                | When it is reached                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Document                              | 65,536 bytes in UTF-8, as every definition                                           | Refused when saved                                   |
| Templates                             | 32 KiB (32,768 bytes) in UTF-8, the two together                                     | Refused when saved                                   |
| Names in tags and outputs             | 1,000 in each template, as in a reasoning function's                                 | Refused when saved                                   |
| Views                                 | 8                                                                                    | Refused when saved                                   |
| Filters                               | 8, as for a recall function                                                          | Refused when saved                                   |
| The check at save                     | 2 seconds of the server's time on the check's own worker, as for a recall function   | `invalid_input`; `unavailable` with no checker ready |
| The views together                    | 512 KiB as JSON, checked after every fold                                            | The views stall at that event, `size`                |
| Work, memory and duration of one fold | 500 checkpoints, 64 MiB and 10 seconds, as for a recall function                     | The views stall at that event                        |
| Views built at once                   | 4 a playbook, pages and recall functions together, the setting `RECALL_MAX_REBUILDS` | The save succeeds; the standing says `waiting`       |
| Time to render                        | 200 ms for each block                                                                | The line in place of the block                       |
| Memory a render may charge            | 5,000,000 characters or items                                                        | The line in place of the block                       |
| A rendered block                      | 64 KiB (65,536 bytes) in UTF-8, for `result` and for `lately`                        | The line in place of the block                       |
| The headline                          | 200 characters                                                                       | A client cuts it there, with an ellipsis             |
| `sample_output`                       | 256 KiB as JSON, nesting at most 512 levels, as a run's input                        | `invalid_input` at `/sample_output`                  |
| Pages of a subject                    | 1 active                                                                             | `conflict`                                           |
| Cells of a row                        | 2 to 4                                                                               | Refused when saved; a line says why when it renders  |

## Availability

Pages are available in every runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
