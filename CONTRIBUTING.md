# Contributing to Auto Runtime

Thanks for helping build the runtime for business playbooks. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Found a vulnerability?** Don't open an issue. Follow [SECURITY.md](SECURITY.md).
- **Bugs and ideas** go in [issues](https://github.com/BeOnAuto/runtime/issues/new/choose). For anything bigger than a small fix, open an issue first so we can agree on the approach before you write code.
- **The CLA.** Auto Runtime is [source-available under ELv2](LICENSING.md), and Auto also sells commercial licenses. So every contributor signs the [Contributor License Agreement](CLA.md) once. The CLA bot asks on your first pull request; reply with the sentence it gives you.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Node 26 (`nvm use` reads `.nvmrc`) and pnpm 12 (`npm install --global pnpm@12`).

```bash
pnpm install          # also installs the git hooks
pnpm dev              # the server on http://localhost:5555, reloading on save
pnpm test:watch       # every package's tests, rerun on save
pnpm typecheck:watch  # TypeScript over the whole repo
pnpm check            # everything CI checks; run it before you push
```

Node runs the TypeScript sources directly, so there's no build step. `pnpm dev` never sends the [usage ping](docs/self-host/configuration.md#usage-ping), and runs in local mode, which trusts every request on your machine, with no sign-in; `PUBLIC_URL=http://localhost:5555` in `.env` signs you in through the Auto identity service when your agent connects.

## Documentation

Runtime guides live in `docs/` and are published as part of [on.auto/docs](https://on.auto/docs/). Change the docs in the same pull request as behavior changes. The public preview needs no private repository or service credentials:

```sh
pnpm docs:dev
pnpm docs:check
```

The preview opens under `/docs/`. Read [Documentation contributions](docs/contributing/documentation.md) for navigation, links, status labels and the publication contract. Package READMEs keep code entry points and test instructions. Detailed setup and implementation guides live in [docs/engineering/](docs/engineering/index.md), which is excluded from the public build and website import.

## How the code is written

[CLAUDE.md](CLAUDE.md) holds the full rules. The ones that matter most for a first pull request:

- **Every file is held to 100% test coverage.** Write the test; coverage-ignore comments and coverage excludes are rejected.
- **The lint and TypeScript rules are strict and stay that way.** No `any`, no `as` assertions, no `@ts-ignore`, no disable directives.
- **TypeScript must be erasable**, because Node strips the types at runtime. That means no `enum`, `namespace`, parameter properties or decorators. Relative imports include the `.ts` extension.
- **Tests sit next to the code** as `*.test.ts` and test behaviour through the public interface, with injected fakes rather than mocks.
- **A test waits for the event that shows the state it needs, never for the clock,** and the one-minute ceiling in `vitest.shared.ts` only guards against a hang.

## Commits and pull requests

- **Commits are [conventional](https://www.conventionalcommits.org) with a scope,** for example `feat(reasoning): render the liquid body against the playbook`.
  - The scope is a package or capability folder name (`server`, `config`, `ledger`, `reasoning`, ...), or one of `global`, `deps`, `ci` and `release`.
  - `pnpm commit` walks you through it, and a git hook checks every message.
- **The pull request title matters most.** Pull requests are squash-merged, so the title becomes the commit on `main` and the changelog entry. CI checks it too.
- **CI must pass, then the pull request merges through the merge queue.** CI runs the full `pnpm check`, builds and smoke-tests the container, and audits the workflows. Keep each pull request to one change.

## Adding a function or workflow adapter

Function and workflow implementations live in `capabilities/<name>`. The shared `Capability` interface is their low-level runtime adapter contract, including custom extension adapters. It is not a product category. Each implemented adapter is a workspace package:

- `package.json` named `@on.auto/<name>`, with `"exports": { ".": "./src/index.ts" }` and `lint`, `typecheck` and `test` scripts. Copy them from `packages/config`.
- `README.md` saying what the adapter runs and how it reads and writes the ledger.
- `src/index.ts` as its public interface, with tests beside the code.

Open an issue before adding an adapter or implementing a planned function type. Follow [Playbook terminology](docs/concepts/terminology.md) for resource names, and [CLAUDE.md](CLAUDE.md) for the names in code. Workflow coordination is separate from the five function types.

## License

By contributing, you agree that your contributions are covered by the [CLA](CLA.md) and distributed under the [Elastic License 2.0](LICENSE).
