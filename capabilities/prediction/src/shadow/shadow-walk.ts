import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { BuiltVersion } from '../models/model-state.ts';
import type { ExecutingRuntime } from '../runtimes/model-runtimes.ts';
import { remainingOfTheOrigins, scoringGridOf, type ScoringGrid } from '../scoring/scoring-grid.ts';
import { featureNamesOf, givenIndexesOf } from '../scoring/scoring-inputs.ts';
import type { ShadowRows } from './shadow-rows.ts';
import type { ShadowOrigin } from './shadow-schedule.ts';

export interface Predicting {
  readonly document: PredictionFunctionDefinitionDocument;
  readonly challenger: BuiltVersion;
  readonly of: BuiltVersion;
  readonly origin: ShadowOrigin;
}

export function shadowGridOf(document: PredictionFunctionDefinitionDocument, { files }: ShadowRows): ScoringGrid {
  return scoringGridOf(document.predicts, { window: files.window, holdout: 1, firstPeriod: files.firstPeriod });
}

export function shadowWalk(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  { document, of }: Predicting,
  { executing, rows }: { readonly executing: ExecutingRuntime; readonly rows: ShadowRows },
) {
  const grid = shadowGridOf(document, rows);
  return Effect.flatMap(
    ports.caches.models.pathOf(executing.file, () => ports.ledger.content.get(playbook, of.fileSha256)),
    (kept) =>
      ports.models.walk(
        executing.runtime,
        { sha256: of.fileSha256, path: Option.getOrThrow(Option.fromNullishOr(kept)) },
        {
          rows: rows.path,
          window: rows.files.window,
          holdout: 1,
          steps: grid.steps,
          features: featureNamesOf(document).length,
          given: givenIndexesOf(document),
          remaining: remainingOfTheOrigins(grid),
        },
      ),
  );
}
