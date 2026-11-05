import { Caller, CallLineage, Conflict, PlaybookContext, defineCommand } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import { noRunCalled } from '../runs/run-lookup.ts';
import { RunDetailSchema } from '../runs/run.ts';
import { answeredAttempt } from './attempt-endings.ts';
import { RunIdInputField } from './definition-fields.ts';
import { nextAttemptOf } from './next-attempts.ts';
import { loadRun } from './run-access.ts';

const description = [
  'Goes on with a run that waited for its request, once the request was answered or has expired:',
  'makes its next attempt from its facts, as the caller who started the run, or answers the run as it stands.',
].join(' ');

function goesOnWithNoCapabilityOf(type: string): Conflict {
  return new Conflict({ detail: `No capability of this server goes on with a run of the type ${type}` });
}

function wentOn(capabilities: readonly Capability[], capability: Capability, id: string) {
  return Effect.flatMap(nextAttemptOf(capabilities, capability, id), (next) =>
    next.type === 'answered'
      ? Effect.succeed(next.answer)
      : Effect.uninterruptibleMask((restore) => answeredAttempt(next.attempt, restore)),
  );
}

export function defineGoOnWithRun(capabilities: readonly Capability[]) {
  return defineCommand('playbook', {
    name: 'go_on_with_run',
    title: 'Go on with a run',
    description,
    route: { method: 'POST', path: '/runs/{run_id}/go-on' },
    inputSchema: Schema.Struct({ run_id: RunIdInputField }),
    outputSchema: RunDetailSchema,
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: Effect.fnUntraced(function* ({ run_id: id }) {
      const run = yield* loadRun(id);
      if (run === undefined) {
        return yield* noRunCalled(id);
      }
      const capability = capabilities.find(({ type }) => type === run.run.type);
      if (capability === undefined) {
        return yield* goesOnWithNoCapabilityOf(run.run.type);
      }
      const { started_by: startedBy, acts_for: actsFor } = run.run;
      const going = wentOn(capabilities, capability, id).pipe(
        Effect.provideService(Caller, { ...(yield* Caller), id: startedBy.id, name: startedBy.name }),
        Effect.provideService(CallLineage, { ...(yield* CallLineage), actsFor: actsFor ?? null }),
      );
      const live = yield* Effect.serviceOption(LiveAttempts);
      return yield* Option.isNone(live) ? going : live.value.outliving(attemptKeyOf(yield* PlaybookContext, id), going);
    }),
  });
}
