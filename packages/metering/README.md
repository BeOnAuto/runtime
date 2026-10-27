# @on.auto/metering

The credit arithmetic and admission contracts shared by Cloud and customer-hosted Auto Runtime. A credit is one million integer microcredits. Provider amounts retain decimal precision until the approved tariff converts them; reservations round upward and settlements round once to the nearest microcredit, with ties to even.

This package owns execution identities and accounting rules. Customer accounts, payments, private signing keys, and credit issuance belong to the Studio account service. Customer-funded model and compute resources do not incur an Auto resource surcharge.

An execution charge is identified by account, deployment, playbook, logical run and charge kind. Retries retain that identity. Provider receipts are identified by account, provider and provider request, so a response and a later gateway log cannot become separate resources.

Quotes bind an execution to its definition version, input digest, enforced-limit digest, tariff, deadline and maximum spend. The bound calculator includes sequence and parallel paths, finite repetitions and each branch's category maxima. Resource fractions are aggregated before the reservation rounds upwards. The caller must derive and enforce these bounds from the actual execution configuration; a quote hash alone is not spending approval. Approval and the committed reservation belong to the account authority. Unknown resource bounds, unbounded repetitions, oversized plans and unsafe accounting amounts are refused.

The implementation is being delivered with the Runtime and Studio pricing-and-metering PRs. The complete approved design and requirement-by-requirement verification record live in Studio's `docs/design/`. Passing the arithmetic suite alone does not establish completion of runtime enforcement or account-service integration.
