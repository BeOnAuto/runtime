import { RunContextSchema, changingNothing, factOf, type Presenter } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import {
  playbookOwnNamesOf,
  declaredFact,
  defineCapability,
  definePublishEvent,
  type RequestRecord,
} from '../index.ts';
import { echo } from './capabilities/echo.ts';

const NudgeSentSchema = factOf('nudge_sent', Schema.Struct({ number: Schema.Int }), RunContextSchema);

export const nudgesPresenter: Presenter = {
  streamKind: 'nudges',
  publicNames: { nudge_read: ['nudge_read'] },
  present: ({ type }) => [{ type, summary: 'A nudge was read.', data: {} }],
  changes: changingNothing(['nudge_read']),
};

export const askedRequest: RequestRecord = {
  to: 'ada',
  message: 'Approve the brief?',
  answer_schema: { type: 'object', required: ['choice'] },
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

const isAskedNow = Schema.is(Schema.Struct({ now: Schema.Literal(true) }));

export const answeringNowMs = 10_000;

export const answeringLaterMs = 86_400_000;

export const asking = defineCapability({
  type: 'asking',
  title: 'Asking',
  guide: { name: 'asking' },
  noun: { one: 'question', other: 'questions' },
  describeOutput: () => 'It was answered.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ question: source }),
  summarize: ({ question }) => ({ description: question }),
  run: ({ question }, input) =>
    Effect.succeed(
      isAskedNow(input)
        ? { output: { answered: question }, record: {} }
        : { finishesLater: true, record: { ...askedRequest, message: question } },
    ),
  finishesLater: true,
  finishesLaterFor: (_parsed, input) => !isAskedNow(input),
  longestRunOf: () => answeringLaterMs,
  longestRunFor: (_parsed, input) => (isAskedNow(input) ? answeringNowMs : answeringLaterMs),
  runWords: {
    deferralType: 'asking_requested',
    deferral: () => ({ summary: 'A question waits for its answer.', data: {} }),
  },
  facts: {
    onRuns: [
      declaredFact('nudge_sent', NudgeSentSchema, ({ type, data }) => ({
        type,
        summary: `Nudge ${data.number} was sent.`,
        data,
      })),
    ],
    streams: [nudgesPresenter],
  },
});

const askingPlaybookNames = playbookOwnNamesOf([echo, asking]);

export const publishEventToAskingPlaybook = definePublishEvent(askingPlaybookNames);
