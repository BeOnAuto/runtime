# Durable meter

`@on.auto/meter` stores the self-hosted installation identity beside Runtime's ledger. It builds on the pure credit, tariff, license and offline-report contracts in `@on.auto/metering`.

`openInstallation` receives the existing `LedgerConnection` and encrypted `SecretStore`. The database holds one cluster identity and a secret reference; the Ed25519 private key remains in the configured secret keeper. Replicas using the same PostgreSQL database and secret custody share the identity. SQLite retains it across process restarts. A missing or mismatched private key refuses signing instead of silently issuing another identity.

Concurrent initialization chooses one durable identity. Losing candidates delete only their own unused secrets after the stored winner proves which key is in use. A lost acknowledgement is recovered from the database; an uncertain outcome retains its candidate key for recovery.

The returned signer produces installation challenge proofs and cumulative usage-report signatures with separate protocol types. Its public metadata contains no private key or secret reference. Opening an identity does not activate a license, grant credits or authorize a run.

Tests exercise encrypted secret storage and real SQLite and PostgreSQL transactions. Set `LEDGER_TEST_POSTGRESQL_URL` to a disposable local PostgreSQL server to run the latter tests. No account service or production credentials are used.
