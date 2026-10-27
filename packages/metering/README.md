# @on.auto/metering

The credit arithmetic and admission contracts shared by Cloud and customer-hosted Auto Runtime. A credit is one million integer microcredits. Provider amounts retain decimal precision until the approved tariff converts them; reservations round upward and settlements round once to the nearest microcredit, with ties to even.

This package owns execution identities and accounting rules. Customer accounts, payments, private signing keys, and credit issuance belong to the Studio account service. Customer-funded model and compute resources do not incur an Auto resource surcharge.

An execution charge is identified by account, deployment, playbook, logical run and charge kind. Retries retain that identity. Provider receipts are identified by account, provider and provider request, so a response and a later gateway log cannot become separate resources.

Quotes bind an execution to its definition version, input digest, enforced-limit digest, tariff, deadline and maximum spend. The bound calculator includes sequence and parallel paths, finite repetitions and each branch's category maxima. Resource fractions are aggregated before the reservation rounds upwards. The caller must derive and enforce these bounds from the actual execution configuration; a quote hash alone is not spending approval. Approval and the committed reservation belong to the account authority. Unknown resource bounds, unbounded repetitions, oversized plans and unsafe accounting amounts are refused.

`reserveFromLots` chooses eligible source lots for platform, resource and development charges, subject to source expiry and the remaining Cloud Free daily allowance. It finds a complete feasible allocation and prefers earlier expiry, then issuance time, then lot ID. A residual flow network can move tentative category assignments when a later restricted lot requires it. Exact integer preference weights make the source priority lexicographic, including when Free lots share a daily capacity limit. An insufficient request returns no partial reservation and does not mutate the supplied snapshot. The caller commits the result and the daily quota under the same account revision. Snapshots are bounded to 1,024 distinct lots; the service must surface an oversized snapshot for maintenance rather than omit source lots or assume no credits exist.

The allocator is checked against an independent exhaustive enumeration of 5,292 small funding cases in addition to the source, expiry and eligibility examples. A local Node run with 1,024 one-credit lots and a 512-credit request took 390 ms; this is a local sizing observation, not a cloud throughput guarantee.

The implementation is being delivered with the Runtime and Studio pricing-and-metering PRs. The complete approved design and requirement-by-requirement verification record live in Studio's `docs/design/`. Passing the arithmetic suite alone does not establish completion of runtime enforcement or account-service integration.
