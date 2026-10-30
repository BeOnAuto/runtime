import type { AppRuntime } from '@on.auto/api';
import {
  LedgerChores,
  LedgerConnection,
  LedgerFactsRefused,
  LedgerLayoutRefused,
  type AppendObserver,
  type AppendSignal,
  type ConnectionPorts,
  type FactSchemaRead,
  type LayoutStep,
  type LedgerServices,
} from '@on.auto/ledger';
import type { ContentStore, KeyedProjection, RunOutcomeMapping } from '@on.auto/operations';
import type { SecretRows } from '@on.auto/secrets';
import { choreWork, type DueWork } from '@on.auto/workflow-host';
import { Cause, Effect, Layer, type Context } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { ledgerOfAnotherVersion } from './ledger-of-another-version.ts';
import { ledgerOfUnknownFacts } from './ledger-of-unknown-facts.ts';

interface KeptByTheLedger {
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly layoutSteps?: readonly LayoutStep[];
  readonly factSchemas?: readonly FactSchemaRead[];
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

function refusalExplained(failure: unknown, settings: Pick<Settings, 'ledger' | 'distribution'>): Error | undefined {
  if (failure instanceof LedgerLayoutRefused) {
    return ledgerOfAnotherVersion(failure, settings);
  }
  return failure instanceof LedgerFactsRefused ? ledgerOfUnknownFacts(failure, settings) : undefined;
}

export function withARefusedLayoutExplained<Services>(
  ledgerLayer: Layer.Layer<Services>,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): Layer.Layer<Services> {
  return Layer.catchCause(ledgerLayer, (cause) => {
    const explained = refusalExplained(Cause.squash(cause), settings);
    const refused: Effect.Effect<Context.Context<Services>> =
      explained === undefined ? Effect.failCause(cause) : Effect.die(explained);
    return Layer.effectContext(refused);
  });
}

export function ledgerConnectionIn(runtime: AppRuntime<LedgerConnection>): Promise<ConnectionPorts> {
  return Effect.runPromise(inRuntime(runtime, Effect.service(LedgerConnection)));
}

export interface Served {
  readonly stopWork: () => Promise<void>;
}

export async function withHeldRequestsEndedFirst<Serving extends Served>(
  runtime: AppRuntime<LedgerChores>,
  serving: Serving,
): Promise<Serving> {
  const { endWaits } = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerChores)));
  return {
    ...serving,
    stopWork: async () => {
      await Effect.runPromise(endWaits);
      await serving.stopWork();
    },
  };
}

export async function orphansSweptIn(runtime: AppRuntime<LedgerChores>): Promise<DueWork> {
  const { sweepOrphans } = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerChores)));
  return choreWork({ name: 'orphaned content', perform: sweepOrphans });
}
