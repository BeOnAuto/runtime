---
description: Discuss running Auto Runtime on infrastructure your organization controls.
---

# Self-hosting

Auto Runtime can run on your own infrastructure, including on-premises. Your team operates the deployment and manages its storage, model providers, upgrades and backups.

Each release opens the database of the release before it and carries it forward as it starts: every playbook, definition, run and connection the earlier release recorded stays, and the tables change to the new release's layout. Upgrades go forward only: a release does not open a database a newer release carried forward, so back up the database before an upgrade, as your team does its other backups. A database is carried forward when the facts it holds are ones this release reads: as it starts, the server reads the types of all of them and the newest fact of each type, and refuses the database at start when one is of a type or in a shape this release does not read, or when the database is in an earlier layout than this release carries forward, and says what to delete.

[Get in touch](https://on.auto/contact-us) to discuss your requirements and plan the deployment. Tell us where it needs to run, which systems it must reach, and any requirements for data handling or network access. We can work through licensing and support with you.

For hosted Auto, [connect your agent](get-started/cloud.md) and start working straight away.
