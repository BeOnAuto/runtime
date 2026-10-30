import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { isProjected, type PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import { seriesRowsIn } from '../files/series-rows.ts';
import { seedOf } from './bootstrap.ts';
import type { Scoring } from './candidate-scoring.ts';
import { scoringGridOf, type ScoringGrid } from './scoring-grid.ts';

export interface ScoredBuild {
  readonly document: PredictionFunctionDefinitionDocument;
  readonly assembled: Assembled;
}

export interface ScoringRows {
  readonly path: string;
  readonly scoring: Scoring;
}

export function featureNamesOf({ data }: PredictionFunctionDefinitionDocument): readonly string[] {
  return isProjected(data) ? data.features.map(({ name }) => name) : data.features;
}

export function givenIndexesOf(document: PredictionFunctionDefinitionDocument): readonly number[] {
  const names = featureNamesOf(document);
  return document.data.given.map((name) => names.indexOf(name));
}

export function rowsFileOf(ports: PredictionPorts, playbook: PlaybookAddress, sha256: string): Effect.Effect<string> {
  return Effect.map(
    ports.caches.rows.pathOf(sha256, () => ports.ledger.content.get(playbook, sha256)),
    (path) => Option.getOrThrow(Option.fromNullishOr(path)),
  );
}

function gridOfTheBuild({ predicts }: PredictionFunctionDefinitionDocument, assembled: Assembled): ScoringGrid {
  return scoringGridOf(predicts, {
    window: assembled.window,
    holdout: assembled.holdout,
    firstPeriod: assembled.first_period,
  });
}

export function scoringOf(
  ports: PredictionPorts,
  build: BuildState,
  document: PredictionFunctionDefinitionDocument,
  assembled: Assembled,
): Effect.Effect<ScoringRows> {
  return Effect.gen(function* () {
    const { org, playbook } = build.address;
    const path = yield* rowsFileOf(ports, { org, playbook }, assembled.scoring_sha256);
    const features = featureNamesOf(document).length;
    const rows = yield* ports.caches.parsed.rowsOf(assembled.scoring_sha256, () => seriesRowsIn(path, { features }));
    return {
      path,
      scoring: {
        grid: gridOfTheBuild(document, assembled),
        rows,
        evaluation: document.evaluation,
        seed: seedOf(build.address.id),
      },
    };
  });
}
