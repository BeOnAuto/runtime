import {
  attemptEnded,
  LiveAttempts,
  nextAttemptOf,
  nextAttemptRefused,
  RunDetailSchema,
  RunIdInputField,
  type Capability,
  type RunDetail,
} from '@on.auto/definitions';
import { attemptKeyOf } from '@on.auto/definitions/attempts';
import { defineCommand, NotFound, PlaybookContext } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

const reasons = ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'] as const;

type Attempts = LiveAttempts['Service'];

type HeldBy = 'attempt' | 'outliving';

const heldIn = Effect.fnUntraced(function* <E extends Effect.Error<Parameters<Attempts['attempt']>[1]>, R>(
  id: string,
  held: HeldBy,
  attempt: Effect.Effect<RunDetail, E, R>,
) {
  const live = yield* Effect.serviceOption(LiveAttempts);
  if (Option.isNone(live)) {
    return yield* attempt;
  }
  return yield* live.value[held](attemptKeyOf(yield* PlaybookContext, id), attempt);
});

function capabilityOf(capabilities: readonly Capability[], type: string) {
  const capability = capabilities.find((served) => served.type === type);
  return capability === undefined
    ? Effect.fail(new NotFound({ detail: `This server runs no definition of the type ${type}` }))
    : Effect.succeed(capability);
}

export function defineNextAttempt(capabilities: readonly Capability[]) {
  return defineCommand('playbook', {
    name: 'make_next_attempt',
    title: 'Make next attempt',
    description:
      'Makes the next attempt of a started run whose attempt before it died, from its facts, or answers the run as it stands.',
    route: { method: 'POST', path: '/runs/{run_id}/next-attempt' },
    permittedBy: ['playbook:write', 'playbook:run'],
    inputSchema: Schema.Struct({ type: Schema.String, run_id: RunIdInputField }),
    outputSchema: RunDetailSchema,
    reasons,
    handle: Effect.fnUntraced(function* ({ type, run_id: id }) {
      const capability = yield* capabilityOf(capabilities, type);
      const next = Effect.flatMap(nextAttemptOf(capabilities, capability, id), (made) =>
        made.type === 'answered'
          ? Effect.succeed(made.answer)
          : attemptEnded(made.attempt, made.attempt.run.prepared.run(made.attempt.input, made.attempt.context)),
      );
      return yield* heldIn(id, 'outliving', next);
    }),
  });
}

export function defineRefusedAttempt(capabilities: readonly Capability[]) {
  return defineCommand('playbook', {
    name: 'refuse_next_attempt',
    title: 'Refuse next attempt',
    description:
      'Ends a started run whose attempt before it died with the refusal its next attempt met, or answers the run as it stands.',
    route: { method: 'POST', path: '/runs/{run_id}/refused-attempt' },
    permittedBy: ['playbook:write', 'playbook:run'],
    inputSchema: Schema.Struct({ type: Schema.String, run_id: RunIdInputField, detail: Schema.String }),
    outputSchema: RunDetailSchema,
    reasons,
    handle: Effect.fnUntraced(function* ({ type, run_id: id, detail }) {
      const capability = yield* capabilityOf(capabilities, type);
      const refused = nextAttemptRefused(capabilities, capability, id, { detail });
      return yield* heldIn(id, 'attempt', refused);
    }),
  });
}
