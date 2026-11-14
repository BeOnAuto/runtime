import type { ContentStore } from '@on.auto/content';
import type { DeclaredFact } from '@on.auto/definitions';
import type { AppendSignal, LedgerServices } from '@on.auto/ledger';
import { Effect, Layer } from 'effect';

import type { LedgerDatabase } from '../database/ledger-database.ts';
import { withItsContentFound } from '../database/ledger-of-content-not-found.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';
import { keptByTheLedgerWith } from './kept-by-the-ledger.ts';

interface LedgerOpening {
  readonly declared?: readonly DeclaredFact[];
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export function ledgerLayerOf(
  database: LedgerDatabase,
  { declared = [], appends, content, mostActiveOf }: LedgerOpening = {},
): Layer.Layer<LedgerServices> {
  return database.ledgerLayer({
    ...keptByTheLedgerWith(declared, mostActiveOf),
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
  });
}

interface LedgerOpeningOfTheServer {
  readonly declared: readonly DeclaredFact[];
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
}

export function ledgerLayerFor(
  settings: ContentStoreSettings & Parameters<typeof withItsContentFound>[1],
  database: LedgerDatabase,
  opening: LedgerOpeningOfTheServer,
): Layer.Layer<LedgerServices> {
  const composing = contentStoreOf(settings);
  return composing === undefined
    ? withItsContentFound(ledgerLayerOf(database, opening), settings)
    : Layer.unwrap(
        Effect.flatMap(composing, ({ reached, store, unreachableBy }) =>
          Effect.as(
            reached,
            withItsContentFound(ledgerLayerOf(database, { ...opening, content: store }), settings, unreachableBy),
          ),
        ),
      );
}
