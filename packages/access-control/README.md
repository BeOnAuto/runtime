# @on.auto/access-control

The policy decision point of Auto Runtime: the one place that answers whether a principal may perform an operation on a resource, decided from policies rather than from code written for each role. It holds the engine that decides, Cedar, behind the port of `@on.auto/operations`, the schema and the built-in policies the release ships, and the port of the roles a principal holds. It decides nothing yet: the dispatcher asks it in report-only mode, beside the check that decides (see [Report-only](#report-only)).

It is a package of its own so that the engine, a WebAssembly module of 4.4 MB, is loaded only where a host composes it. The question, the answer and the port are in `@on.auto/operations`, beside the dispatcher that asks, as `Ledger` is there and its stores are in `@on.auto/ledger`; this package depends on `@on.auto/operations` and nothing depends on it but the server, so a host that composes the dispatcher without it, such as a Worker of Auto's cloud, loads no Cedar (`packages/server/src/composition/served-access-control.ts`).

## The architecture, and where each name comes from

| Point                       | Its source                                                                                                                                                                                           | Here                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Policy decision point       | XACML 3.0 (OASIS), NIST SP 800-162: "computes access decisions by evaluating the applicable digital policies"                                                                                        | `cedarDecisionPoint(parts)`, a `PolicyDecisionPoint` of `@on.auto/operations`                                                                                                        |
| Policy enforcement point    | The same: "enforces policy decisions in response to a request from a subject requesting access to a protected object"                                                                                | The dispatcher of `@on.auto/operations`, which every call passes through                                                                                                             |
| Policy information point    | The same: "serves as the retrieval source of attributes, or the data required for policy evaluation"                                                                                                 | `RoleAssignments` (`src/roles/role-assignments.ts`): the roles a principal holds, at an org, a playbook or a definition                                                              |
| Policy administration point | The same                                                                                                                                                                                             | The files of the release: `src/policies/access.cedarschema` and `src/policies/built-in.cedar`. Nobody writes a policy in the main path                                               |
| Role-based access control   | NIST, "users are assigned to roles, permissions are assigned to roles"; Cedar's own guidance, "use groups of principals to represent roles"                                                          | A role is a group of principals; each built-in role is one policy over the permissions operations declare                                                                            |
| Role assignment             | Azure RBAC: "a role assignment consists of three elements: security principal, role definition, and scope"                                                                                           | `RoleAssignment`: a role, `{ type: 'built_in', id }`, at a scope, `{ type, id }`; held by a principal, `{ type, id }`, the typed references the facts of role assignments will carry |
| Ports and adapters          | Alistair Cockburn, "Hexagonal Architecture" (2005)                                                                                                                                                   | The engine sits behind `PolicyDecisionPoint`; replacing it changes no caller                                                                                                         |
| Fail-safe defaults          | Saltzer and Schroeder, "The Protection of Information in Computer Systems" (1975): "base access decisions on permission rather than exclusion"                                                       | Cedar denies what no policy permits, and this package denies wherever anything fails (see [Failing closed](#failing-closed))                                                         |
| Report-only                 | Microsoft Entra Conditional Access, "report-only mode"; the experiment of GitHub's Scientist (2016), which runs the control and the candidate, publishes a mismatch and returns the control's answer | The dispatcher asks, logs a difference and decides as before                                                                                                                         |
| Parallel change             | Danilo Sato, "ParallelChange" (2014): expand, migrate, contract                                                                                                                                      | The decision point is added beside today's check (this step); enforcement moves to it once it has shown it answers as the check does; the check is removed only then                 |
| Differential testing        | William McKeeman, "Differential Testing for Software" (1998)                                                                                                                                         | `src/decision-point/report-only-agreement.test.ts` runs 539 calls through today's check and the decision point and finds them agreeing                                               |

No fact is written and no read model is kept here yet. The facts of role assignments, `role_assigned` and `role_unassigned`, their decider and the read model that fills `RoleAssignments`, an inline keyed projection (event sourcing; the decider of Jérémie Chassaing; the inline projection of Marten and Emmett, [the ledger](../ledger/README.md)), come in a later step, behind the port this package already asks.

## The question and the answer

The question is Cedar's own request, "an authorization request has four parts", in the runtime's words, `AccessRequest` of `@on.auto/operations`:

- `principal`, who acts, `{ type, id }`: `person`, with the subject their sign-in carries, `key`, `playbook` for a playbook acting as itself, or `local_developer`.
- `action`, the operation, `{ scope, name }`.
- `resource`, what it acts on: `{ type: 'org', id }`, `{ type: 'playbook', id, org }` or `{ type: 'definition', id, playbook, org }`.
- `context`: `via`, how the call arrived, `studio`, `agent`, `key`, `conversation`, `run` or `local`; `granted`, what the credential grants, its org, its permissions and its playbooks; and `operation`, what the operation declares about itself, its kind and whether it targets a playbook, only reads, reaches outside, may change outside or cannot be undone.

The answer, `AccessDecision`, is `allow` or `deny`, the ids of the policies that determined it, as AWS Verified Permissions names them, and the errors met, if any. Nothing else.

## The schema and the built-in policies

`src/policies/access.cedarschema` declares the entities, `Org`, `Role`, `Person in [Role]`, `Key`, `LocalDeveloper`, `Playbook in [Org]` and `Definition in [Playbook]`, and the context. `accessSchemaOf(declared, permissions, operations)` (`src/schema/access-schema.ts`) adds to it an action group for each permission, generated from `allPermissions` of `@on.auto/operations`, and an action for each operation the dispatcher is handed, `"<scope>/<name>"` in the groups of the permissions it declares, applying to the resources of its scope: `[Org]`, or `[Org, Playbook, Definition]` for an org operation that targets a playbook, and `[Playbook, Definition]` at playbook scope. Nothing is kept by hand: the server hands it every operation its dispatcher is handed, the catalogs it serves and the workflow host's own, from the one value it gives the host (`packages/server/src/workflows/host-operations.ts`). An operation handed over more than once, as one served in two catalogs, is declared once, and two that share a scope and a name but declare different permissions or targets are refused, so the decision point does not load and denies every request.

`src/policies/built-in.cedar` holds nine policies, each named by its `@id`:

| Id                           | What it says                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `viewer`                     | A principal in the role `viewer` may do what `org:read` or `playbook:read` permits                                   |
| `editor`                     | A principal in the role `editor` may do what any of the four permissions permits                                     |
| `admin`                      | A principal in the role `admin` may do what any of the four permissions permits                                      |
| `key`                        | A key may do what its grant permits                                                                                  |
| `local-developer`            | The local developer may do what its grant permits                                                                    |
| `playbook-itself`            | A playbook acting as itself may do what its grant permits                                                            |
| `own-org`                    | Nobody acts outside the org of their grant                                                                           |
| `within-granted-permissions` | Nobody calls an operation none of whose declared permissions their grant holds                                       |
| `within-granted-playbooks`   | A grant limited to some playbooks reaches only those, and an operation that targets a playbook must name one of them |

No policy names an operation, a person, a key, an org or a playbook: only the built-in roles and the permissions operations declare (`src/engine/prepared-policies.test.ts`). A rule may use only what the schema holds, and Cedar's validator refuses one that uses anything else; the policies pass it in strict mode with no error and no warning.

## Failing closed

Cedar skips a policy that errors and decides without it, so a `forbid` that errors can leave an `allow` ("the policy does not factor into the authorization response; it is skipped"). This package answers `deny`, with no determining policy, whenever an allow comes with an error (`src/engine/cedar-decisions.ts`), and `deny` where:

- the engine cannot be loaded, or its policies do not parse, have no `@id`, repeat an id, hold a template, or do not pass the schema in strict mode: every request is denied and the reason is logged once as an error, `unloadedMessage`;
- the request does not pass the schema, as an operation the release does not declare;
- Cedar throws;
- the roles of the principal cannot be read;
- no policy permits, which is Cedar's own default.

The enforcement point gives the decision point a second; one that does not answer within it is taken as a deny (`packages/operations/src/access-control/report-only.ts`).

## The engine

Cedar is `@cedar-policy/cedar-wasm`, pinned at 4.14.0, whose one change fixes a "memory leak potential when passing malformed inputs". It is loaded through its `web` entry with a compiled module, the one shape a Worker of Auto's cloud can also take, since a Worker compiles no module from bytes: `cedarOf(module)` instantiates it once in the process (`src/engine/cedar.ts`). In Node, `cedarModuleIn(shippedFiles)` reads its file, `web/cedar_wasm_bg.wasm` of the package, named under this package through `dependencyFileOf` of `@on.auto/shipped-files`, and compiles it once for each reader of files (`src/engine/cedar-module.ts`). A Worker's loader is a later step.

- **Loaded on first use.** At start only Cedar's JavaScript glue, about 19 KB, is imported; the WebAssembly, 4.4 MB, is neither read nor compiled. The first request reads the schema and the policies, generates the actions, validates them and reads them into the engine, and later ones find them read (`src/decision-point/cedar-decision-point.ts`). Measured with Node 26.12.1 on arm64 macOS, three times: the first decision took 81 ms and the process grew by 102 to 126 MiB, as V8 compiled the module.
- **Fixed names in the engine's store.** Cedar keeps what it reads in for the life of the process. The schema and the policies are read in under names made from the SHA-256 of their text, so a process holds one of each for the release, never one for each org (`src/engine/prepared-policies.ts`).
- **No network, file or clock while deciding.** The module asks its host for seven functions alone, pinned by a test: turning values into JSON and back, making and throwing its errors, reading a string, telling `undefined` and setting up a table (`src/engine/cedar-module.test.ts`). A decision reads the roles of its principal and asks the engine; it reads no file and no clock.

## Report-only

The server composes `cedarDecisionPoint({ module, files, operations, roles })` over every operation its dispatcher is handed and gives it to its dispatcher as `makeDispatcher(steps, { reportOnly })` of `@on.auto/operations`, which asks it about every call beside today's check, logs a difference with ids alone and answers as today's check decides.

In report-only mode the roles come from `editorRoleForEveryPerson`: every signed-in person holds the built-in role `editor` in the org asked about, and keys, playbooks and the local developer hold none, as today the runtime keeps no roles and gives a signed-in session every permission whatever role its token names, while Auto's cloud cuts the credential by role before the runtime sees it. What a credential grants still bounds every principal, through `within-granted-permissions` and `within-granted-playbooks`. A later step fills the same port from the facts of role assignments.

## What the model takes without a change to the question

Each of these leaves the question as it is and takes at most one more policy (`src/decision-point/model.test.ts`, `src/decision-point/operator.test.ts`):

- **A role at one playbook.** No new policy: a role held at a playbook applies to the playbook and to every definition in it, a role held at a definition to that definition alone, as the information point gives the principal each role held at the thing asked about or at a place it is in. An Editor of one playbook is the built-in role `editor` held at that playbook, and acts on that playbook and what is in it alone.
- **A level that runs and answers but cannot change.** One permission, `playbook:run`, declared beside `playbook:write` by the operations that run, and one policy for its role over `org:read`, `playbook:read` and `playbook:run`. An Editor keeps running through `playbook:write`.
- **A rule on what an operation declares.** "Nobody but an Admin does what cannot be undone" is one `forbid` on `context.operation.irreversible`.

## The pinned table

`src/decision-point/pinned-table.test.ts` lists, for each role and each kind of caller, what the decision point allows of each kind of operation the runtime declares, on the org, on a playbook, on another and on a definition in the first. A change to a policy shows as a change to a row.

## Cedar's licence

Cedar is under the Apache License 2.0. Its npm package carries neither its licence, nor its notice, nor the notices of the crates compiled into its WebAssembly, and the container image of the runtime redistributes it, so three files travel beside the code that loads it, as the typefaces of `@on.auto/api` carry theirs, in the image and in the npm package alike:

- `src/engine/Cedar-LICENSE.txt` and `src/engine/Cedar-NOTICE.txt` are `LICENSE` and `NOTICE` of `github.com/cedar-policy/cedar` at the tag `v4.14.0`, commit `5e54be8a16f3f346eb542e4feca587bfb962ebd1`, byte for byte.
- `src/engine/Cedar-THIRD-PARTY-NOTICES.txt`, named as Playwright and the Monaco editor name theirs, `ThirdPartyNotices.txt`, in the capitals of the two beside it, gives the licence and the copyright lines of every other crate compiled into `web/cedar_wasm_bg.wasm`, for which Cedar publishes no list (its `THIRD_PARTY_LICENSES.txt` is that of its command-line tool). These are the crates its `cedar-wasm/build-wasm.sh` builds for `wasm32-unknown-unknown`, resolved from its `Cargo.lock` at the tag: the normal dependencies of `cedar-wasm` with its default features, the build dependencies of Cedar's own crates, whose output is compiled in (`lalrpop`, which writes Cedar's parsers), and the Rust standard library of the compiler the module's producers section names, rustc 1.99.1. Each text comes from the crate's own published package, gathered by [cargo-about](https://github.com/EmbarkStudios/cargo-about); where a crate offers a choice of licences, MIT is taken, as its text carries the crate's copyright line.

`src/files/access-control-files.test.ts` pins the SHA-256 of all three. `cedarNoticeFiles` names them; the release of the npm package reads them (`packages/server/npm/release-reads.ts`), and the image's smoke test reads them inside the image (`.github/smoke/image.sh`).

### When Cedar's version changes

Take `LICENSE` and `NOTICE` from the new tag, and write the notices of the crates again with `scripts/cedar-notices/cedar-notices.ts`. It reads the version from the installed package and the compiler from its WebAssembly, refuses a clone of Cedar at any other commit than the tag's, runs cargo with Cedar's `Cargo.lock` unchanged and offline after one fetch, and builds nothing. It needs a Rust toolchain, so it runs by hand and never in CI, which lints it and runs its tests, none of which needs Rust. Keep the tools in a folder of their own, so that nothing reaches your profile or your `PATH`; read the installer before you run it:

```bash
work=$(mktemp -d)
export RUSTUP_HOME="$work/rustup" CARGO_HOME="$work/cargo" PATH="$work/cargo/bin:$PATH"
curl --proto '=https' --tlsv1.2 --fail --output "$work/rustup-init.sh" https://sh.rustup.rs
sh "$work/rustup-init.sh" -y --no-modify-path --profile minimal
cargo install cargo-about --locked --features cli
git clone --depth 1 --branch "v$(node -p "require('./packages/access-control/node_modules/@cedar-policy/cedar-wasm/package.json').version")" https://github.com/cedar-policy/cedar "$work/cedar"
node scripts/cedar-notices/cedar-notices.ts "$work/cedar"
```

The script names the compiler to add when its library sources are missing (`rustup toolchain install <version> --profile minimal --component rust-src`); add it and run the script again. `scripts/cedar-notices/about.toml` is the configuration of cargo-about: it accepts only the licences of the MIT, Apache-2.0, BSD, ISC, Unicode and Zlib families, so that a crate under any other licence stops the script, and it names, with its SHA-256, the licence file of each crate whose file cargo-about does not recognise. The script stops on a crate whose package carries a licence file that holds none of the texts taken, as happens when such a file changes or a new one goes unrecognised: name the file in a clarification and run it again. Pin the new SHA-256 of each file in `src/files/access-control-files.test.ts`, then remove `$work`.

## Testing

The tests read the schema, the policies and the engine from the package on disk, through `shippedFilesOnDisk`, and decide with the real Cedar. `src/testing/access-testing.ts` holds the operations they declare, one of each kind the runtime has, and a source of roles given by the test.
