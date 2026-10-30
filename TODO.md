# To Do List

Setup work that couldn't be finished yet, and why.

## Licensing

- [ ] **Build the license-key check into the server before any release with real functionality.**
  - Without a key, the server serves operations up to the free threshold. A signed key, verified offline, carries the limit a customer has paid for (Apollo's router works the same way).
  - Decide what happens at the limit (for example `503`) and when a key expires.
  - The check must ship before Auto Runtime does anything worth using. Every release is ELv2 forever, so a capable release without the check would stay free at any volume.
- [ ] **Decide the threshold and what counts as an operation.** Publish both in [LICENSING.md](LICENSING.md), which currently says they're coming.
- [ ] **Write the commercial terms.** They grant use above the threshold, keep the ELv2 restrictions, and fall back to ELv2 when a subscription ends. Also give [LICENSING.md](LICENSING.md) a licensing contact address; it currently points at on.auto.
- [ ] **Have a lawyer review:**
  - [LICENSE](LICENSE), [LICENSING.md](LICENSING.md) and [CLA.md](CLA.md)
  - the definitions of "operation" and "managed service"
  - the registered legal name of the licensor (currently "BeOnAuto")
  - whether the ELv2 license-key clause makes the threshold binding

## Community

- [ ] **Create `conduct@on.auto`.** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) sends reports there.
- [ ] **Decide who else is on the CLA allowlist.** Today it's the maintainers that `.github/workflows/cla.yml` lists, and bots. Employees covered by an employment agreement could be added, or sign like everyone else.
- [ ] **Offer a corporate CLA.** [CLA.md](CLA.md) tells employees to ask for one, but none exists yet.

## Hardening

- [ ] **Require signed commits.** Set up SSH or GPG signing for every maintainer and agent that commits, then add `required_signatures` to the `main` ruleset. Turning it on first would block every push.
- [ ] **Add CODEOWNERS and require code-owner review.** Wait until there's more than one maintainer; until then it would only request reviews from the same person who wrote the change.
- [x] **Make the CLA check required.** Done on 2026-10-30: the `main` ruleset requires `CLA`, `ci-ok` and `documentation`, and there is no merge queue.
- [ ] **Move harden-runner from audit to block.** Once a few weeks of runs show which endpoints each job calls, switch `egress-policy` to `block` with that allowlist.
- [ ] **Review the first OpenSSF Scorecard report.** It publishes after the Scorecard workflow's first run on `main`. Fix the findings worth fixing.

## Releases

- [ ] **Add the trusted publisher of `@on.auto/runtime` on npm.** npm sets a trusted publisher in a package's settings, which exist once its first version is published, so 0.6.0 was published from a maintainer's machine. On npmjs.com, under the package's **Settings**, add GitHub Actions with the repository `BeOnAuto/runtime` and the workflow `release.yml`, so the release workflow's `package` job publishes every later version with provenance and no token.
- [ ] **Publish `@on.auto/prediction-contract` once by hand and add its trusted publisher on npm.** `npm trust` takes only a package already on the registry, so the release workflow's `contract-package` job cannot publish its first version, `1.0.0`. Once release-please has tagged `prediction-contract-v1.0.0`, publish that version from the tag on a maintainer's machine, signed in to npm with two-factor authentication: install with `pnpm install --frozen-lockfile`, then publish with `pnpm --filter @on.auto/prediction-contract publish --no-provenance`, since provenance needs a CI provider; the package's `prepublishOnly` builds the `dist` it publishes. Then, on npmjs.com, under the package's **Settings**, add GitHub Actions with the repository `BeOnAuto/runtime` and the workflow `release.yml`, so the `contract-package` job publishes every later version with provenance and no token.

## Local databases

- [ ] **Delete every local ledger made before its streams and tables named playbooks and its recorded content became bytes.** The streams, event types and fields took the product's words, and then every message's data became the fact alone, with who acted, when, the definition, the run and its chain in the message's metadata; the facts named for an outcome became one type for each outcome, the projections took their next versions, `run_outcomes_4`, `open_requests_6` and `conversations_3`, and the host's `workflow_calls` gained `started_by`; then each fact's context became the one its fact declares, so a run fact carries its run and its definition, the recorded content became keyed by the digest of the text it keeps, which a read checks, and the host's `workflow_reaction_refusals` gained `version`; then the playbook became the unit in storage as well: a playbook's streams are named `playbook/<org>/<playbook>/`, the org's registry is `org/<org>/playbooks`, whose facts `playbook_created`, `playbook_updated` and `playbook_retired` name their `playbook`, the playbook's own work is recorded by `playbook:<id>`, a workflow run's attributes name its `playbook` and its caller's `playbooks` and permissions, and every table of the ledger and the host that keys a playbook does so by `playbook_key`, `recall_views` among them, the host following each playbook in `workflow_followed_playbooks`; then the recorded content became bytes, its chunks binary and kept by the put that wrote them, its head naming that put and carrying a media type, beside the content staged under a run and the runs whose staging ended. Nothing reads the old shapes, since nothing is live. Delete `packages/server/.data/ledger.db` for `pnpm dev`, or the file `LEDGER_FILE` names, or the PostgreSQL database `DATABASE_URL` names. Kept, such a database stops the server from starting: the host makes its tables with `CREATE TABLE IF NOT EXISTS`, so a table it made before keeps its old key column, the index it then makes on its listeners' `playbook_key` fails with `no such column: playbook_key`, and the host's database does not open, `database_failed`, as the server starts. The ledger alone still opens, since the indexes of the tables it made before already have their names, but it shows no playbook, since nothing reads the streams it holds, and every write to those tables fails, and with it every append of a fact a projection keeps; a database whose recorded content has another shape is refused when the ledger opens, with words that say to delete it.

## Tests

- [ ] **Run `pnpm exec vitest doctor` again as the suite grows.** On 2026-09-30 it recommended keeping the defaults (forks, isolated), because no alternative was more than 10% faster.
