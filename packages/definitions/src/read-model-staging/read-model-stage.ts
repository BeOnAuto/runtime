import type { StreamProjection } from '@on.auto/operations';
import { Context, Layer } from 'effect';

import { definitionsReadModel } from '../read-model/definitions-read-model.ts';

export const readModelStages = ['off', 'shadow', 'reads', 'on'] as const;

export type ReadModelStage = (typeof readModelStages)[number];

export interface StagedReadModel {
  readonly stage: ReadModelStage;
  readonly folds: readonly string[];
}

export const DefinitionsReadModel = Context.Reference<StagedReadModel>('@on.auto/definitions/DefinitionsReadModel', {
  defaultValue: () => ({ stage: 'off', folds: [] }),
});

export function stagedOver(stage: ReadModelStage, { streams }: Pick<StreamProjection, 'streams'>): StagedReadModel {
  return { stage, folds: streams };
}

export function definitionsReadModelAt(stage: ReadModelStage): Layer.Layer<never> {
  return Layer.succeed(DefinitionsReadModel, stagedOver(stage, definitionsReadModel));
}

export type StagedReading = 'answers' | 'run_starts';

export type StagedPath = 'today' | 'compared' | 'read_model';

const pathsOf: Readonly<Record<StagedReading, Readonly<Record<ReadModelStage, StagedPath>>>> = {
  answers: { off: 'today', shadow: 'compared', reads: 'read_model', on: 'read_model' },
  run_starts: { off: 'today', shadow: 'compared', reads: 'compared', on: 'read_model' },
};

export function pathOf(
  { stage, folds }: StagedReadModel,
  reading: StagedReading,
  involved: readonly string[],
): StagedPath {
  return involved.every((type) => folds.includes(type)) ? pathsOf[reading][stage] : 'today';
}

export function isReadModelStage(text: string): text is ReadModelStage {
  return readModelStages.some((stage) => stage === text);
}
