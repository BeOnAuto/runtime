import type { HostDatabase } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { seriesWindow, type WindowRefused } from '../window/series-window.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const askedAt = Date.parse('2026-10-12T09:00:00.000Z');

export function questionRefusedOn(
  database: Pick<HostDatabase, 'readConsistently'>,
  document: PredictionFunctionDefinitionDocument,
): Promise<WindowRefused> {
  return Effect.runPromise(
    Effect.flip(seriesWindow(database, { playbook: alpha, document, series: 'north', now: askedAt })),
  );
}
