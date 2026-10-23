import { LedgerLayoutRefused, type AppendObserver, type AppendSignal } from '@on.auto/ledger';
import { Ledger, type ContentStore, type KeyedProjection, type RunOutcomeMapping } from '@on.auto/operations';
import type { SecretRows } from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Cause, Effect, Layer } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { ledgerOfAnotherVersion } from './ledger-of-another-version.ts';

interface KeptByTheLedger {
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export type LedgerDatabase = DatabaseSettings & {
  readonly ledgerLayer: (kept: KeptByTheLedger) => Layer.Layer<Ledger>;
  readonly secretRows: Effect.Effect<SecretRows>;
};

export async function ledgerDatabaseOf(
  { ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>,
  observer?: AppendObserver,
): Promise<LedgerDatabase> {
  if (ledger.store === 'sqlite') {
    const { sqliteLedgerDatabase } = await import('./sqlite-ledger-database.ts');
    return sqliteLedgerDatabase(ledger.file, observer);
  }
  const { postgresqlLedgerDatabaseOf } = await import('./postgresql-ledger-database.ts');
  return postgresqlLedgerDatabaseOf(ledger, proxy, observer);
}

export function withARefusedLayoutExplained(
  ledgerLayer: Layer.Layer<Ledger>,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): Layer.Layer<Ledger> {
  return Layer.catchCause(ledgerLayer, (cause) => {
    const failure = Cause.squash(cause);
    return Layer.effect(
      Ledger,
      failure instanceof LedgerLayoutRefused
        ? Effect.die(ledgerOfAnotherVersion(failure, settings))
        : Effect.failCause(cause),
    );
  });
}
