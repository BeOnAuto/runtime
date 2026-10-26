# @on.auto/playbooks

The playbook operations of Auto Runtime: create, list, read, update and retire the playbooks of an org, and follow what happened in one playbook. They are defined on the application layer, [`@on.auto/operations`](../operations).

## A playbook

A playbook belongs to one org.

| Field         | What it holds                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Chosen by its creator: 3 to 48 lowercase letters, digits and hyphens, starting with a letter. Unique in the org, never reused |
| `name`        | 1 to 100 characters, not all whitespace, stored trimmed                                                                       |
| `description` | 0 to 2000 characters, stored trimmed                                                                                          |
| `status`      | `active` or `retired`                                                                                                         |
| `created_at`  | When it was created                                                                                                           |
| `created_by`  | The caller who created it, by `id` and `name`, as the fact that creates it, `playbook_created`, holds it                      |
| `updated_at`  | When it last changed                                                                                                          |
| `retired_at`  | When it was retired, on a retired playbook only                                                                               |

Times are ISO 8601 UTC strings read from Effect's `Clock`. `PlaybookSchema` is the schema of a playbook.

The limits of `name` and `description` hold for the text as sent, so the JSON Schema of an input carries them as `minLength` and `maxLength`. The stored text is trimmed, and a name that trims to nothing is rejected.

## The operations

All five are org operations, so their routes are relative to the org. `playbookOperations` lists them for a catalog. `get_playbook` is defined with `defineHttpOperation` and so served over HTTP alone, since a playbook `list_playbooks` lists holds the same fields; the other four are also MCP tools.

| Operation         | Kind    | Route                               | Input                                                      | Answer                          | Rejections of the handler |
| ----------------- | ------- | ----------------------------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------- |
| `create_playbook` | command | `POST /playbooks`                   | `playbook` (the id), `name`, `description` (default empty) | the playbook, `201`             | `conflict`                |
| `list_playbooks`  | query   | `GET /playbooks`                    | `include_retired` (default `false`)                        | `{ playbooks }`, sorted by id   | none                      |
| `get_playbook`    | query   | `GET /playbooks/{playbook}`         | `playbook`                                                 | the playbook, active or retired | `not_found`               |
| `update_playbook` | command | `PUT /playbooks/{playbook}`         | `playbook`, `name`, `description`, all required            | the playbook                    | `not_found`, `conflict`   |
| `retire_playbook` | command | `POST /playbooks/{playbook}/retire` | `playbook`                                                 | the playbook                    | `not_found`, `conflict`   |

- `create_playbook` meets `conflict` when an active or a retired playbook holds the id.
- `update_playbook` meets `conflict` when the playbook is retired. An update that changes nothing succeeds and records nothing.
- Retiring is permanent: there is no restore. Retiring a retired playbook succeeds and records nothing.
- Every command also meets `conflict` when the org's playbooks changed while it decided.
- `list_playbooks` lists only the playbooks the caller may access, and leaves out the retired ones unless `include_retired` is true. `include_retired` decodes from a JSON boolean and from the strings `true` and `false` of a query string.

Before a handler runs, the dispatcher rejects with `forbidden` a caller of another org, a caller without `org:read` for the queries or `org:write` for the commands, though `list_playbooks` is permitted by `playbook:read` as well, since it answers only the playbooks its caller may access, and a caller that may not access the playbook named by the `playbook` field of `create_playbook`, `get_playbook`, `update_playbook` or `retire_playbook`. So a caller limited to a list of playbooks creates, reads, updates and retires only those. The dispatcher rejects with `invalid_input` input that breaks the schema, including fields the operation does not know.

## What happened in a playbook

`defineListPlaybookEvents(presenters)` makes `list_playbook_events`, a playbook query at `GET /events` relative to the playbook, under `playbook:read`. It takes the presenters as a parameter, the way `makeDefinitionOperations` takes capabilities, so this package depends on `@on.auto/operations` alone; the server passes the presenters of every package that owns a stream kind, today `makeDefinitionPresenters` of `@on.auto/definitions`, which presents the definitions, the runs and the events published to the playbook with `publish_event`. At least one presenter must show at least one type of event.

| Input    | What it does                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `order`  | `desc`, newest first, when left out; `asc`, oldest first                                                                              |
| `limit`  | 1 to 100, 20 when left out: the most events a page answers with                                                                       |
| `cursor` | The `next_cursor` of the page before, or the `cursor` of an event, to read on after it                                                |
| `since`  | A time in ISO 8601: what the playbook recorded from then on, by the time it was recorded, in either order                             |
| `type`   | One public type of event, which the published JSON Schema lists; it is translated to the stored types its presenters present under it |
| `run_id` | The id of a run no other run started: only what that run and the runs it started recorded, the messages whose correlation is that run |

It reads the playbook's whole partition of the ledger (`PlaybookReader.readRecorded({ kind: 'everything' }, page)`), or with `run_id` the messages correlated to that run (`{ kind: 'correlated', correlation }`), and answers `{ events, has_more, next_cursor }`, each event a `PublicEvent`, `{ id, cursor, causation_id, at, type, summary, data }`. A run that another run started belongs to the tree of the run at its top, so its own id answers nothing. `limit` counts the events a page answers with, the step events of a workflow's records included, through `eventsPageOf` of `@on.auto/operations`, so a page may end inside a record. A record of a stream kind no presenter presents, or of a type its presenter hides, is left out, and with `type` only the events presented under that name are kept, though another kind stores a type of the same name. A page looks at `limit` records, or with `type` at up to 1,000, and ends at 4 MiB of stored data. So a page may hold fewer events than `limit`, or none, while `has_more` is true; `next_cursor` is null only when nothing remains. A cursor that does not decode, or that another playbook gave, is `invalid_input` at `/cursor`, and a `type` no presenter shows `invalid_input` at `/type`.

The feed cannot show the playbook's own creation, update and retirement: they are recorded in the org's `playbooks` stream, outside the playbook's partition, and `get_playbook` reads them. A retired playbook stays readable, since the dispatcher runs every query on it.

## Storage

The full set of an org's playbooks is the org's playbook registry. It lives in one stream, named `playbooks` relative to the org. Its facts carry a `type`, the playbook id, who recorded it (`by`) and when (`at`):

- `playbook_created`, with the name and the description
- `playbook_updated`, with only the fields that changed
- `playbook_retired`

There is no read model: each call folds the stream. A pure decider holds the rules; the handlers pass it who and when in the command.

## The playbook registry port

`ledgerPlaybookRegistry` is a `Layer` that provides the `PlaybookRegistry` port of `@on.auto/operations` from a `Ledger`. It answers the status of a playbook as the org's playbook registry holds it: `active` from its creation, `retired` from its retirement, and `unknown` for an id the org never created. It names the stream with `streamPrefixOfOrg`, the prefix the org-bound ports put before `playbooks`, so it reads the very stream the operations write.

The dispatcher applies the status to every playbook-scoped operation. A retired playbook stays readable: every query runs on it, so what the playbook recorded survives its retirement. Every command on a retired playbook is refused with `conflict`, kind `retired`, and the detail `update_playbook` gives, such as `The playbook gamma is retired and can no longer change`. An unknown playbook is `not_found`.

`foundPlaybook(playbook)` is the same lookup for an org operation that takes a `playbook` of its own, which the dispatcher checks access to but never looks up: an effect that needs `OrgReader` and answers the playbook, active or retired, as `get_playbook` does, or fails with `NotFound` and `get_playbook`'s detail, `There is no playbook nowhere in this org`, the words the dispatcher gives an unknown playbook. The server gives it to `search` of the org, so a playbook it is given that the org does not have is `not_found` there as at the playbook's own route.

## Source

`src/index.ts` is the only entry point. `src/registry` holds the org's playbook registry: a playbook, the facts and commands of the `playbooks` stream, the registry's decider and its rules, the stream's name, and `ledgerPlaybookRegistry`. `src/operations` holds the five operations and how they load the registry and record in it. `src/feed` holds `list_playbook_events`. `src/testing` holds what the tests share. `operations` depends on `registry`, never the other way round.
