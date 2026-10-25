import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { attemptEnded, nextAttemptOf, type Capability } from '../index.ts';
import { modelCallAnswered } from '../journal-testing/model-calls.ts';

const answeredFirstCall = {
  type: 'model_call_answered',
  data: { number: 1, ...modelCallAnswered(0) },
} as const;

export function drivingAShell(capabilities: readonly Capability[], capability: Capability) {
  return defineCommand('playbook', {
    name: 'drive_run',
    title: 'Drive run',
    description: 'Drives the next attempt of a started run as a shell does, from its facts.',
    route: { method: 'POST', path: '/drive' },
    inputSchema: Schema.Struct({ run_id: Schema.String }),
    outputSchema: Schema.Struct({ next: Schema.String, status: Schema.String }),
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: ({ run_id: id }) =>
      Effect.gen(function* () {
        const next = yield* nextAttemptOf(capabilities, capability, id);
        if (next.type === 'answered') {
          return { next: next.type, status: next.answer.status };
        }
        const { journal } = next.attempt.context;
        const ended = yield* attemptEnded(
          next.attempt,
          Effect.as(Effect.orDie(journal.record(answeredFirstCall)), { output: { driven: true }, record: {} }),
        );
        return { next: next.type, status: ended.status };
      }),
  });
}
