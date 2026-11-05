import { Effect, type Schema } from 'effect';

import { defineCapability, outputInWords, type Capability } from '../../index.ts';
import { quietMs } from './resumer.ts';

export interface WaiterOptions {
  readonly waits?: number;
  readonly expiresAt?: string;
}

export const waitedFor = 'person:user_7kLm2';

function waitersRequest(expiresAt: string): Schema.JsonObject {
  return {
    to: waitedFor,
    answerer: waitedFor,
    message: 'Approve paying for order A-17?',
    answer_schema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
    expires_at: expiresAt,
    requested_at: '2026-10-01T09:00:00.000Z',
    approval: { server: 'shop', tool: 'pay', action: 'Pay for order A-17' },
  };
}

export function waiter({ waits = 1, expiresAt = '2026-10-01T09:10:00.000Z' }: WaiterOptions = {}): Capability {
  return defineCapability({
    type: 'waiter',
    title: 'Waiter',
    guide: { name: 'waiter' },
    noun: { one: 'waiter', other: 'waiters' },
    describeOutput: outputInWords('result'),
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ source }),
    summarize: () => ({}),
    resumes: { afterMs: () => quietMs, cancelledAttempt: () => ({ ends: [] }) },
    run: (_parsed, _input, { caller, journal, actsFor = null }) => {
      const { requests = 0, request, waitedMs = 0 } = journal.attempt;
      const answer = request?.answer?.answer ?? null;
      return Effect.succeed(
        requests < waits
          ? { finishesLater: true as const, record: waitersRequest(expiresAt) }
          : { output: { answer, waited_ms: waitedMs, requests, by: caller.id, acts_for: actsFor }, record: {} },
      );
    },
  });
}
