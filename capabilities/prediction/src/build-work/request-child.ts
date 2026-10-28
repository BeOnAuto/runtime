import type { RecordedRun } from '@on.auto/definitions';
import { Effect } from 'effect';

import { routesOf } from '../build/build-request.ts';
import type { BuildRecord } from '../builds/build-state.ts';
import { buildAnswerIssues } from '../checks/build-answers.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { TrainerAnswer } from '../scoring/version-card.ts';
import { restingUntil, settledBuild, type Performing } from './build-performing.ts';
import { childRunOf, requestReference, startedChild } from './child-runs.ts';
import { trainerAnswerOf } from './trainer-answers.ts';

function unanswered(performing: Performing, through: string, detail: string, kind: 'expired' | 'undelivered') {
  return settledBuild(performing, {
    status: 'rejected',
    reason: 'unanswered',
    kind,
    detail: `The interaction function ${through} that carries the build to its trainer ended without an answer: ${detail}`,
  });
}

function endedChild(performing: Performing, through: string, { run }: RecordedRun) {
  const { rejection } = run;
  return rejection?.reason === 'unanswered'
    ? unanswered(performing, through, rejection.detail, rejection.kind)
    : unanswered(performing, through, `it ended ${run.status}`, 'undelivered');
}

function requested(performing: Performing, through: string, record: BuildRecord) {
  const { build } = performing;
  return Effect.gen(function* () {
    const started = yield* startedChild(
      performing.runs,
      {
        build: build.address,
        reference: requestReference,
        name: through,
        input: {
          build: {
            run_id: build.address.id,
            function: build.run.run.name,
            brief_sha256: record.build.brief_sha256,
            routes: { ...routesOf(build.address) },
            formats: [...record.build.formats],
            expires_at: record.expires_at,
          },
        },
        lineage: performing.lineage,
      },
      build.run,
    );
    const child = yield* childRunOf(performing.ports.ledger, build.address, requestReference);
    return started.status === 'rejected' && child === undefined
      ? yield* unanswered(performing, through, started.detail, 'undelivered')
      : yield* restingUntil(performing, null);
  });
}

export function throughAChild(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  record: BuildRecord,
  scoring: (answer: TrainerAnswer) => Effect.Effect<void>,
): Effect.Effect<void> {
  const through = String(document.source.through);
  return Effect.flatMap(childRunOf(performing.ports.ledger, performing.build.address, requestReference), (child) => {
    if (child === undefined) {
      return requested(performing, through, record);
    }
    if (child.run.status === 'started') {
      return restingUntil(performing, null);
    }
    if (child.run.status !== 'succeeded' || child.answer === null) {
      return endedChild(performing, through, child);
    }
    const issues = buildAnswerIssues(child.answer.answer, { work: performing.build.run.work });
    return issues.length === 0
      ? scoring(trainerAnswerOf(child.answer))
      : settledBuild(performing, {
          status: 'rejected',
          reason: 'invalid_input',
          detail: `The interaction function ${through} answered what the build cannot take`,
          issues: issues.map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail })),
        });
  });
}
