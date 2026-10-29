import { textToKeep } from '@on.auto/operations';
import { Effect } from 'effect';

import { aMinute, restingUntil, type Performing, type PerformedStep } from '../build-work/build-performing.ts';
import type { ModelOutcome, WalkAnswer } from '../model-processes/model-processes.ts';
import { executed } from '../models/model-commands.ts';
import { executingRuntimeOf } from '../runtimes/model-runtimes.ts';
import { predictionsText } from './shadow-records.ts';
import { shadowRowsOf, type ShadowRows } from './shadow-rows.ts';
import { shadowWalk, type Predicting } from './shadow-walk.ts';

const notExecuted: ModelOutcome<WalkAnswer> = {
  ended: 'crashed',
  detail: 'No model runtime this server has installed executes the format of the version',
  milliseconds: 0,
};

function predictedOn(performing: Performing, predicting: Predicting, rows: ShadowRows): PerformedStep {
  const { ports, build, now } = performing;
  const { org, playbook, id } = build.address;
  const { document, challenger, of, origin } = predicting;
  const executing = executingRuntimeOf(ports.runtimes, { sha256: of.fileSha256, format: of.fileFormat });
  return Effect.gen(function* () {
    const outcome =
      executing === undefined
        ? notExecuted
        : yield* shadowWalk(ports, { org, playbook }, predicting, { executing, rows });
    if (outcome.ended === 'busy' || outcome.ended === 'closing' || outcome.ended === 'cancelled') {
      return yield* restingUntil(performing, now + aMinute);
    }
    const answer = outcome.ended === 'answered' ? outcome.answer : undefined;
    const { text, count, missing } = yield* predictionsText(document, origin, rows, answer);
    const predictions = yield* Effect.orDie(
      ports.ledger.content.put({ org, playbook }, textToKeep(text, 'application/json')),
    );
    return yield* executed(performing, (asked) => ({
      ...asked,
      type: 'predict',
      definitionVersion: challenger.definitionVersion,
      data: {
        version: challenger.version,
        of: of.version,
        build: id,
        runtime: executing === undefined || outcome.ended === 'unlicensed' ? null : { ...executing.named },
        origin: origin.form,
        count,
        missing,
        predictions_sha256: predictions.sha256,
        predictions_bytes: predictions.bytes,
        ...(outcome.ended === 'unlicensed' ? { because: 'feature_unlicensed', feature: outcome.feature } : {}),
      },
    }));
  });
}

export function predicted(performing: Performing, predicting: Predicting): PerformedStep {
  const { ports, build, now } = performing;
  const release = ports.permits.take();
  if (release === null) {
    return restingUntil(performing, now + aMinute);
  }
  const { org, playbook } = build.address;
  return shadowRowsOf(ports, { org, playbook }, predicting.document, predicting.origin.closesAt).pipe(
    Effect.matchEffect({
      onFailure: () => restingUntil(performing, now + aMinute),
      onSuccess: (rows) => predictedOn(performing, predicting, rows),
    }),
    Effect.ensuring(Effect.sync(release)),
  );
}
