---
description: 'How to write a message to Slack as a card: the components and their props, the limits, what is refused and a complete example.'
---

<div v-pre>

# Cards for Slack

A message to a person can be a card with text, fields, a table, a chart and link buttons. Write `render: slack` in the front matter of an interaction function. The body after the front matter is then a card in YAML, not a Liquid text, and the run turns it into the list of Slack blocks and offers it to `deliver.with` as `rendered`. This guide holds everything about the card. The `interaction-function` guide holds the other keys of the function: `to`, `expires`, `deliver`, `replies`, `input` and `output`.

## Lay the card out

Decide what the reader must know, decide or do. Build the card around that one thing, and leave out what does not serve it.

**Order.** Use these zones in this order. Skip a zone that would be empty or padding.

1. Title: what happened or what is needed, with the number or state that matters. Subtitle: one short fact that places it, such as who or when. A notification shows the top of the card, so these two must stand alone. Do not repeat them below.
2. Lead: one plain Text, only for a reason or a consequence the title cannot carry.
3. Facts: one Fields block of two to six pairs, the one the reader acts on first.
4. Body: what the reader must read, look at or compare, in that order: a Text of input prose, an Image, up to two Charts, one Table.
5. Ask, when the card asks something: a Divider, one bold Text with the question, then the replies. It comes after everything the reader needs to answer. When the title is the question and nothing sits between, skip the Divider and the bold Text.
6. Links: one Actions row.
7. Footnote: one muted Text. When the reader need do nothing, it says so.

**Component by content.**

- Pairs whose labels you know now: Fields. A lone fact goes in the title or subtitle.
- An input list with one value per item, bounded by the input schema to ten or fewer: repeated Fields. More values per item, or no bound: a Table of at most four columns, numbers aligned right.
- Values across categories or time: a Chart, only when the input always holds the same points. Line for time, bar for categories, pie for shares of a whole. A single number goes in the title or a Field.
- Input text of unknown length: its own plain Text in the body, whole, never in the title, the subtitle or a Field.
- A picture the reader must judge: an Image whose alt says what it shows.
- A link: a LinkButton labelled with what it opens, never an address or a link in a Text. Give the one link the reader most likely needs `style: primary`, which shows it in colour, and leave the others plain. Use `style: danger` only for a link to something that cannot be undone. Links from an input list: repeated LinkButtons.

**Replies.** The reader answers by replying in the thread, so say exactly what to reply. For yes or no, one muted Text is enough. For several answers, write one Field per answer, its label the exact word to reply and its value what happens next, then one muted Text that says to reply with one of them. Show an answer that takes a note as the word, then what to add.

**Emphasis.** The title is the entry point. Only the ask is bold, so a card that asks nothing has no bold Text. Only the footnote and the reply instructions are muted. Use a Divider only before the ask, or between two groups the reader handles separately. Use a Section to repeat a group once for each input item.

**Data you cannot see.** The card cannot count, cut, sort or hide. Have the step before it pass what the card shows: a summary line that reads right at zero and at many, for the subtitle or the lead; at most ten rows, sorted, with a link to the rest; and a Table caption that says what was left out or that there is nothing, since an empty Table still shows its headers.

**Small stays small.** A reminder may be a title, one Text and one LinkButton.

**Fix these.**

- One long Text: split it into title, lead, Fields and links.
- "Label: value" in a sentence: make it a Field.
- More than six Fields: drop what nobody acts on, or use a Table.
- The question in the title and again in the body: keep it once.
- The ask before what the reader must read: move it after.

**Check before saving.**

- Do the title and subtitle alone say what this is and what is needed?
- Is at most one Text bold, and is it the ask?
- Does the card read right with no items and with a very long text?
- Can the reader tell exactly what to reply, or that nothing is needed?

## An example

This function tells a team how the week's orders went. It takes no answer, so it is a notification.

<!-- prettier-ignore -->
```markdown
---
description: Tell a team how the week's orders went
to: '{{ input.channel }}'
expires: P1D
render: slack
deliver:
  server: chat
  tool: post_message
  with: { channel: '{{ to }}', blocks: '{{ rendered }}', text: '{{ message }}' }
input:
  schema:
    type: object
    required: [channel, week, summary, totals, lateOrders, reportUrl]
    properties:
      channel: { type: string }
      week: { type: string }
      summary: { type: string }
      totals:
        type: array
        items:
          type: object
          required: [label, value]
          properties: { label: { type: string }, value: { type: string } }
      lateOrders: { type: array, items: { type: array, items: { type: string } } }
      reportUrl: { type: string }
---
root: card
elements:
  card:
    type: Card
    props: { title: { $template: 'Orders, week of ${/input/week}' } }
    children: [summary, totals, late, links]
  summary:
    type: Text
    props: { content: { $state: /input/summary } }
  totals:
    type: Fields
    repeat: { statePath: /input/totals }
    children: [total]
  total:
    type: Field
    props: { label: { $item: label }, value: { $item: value } }
  late:
    type: Table
    props: { headers: [Order, Customer, Days late], rows: { $state: /input/lateOrders } }
  links:
    type: Actions
    children: [report]
  report:
    type: LinkButton
    props: { label: Open the report, url: { $state: /input/reportUrl }, style: primary }
```

## Shapes

These three skeletons show how the zones fall for different messages, and none is a pattern to copy.

Something happened, nothing to do:

```text
Card (title, subtitle)
  Fields
  Actions
    LinkButton
  Text (muted)
```

A question:

```text
Card (title, subtitle)
  Text
  Fields
  Text (input prose)
  Divider
  Text (bold)
  Fields (one per answer)
  Text (muted)
  Actions
    LinkButton
```

A report:

```text
Card (title, subtitle)
  Text
  Fields
  Chart
  Table
  Actions
    LinkButton
```

## In the front matter

- A message sent through a connection that shows cards must be a card, so a function with no `render` is refused there.
- `render: slack` is the only value that renders. It is refused with `call`, with no `deliver`, and with `deliver: agent`, since an agent reads text.
- `deliver.with` must read `rendered`, and a function with no `render` must not. In it, `rendered` is the list of Slack blocks and `message` is the plain text of the same card. `'{{ rendered }}'` alone is sent as the list; among other text it is refused.
- `deliver` names the tool of a connection that sends a message with blocks, as the `interaction-function` guide sets out. Read what the tool takes with `introspect` first.
- A card asks a question like any request: add `output` and `replies` as the `interaction-function` guide sets out. The reader answers by replying, since a click is no answer, so end the card with a `Text` that says how to reply.
- List in `input.schema.required` every field the card reads, so a request that lacks one is refused when it starts.

## The card

`root` is the id of the first element, which is a `Card`. `elements` maps an id to an element with `type`, `props` and `children`, a list of ids. Every id in `children` names an element under `elements`. Group with a `Section`, never with another `Card`. The body is YAML and no template: quote a text that holds a comma or a colon inside `{ }`, and write no alias or `state`.

A prop may read the run instead of holding a value:

- `{ $state: /input/<field> }` is the value at that path.
- `{ $template: 'Due ${/input/date}' }` fills each `${path}` into the text.
- `repeat: { statePath: /input/items }` on an element, beside `props` and `children`, shows its `children` once for each item of the list. In those children, `{ $item: <field> }` is that item's field.
- A path starts with `/input`, the run's input, `/today`, the UTC day such as `2026-11-01`, or `/now`, the moment of the request in ISO 8601. They are fixed when the request is made, so every attempt sends the same card.
- `$bindState` and `$bindItem` take an answer from the reader, which a message cannot: they are refused.

## Components

Write `type` as one of these. Each prop is shown as it is written in YAML: `[x]` is a list of x, `{ a, b? }` a mapping whose `b` is optional, and `a | b` one of the words.

### Card

Root of a message. Title renders as the card header, subtitle as secondary text. Takes `children`, a list of element ids.

- `title`, optional: `text`
- `subtitle`, optional: `text`
- `imageUrl`, optional: `URL`

### Section

Groups related elements. Takes `children`, a list of element ids.

- No props: write `props: {}` or leave it out.

### Text

A paragraph of markdown text. Use muted for footnotes. No `children`.

- `content`, required: `non-empty text`
- `style`, optional: `plain | bold | muted`

### Fields

Grid of label and value pairs. Children are Field elements. Takes `children`, a list of element ids.

- No props: write `props: {}` or leave it out.

### Field

One label and value pair inside Fields. Good for KPIs. No `children`.

- `label`, required: `non-empty text`
- `value`, required: `text or number`

### Table

Table for row data. Every row has one cell per header. Right-align numeric columns. No `children`.

- `headers`, required: `[text] (1 or more)`
- `rows`, required: `[[text or number]]`
- `align`, optional: `[left | center | right]`
- `caption`, optional: `text`

### Chart

Chart. pie for shares of a whole, bar, line or area for series over categories. No `children`.

- `title`, required: `non-empty text`
- `chart`, required: `{ type: pie, segments: [{ label: non-empty text, value: number above 0 }] (1 or more) } or { type: bar | line | area, categories: [non-empty text] (1 or more), series: [{ name: non-empty text, values: [number] }] (1 or more), xLabel?: text, yLabel?: text }`

### Divider

Separator between groups. No `children`.

- No props: write `props: {}` or leave it out.

### Image

Image from a public https URL. No `children`.

- `url`, required: `URL`
- `alt`, required: `non-empty text`

### Actions

Row of Button and LinkButton elements. Takes `children`, a list of element ids.

- No props: write `props: {}` or leave it out.

### LinkButton

Button that opens a URL. No `children`.

- `label`, required: `non-empty text`
- `url`, required: `URL`
- `style`, optional: `primary | danger`

## Refused

- `Button`: A click is not taken as an answer, so remove the Button; to send the reader somewhere, write a LinkButton with a label and a url.
- Anything else a Slack message cannot show. The run names the element and says to write only text, image, divider, fields, table, chart and link buttons.

## Limits

- Tables in a card: 1
- Charts in a card: 2
- Field elements in one Fields: 10
- Rows in a Table: 100
- Columns in a Table: 20
- Characters in a chart label: 20
- Characters in a Chart title: 50
- Series in a chart: 12
- Categories in a chart: 20
- The plain text of the card, `message`: 8 KiB
- The blocks, as JSON: 32 KiB

## What is refused when

- When the function is saved: a `render` that is not `slack`; a body that is not YAML, or not a mapping of `root` and `elements`; an element that is not a mapping, has a `type` not listed above, or has `children` that are not ids under `elements`; a path that does not start with `/input`, `/today` or `/now`, or names a property `input.schema` does not allow; props that do not fit the type, in an element with no expression and no `repeat`; a LinkButton `style` that is not `primary` or `danger`.
- When it is saved, for layout: a function that sends through a connection that shows cards and writes no `render`, and a card that breaks the rules of "Lay the card out" in what it writes literally: a Card with no title or fewer than two children, a Text that holds a link, two or more `Label: value` lines or more than 600 characters, more than one bold Text, more than one LinkButton with `style: primary`, or no muted Text in a function that takes an answer. A prop that reads the input is not judged.
- When it runs: a card that cannot be made ends the run `invalid_input` with an issue for each problem, such as a root that is not a `Card`, a value read from the input that does not fit its prop, a row with the wrong number of cells, a series with the wrong number of values, a `Field` outside `Fields`, an empty card, or a limit passed. Text or blocks over the limits end it `conflict`, kind `unworkable`.

</div>
