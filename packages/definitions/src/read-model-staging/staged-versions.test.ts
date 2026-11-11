import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { capturedLogs } from '../read-model-testing/captured-logs.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { createdIn } from '../read-model-testing/read-model-histories.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { DefinitionsReadModel, stagedOver, type ReadModelStage } from './read-model-stage.ts';
import { stagedVersion } from './staged-versions.ts';

const folding = definitionsReadModelOf(['echo']);

function putInPlaceByOf(version: number) {
  return stagedVersion('echo', 'greet', version).pipe(
    Effect.map(({ putInPlaceBy }) => putInPlaceBy),
    Effect.catchTag('not_found', () => Effect.succeed('not found')),
  );
}

async function versionsAt(stage: ReadModelStage) {
  const ledger = memoryLedger(undefined, [folding]);
  await createdIn(ledger.service, 'greet');
  const logs = capturedLogs();
  const answers = await inThePlaybook(
    ledger,
    Effect.all([putInPlaceByOf(1), putInPlaceByOf(9)]).pipe(
      Effect.provideService(DefinitionsReadModel, stagedOver(stage, folding)),
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
