import type { FinishesLater, RunContext, Standing, StandingRequest } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import type { QueuedStartReads, StartAnswer, WorkflowHost } from '@on.auto/workflow-host';
import { Effect, Random, type Schema } from 'effect';

import type { WorkflowDefinitionDocument } from '../document/workflow-document.ts';
import { longestCallsOf, resumesAfterCallsOf } from './call-limits.ts';
import { unavailableUnless } from './host-refusals.ts';
import type { RunAttributes } from './run-attributes.ts';

export interface WorkflowStarts {
  readonly runs: Pick<WorkflowHost, 'start'>;
  readonly queued: Pick<QueuedStartReads, 'queuedStartsOf'>;
  readonly mostDurationMs: number;
  readonly longestCallMs: number;
}

const ranBefore =
  'This run ID already ran its workflow, which ended; a workflow runs once for a run ID, so use a new run ID to run it again';

const notNow = 'The workflow cannot start now; try again shortly';

const mostSeed = 2_147_483_647;

export function queuedStandingOf(
  { queued }: Pick<WorkflowStarts, 'queued'>,
  triggersOf: (request: StandingRequest) => Effect.Effect<readonly Schema.JsonObject[] | undefined>,
): Standing {
  return (request) =>
    Effect.zipWith(
      queued.queuedStartsOf({ org: request.org, definition: request.definition }),
      triggersOf(request),
      ({ queued: count, nextDueAt }, triggers) => ({
        queued: count,
        next_queued_start: nextDueAt === null ? null : new Date(nextDueAt).toISOString(),
        ...(triggers === undefined ? {} : { triggers }),
      }),
    );
}

function finishedLaterOr(answer: StartAnswer): Effect.Effect<FinishesLater, Conflict> {
  return answer === 'settled'
    ? Effect.fail(new Conflict({ detail: ranBefore, kind: 'unworkable' }))
    : Effect.succeed({ finishesLater: true, record: {} });
}

export function started(
  { runs, mostDurationMs, longestCallMs }: WorkflowStarts,
  document: WorkflowDefinitionDocument,
  input: Schema.Json,
  run: RunContext,
): Effect.Effect<FinishesLater, Conflict | Unavailable> {
  const { id, org, playbook, caller, definition, lineage, depth, callDepth, calledBy, trigger, actsFor } = run;
  return Effect.gen(function* () {
    const seed = yield* Random.nextIntBetween(0, mostSeed);
    const resumesAfterMsByTask = yield* resumesAfterCallsOf(document, run);
    const attributes: RunAttributes = {
      org,
      playbook,
      run_id: id,
      definition: { name: definition.name, version: definition.version },
      caller,
      depth,
      call_depth: callDepth,
      ...(calledBy === undefined ? {} : { called_by: calledBy }),
      ...(trigger === undefined ? {} : { trigger }),
      ...(actsFor === undefined ? {} : { acts_for: actsFor }),
      lineage: { start: lineage.startId, correlation: lineage.correlationId },
      ...(Object.keys(resumesAfterMsByTask).length === 0 ? {} : { resumes_after_ms_by_task: resumesAfterMsByTask }),
    };
    const longestCallMsByTask = yield* longestCallsOf(document, run);
    const limits = { mostDurationMs, longestCallMs, longestCallMsByTask };
    const answer = yield* runs
      .start({ org, playbook, definition: definition.id, runId: id }, { document, input, limits, attributes, seed })
      .pipe(Effect.mapError(unavailableUnless(notNow)));
    return yield* finishedLaterOr(answer);
  });
}
