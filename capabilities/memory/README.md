# @on.auto/memory

The implementation of memory functions. A memory is one short text a playbook keeps, with a few tags, for the playbook alone or for its whole organization; a memory function's run remembers one or recalls those that match, and the same work is served to a person's agent as operations of the playbook. A memory function reads and writes the memory store alone: it calls no model and reaches nothing outside the runtime.

User documentation is [Memory function format](../../docs/reference/memory-format.md), published at [on.auto/docs](https://on.auto/docs/): the document, the operations, how a recall matches, the history and the bounds; the guide [Make a playbook remember](../../docs/guides/remember.md) walks through it. Update them alongside behaviour changes.

## The document

`parseMemoryDocument(source)` (`src/document`) reads a document with the shared reader of [`@on.auto/definitions/document`](../../packages/definitions/README.md#reading-function-documents) and gives a `MemoryFunctionDefinitionDocument`: an optional `description`, the compiled `input.schema`, and one block, `remember` or `recall`, never both and never neither. A memory function takes no body. Every field a block writes is a Liquid template rendered against the run's input with the shared engine of `@on.auto/definitions/template`; a field written as a literal is held to its bound when the document is saved, `invalid_input` at its field in the words of the bound, and a rendered one when the run renders it.

- `remember` takes `text`, required, and `tags`, `scope` (`playbook`, the default, or `organization`), `about` (`from` and `to`, two days), `expires` (an ISO 8601 duration) and `replaces` (the id of a memory it keeps a new version of).
- `recall` takes `words`, `tags`, `scope` (`playbook`, `organization` or `both`, the default) and `most_characters`.

A tag written twice is kept once: a document's literal tags when it is saved, a run's rendered tags when it renders them, and the tags `remember` is asked.

The capability's output is fixed, so a document declares none: a run of `remember` answers `{ id, version, scope }`, and a run of `recall` the shape `memories` of [`@on.auto/definitions`](../../packages/definitions/README.md#output-shapes), `{ memories: [{ id, scope, text, tags, about?, written_at, written_by }] }`.

## A run

`makeMemoryFunctionAdapter({ ledger, mostKept?, mostExamined?, newId?, organizationKept? })` is the capability for `makeDefinitionOperations` (`src/capability`), its `ledger` the ledger's `load`, `execute`, `scrubFact`, `readProjectedRows` and `countProjectedRows`. It finishes at once, reaches nothing outside and changes nothing there. A run checks its input with `checkedInput` of `@on.auto/definitions`, renders its block over `input`, `today` and `now` on the run's clock, and then:

- for `remember`, keeps the memory under a new id, `newId`, a UUIDv7, or a new version of the one `replaces` names, as the caller of the run, its facts naming the run and the function, and answers what it kept;
- for `recall`, answers the memories that match, and records how many rows it examined and how many it recalled.

A rendered field out of its bound, and a `replaces` naming a memory the scope does not keep, end the run `conflict`, `unworkable`, at the field; a `replaces` naming one forgotten, erased or moved ends it `conflict` in the decider's words; a full scope ends it `unavailable`, `memories_full`.

## The facts it declares

Each memory is a stream of its own (`src/facts`): `playbook/<org>/<playbook>/memories/<id>` for the playbook's, `org/<org>/memories/<id>` for the organization's. Its decider, `memoryDecider`, appends under the stream's expected version, so a version replaces the one before only when nothing else wrote between them:

| Fact                | Data                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `memory_remembered` | `version`, `text`, `tags`, and `about`, `expires_at`, `replaces_version` and `moved_from` where set              |
| `memory_forgotten`  | `version`, or 0 where an erase forgot ahead the memory a move had not written yet                                |
| `memory_erased`     | `version`, appended by `Ledger.scrubFact` beside the scrub of that version                                       |
| `memory_moved`      | `to`, the scope, `as`, the id it was moved as, and `playbook`, the playbook it went to, where `to` is `playbook` |

The capability declares the stream kind `memories` with its presenter, `memoryPresenter`, which shows each fact among the playbook's events in plain words, so the history of the playbook's own memories is read with `list_playbook_events`; a listing shows what became of each memory, the organization's among them. Erasing first appends `memory_forgotten` through the decider where the memory is kept, so a new version asked while its text is erased is refused as forgotten, and then scrubs each `memory_remembered` of the memory that still has its text, as the stream holds it after that append: `text` to `null`, `tags` to `[]`, `about` dropped and `erased_at` set, keeping `version`, `replaces_version`, `expires_at` and `moved_from`, which `ErasedMemoryFactSchema` reads (`src/forget/erased-facts.ts`); the row of the memory drops its text, its tags and its days with it. An erase that follows a move to a memory whose stream holds nothing yet, since the move has not written it, forgets it ahead, `memory_forgotten` at version 0 under the expected version 0, so the move's late copy is decided again against that stream and keeps nothing; it does not reach what runs recorded: the output of a recall that answered the memory, and a prompt that held it, keep its text as they recorded it. Each fact type and each scrubbed shape has a recorded fixture under `0.56.0/` of its folder, named in `recorded-facts.json`.

## The projection

`memoryRows` (`src/projection`) is a keyed projection the server registers with the ledger, table `memories_1`, one row per memory, keyed by its stream, at the scopes `playbook` and `org`: the version, the text and its characters, the tags as JSON, the days it is about, when it expires, when its latest version was written and by whom, the run and the function that wrote it, and its status, `kept`, `forgotten`, `erased` or `moved`, with indexes on the status and on when it was written. The scope of a row is its address. It is kept in the transaction of every append, and its table came with layout 10 of the ledger, whose step makes nothing: the projection makes its own table.

## Recalling

A recall reads at most the 2,000 newest kept rows of each scope it asks, through `readProjectedRows`, never an index across organizations, and keeps those that have not expired, carry every tag asked and hold every word asked, each word and the text compared after NFKC and Unicode full case folding, upper case then lower, so `STRASSE` finds `Straße` and `İstanbul` is found by `i̇stanbul`, whose dotted `i` it folds to, not by `istanbul`. It ranks them newest first, by when their latest version was written and then by id, and stops before the memory that would take it past `most_characters`, 4,000 unless the document or the operation says, at most 16,000. Matching and ranking sit behind one function, `rankedMemories` (`src/recall/memory-matching.ts`), so a ranking of another kind, by meaning rather than by words, can take its place as a port without touching what a recall reads or answers.

## Operations

`memoryOperationsOf({ ledger, ... })` (`src/operations`) gives the operations the server serves, `inPlaybook`, whose routes are under `/v1/orgs/{org}/playbooks/{playbook}`, and `inOrg`:

| Operation           | Route                         | Permission       | Served       |
| ------------------- | ----------------------------- | ---------------- | ------------ |
| `remember`          | `POST /memories`              | `playbook:write` | HTTP and MCP |
| `recall`            | `POST /memories/recall`       | `playbook:read`  | HTTP and MCP |
| `forget`            | `POST /memories/{id}/forget`  | `playbook:write` | HTTP and MCP |
| `move_memory`       | `POST /memories/{id}/move`    | `playbook:write` | HTTP alone   |
| `list_memories`     | `GET /memories`               | `playbook:read`  | HTTP alone   |
| `list_org_memories` | `GET /v1/orgs/{org}/memories` | `org:read`       | HTTP alone   |

The three tools are listed on every MCP endpoint that lists the playbook's tools, `/mcp` with a `playbook` argument among them. `remember`'s `scope` says when a memory belongs to the organization: when it is about the team or the business rather than this playbook's work. `forget` finds the memory in the playbook's scope and then the organization's; forgetting it again answers as before, and `erase: true` erases the text of every version, of the memory it was moved as, in the playbook its move names, and of the one it was moved from, whatever playbook asked and whoever: an erasure is complete or it is not one. `move_memory` marks the memory moved first, under the decider, naming the scope it went to and, into a playbook, the playbook, then writes its latest version there under an id named by a UUIDv5 of its stream and the scope, so a move asked again answers the same id and completes one cut short. A memory of the organization moved into one playbook is refused a move into another, as `conflict`, in words that name the playbook it went to. A listing pages newest first with `limit` and `cursor`, every memory whatever became of it; `list_org_memories` reads the organization's own and those of each playbook the caller may read.

Each call of `remember`, `recall` or `forget` is admitted by the meter as one agent action, `agentActionOf` of `@on.auto/definitions`, under the ids `remember:<memory id>` for a new memory, `remember:<a UUIDv7>` for each new version of one, so each version counts, `recall:<a UUIDv7>` and `forget:<memory id>`; a memory function's run is admitted once, as every run is. A call refused before it acts is not metered: a field out of bounds, a full scope, `memories_full`, a `replaces` that names no memory the scope keeps, or one forgotten, erased or moved, and a `forget` of a memory neither scope holds. An agent action never counts against the free daily rate of a runtime that holds no license.

A server that keeps no memories of the organization gives `organizationKept: false` to the capability and to the operations: `remember` with `scope: organization` and `move_memory` to the organization are refused as `invalid_input` at `/scope` and `/to`, `Organization-wide memories are not available here yet: keep it for the playbook, with scope playbook`, before anything is metered; a memory function that remembers for the organization is refused when it is saved, at the line of its scope; and a recall of the organization, or of both, reads none of the organization's and says nothing of it.

## Bounds

`memoryBounds` holds them: a text of 1 to 2,000 characters; at most 8 tags, each matching `^[a-z0-9][a-z0-9-]{0,31}$`; `about` two calendar days, `from` no later than `to`; `expires` an ISO 8601 duration of weeks, days, hours, minutes or seconds from one day to 3,650 days, about ten years, so `PT24H` is one day and `P1W` seven, kept as `expires_at`; the `words` of a recall at most 1,000 characters; a recall of at most 16,000 characters, 4,000 by default; 10,000 memories kept by a playbook and 10,000 by its organization, past which `remember` is `unavailable`, `memories_full`; and 2,000 rows examined per scope by a recall. A memory that expired still counts toward the 10,000 until it is forgotten, since the count reads the rows kept and an expiry is read only by a recall. The count is read before the append, not in its transaction, so two remembers at the bound at once can each find room and keep one memory more than it. `list_org_memories` reads each playbook the caller may read, one read a playbook a page beside the organization's own, so a page of an organization of many playbooks takes as many reads.

## Testing

`@on.auto/memory/testing` holds `memoryHarness`, over the in-memory ledger with the projection, which composes the capability with the definition operations and the memory operations, calls them as a caller of `acme`, defines and runs memory functions on a test clock, and reads the rows and the facts of a memory; and the documents the tests share. Tests that reach a bound give the harness a small `mostKept` or `mostExamined`, and `newId` where an id must repeat.

## Source

`src/document` reads the definition and holds the bounds, `src/capability` the capability, its run and the rendering of a block, `src/facts` the facts, the streams and the decider, `src/projection` the rows, `src/remember`, `src/recall`, `src/forget` and `src/move` the work of each, `src/operations` the operations, and `src/testing` what the tests share. `src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support.
