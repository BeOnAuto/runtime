import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import {
  DefinitionsReadModel,
  definitionsReadModelAt,
  isReadModelStage,
  pathOf,
  readModelStages,
  stagedOver,
  type ReadModelStage,
} from './read-model-stage.ts';

const folding = definitionsReadModelOf(['probe', 'workflow']);

function pathsAt(stage: ReadModelStage) {
  const staged = stagedOver(stage, folding);
  return [stage, pathOf(staged, 'answers', ['probe']), pathOf(staged, 'run_starts', ['workflow', 'probe'])];
}

describe('the stage of the read model of the definitions', () => {
  it('answers the reads of answers from today, compared, then from the read model, and run starts a stage later', () => {
    expect(readModelStages.map((stage) => pathsAt(stage))).toEqual([
      ['off', 'today', 'today'],
      ['shadow', 'compared', 'compared'],
      ['reads', 'read_model', 'compared'],
      ['on', 'read_model', 'read_model'],
    ]);
  });

  it('answers from today a read that involves a type the composed read model does not fold', () => {
    expect([
      pathOf(stagedOver('on', folding), 'answers', ['probe', 'echo']),
      pathOf({ stage: 'on', folds: [] }, 'run_starts', ['probe']),
    ]).toEqual(['today', 'today']);
  });

  it('is provided at a stage over the read model the composition keeps, which folds every type of definition', async () => {
    const provided = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* DefinitionsReadModel;
      }).pipe(Effect.provide(definitionsReadModelAt('shadow'))),
    );

    expect(provided).toEqual({ stage: 'shadow', folds: definitionTypeOrder });
  });

  it('is one of its four words alone', () => {
    expect(['off', 'shadow', 'reads', 'on', 'Off', 'all', ''].map((text) => isReadModelStage(text))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
