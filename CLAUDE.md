# CLAUDE.md

## What this is

`@on.auto/runtime` is the runtime for business playbooks, a pnpm monorepo. It is source-available under the Elastic License 2.0 (see `LICENSING.md`); never call it open source. Its container image runs self-hosted and in Auto's cloud hosting. Auto Studio (the management plane, with governance and observability) lives in the private `studio` repo and the hosting side in the private `on.auto` repo, not here.

- `packages/server`: the Node.js server (`@on.auto/server`), plus everything that packages it into a container (`Dockerfile`, `Dockerfile.dockerignore`, `container.vex.json`, the findings of image scanners that do not apply to it, and `docker-hub.md`, the image's description on Docker Hub) and into the npm package `@on.auto/runtime` (`npm/pack.ts`, `npm/README.md`), whose `auto-runtime` command is `auto-runtime.ts`. The package ships the same `.ts` sources as the image and, beside them, each package's testing entry, so a program that composes the core can test against it; its launcher, `src/command-line/launch.ts`, is shipped as JavaScript with its types stripped, so it imports only `node:` modules, and it copies the sources out of `node_modules`, where Node does not strip types, before it runs them
- `packages/api`: the API (`@on.auto/api`), a Hono app that answers every request, with problem documents, the `Origin` and `Host` checks, authentication and the operation routes
- `packages/identity`: API keys, the local-mode rule and the key command (`@on.auto/identity`)
- `packages/*`: the server's libraries (`@on.auto/*`), including the ledger
- `capabilities/*`: the runtime adapters of the playbook's capabilities. `reasoning` implements reasoning functions, `interaction` interaction functions, `prediction` prediction functions, `recall` recall functions, `computation` computation functions and `coordination` workflows.
- `scripts`: the repository's own scripts (`@on.auto/scripts`), linted and typechecked by `docs:lint`: the checks of the documents, which `docs:test` runs with the scripts' other tests; the generation of the OpenAPI document, `docs/assets/openapi.json`, from what a throwaway server serves (`docs:openapi`); the function taxonomy, `docs/assets/brain-functions.json`, written from `@on.auto/definitions` (`docs:taxonomy`) and refused when missing or stale by `docs:taxonomy:check`; the check that the CI workflow's test job runs each package with tests in exactly one group, and starts the database and the object store for exactly the groups whose tests read the variables that reach them; and `try-reasoning.sh` and `try-workflows.sh`, which run a reasoning function and a workflow over HTTP against a server already running and print the run
- `TODO.md`: setup work that is still outstanding

Use the vocabulary in [Playbook terminology](docs/concepts/terminology.md) in product text and domain code. A playbook reasons, interacts, predicts, recalls and computes. Workflows coordinate those functions. The five function categories are Reasoning, Interaction, Prediction, Recall and Computation, in that order; coordination is a capability, not a sixth function type. A reasoning function has a prompt. A workflow or function definition is reusable; a run executes it against particular inputs.

Playbooks own reusable functions, workflows and runs. Each playbook includes one brain: its function collection, with no independent lifecycle. Auto Runtime executes; Auto Studio manages and presents; the user's agent is a separate client. The product is not live and has no stored data, so nothing keeps an old name beside a new one: no alias, no mapping, no anchor for an old heading, no upgrade note and no test that an old name or an old record still works, and a local database made before a rename is deleted. The product's words are the one vocabulary, on the wire, in the ledger, in the configuration, in the package names and in the code; a name inside a namespace drops the brand and a name outside keeps it, so the repository is `BeOnAuto/runtime`, the root package `@on.auto/runtime`, the image `onauto/runtime`, the packages are scoped `@on.auto`, and the configuration file is `auto-runtime.yaml`. A definition has a `type`, `reasoning`, `interaction`, `prediction`, `recall`, `computation` or `workflow`, and a run has a `run_id`; a record whose own `type` names it, such as a ledger event, carries `definition_type`. The workflow engine's run-log formats are internal replay formats and follow their own rule, which its README sets out under [State formats](packages/workflow-engine/README.md#state-formats). `Capability` is the contract a capability package implements for the runtime, and is named for what it is.

Domain code names a definition for its resource: `WorkflowDefinition`, and `ReasoningFunctionDefinition`, `InteractionFunctionDefinition`, `PredictionFunctionDefinition`, `RecallFunctionDefinition` or `ComputationFunctionDefinition`. A definition's `type` is its one discriminator: `reasoning`, `interaction`, `prediction`, `recall` and `computation` for the five function types, and `workflow`, which is not a function type. A parsed source document is a `...DefinitionDocument`, and a factory of a runtime adapter is `make...Adapter`. **inference** names a model call and its provider's terms, **agent** an actual actor, such as an external coding agent, and **memory** the retention of information.

## Commands

```bash
pnpm dev               # the server, which runs workflows itself, restarted on every save
pnpm --filter @on.auto/server container:build   # build the image locally
pnpm --filter @on.auto/server npm:pack          # pack the npm package into dist/
pnpm test:watch        # the tests of packages/* and capabilities/* in one Vitest watch process
pnpm typecheck:watch   # TypeScript 7 over packages/* and capabilities/*
pnpm check             # the full gate: format, lint, typecheck, test (100% coverage), knip, sherif, docs:check
pnpm format            # oxfmt --write
pnpm lint:fix          # oxlint --fix
pnpm commit            # guided conventional commit (czg)
```

Run one package's gate with `pnpm turbo run lint typecheck test --filter @on.auto/server`.

## How the code runs

- Node runs `.ts` directly (native type stripping). There is no build step for the server or internal packages.
- Only erasable TypeScript: no `enum`, `namespace`, parameter properties or decorators.
- Relative imports carry the `.ts` extension. Type-only imports use `import type`.
- Workspace packages export their `src/index.ts`; import them by package name, never by relative path across packages.
- Tests run on Node's own module loader (`experimental.viteModuleRunner: false`), exactly as production does.

## Rules

- Follow the lint and TypeScript rules. You are not allowed to relax them, add disable directives, `@ts-ignore`, `any`, or `as` assertions. Fix the underlying problem.
- 100% coverage per file is the gate. Never add coverage-ignore comments or coverage excludes; write the test.
- Do not write comments. Make the code read like English through names and ordering.
- Tests live next to the code as `*.test.ts`, test behaviour through the public interface, and prefer injected fakes over mocks.
- A package with more than about 12 source files groups them one level deep, in folders named after concepts that hold fewer than about 15 files each, with tests beside the code they test. Nothing new goes directly under `src`, and there are no barrel files: a package's entry points are the few paths its `exports` map names (`src/index.ts`, `src/testing/index.ts` and, where its README says why, a subpath) and its commands (the server's `src/main.ts`, `dev.ts` and `auto-runtime.ts`, the identity package's `src/key-command.ts`).
- Commits are conventional with a scope named after a package or capability folder (`feat(server): ...`, `docs(reasoning): ...`); `global`, `deps`, `ci` and `release` are the other scopes.
- `pnpm check` must pass before you finish. Fixing a problem is a change, so rerun it.
- When something fails, assume your change broke it. What is on `main` passed the same gate.

## User-visible text

Before changing user-visible text, read [Auto voice](docs/contributing/voice.md) and [Playbook terminology](docs/concepts/terminology.md). Apply them to labels, help text, empty states, validation, dialogs, errors, notifications, accessibility text, emails and generated overviews.

Check the code path before changing a claim. Preserve permissions, timing, recovery limits and uncertainty. Keep user-authored content and historic run records unchanged unless the task explicitly includes them. Run a humanizer pass and review the complete affected states. Include substantive before-and-after wording in the pull request.

For documentation, also follow [the documentation contribution guide](docs/contributing/documentation.md). Keep voice rules in the canonical guide instead of copying them into other repositories.
