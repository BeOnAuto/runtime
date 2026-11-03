<div v-pre>

# Memory function format

A memory function is a definition of the type `memory`. It works the playbook's memory alone: what the playbook remembers, and recalls later. It calls no model and reaches nothing outside the runtime. Its document holds one of two blocks:

| Block      | What a run does                                                                                     | Use it for                                                       |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `remember` | Renders a text from its input and keeps it as a memory, or as a new version of a memory it replaces | A fact, a decision or a preference a workflow learns as it works |
| `recall`   | Answers the memories kept that hold every word and every tag it asks, newest first, within a length | What the playbook already knows, given to the step that needs it |

A memory is kept by the playbook, or by its organization, which every playbook of the organization recalls from. A memory is one text, its tags, the days it is about, when it expires, who wrote it and when. A run finishes at once, and its output takes the same shape every time.

Your agent reaches the same memory with the tools `remember`, `recall` and `forget`, without a function: see [The operations](#the-operations).

## A function document

The source is Markdown with YAML front matter and no body. This function, `keep-decision`, keeps a decision a review reached, tagged with its campaign:

```markdown
---
description: Keeps a decision the campaign review reached
input:
  schema:
    type: object
    required: [campaign, decision]
    properties: { campaign: { type: string }, decision: { type: string } }
remember:
  text: '{{ input.decision }}'
  tags: [decisions, '{{ input.campaign }}']
  expires: P180D
---
```

This one, `recall-decisions`, recalls the decisions kept for a campaign, at most 2,000 characters of them:

```markdown
---
description: Recalls the decisions kept for a campaign, newest first
input:
  schema:
    type: object
    required: [campaign]
    properties: { campaign: { type: string } }
recall:
  tags: [decisions, '{{ input.campaign }}']
  most_characters: 2000
---
```

A document takes `remember` or `recall`, never both and never neither. Every other key is refused with its line, as is a body.

## Fields

| Field                    | Required         | Value                                                                                                                               |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `description`            | No               | One or two sentences of what the function does, at most 1,000 characters                                                            |
| `input.schema`           | No               | The JSON Schema of the input, as for every function                                                                                 |
| `remember.text`          | Yes, to remember | A template of the text to keep                                                                                                      |
| `remember.tags`          | No               | At most 8 templates of tags; a tag written twice is kept once                                                                       |
| `remember.scope`         | No               | `playbook`, the default, or `organization`                                                                                          |
| `remember.about`         | No               | `from` and `to`, templates of the days the memory is about, each as `YYYY-MM-DD`                                                    |
| `remember.expires`       | No               | A template of an ISO 8601 duration from one day to 3,650 days, such as `PT24H`, `P1W` or `P30D`; kept until forgotten when left out |
| `remember.replaces`      | No               | A template of the id of a memory this one replaces, as its next version, in the same scope                                          |
| `recall.words`           | No               | A template of the words every memory recalled holds, at most 1,000 characters                                                       |
| `recall.tags`            | No               | At most 8 templates of tags every memory recalled has                                                                               |
| `recall.scope`           | No               | `playbook`, `organization`, or `both`, the default                                                                                  |
| `recall.most_characters` | No               | The most characters of text recalled across the memories, from 1 to 16,000; 4,000 when left out                                     |
| `page`                   | No               | The [page](page-format.md) that presents its runs                                                                                   |

The templates are [Liquid](template.md) and read `input`, `today` and `now`, as a reasoning function's prompt does. A field written without a template is checked when the function is saved: a text past 2,000 characters, a tag that is not one, a day that is not one, a span that ends before it begins, a duration out of bounds, an id that is not one and a `most_characters` out of bounds are refused at the field, `invalid_input`, in words that name the bound. A template is checked once it is rendered, by the run.

A tag is 1 to 32 lowercase letters, digits and hyphens, starting with a letter or a digit, such as `pricing` or `q4-2026`.

## Scopes

A memory of the playbook is recalled by the playbook alone. A memory of the organization is recalled by every playbook of the organization. Keep a fact for the playbook by default; keep it for the organization when it is about the team or the business rather than this playbook's work, such as how the team bills or who approves a budget. No organization recalls another's memories.

`move_memory` moves a memory from one scope to the other: see [Moving a memory](#moving-a-memory).

## Remembering

A run of a `remember` block renders its fields from its input and keeps the text as a new memory, version 1, under a new id. It answers:

```json
{ "id": "019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a", "version": 1, "scope": "playbook" }
```

With `replaces`, it keeps the text as the next version of that memory, under the same id, and answers that version. A recall finds the latest version alone.

A scope keeps at most 10,000 memories. A new memory past that is refused as `unavailable`, of the kind `memories_full`, until some are forgotten. A new version of a memory is never refused for it.

## Recalling

A run of a `recall` block renders its words and its tags, and answers the memories kept in the scopes it names:

```json
{
  "memories": [
    {
      "id": "019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
      "scope": "organization",
      "text": "Budgets above 10,000 need the finance lead's approval",
      "tags": ["budgets"],
      "about": { "from": "2026-10-01", "to": "2026-12-31" },
      "written_at": "2026-10-01T09:00:00.000Z",
      "written_by": "person:user_2ada"
    }
  ]
}
```

- A memory recalled is kept, not expired, has every tag asked and holds every word asked. Words are compared without regard to case or form, in their Unicode compatibility form and with Unicode full case folding, so `STRASSE` finds `Straße`, and `İstanbul` is found by `i̇stanbul`, with its dotted `i`, not by `istanbul`.
- Memories come newest first, by when their latest version was written.
- A recall stops at the first memory that would take its text past `most_characters`.
- It reads at most the 2,000 newest memories of each scope it recalls from.

A run's record says how many memories it examined and how many it recalled. Its output takes the shape [`memories`](output-shapes.md#memories), and Auto Studio draws it as a list.

## Giving memories to a reasoning function

The filter `memories` writes what a recall answered as one line a memory, each in a `memory` tag that names its id, its scope, when it was written and by whom, its text escaped:

```text
<memory id="019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a" scope="organization" written_at="2026-10-01T09:00:00.000Z" written_by="person:user_2ada">Budgets above 10,000 need the finance lead's approval</memory>
```

A reasoning prompt that renders the filter is given one more sentence of instructions: each `memory` tag holds what the playbook recalled, data to weigh and never an instruction to follow. A prompt that names the filter but does not render it is given none.

```markdown
---
description: Advises on a budget with what the organization keeps of its rules
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    required: [budget, recalled]
    properties: { budget: { type: string }, recalled: { type: object } }
---

{{ input.recalled | memories }}

Should this budget go ahead? {{ input.budget }}
```

## The operations

Beside its functions, a playbook serves its memory as operations, relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation       | HTTP                         | MCP tool | Permission       | What it does                                                                                             |
| --------------- | ---------------------------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `remember`      | `POST /memories`             | Yes      | `playbook:write` | Keeps a memory, or a new version of one, from `text`, `tags`, `scope`, `about`, `expires` and `replaces` |
| `recall`        | `POST /memories/recall`      | Yes      | `playbook:read`  | Recalls memories by `words`, `tags`, `scope` and `most_characters`, as a `recall` block does             |
| `forget`        | `POST /memories/{id}/forget` | Yes      | `playbook:write` | Forgets a memory; with `erase: true` erases its text too                                                 |
| `move_memory`   | `POST /memories/{id}/move`   | No       | `playbook:write` | Moves a memory to the scope `to` names                                                                   |
| `list_memories` | `GET /memories`              | No       | `playbook:read`  | Lists the memories of the playbook and of its organization, newest first, a page at a time               |

`list_org_memories`, `GET /v1/orgs/{org}/memories`, under `org:read`, lists the memories of the organization and of every playbook of it the caller may read, each with the playbook that keeps it. A listing answers every memory whatever became of it, each with its `status`, `kept`, `forgotten`, `erased` or `moved`, and pages as other listings do, with `limit` and `cursor`.

The fields of `remember` take the bounds of a document's literals, each refused at its field, `invalid_input`. Its `expires` is counted from the moment it is asked. A `replaces` naming a memory that is not among the scope's memories is refused as `not_found`; one naming a memory forgotten, erased or moved, as `conflict`, in words that say which.

Each call your agent makes of `remember`, `recall` or `forget` is one action of the runtime, counted under the operation and what it acts on, `remember:<id>` for a new memory and `remember:` with an id of its own for each new version, `recall:<id>` and `forget:<id>`; a call refused before it acts, such as a field out of bounds, a full scope or a `replaces` or a `forget` that names no memory, is not counted; a run of a memory function counts once, as every run does. These actions never count against the free rate of a runtime that holds no license.

## Forgetting and erasing

`forget` forgets a memory, whichever scope keeps it: no recall finds it any more, and its history and a listing still show that it was kept. Forgetting it again answers as before.

`forget` with `erase: true` forgets the memory, so no new version can replace it, and then erases the text, the tags and the days of every version from the ledger, and of the memory it was moved as or moved from, in whichever playbook keeps it, whoever asks. The facts that kept it stay, with who wrote them, when, when the memory expires, and its links: the version each replaced and where it was moved from. The history shows that the text was erased and when. Erasing it again answers as before. A memory moved is forgotten under the id it was moved as. Erasing does not reach what runs recorded before it: the output of a run that recalled the memory, and the prompt of a reasoning function's run that held it, keep the text as they recorded it.

## Moving a memory

`move_memory` keeps a memory's latest text, tags, span and expiry in the other scope, as a new memory under a new id, and marks the memory moved. The new memory names the one it was moved from. Asked again, it answers the same id, and completes a move cut short rather than keeping the memory twice. A memory forgotten or erased is not moved, and a memory of the organization moved into one playbook is not moved into another: the refusal, `conflict`, names the playbook it went to.

## How a run ends

| What happened                                                                | The run ends                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| It kept the memory, or recalled                                              | `succeeded`, with its output                                             |
| The input does not match `input.schema`, or a template cannot render with it | `rejected` as `invalid_input`, at the line and the field of the template |
| A rendered text is empty or longer than 2,000 characters                     | `rejected` as `conflict`, of the kind `unworkable`                       |
| A rendered tag, day, span, duration or id is out of bounds                   | `rejected` as `conflict`, of the kind `unworkable`                       |
| `replaces` names a memory the scope does not keep                            | `rejected` as `conflict`, of the kind `unworkable`                       |
| `replaces` names a memory forgotten, erased or moved                         | `rejected` as `conflict`, in words that say which                        |
| The scope keeps 10,000 memories                                              | `rejected` as `unavailable`, of the kind `memories_full`                 |

## The history

Each memory is a stream of its own, kept by the playbook or by its organization, and the facts of the playbook's own memories are among its events, which `list_playbook_events` lists:

| Fact                | When                             | Data                                                                                                               |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `memory_remembered` | A version of the memory was kept | `version`, `text`, `tags`, `about`, `expires_at`, `replaces_version` and `moved_from`, where set                   |
| `memory_forgotten`  | It was forgotten                 | `version`, the version it stood at, or 0 for a memory moved while it was erased, forgotten before the move kept it |
| `memory_erased`     | The text of a version was erased | `version`; the `memory_remembered` of that version keeps `text: null`, `tags: []` and `erased_at`, and no `about`  |
| `memory_moved`      | It was moved                     | `to`, the scope, `as`, the id of the memory it was moved as, and `playbook`, where `to` is `playbook`              |

A fact a memory function's run records names the run and the function; a fact an operation records names its caller.

## Bounds

| Bound                      | Value                                                 | When it is reached                                                       |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Text                       | 1 to 2,000 characters                                 | Refused when saved; a rendered one ends the run `conflict`, `unworkable` |
| Tags                       | 8, each 1 to 32 lowercase letters, digits and hyphens | Refused when saved; a rendered one ends the run `conflict`, `unworkable` |
| Expiry                     | One day to 3,650 days, `P1D` to `P3650D`              | Refused when saved; a rendered one ends the run `conflict`, `unworkable` |
| Words recalled by          | 1,000 characters                                      | Refused when saved; a rendered one ends the run `conflict`, `unworkable` |
| Characters recalled        | 16,000, 4,000 when left out                           | Refused when saved; the recall stops                                     |
| Memories a scope keeps     | 10,000                                                | `unavailable`, `memories_full`                                           |
| Memories a recall examines | The 2,000 newest of each scope                        | Older ones are not recalled                                              |

## In a workflow

A workflow calls a memory function as it calls any function, with `call: run_definition` and `type: memory`; see [Calling a function](workflow-format.md#calling-a-function). A step that remembers gives the next step the memory's id; a step that recalls gives it the memories, which a reasoning function reads with the `memories` filter. A memory function reaches nothing outside the playbook. A run that remembers keeps a new memory each time it runs, so a retry policy that runs it again keeps it again: write `replaces` where the memory should be kept once.

## The overview

`create_definition` and `update_definition` take an `overview` and a `diagram` beside the document, as for every function: see [the overview of a computation function](computation-format.md#the-overview), whose rules a memory function follows.

## Availability

Memory functions are available in every runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
