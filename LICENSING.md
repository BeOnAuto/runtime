# Licensing

Auto Runtime is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2), the same license Apollo uses for its GraphQL router. You can read, modify and self-host it. It is not open source in the OSI sense, because ELv2 restricts offering the software as a managed service.

This page explains the license in plain language. If anything here conflicts with [LICENSE](LICENSE), the license wins.

## What you can do for free

- Read, build and modify the source.
- Run Auto Runtime on your own infrastructure, in development and in production: 100 runs before you register it, and after that with a free license key and the credits of your org's account at Auto.
- Create playbooks with it for your own business, or for clients who run them in their own environments.
- Redistribute it, including modified versions. Anyone who gets a copy from you must also get the license terms, and you must mark what you changed.

## When you need a license key

Self-hosted Auto Runtime counts **actions**: each run of a workflow or a function is one action, counted once by its run id, however often it is asked again, retried or resumed. A function or workflow that a workflow calls is a run of its own, and counts as one too. Nothing else is counted: no model calls, compute or storage. The count is kept from the runtime's own ledger.

- **100 runs before you register.** An installation that holds no key starts 100 runs, and says in its terminal and on its page how many of them it used. The next new run is refused, with the page of Studio where an org gets its free key for the installation. The 100 are counted over every run in the installation's ledger.
- **A license key is free to get, and runs are then paid in credits.** An owner of an org registers the installation in Auto Studio and gets its key. From then on the runtime asks the org's account at Auto to admit every new run, and each one spends a credit, even if the installation had not used all of its 100 runs: while the runtime holds a key, it does not use what is left of them, and nothing of them is added to the account. The account's credits are shared by every installation of the org and by Auto's cloud hosting: a new org gets 100 welcome credits for 14 days, and while it is on the Free plan, 75 credits each calendar month (UTC), of which at most 15 are spent a day and none roll over. Paid plans, top-ups and Enterprise orders add credits. [Free runs and credits](docs/self-host/licenses.md#free-runs-welcome-credits-and-free-plan-credits) works through how they combine.
- **The runtime depends on Auto to start runs after the first 100.** A licensed runtime asks Auto's account service to admit each new run as it starts; while the service cannot be reached, new runs are refused until it can. Its license lasts seven days and renews every day. An installation that cannot reach Auto at all runs on offline credits Auto signs for it, which stop seven days after they were last refreshed. [When Auto can't be reached](docs/self-host/licenses.md#when-auto-is-unreachable) says what happens to the work in progress.
- **What still works without a key or credits.** Reading playbooks, definitions, runs, their history and events through the API, editing definitions, cancelling runs and activating a license are never refused, whatever the license says and during a metering fault; only starting a new run is.
- **What the runtime tells Auto.** For each action it asks to run: the installation, the org and playbook names, the run id, the definition's type, name and version, the run that called it and its trigger, and who started it. Every hour, the number of actions counted, with the point in its ledger it counted to. Never a run's inputs, outputs or anything a playbook holds.

[Licenses](docs/self-host/licenses.md) says how to register, activate a key, run an installation offline and have a metering fault repaired.

For Enterprise terms, contact us through [on.auto](https://on.auto).

## Which releases limit runs

Auto Runtime 0.27.0, released on 27 October 2026, is the first release that limits runs. Every earlier release limits nothing, sends nothing to Auto's account service and stays available under ELv2 as it was published.

This page did not say so when the limit shipped. The npm package links to this page on the main branch, which, when 0.27.0, 0.28.0 and 0.29.0 were published, said that no release limited usage and that the threshold would be published here before the first release that enforced it. The copy of this page in the source tagged for each of those releases says the same, although the self-hosting page Licenses in that source did state the 100 runs. The threshold was published here later the same day, at 20:56 UTC, after those three releases (BeOnAuto/runtime#350), and 0.30.0 is the first release whose source includes it. A correction published later does not change what someone who installed or upgraded before it was told; if that is you, [Licenses](docs/self-host/licenses.md#if-you-installed-an-early-release) says what applies to your installation.

Releases 0.27.0 to 0.32.0 also ask for Auto's account service at an address where it never ran, so with their default settings they cannot activate a key at all. Release 0.32.1 and later ask `https://billing.on.auto`.

## What ELv2 doesn't allow

- **Offering Auto Runtime as a hosted or managed service.** You can't give third parties access to a substantial set of its features as a service, for example by reselling "Auto Runtime hosting". Running it for your own business, or building playbooks that your clients operate, is fine.
- **Getting around the license key.** You can't move, change, disable or circumvent the license key functionality, or remove or obscure functionality the key protects. In Auto Runtime, what the key protects is starting new runs beyond the 100 an installation runs before it is registered. The license key functionality is what enforces that boundary: the admission of each new run, the verification of the entitlements, admissions and offline credits Auto signs, and the count of runs from the ledger, with the checks that keep that count true to the ledger.
- **Removing notices.** You can't alter, remove or obscure licensing, copyright or other notices.

## Changing the source

ELv2 lets you modify Auto Runtime, and most changes have nothing to do with the license key: adding or changing functions, workflows, capabilities, connections and providers, fixing bugs, changing the API, the pages or the configuration, and running it on other infrastructure. A modified runtime that still asks for admission before each new run beyond its first 100 is within the license.

What is not allowed is a change whose effect is to start new runs beyond the first 100 without the admission Auto's key functionality requires: removing or bypassing the meter or the admission of a run, accepting entitlements, admissions or offline credits that Auto did not sign, replacing or adding to the public keys the runtime ships, faking the answers of Auto's account service, or editing the count so that it stays below what the ledger holds. Releases before 0.27.0 contain no license key functionality, and stay under the license they were published with.

## Starting again with an empty ledger

You may delete an installation's whole ledger, its SQLite file or its PostgreSQL database, and start again. Everything the old ledger held is gone with it: playbooks, definitions, runs, their history and events, the secrets and connections it kept, its count and its license. Started without a key, the empty ledger is a new installation with a new runtime id and 100 runs before it is registered. [Starting again](docs/self-host/licenses.md#starting-again-with-an-empty-ledger) says what happens when you restore a backup instead.

## Cloud hosting

Auto also runs Auto Runtime for you as a cloud-hosted service. If you'd rather not operate it yourself, that's the managed way to use it.

## Contributing

Contributions are accepted under the [Contributor License Agreement](CLA.md). It lets Auto distribute your contribution under ELv2 and under commercial licenses. The CLA bot asks you to sign it on your first pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
