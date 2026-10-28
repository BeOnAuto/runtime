# Licensing

Auto Runtime is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2), the same license Apollo uses for its GraphQL router. You can read, modify and self-host it. It is not open source in the OSI sense, because ELv2 restricts offering the software as a managed service.

This page explains the license in plain language. If anything here conflicts with [LICENSE](LICENSE), the license wins.

## What you can do for free

- Read, build and modify the source.
- Run Auto Runtime on your own infrastructure, in development and in production, for 100 actions before you register it, and with a free license key after.
- Create playbooks with it for your own business, or for clients who run them in their own environments.
- Redistribute it, including modified versions. Anyone who gets a copy from you must also get the license terms, and you must mark what you changed.

## When you need a license key

Self-hosted Auto Runtime counts **actions**: a run of a workflow or a function is one action, counted once by its run id, however often it is retried or resumed. Nothing else is counted: no model calls, compute or storage. The count is kept from the runtime's own ledger.

- **The first 100 actions need nothing.** An installation that nobody registered runs 100 actions, and says in its terminal and on its page how many of them it used. The next run is refused, with the page of Studio where an org gets its free key for the installation.
- **A license key is free to get.** An owner of an org registers the installation in Auto Studio and gets its key; the org's Free plan includes 75 credits each month, and a new org gets 100 welcome credits. From then on each action spends one credit of the org's account at Auto. Paid plans, top-ups and Enterprise orders add credits.
- **What still works without a key or credits.** Reading, editing and exporting playbooks, definitions, runs and events is never refused; only starting a new run is.
- **What the runtime tells Auto.** For each action it asks to run: the installation, the org and playbook names, the run id, the definition's type, name and version, the run that called it and its trigger, and who started it. Every hour, the number of actions counted, with the point in its ledger it counted to. Never a run's inputs, outputs or anything a playbook holds.

These limits are enforced from Auto Runtime 0.27.0, released on 27 October 2026. Earlier releases limit nothing. [Licenses](docs/self-host/licenses.md) says how to register, activate a key and run an installation offline.

For Enterprise terms, contact us through [on.auto](https://on.auto).

## What ELv2 doesn't allow

- **Offering Auto Runtime as a hosted or managed service.** You can't give third parties access to a substantial set of its features as a service, for example by reselling "Auto Runtime hosting". Running it for your own business, or building playbooks that your clients operate, is fine.
- **Getting around the license key.** You can't move, change, disable or circumvent the license key functionality, or remove functionality the key protects. The meter that counts actions, and the checks that keep its count true to the ledger, are that functionality.
- **Removing notices.** You can't alter, remove or obscure licensing, copyright or other notices.

## Cloud hosting

Auto also runs Auto Runtime for you as a cloud-hosted service. If you'd rather not operate it yourself, that's the managed way to use it.

## Contributing

Contributions are accepted under the [Contributor License Agreement](CLA.md). It lets Auto distribute your contribution under ELv2 and under commercial licenses. The CLA bot asks you to sign it on your first pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
