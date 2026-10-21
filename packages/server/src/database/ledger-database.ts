import { LedgerLayoutRefused, type AppendObserver } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Cause, Effect, Layer } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { databasePoolsOf } from './database-pools.ts';
import { ledgerOfAnotherVersion } from './ledger-of-another-version.ts';

export function ledgerDatabaseOf(
  { ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>,
  observer?: AppendObserver,
): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file, observer }
    : { store: 'postgresql', pools: databasePoolsOf(ledger, proxy), observer };
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
