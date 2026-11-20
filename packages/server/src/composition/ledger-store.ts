import type { AppendObserver, AppendSignal, LedgerServices } from '@on.auto/ledger';
import { authStoreOpened, type AuthStore } from '@on.auto/openid-connect';
import { Effect, Layer } from 'effect';

import { madeAtStart, type MadeAtStart, type StartWiring } from '../capability-registry/made-at-start.ts';
import {
  ledgerConnectionIn,
  ledgerDatabaseOf,
  withARefusedLayoutExplained,
  type LedgerDatabase,
} from '../database/ledger-database.ts';
import { withItsContentFound } from '../database/ledger-of-content-not-found.ts';
import { signInStoreRefusalExplained } from '../database/sign-in-store-of-a-newer-version.ts';
import { admissionIn, type AdmissionOpened } from '../sign-in/admission.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';
import { keptByTheLedgerWith } from './kept-by-the-ledger.ts';

type DeclaredFacts = Parameters<typeof keptByTheLedgerWith>[0];

type KeptByTheLedger = Parameters<LedgerDatabase['ledgerLayer']>[0];

interface LedgerOpening {
  readonly declared?: DeclaredFacts;
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
  readonly content?: KeptByTheLedger['content'];
  readonly floor?: number;
}

export function ledgerLayerOf(
  database: LedgerDatabase,
  { declared = [], appends, content, mostActiveOf, floor }: LedgerOpening = {},
): Layer.Layer<LedgerServices> {
  return database.ledgerLayer({
    ...keptByTheLedgerWith(declared, mostActiveOf),
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
    ...(floor === undefined ? {} : { floor }),
  });
}

interface LedgerOpeningOfTheServer {
  readonly declared: DeclaredFacts;
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
  readonly floor?: number;
}

type LedgerOpeningSettings = ContentStoreSettings &
  Parameters<typeof withItsContentFound>[1] &
  Parameters<typeof withARefusedLayoutExplained>[1];

export function ledgerLayerFor(
  settings: LedgerOpeningSettings,
  database: LedgerDatabase,
  opening: LedgerOpeningOfTheServer,
): Layer.Layer<LedgerServices> {
  const composing = contentStoreOf(settings);
  const opened =
    composing === undefined
      ? withItsContentFound(ledgerLayerOf(database, opening), settings)
      : Layer.unwrap(
          Effect.flatMap(composing, ({ reached, store, unreachableBy }) =>
            Effect.as(
              reached,
              withItsContentFound(ledgerLayerOf(database, { ...opening, content: store }), settings, unreachableBy),
            ),
          ),
        );
  return withARefusedLayoutExplained(opened, settings);
}

export interface LedgerAtStart {
  readonly database: LedgerDatabase;
  readonly made: MadeAtStart;
  readonly ledgerLayer: Layer.Layer<LedgerServices>;
}

interface LedgerWiring extends StartWiring {
  readonly appended?: AppendObserver | undefined;
  readonly appends?: AppendSignal;
  readonly floor?: number;
}

export async function ledgerOpenedAtStart(
  settings: Parameters<typeof madeAtStart>[0],
  { appended, appends, floor, ...wiring }: LedgerWiring,
): Promise<LedgerAtStart> {
  const database = await ledgerDatabaseOf(settings, appended);
  const made = await madeAtStart(settings, wiring);
  const ledgerLayer = ledgerLayerFor(settings, database, {
    declared: made.prediction.provided.capability.facts.onRuns,
    mostActiveOf: made.bounds.mostActiveOf,
    ...(appends === undefined ? {} : { appends }),
    ...(floor === undefined ? {} : { floor }),
  });
  return { database, made, ledgerLayer };
}

export async function signInOpened(
  runtime: Parameters<typeof ledgerConnectionIn>[0] & Parameters<typeof admissionIn>[0],
  settings: Parameters<typeof signInStoreRefusalExplained>[1],
): Promise<AuthStore & AdmissionOpened> {
  try {
    const store = await authStoreOpened(await ledgerConnectionIn(runtime));
    return { ...store, ...admissionIn(runtime) };
  } catch (failure) {
    throw signInStoreRefusalExplained(failure, settings);
  }
}
