import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { capturedLogs } from '../read-model-testing/captured-logs.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { createdIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import {
  DefinitionsReadModel,
  definitionsReadModelAt,
  isReadModelStage,
  pathOf,
  readModelStages,
  stagedOver,
  type ReadModelStage,
} from './read-model-stage.ts';
import { stagedVersion } from './staged-versions.ts';

const folding = ['probe', 'workflow'];

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

function putInPlaceByOf(version: number) {
  return stagedVersion('echo', 'greet', version).pipe(
    Effect.map(({ putInPlaceBy }) => putInPlaceBy),
    Effect.catchTag('not_found', () => Effect.succeed('not found')),
  );
}

async function versionsAt(stage: ReadModelStage) {
  const ledger = readModelLedgerOf(['echo']);
  await createdIn(ledger.service, 'greet');
  const logs = capturedLogs();
  const answers = await inThePlaybook(
    ledger,
    Effect.all([putInPlaceByOf(1), putInPlaceByOf(9)]).pipe(
      Effect.provideService(DefinitionsReadModel, stagedOver(stage, ['echo'])),
      Effect.provide(Logger.layer([logs.logger])),
    ),
  );
  return {
    answers,
    outcomes: logs
      .logged()
      .map(({ annotations }) => [annotations['read'], annotations['outcome'] ?? annotations['because']]),
  };
}

describe('a version read to start or resume a run, staged between today and the read model', () => {
  it('is compared while reads are switched, and read from the read model at on, falling back to today on a missing version', async () => {
    const answered = ['person_reader', 'not found'];

    expect([await versionsAt('reads'), await versionsAt('on')]).toEqual([
      {
        answers: answered,
        outcomes: [
          ['version', 'matched'],
          ['version', 'matched'],
        ],
      },
      { answers: answered, outcomes: [['version', 'failed']] },
    ]);
  });
});
