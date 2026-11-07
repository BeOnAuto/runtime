---
title: Addresses of playbooks, definitions and runs
description: An address names one thing in Auto as text, such as a playbook, a definition at a version, a run or an event. Its forms, and the tools that read or change it.
---

# Addresses

An address names one thing as text. Of a playbook, it names the playbook, a definition at a version, a step of a workflow, a run, an event of a run, a block of a run's result or a request. Of the organization, it names the organization, a connection, a member or a page of Studio's Settings. It can also name a part of most of these, such as a section of a playbook's Overview. The [organization's activity](http.md#the-organization-s-activity) names each of its rows by an address, and a [comment](http.md#comments) names what it is about by one. An agent given an address knows which tool reads the thing and which changes it.

## The forms

A comment can be made on any of these things of a playbook:

| Thing                                         | Address                                                         | Example                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The playbook                                  | `playbooks/<playbook>`                                          | `playbooks/finance`                                                                                 |
| A definition at a version                     | `<playbook>/definitions/<type>/<name>/<version>`                | `finance/definitions/reasoning/categorize-invoice/7`                                                |
| A step of a workflow                          | `<playbook>/definitions/workflow/<name>/<version>/steps/<step>` | `finance/definitions/workflow/close-the-week/4/steps/do/1/review`                                   |
| A run                                         | `<playbook>/runs/<run_id>`                                      | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e`                                                 |
| An event of a run                             | `<playbook>/runs/<run_id>/events/<event_id>`                    | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/events/019a4012-7c41-7e22-8a10-1b2c3d4e5f60_2`   |
| A block of a run's result                     | `<playbook>/runs/<run_id>/result/<n>`                           | `finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/result/2`                                        |
| The request of a run                          | `<playbook>/<run_id>`                                           | `finance/019a400e-1f2b-7a44-8c5d-6b7e9f0a1b2c`                                                      |
| A part of the playbook, a definition or a run | The thing's address, then `/parts/<part>`                       | `playbooks/finance/parts/ledger`, `finance/definitions/reasoning/categorize-invoice/7/parts/source` |

And on any of these things of the organization:

| Thing                       | Address                                   | Example                                                |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| The organization            | `org`                                     | `org`                                                  |
| A connection                | `org/connections/<connection>`            | `org/connections/019a3f10-2b4c-7d5e-8f60-718293a4b5c6` |
| A member                    | `org/members/<member>`                    | `org/members/user_2kLm7Qx`                             |
| A page of Studio's Settings | `org/settings/<page>`                     | `org/settings/billing`                                 |
| A part of any of these      | The thing's address, then `/parts/<part>` | `org/settings/runtime/parts/license`                   |

The activity also names four things no comment is made on:

| Thing                               | Address                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| A broken definition                 | `<playbook>/<type>/<name>`                                                   |
| A playbook created or updated       | `playbooks/<playbook>/<at>`, `at` in milliseconds since 1970-01-01T00:00:00Z |
| A comment of a playbook             | `<playbook>/comments/<id>`                                                   |
| A comment of the organization's own | `org/comments/<id>`                                                          |

A reply to a comment is a new comment on the same address, so a comment's own address takes no comment.

## The parts of a thing

A part is a piece of what Studio shows of a thing, such as the description on a playbook's Overview or a view Studio shows of a definition. A comment on a part says which piece of the thing it is about, and the thing's own address stays its prefix, so whatever reads the thing reads the part. `<part>` is one segment: 1 to 64 lowercase letters, digits and hyphens, beginning with a letter.

The runtime takes any part of that form. These are the parts Studio names, as examples rather than a closed list:

| Thing                     | Parts Studio names                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The playbook              | `ledger`, its Ledger; `name` and `description`, its name and its description as its Overview shows them; `card`, its card on Studio's home; `settings`, its page of Settings, whose tool servers `search` with `playbook` lists                                                                                                                                                                                                                       |
| A definition at a version | `overview`, `source`, `result` and `details`, the views Studio shows of it; `runs-<n>`, the `n`th block of the `runs` of its [page](page-format.md) as Studio draws it, and `runs-<n>-<m>`, the `m`th cell of that block                                                                                                                                                                                                                              |
| A run                     | `output`, `events` and `result`, the views of the run, where `result` is the result as a whole and each of its blocks has an address of its own; `result-<n>-<m>`, the `m`th cell of the `n`th block of its result; and `row`, the run's row in a list of runs: the Ledger's runs column and the runs Studio lists for a definition. A comment on `row` is drawn on that row alone, as one on `card` is drawn on the playbook's card on Studio's home |
| A page of Settings        | One card of the page; and `<card>-<row>`, a labelled row or an action of a card, beside the card, such as `runtime-address`, `runtime-status` and `license-key` of `org/settings/runtime` and `credits-available` of `org/settings/credit-history`                                                                                                                                                                                                    |

A cell is the `m`th cell, counted from 1, of the `n`th block, counted from 1 as `<n>` counts the blocks of a run's result: a cell of a [row](page-format.md#rows), or a tile of a [`figure` chart block](page-format.md#chart-blocks), one for each of its values. A table, a paragraph or a chart that stands alone is its block, and has no cells. A cell of a run's result is a part of the run, `<playbook>/runs/<run_id>/parts/result-<n>-<m>`, since a block takes no parts, so `under` on the run holds it. These parts are single segments by the rule of `<part>`, so the grammar takes them as it is.

A step, an event, a block, a request and a comment take no parts. A step runs to the end of its address, so a `/parts/` after it is read as part of the step's reference.

## The organization's things

A comment on the organization's things is the organization's own: it is kept with the organization, not with a playbook, and is made, listed and resolved through the [organization's comment routes](http.md#the-organization-s-comments).

- `org` names the organization itself, as Studio's home and its organization page show it.
- `<connection>` is a connection's `id`, as [`list_connections`](http.md#connections) gives it: a UUID in lowercase.
- `<member>` is a member's `id`, as the organization's list of members gives it, `list_members` where the endpoint offers it: 1 to 64 ASCII letters, digits, underscores and hyphens.
- `<page>` is a page of Studio's Settings, by the rule of `<part>`, as Studio names it: `organisation`, `members`, `email-domains`, `billing`, `plans`, `credits`, `credit-history`, `runtime`, `licenses`, `connections`, `mcp` and `tool-servers`. A playbook's page of Settings is the playbook's part, `playbooks/<playbook>/parts/settings`.

`org` is one segment, and no address of a playbook is: a playbook is `playbooks/<playbook>`. A playbook whose id is `org` keeps every address of its own. `org/<run_id>` is the request of its run, by the rule of two segments below, and its definitions and runs begin `org/definitions/` and `org/runs/`. No address of a playbook begins `org/connections/`, `org/members/`, `org/settings/` or `org/parts/`, so an address that begins with one of them names one of the organization's things, even when the organization holds a playbook whose id is `org`. In the activity, `org/comments/<id>` names a comment of the organization's own and a comment of a playbook named `org` alike; the row's `playbook` tells them apart, and no two comments share an id.

## The segments

| Segment        | Rule                                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<playbook>`   | The playbook's id: 3 to 48 lowercase letters, digits and hyphens, beginning with a letter                                                                                                                                                                                                                                                           |
| `<type>`       | `reasoning`, `lookup`, `interaction`, `prediction`, `computation`, `generation` or `workflow`                                                                                                                                                                                                                                                       |
| `<name>`       | The definition's name, by the same rule as a playbook's id                                                                                                                                                                                                                                                                                          |
| `<version>`    | The version, a whole number from 1 to 2,147,483,646, without a leading zero                                                                                                                                                                                                                                                                         |
| `<step>`       | The step's reference in the workflow's document, the JSON Pointer the step events show, such as `/do/1/review`, without its leading `/`: `do/1/review`. The reference is at most 256 bytes in UTF-8 with its leading `/`, so the step is at most 255 bytes without it, and its own `/` stay as they are, so the step runs to the end of the address |
| `<run_id>`     | The run's id, a UUID in lowercase, as `get_run` gives it                                                                                                                                                                                                                                                                                            |
| `<event_id>`   | The event's `id`, as a run's history shows it: a UUID, or for a step's event a UUID, an underscore and its number from 1 without a leading zero                                                                                                                                                                                                     |
| `<n>`          | The block's place in the run's rendered result, a whole number from 1, without a leading zero                                                                                                                                                                                                                                                       |
| `<part>`       | A part of a thing: 1 to 64 lowercase letters, digits and hyphens, beginning with a letter                                                                                                                                                                                                                                                           |
| `<connection>` | The connection's `id`, a UUID in lowercase                                                                                                                                                                                                                                                                                                          |
| `<member>`     | The member's `id`: 1 to 64 ASCII letters, digits, underscores and hyphens                                                                                                                                                                                                                                                                           |
| `<page>`       | A page of Studio's Settings, by the rule of `<part>`                                                                                                                                                                                                                                                                                                |
| `<id>`         | The comment's id, a UUID                                                                                                                                                                                                                                                                                                                            |

- A whole address is at most 512 characters. It has no empty segment, no white space and no `/` at its end.
- A block of a run's result is one top-level block of the Markdown its page's `result` renders for the run, `page.result` of [`get_run`](page-format.md#what-reads-render): a heading, a paragraph, a list, a quote, a table, a [chart block](page-format.md#chart-blocks) or another fenced block, or a [row](page-format.md#rows), counted from the top. A rule, such as `---`, is not counted. A run's result renders with the page as it stands, so after the page changes, the same `n` can name another block. The comment's text says what it was about.
- An address of two segments whose second is a UUID names a request, even in a playbook whose id is `playbooks` or `org`. Any other address that begins `playbooks/` names a playbook, or, followed by `/parts/<part>`, a part of it.
- An event is named under its run. An event that belongs to no run, such as a published event, has no address.

## What the runtime checks

The runtime checks an address's form, and never that the thing exists.

- [`make_comment`](http.md#making-a-comment) of a playbook refuses an address that is not of a form a comment takes, that names another playbook or that is the organization's, with `invalid_input` at `/address`. The organization's `make_comment` refuses every address but those of the organization's things and their parts, the same way. So does [`list_comments`](http.md#listing-comments) of each, which with `under` also takes a definition without its version, `<playbook>/definitions/<type>/<name>`.
- With `under`, an address holds its parts. A run also holds its events and the blocks of its result, a definition at a version its steps, and a definition without its version every version, their steps and their parts. Any other address holds its parts alone: the playbook's `playbooks/<playbook>` holds none of what the playbook holds, `org` none of the organization's connections, members or pages, and a step nested in another is not under it. A step, an event, a block and a request, which take no parts, hold nothing but themselves.
- [`mark_activity_seen`](http.md#marking-items-seen) refuses an item whose address is not of a form the activity names.
- A comment made on a page saved as a definition of its own is read as a comment on its subject, without a version, so `under` on the subject holds it.
- A comment on a thing that is gone, or never was, is still a comment. A comment on a retired definition, on version 3 after version 4 was saved, on a connection since removed or on a member who has left stays as it was made. The thing's own read says what became of it.

## From an address to a call

The segments of an address are the arguments of the tools that read and change the thing. These tools are those of the [MCP reference](mcp.md#tools), each with the same name over HTTP, apart from `list_members` and `invite_member`, which hosted Auto serves and a self-hosted runtime does not.

| Address                   | Read it with                                                                                                                                                                   | Act on it with                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The playbook              | `get_playbook`, which holds the source of its page, and `list_definitions` for what it holds                                                                                   | `update_playbook` for its name, description and page, or the definitions the comment is about                                                                          |
| A definition at a version | `get_definition` with `type` and `name`                                                                                                                                        | `update_definition` with the changed document, overview or diagram                                                                                                     |
| A step of a workflow      | `get_definition` with `type` `workflow` and `name`; the step is at its reference, `/` and the step's segment, in its `source`, and a step that calls a function names it there | `update_definition` of the workflow, or of the function the step calls                                                                                                 |
| A run                     | `get_run` with `run_id`, and `list_playbook_events` with `run_id` for what it did                                                                                              | `update_definition` of the definition the run carried out, its `type` and `name`, then `run_definition`; `cancel_run` while it is `started`                            |
| An event of a run         | `get_event` with `event_id`                                                                                                                                                    | As for its run                                                                                                                                                         |
| A block of a run's result | `get_run` with `run_id`; the block is the `n`th of its `page.result`                                                                                                           | `update_definition` of the definition the run carried out: its `page` for how it shows the run, the rest of its document for what it produced                          |
| The request of a run      | `list_interactions`, and `get_run` with `run_id`                                                                                                                               | `answer_interaction` with `run_id`, once the person says how to answer                                                                                                 |
| A part of a thing         | As for the thing; the part says which piece of it the comment is about                                                                                                         | As for the thing                                                                                                                                                       |
| The organization          | The tools of what the comment asks about, such as `list_playbooks` for its playbooks and `list_connections` for its connections                                                | The tools of what it asks about. What no tool changes, such as the organization's name, the agent reports to the person                                                |
| A connection              | `list_connections`, which holds every field of each connection, its `status` among them, and `list_connection_tools` with its `id` for its tools                               | `reconnect_connection` with its `id` for a connection that is broken, whose link ran out or that should be granted `more`; `remove_connection` once the person says to |
| A member                  | `list_members`, where the endpoint offers it, as hosted Auto's does                                                                                                            | No tool: a member's role and their removal are a person's to change, in Studio. The agent reports what the comment asks to the person                                  |
| A page of Settings        | The tool of the page, as the list below names it                                                                                                                               | The tool of the page, or none                                                                                                                                          |

The pages of Settings, by the tool that reads or changes what each shows:

- `connections`: the tools of a connection, as above.
- `tool-servers`: `search`, which lists the tool servers and the tools of each. The servers of the configuration are the operator's to change, so the agent reports to the person what a comment asks of them.
- `runtime`: `activate_license` with the key the person gives, for a self-hosted runtime's license. The runtime's address, its status, who Studio acts as there and the voice model are the operator's and Studio's, and the agent reports what a comment asks of them.
- `members`: `list_members`, and `invite_member` to invite a person as a member, where the endpoint offers them. Roles, removals and invitations of admins are a person's, in Studio.
- `organisation`, `email-domains`, `billing`, `plans`, `credits`, `credit-history`, `licenses` and `mcp`: no tool. The agent reports what the comment asks to the person, who changes it in Studio.

`get_definition` reads the definition as it stands, at its current `version`. An address that names an earlier version says the comment was made before the definition last changed: read the comment against the current document, and act only where it still applies.

A comment on the step `/do/1/review` of version 4 of the workflow `close-the-week` becomes these calls:

1. `get_definition` with `type` `workflow` and `name` `close-the-week`: the document, at its current `version`. At `/do/1/review` in it is the step, which calls the reasoning function `review-entries`.
2. `get_definition` with `type` `reasoning` and `name` `review-entries`: the prompt the comment is about.
3. `update_definition` of `review-entries`, with the prompt changed as the comment asks.
4. `resolve_comment` with the comment's `id` and `how` `acted`.

A comment on `org/connections/019a3f10-2b4c-7d5e-8f60-718293a4b5c6` that says the CRM stopped answering becomes these calls:

1. `list_connections`: the connection with that `id` is `broken`, its `broken` saying why.
2. `reconnect_connection` with its `id`: a new link, which the agent gives the person to sign in again.
3. Once the person says they signed in, `resolve_comment` with the comment's `id` and `how` `acted`, and no `playbook`, since the comment is the organization's own.
