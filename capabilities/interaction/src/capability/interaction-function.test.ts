import { makeDefinitionPresenters } from '@on.auto/definitions';
import { onTheStandingClock } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  approvalDocument,
  chatDelivery,
  fakeTools,
  interactionHarness,
  notificationDocument,
  threadDocument,
} from '../testing/index.ts';
import { flatReplies, timedReplies, wholeAnswerReplies } from '../testing/reading-documents.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';

describe('the interaction capability', () => {
  it('prepares a question to finish later within its expiry, and a notification an earlier release saved without deliver to finish at once', () => {
    const { capability } = interactionHarness();
    const input = { campaign: 'Spring', owner: 'ada' };
    const prepared = [approvalDocument(), notificationDocument([]), notificationDocument(chatDelivery)].map(
      (document) => Effect.runSync(onTheStandingClock(capability.prepare(document))),
    );

    expect(prepared).toMatchObject([
      { whenCancelled: 'finish', summary: { details: { expires: 'P2D' } } },
      {},
      { summary: { details: { expires: 'PT1H', deliver: { server: 'chat', tool: 'post_message' } } } },
    ]);
    expect(
      prepared.map(({ finishesLaterFor, longestRunMsFor }) => [finishesLaterFor(input), longestRunMsFor(input)]),
    ).toEqual([
      [true, 172_800_000],
      [false, 3_600_000],
      [true, 3_600_000],
    ]);
  });

  it('reaches outside and may change it only once the server offers a tool server', () => {
    const offline = interactionHarness().capability;
    const online = interactionHarness({ tools: fakeTools() }).capability;

    expect([offline.reachesOutside, offline.mayChangeOutside, online.reachesOutside, online.mayChangeOutside]).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('refuses a document it cannot read, counting its problems', () => {
    const { capability } = interactionHarness();

    expect([
      Effect.runSync(onTheStandingClock(Effect.flip(capability.prepare("---\nto: 'x'\n---\n")))).detail,
      Effect.runSync(onTheStandingClock(Effect.flip(capability.prepare('Hello')))).detail,
    ]).toEqual([
      'The interaction function definition has 2 problems',
      'The interaction function definition has a problem',
    ]);
  });
});

describe('the words of an interaction run', () => {
  it('show a request as waiting for an answer, and a notification as waiting to be delivered, without its message', () => {
    expect([
      interactionRunWords.deferral({
        to: 'ada',
        message: 'Approve?',
        answer_schema: {},
        expires_at: '2026-10-09T09:00:00.000Z',
        requested_at: '2026-10-07T09:00:00.000Z',
      }),
      interactionRunWords.deferral({
        to: 'a'.repeat(300),
        message: 'Out',
        expires_at: '2026-10-09T09:00:00.000Z',
        requested_at: '2026-10-07T09:00:00.000Z',
        deliver: { server: 'chat', tool: 'post_message', with: {} },
      }),
      interactionRunWords.deferral({ run: 'not a request' }),
    ]).toEqual([
      {
        summary: 'A request is waiting for an answer, held for an agent, until 2026-10-09T09:00:00.000Z.',
        data: {
          delivery: null,
          to: 'ada',
          message_bytes: 8,
          takes_answer: true,
          expires_at: '2026-10-09T09:00:00.000Z',
        },
      },
      {
        summary:
          'A notification is waiting to be delivered, through the post message tool of chat, until 2026-10-09T09:00:00.000Z.',
        data: {
          delivery: { server: 'chat', tool: 'post_message' },
          to: 'a'.repeat(256),
          message_bytes: 3,
          takes_answer: false,
          expires_at: '2026-10-09T09:00:00.000Z',
        },
      },
      undefined,
    ]);
    expect(interactionRunWords.deferralType).toBe('interaction_requested');
  });
});

describe('the words of a request answered by reply', () => {
  it('name its answerer where it is not the party the request goes to', () => {
    expect(
      interactionRunWords.deferral({
        to: '#approvals-sales',
        message: 'Approve?',
        answer_schema: {},
        answerer: 'U024BE7LH',
        expires_at: '2026-10-09T09:00:00.000Z',
        requested_at: '2026-10-07T09:00:00.000Z',
      }),
    ).toMatchObject({
      summary:
        'A request is waiting for an answer, held for an agent, until 2026-10-09T09:00:00.000Z; a reply counts from its answerer alone.',
      data: { to: '#approvals-sales', answerer: 'U024BE7LH' },
    });
    expect(
      interactionRunWords.deferral({
        to: 'ada',
        message: 'Approve?',
        answer_schema: {},
        answerer: 'ada',
        expires_at: '2026-10-09T09:00:00.000Z',
        requested_at: '2026-10-07T09:00:00.000Z',
      })?.data,
    ).not.toHaveProperty('answerer');
  });
});

describe('the words of an answer', () => {
  it('say that a notification was delivered, read from the record of its request or of its delivery, and give the answer of a run settled from its answer, whose record is empty', () => {
    const notified = {
      to: 'ada',
      message: 'Shipped',
      expires_at: '2026-10-09T09:00:00.000Z',
      requested_at: '2026-10-07T09:00:00.000Z',
    };

    expect([
      describeAnswer({}, notified),
      describeAnswer({}, { delivered_at: '2026-10-07T09:00:01.000Z' }),
      describeAnswer({}, { ...notified, answer_schema: {} }),
      describeAnswer({}, {}),
    ]).toEqual([
      'It delivered its notification.',
      'It delivered its notification.',
      'Its answer: nothing.',
      'Its answer: nothing.',
    ]);
  });

  it('say what the answer was', () => {
    expect([describeAnswer({ choice: 'approve' }), describeAnswer('x'.repeat(5000)), describeAnswer([])]).toEqual([
      expect.stringContaining('Its answer:'),
      'Its answer is too long to repeat here; the whole of it is in the details below.',
      expect.stringContaining('Its answer'),
    ]);
  });

  it('name the deferral in the history by the type the playbook reserves for requests', () => {
    const presenters = makeDefinitionPresenters([interactionHarness().capability]);

    expect(presenters[0]?.publicNames['run_deferred']).toEqual(['run_deferred', 'interaction_requested']);
  });
});

interface SavedShape {
  readonly shape: string;
  readonly replies: readonly string[];
}

const atTheMessages: unknown = expect.stringMatching(/^Line \d+, \/replies\/read\/each: /u);

const savedShapes: readonly SavedShape[] = [
  { shape: 'a thread read by sent.id', replies: threadReplies },
  {
    shape: 'a read listed newest_first that names no message',
    replies: flatReplies.map((line) => (line === '    order: oldest_first' ? '    order: newest_first' : line)),
  },
  { shape: 'a read that gives each.time', replies: timedReplies },
  { shape: 'a read of the whole answer that gives each.time', replies: wholeAnswerReplies },
];

describe('a function whose read lists oldest first, names no message of its own and gives no time', () => {
  it('is refused when saved, at replies.read.each', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('approve-plan', threadDocument({ replies: flatReplies }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/source', detail: atTheMessages }],
    });
  });

  it.each(savedShapes)('is saved as $shape', async ({ replies }) => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('approve-plan', threadDocument({ replies }))).toMatchObject({
      status: 'succeeded',
    });
  });
});
