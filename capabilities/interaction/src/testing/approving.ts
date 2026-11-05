import { defineCapability, outputInWords, type Capability, type RequestRecord } from '@on.auto/definitions';
import { Effect } from 'effect';

export const approvalAsked: RequestRecord = {
  to: 'person:user_7kLm2',
  answerer: 'person:user_7kLm2',
  message: 'Approve paying for order A-17?',
  answer_schema: {
    type: 'object',
    properties: { approved: { type: 'boolean' }, reason: { type: 'string' } },
    required: ['approved'],
    additionalProperties: false,
  },
  expires_at: '2099-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
  approval: { server: 'shop', tool: 'pay', action: 'Pay for order A-17', site: 'shop.example', kind: 'pay' },
};

export const approving: Capability = defineCapability({
  type: 'approving',
  title: 'Approving',
  guide: { name: 'approving' },
  noun: { one: 'approving run', other: 'approving runs' },
  describeOutput: outputInWords('answer'),
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  resumes: { afterMs: () => 60_000, cancelledAttempt: () => ({ ends: [] }) },
  run: (expiresAt, _input, { journal }) => {
    const { requests = 0, request } = journal.attempt;
    return Effect.succeed(
      requests === 0
        ? { finishesLater: true as const, record: { ...approvalAsked, expires_at: expiresAt } }
        : { output: { answer: request?.answer?.answer ?? null }, record: {} },
    );
  },
});
