# Addresses

An address names one thing of a playbook as text: the playbook, a definition at a version, a step of a workflow, a run, an event of a run, a block of a run's result or a request. The [organization's activity](http.md#the-organization-s-activity) names each of its rows by an address, and a [comment](http.md#comments) names what it is about by one. An agent given an address knows which tool reads the thing and which changes it.

## The forms

A comment can be made on any of these:

| Thing                     | Address                                                         | Example                                                                                           |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The playbook              | `playbooks/<playbook>`                                          | `playbooks/finance`                                                                               |
| A definition at a version | `<playbook>/definitions/<type>/<name>/<version>`                | `finance/definitions/reasoning/categorize-invoice/7`                                              |
| A step of a workflow      | `<playbook>/definitions/workflow/<name>/<version>/steps/<step>` | `finance/definitions/workflow/close-the-week/4/steps/do/1/review`                                 |
| A run                     | `<playbook>/runs/<run_id>`                                      | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e`                                               |
| An event of a run         | `<playbook>/runs/<run_id>/events/<event_id>`                    | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/events/019a4012-7c41-7e22-8a10-1b2c3d4e5f60_2` |
| A block of a run's result | `<playbook>/runs/<run_id>/result/<n>`                           | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/result/2`                                      |
| The request of a run      | `<playbook>/<run_id>`                                           | `finance/019a400e-1f2b-7a44-8c5d-6b7e9f0a1b2c`                                                    |

The activity also names three things no comment is made on:

| Thing                         | Address                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| A broken definition           | `<playbook>/<type>/<name>`                                                   |
| A playbook created or updated | `playbooks/<playbook>/<at>`, `at` in milliseconds since 1970-01-01T00:00:00Z |
| A comment                     | `<playbook>/comments/<id>`                                                   |

A reply to a comment is a new comment on the same address, so a comment's own address takes no comment.

## The parts

| Part         | Rule                                                                                                                                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<playbook>` | The playbook's id: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter                                                                                                                                                                                                                                                           |
| `<type>`     | `reasoning`, `interaction`, `prediction`, `recall`, `computation`, `workflow` or `page`                                                                                                                                                                                                                                                             |
| `<name>`     | The definition's name, by the same rule as a playbook's id                                                                                                                                                                                                                                                                                          |
| `<version>`  | The version, a whole number from 1 to 2,147,483,646, without a leading zero                                                                                                                                                                                                                                                                         |
| `<step>`     | The step's reference in the workflow's document, the JSON Pointer the step events show, such as `/do/1/review`, without its leading `/`: `do/1/review`. The reference is at most 256 bytes in UTF-8 with its leading `/`, so the step is at most 255 bytes without it, and its own `/` stay as they are, so the step runs to the end of the address |
| `<run_id>`   | The run's id, a UUID in lowercase, as `get_run` gives it                                                                                                                                                                                                                                                                                            |
| `<event_id>` | The event's `id`, as a run's history shows it: a UUID, or for a step's event a UUID, an underscore and its number from 1 without a leading zero                                                                                                                                                                                                     |
| `<n>`        | The block's place in the run's rendered result, a whole number from 1, without a leading zero                                                                                                                                                                                                                                                       |
| `<id>`       | The comment's id, a UUID                                                                                                                                                                                                                                                                                                                            |

- A whole address is at most 512 characters. It has no empty part, no white space and no `/` at its end.
- A block of a run's result is one top-level block of the Markdown its page's `result` renders for the run, `page.result` of [`get_run`](page-format.md#what-reads-render): a heading, a paragraph, a list, a quote, a table, a [chart block](page-format.md#chart-blocks) or a [row](page-format.md#rows), counted from the top. A run's result renders with the page as it stands, so after the page changes, the same `n` can name another block. The comment's text says what it was about.
- An address of two parts whose second part is a UUID names a request, even in a playbook whose id is `playbooks`; `playbooks/` followed by anything else names a playbook.
- An event is named under its run. An event that belongs to no run, such as a published event, has no address.

## What the runtime checks

The runtime checks an address's form, and never that the thing exists.

- [`make_comment`](http.md#making-a-comment) refuses an address that is not of a form a comment takes, or that names another playbook, with `invalid_input` at `/address`. So does [`list_comments`](http.md#listing-comments), which with `under` also takes a definition without its version, `<playbook>/definitions/<type>/<name>`. With `under`, a run holds its events and the blocks of its result, a definition at a version its steps, and a definition without its version every version and their steps; any other address, the playbook's `playbooks/<playbook>` among them, holds nothing but itself, so a step nested in another is not under it, and the playbook holds none of what it holds.
- [`mark_activity_seen`](http.md#marking-items-seen) refuses an item whose address is not of a form the activity names.
- A comment on a thing that is gone, or never was, is still a comment. A comment on a retired definition, or on version 3 after version 4 was saved, stays as it was made. The thing's own read says what became of it.

## From an address to a call

The parts of an address are the arguments of the tools that read and change the thing. These tools are those of the [MCP reference](mcp.md#tools), each with the same name over HTTP.

| Address                   | Read it with                                                                                                                                                                | Act on it with                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The playbook              | `list_playbooks`, which holds every field of each playbook, and `list_definitions` for what it holds                                                                        | `update_playbook` for its name and description, or the definitions the comment is about                                                     |
| A definition at a version | `get_definition` with `type` and `name`                                                                                                                                     | `update_definition` with the changed document, overview or diagram                                                                          |
| A step of a workflow      | `get_definition` with `type` `workflow` and `name`; the step is at its reference, `/` and the step's part, in its `source`, and a step that calls a function names it there | `update_definition` of the workflow, or of the function the step calls                                                                      |
| A run                     | `get_run` with `run_id`, and `list_playbook_events` with `run_id` for what it did                                                                                           | `update_definition` of the definition the run carried out, its `type` and `name`, then `run_definition`; `cancel_run` while it is `started` |
| An event of a run         | `get_event` with `event_id`                                                                                                                                                 | As for its run                                                                                                                              |
| A block of a run's result | `get_run` with `run_id`; the block is the `n`th of its `page.result`                                                                                                        | `update_definition` of the page, `type` `page`, for how it shows the run; of the definition the run carried out, for what it produced       |
| The request of a run      | `list_interactions`, and `get_run` with `run_id`                                                                                                                            | `answer_interaction` with `run_id`, once the person says how to answer                                                                      |

`get_definition` reads the definition as it stands, at its current `version`. An address that names an earlier version says the comment was made before the definition last changed: read the comment against the current document, and act only where it still applies.

A comment on the step `/do/1/review` of version 4 of the workflow `close-the-week` becomes these calls:

1. `get_definition` with `type` `workflow` and `name` `close-the-week`: the document, at its current `version`. At `/do/1/review` in it is the step, which calls the reasoning function `review-entries`.
2. `get_definition` with `type` `reasoning` and `name` `review-entries`: the prompt the comment is about.
3. `update_definition` of `review-entries`, with the prompt changed as the comment asks.
4. `resolve_comment` with the comment's `id` and `how` `acted`.
