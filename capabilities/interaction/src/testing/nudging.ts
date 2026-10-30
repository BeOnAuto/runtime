import {
  declaredFact,
  defineCapability,
  outputInWords,
  type Capability,
  type RequestRecord,
} from '@on.auto/definitions';
import { RunContextSchema, factOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

export const nudgedRequest: RequestRecord = {
  to: 'sales',
  message: 'Confirm the forecast?',
  answer_schema: { type: 'object', required: ['confirmed'] },
  expires_at: '2099-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
  deliver: { server: 'chat', tool: 'post_message', with: { channel: '#forecast-{{ to }}', text: '{{ message }}' } },
};

const NudgeSentSchema = factOf('nudge_sent', Schema.Struct({ number: Schema.Int }), RunContextSchema);

export const nudging: Capability = defineCapability({
  type: 'nudging',
  title: 'Nudging',
  guide: { name: 'nudging' },
  noun: { one: 'nudge', other: 'nudges' },
  describeOutput: outputInWords('answer'),
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: (message) => Effect.succeed({ finishesLater: true, record: { ...nudgedRequest, message } }),
  finishesLater: true,
  facts: {
    onRuns: [declaredFact('nudge_sent', NudgeSentSchema, ({ type, data }) => ({ type, summary: 'Nudged.', data }))],
    streams: [],
  },
});
