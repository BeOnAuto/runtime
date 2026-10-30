import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import { ledgerLayoutSteps, type AppendSignal, type LayoutStep, type LedgerServices } from '@on.auto/ledger';
import type { ContentStore } from '@on.auto/operations';
import { predictionLayoutSteps } from '@on.auto/prediction';
import { hostLayoutSteps } from '@on.auto/workflow-host';
import { Effect, Layer } from 'effect';

import type { LedgerDatabase } from '../database/ledger-database.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';
import { knownFactSchemas } from './known-facts.ts';

const projections = [openRequests, conversations];

export const layoutSteps: readonly LayoutStep[] = [...ledgerLayoutSteps, ...hostLayoutSteps, ...predictionLayoutSteps];

export function ledgerLayerOf(
  database: LedgerDatabase,
  appends?: AppendSignal,
  content?: ContentStore,
): Layer.Layer<LedgerServices> {
  return database.ledgerLayer({
    runOutcomes: runOutcomeMapping,
    projections,
    layoutSteps,
    factSchemas: knownFactSchemas,
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
  });
}

export function ledgerLayerFor(
  settings: ContentStoreSettings,
  database: LedgerDatabase,
  appends?: AppendSignal,
): Layer.Layer<LedgerServices> {
  const composing = contentStoreOf(settings);
  return composing === undefined
    ? ledgerLayerOf(database, appends)
    : Layer.unwrap(
        Effect.flatMap(composing, ({ reached, store }) => Effect.as(reached, ledgerLayerOf(database, appends, store))),
      );
}
