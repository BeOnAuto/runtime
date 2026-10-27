# @on.auto/metering

The credit arithmetic and admission contracts shared by Cloud and customer-hosted Auto Runtime. A credit is one million integer microcredits. Provider amounts retain decimal precision until the approved tariff converts them; reservations round upward and settlements round once to the nearest microcredit, with ties to even.

This package owns execution identities and accounting rules. Customer accounts, payments, private signing keys, and credit issuance belong to the Studio account service. Customer-funded model and compute resources do not incur an Auto resource surcharge.

The implementation is being delivered with the Runtime and Studio pricing-and-metering PRs. The complete approved design and requirement-by-requirement verification record live in Studio's `docs/design/`. Passing the arithmetic suite alone does not establish completion of runtime enforcement or account-service integration.
