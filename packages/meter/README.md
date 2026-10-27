# Durable meter

`@on.auto/meter` stores the self-hosted installation identity beside Runtime's ledger. It builds on the pure credit, tariff, license and offline-report contracts in `@on.auto/metering`.

`openInstallation` receives the existing `LedgerConnection` and encrypted `SecretStore`. The database holds one cluster identity and a secret reference; the Ed25519 private key remains in the configured secret keeper. Replicas using the same PostgreSQL database and secret custody share the identity. SQLite retains it across process restarts. A missing or mismatched private key refuses signing instead of silently issuing another identity.

Concurrent initialization chooses one durable identity. Losing candidates delete only their own unused secrets after the stored winner proves which key is in use. A lost acknowledgement is recovered from the database; an uncertain outcome retains its candidate key for recovery.

The returned signer produces installation challenge proofs and cumulative usage-report signatures with separate protocol types. Its public metadata contains no private key or secret reference. Opening an identity does not activate a license, grant credits or authorize a run.

`openLicenseClock` keeps a shared clock checkpoint and refresh receipts in the same database. It uses PostgreSQL's clock when present and combines elapsed monotonic time, a trusted server-to-wall offset and the persisted highest observed time. A wall-clock rollback, regressed monotonic clock or restart on a non-advancing wall clock requires online repair before new protected work. Ordinary small wall adjustments cannot rewind elapsed time. The clock does not change signed license or allocation deadlines.

Only the trusted license client may call `synchronize` after authenticating a fresh online time response, with the durable identity of that exchange. A new verified response may repair an incorrect host clock. The same receipt can never reset the anchor again, even after later refreshes; altered receipt content is refused. Refresh state and its receipt commit together, and replicas recover lost acknowledgements. The protected client and dispatch wiring remain required; this API is not a customer-controlled clock setting. Software cannot establish elapsed downtime after a complete administrator-controlled machine and clock rollback without an external trust source, so restored allocation histories also require central divergence checks.

Tests exercise encrypted secret storage and real SQLite and PostgreSQL transactions. Set `LEDGER_TEST_POSTGRESQL_URL` to a disposable local PostgreSQL server to run the latter tests. No account service or production credentials are used.
