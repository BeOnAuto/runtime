# Licensing

Auto Runtime is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2), the same license Apollo uses for its GraphQL router. You can read, modify and self-host it. It is not open source in the OSI sense, because ELv2 restricts offering the software as a managed service.

This page explains the license in plain language. If anything here conflicts with [LICENSE](LICENSE), the license wins.

## What you can do for free

- Read, build and modify the source.
- Run Auto Runtime on your own infrastructure, in development and in production: without a key for 100 free runs and then up to 15 runs a UTC day and 75 a UTC month, for as long as you like, and on your org's credits with a free license key.
- Create playbooks with it for your own business, or for clients who run them in their own environments.
- Redistribute it, including modified versions. Anyone who gets a copy from you must also get the license terms, and you must mark what you changed.

## When you need a license key

Self-hosted Auto Runtime counts **runs**: a run of a workflow or a function counts once by its run id, however often it is retried or resumed. Nothing else is counted: no model calls, compute or storage. The runtime counts from its own record of the runs it admitted, kept in its ledger.

- **Without a key.** A runtime that nobody registered runs 100 free runs, then up to 15 runs a UTC day and 75 a UTC calendar month, and never calls Auto. It says in its terminal and on its page how many it used. A run past the free rate is refused, saying when it can run again and where an org gets its free key for the runtime.
- **A license key is free to get.** An owner of an org registers the runtime in Auto Studio and gets its key; the org's Free plan includes 75 credits each month, and a new org gets 100 welcome credits. From then on the runtime starts runs on the org's credits against a license Auto signs, and each run it starts on the license spends one credit, which Auto takes as the runtime reports. Paid plans, top-ups and Enterprise orders add credits, and a paid plan may go into a bounded overage that its next credits repay. Without credits, or out of touch with Auto for four weeks, the runtime runs at the free rate again; it never stops outright.
- **What still works without a key or credits.** Reading, editing and exporting playbooks, definitions, runs and events is never refused; only starting a new run past the free rate is.
- **What the runtime tells Auto.** With a key, as it activates the key and then every hour: the runtime's id, the number of runs it admitted and the number it admitted on its license. Never a run's id, definition, inputs or outputs, or anything a playbook holds. Without a key, nothing.

Auto Runtime enforces a license from 0.27.0, released on 27 October 2026. Earlier releases limit nothing. [Licenses](docs/self-host/licenses.md) says how to register, activate a key and run a runtime offline.

For Enterprise terms, contact us through [on.auto](https://on.auto).

## What ELv2 doesn't allow

- **Offering Auto Runtime as a hosted or managed service.** You can't give third parties access to a substantial set of its features as a service, for example by reselling "Auto Runtime hosting". Running it for your own business, or building playbooks that your clients operate, is fine.
- **Getting around the license key.** You can't move, change, disable or circumvent the license key functionality, or remove functionality the key protects. The meter that counts runs, the license it admits them against and the free rate it falls back to are that functionality.
- **Removing notices.** You can't alter, remove or obscure licensing, copyright or other notices.

## Cloud hosting

Auto also runs Auto Runtime for you as a cloud-hosted service. If you'd rather not operate it yourself, that's the managed way to use it.

## Contributing

Contributions are accepted under the [Contributor License Agreement](CLA.md). It lets Auto distribute your contribution under ELv2 and under commercial licenses. The CLA bot asks you to sign it on your first pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
