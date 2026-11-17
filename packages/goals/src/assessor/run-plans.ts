import { playbookGoalsIn } from '@on.auto/definitions/goals';
import { PlaybookReader, playbookLedgerOf } from '@on.auto/operations';
import { Cause, Context, Effect, Option, Schema } from 'effect';

import { originCounts } from '../chain-origins/chain-origin.ts';
import { chainOriginsOf } from '../chain-origins/chain-origins.ts';
import {
  nothingPlanned,
  observedPlan,
  refusedPlan,
  type PlanParts,
  type PlannedRecord,
  type RunPlan,
} from './planned-runs.ts';
import {
  conditionedOf,
  contributedRunOf,
  extractedOf,
  failedRunOf,
  finishedRunOf,
  goneRefusalsOf,
  knownEntriesOf,
  observedKeysOf,
} from './run-observations.ts';
import { stoppingPlanOf } from './stopped-runs.ts';

const OutputDataSchema = Schema.Struct({
  output: Schema.optionalKey(Schema.Unknown),
  output_sha256: Schema.optionalKey(Schema.String),
  output_bytes: Schema.optionalKey(Schema.Finite),
});

const outputDataOf = Schema.decodeUnknownOption(OutputDataSchema);

function planOf<E>(parts: PlanParts<E>, planned: PlannedRecord) {
  const failed = failedRunOf(planned.record);
  return failed === undefined ? succeededPlanOf(parts, planned) : stoppingPlanOf(parts, planned, failed);
}

function succeededPlanOf<E>(parts: PlanParts<E>, { playbook, playbookKey, record }: PlannedRecord) {
  return Effect.gen(function* () {
    const run = finishedRunOf(record);
    if (run === undefined) {
      return nothingPlanned;
    }
    const ledger = playbookLedgerOf(parts.ledger, playbook);
    const reader = Context.get(ledger, PlaybookReader);
    const contributes = yield* parts.versions.contributesOf(reader, { playbookKey, ...run });
    if (contributes.length === 0) {
      return nothingPlanned;
    }
    const { stream, context, causationId, correlationId } = record;
    const origin = yield* chainOriginsOf(parts.chainsOf(playbook), parts.callers).originOf({
      run: run.run,
      fact: { stream, context, causationId, correlationId },
    });
    if (!originCounts(origin)) {
      return nothingPlanned;
    }
    const standing = yield* Effect.provideContext(playbookGoalsIn, ledger);
    const known = knownEntriesOf(contributes, standing.goals);
    if (known.length === 0) {
      return nothingPlanned;
    }
    const data = Option.getOrElse(outputDataOf(record.data), () => ({}));
    const read = yield* parts.outputsOf(playbook).outputOf({ record: record.id, data });
    const ended = contributedRunOf(record, run, 'gone' in read ? null : read.output);
    const keysOf = observedKeysOf(known, run);
    if ('gone' in read) {
      return refusedPlan(goneRefusalsOf(known, ended), ended.ended_at, keysOf);
    }
    const verdicts = yield* parts.conditions.verdictsOf({
      record: record.id,
      ended_at: ended.ended_at,
      output: ended.output,
      entries: conditionedOf(contributes, known),
    });
    return observedPlan(extractedOf(known, ended, verdicts), {
      goalsVersion: standing.version,
      endedAt: ended.ended_at,
      observedKeysOf: keysOf,
    });
  });
}

export function runPlanOf<E>(parts: PlanParts<E>, record: PlannedRecord): Effect.Effect<RunPlan> {
  return planOf(parts, record).pipe(
    Effect.catchCause((cause: Cause.Cause<unknown>) =>
      Effect.succeed<RunPlan>({ unread: String(Cause.squash(cause)) }),
    ),
  );
}
