import type { ContentStore } from '@on.auto/content';
import { runOutcomeMapping, type DeclaredFact } from '@on.auto/definitions';
import { ledgerLayoutSteps, type AppendSignal, type LayoutStep, type LedgerServices } from '@on.auto/ledger';
import { predictionLayoutSteps } from '@on.auto/prediction';
import { hostLayoutSteps } from '@on.auto/workflow-host';
import { Effect, Layer } from 'effect';

import type { LedgerDatabase } from '../database/ledger-database.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';
import { keptProjections } from './kept-projections.ts';
import { factSchemasKnownWith } from './known-facts.ts';

export const layoutSteps: readonly LayoutStep[] = [
  ...ledgerLayoutSteps,
  ...hostLayoutSteps,
  ...predictionLayoutSteps,
].toSorted((one, other) => one.layout - other.layout);

interface LedgerOpening {
  readonly declared?: readonly DeclaredFact[];
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export function ledgerLayerOf(
  database: LedgerDatabase,
  { declared = [], appends, content }: LedgerOpening = {},
): Layer.Layer<LedgerServices> {
  return database.ledgerLayer({
    runOutcomes: runOutcomeMapping,
    projections: keptProjections,
    layoutSteps,
    factSchemas: factSchemasKnownWith(declared),
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
  });
}

interface LedgerOpeningOfTheServer {
  readonly declared: readonly DeclaredFact[];
  readonly appends?: AppendSignal;
}

export function ledgerLayerFor(
  settings: ContentStoreSettings,
  database: LedgerDatabase,
  opening: LedgerOpeningOfTheServer,
): Layer.Layer<LedgerServices> {
  const composing = contentStoreOf(settings);
  return composing === undefined
    ? ledgerLayerOf(database, opening)
    : Layer.unwrap(
        Effect.flatMap(composing, ({ reached, store }) =>
          Effect.as(reached, ledgerLayerOf(database, { ...opening, content: store })),
        ),
      );
}
