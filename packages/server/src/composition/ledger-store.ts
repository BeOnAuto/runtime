import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import type { AppendSignal } from '@on.auto/ledger';
import type { ContentStore, Ledger } from '@on.auto/operations';
import { predictionBuilds, predictionModels } from '@on.auto/prediction';
import { Effect, Layer } from 'effect';

import type { LedgerDatabase } from '../database/ledger-database.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';

const projections = [openRequests, conversations, predictionBuilds, predictionModels];

export function ledgerLayerOf(
  database: LedgerDatabase,
  appends?: AppendSignal,
  content?: ContentStore,
): Layer.Layer<Ledger> {
  return database.ledgerLayer({
    runOutcomes: runOutcomeMapping,
    projections,
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
  });
}

export function ledgerLayerFor(
  settings: ContentStoreSettings,
  database: LedgerDatabase,
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  const composing = contentStoreOf(settings);
  return composing === undefined
    ? ledgerLayerOf(database, appends)
    : Layer.unwrap(
        Effect.flatMap(composing, ({ reached, store }) => Effect.as(reached, ledgerLayerOf(database, appends, store))),
      );
}
