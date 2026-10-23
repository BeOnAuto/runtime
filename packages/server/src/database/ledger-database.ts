import type { AppRuntime } from '@on.auto/api';
import {
  LedgerChores,
  LedgerConnection,
  LedgerLayoutRefused,
  type AppendObserver,
  type AppendSignal,
  type ConnectionPorts,
  type LedgerServices,
} from '@on.auto/ledger';
import type { ContentStore, KeyedProjection, RunOutcomeMapping } from '@on.auto/operations';
import type { SecretRows } from '@on.auto/secrets';
import { choreWork, type DueWork } from '@on.auto/workflow-host';
import { Cause, Effect, Layer, type Context } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { ledgerOfAnotherVersion } from './ledger-of-another-version.ts';

interface KeptByTheLedger {
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export interface LedgerDatabase {
  readonly ledgerLayer: (kept: KeptByTheLedger) => Layer.Layer<LedgerServices>;
  readonly secretRows: Effect.Effect<SecretRows>;
}

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

export function withARefusedLayoutExplained<Services>(
  ledgerLayer: Layer.Layer<Services>,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): Layer.Layer<Services> {
  return Layer.catchCause(ledgerLayer, (cause) => {
    const failure = Cause.squash(cause);
    const refused: Effect.Effect<Context.Context<Services>> =
      failure instanceof LedgerLayoutRefused
        ? Effect.die(ledgerOfAnotherVersion(failure, settings))
        : Effect.failCause(cause);
    return Layer.effectContext(refused);
  });
}

export function ledgerConnectionIn(runtime: AppRuntime<LedgerConnection>): Promise<ConnectionPorts> {
  return Effect.runPromise(inRuntime(runtime, Effect.service(LedgerConnection)));
}

export async function orphansSweptIn(runtime: AppRuntime<LedgerChores>): Promise<DueWork> {
  const { sweepOrphans } = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerChores)));
  return choreWork({ name: 'orphaned content', perform: sweepOrphans });
}
