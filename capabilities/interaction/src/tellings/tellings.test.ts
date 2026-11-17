import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  chatConversations,
  chatHarness,
  type ChatHarness,
  chatProjections,
  farAhead,
  keptAsRecorded,
  playbookUser,
  recordedTellingsBefore,
  recordsOf,
  tellingsBefore,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';
import { endingWords, isPlacedByTheRequest, namingTheRequest } from './ending-words.ts';
import type { TellingRoute } from './telling-routes.ts';

const { toldBefore, waitingUntold } = tellingsBefore;

const channel = '#approvals-sales';

describe('requests asked before a provider could say how its conversations are replied to', () => {
  it('tell what main told and nothing of a taken reply, though the provider now marks and replies', async () => {
    const recorded = recordedTellingsBefore();
    const ledger = ledgerHoldingRuns(chatProjections);
    await keptAsRecorded(ledger.service, recorded.facts);
    const playbook = await chatHarness({ ledger, inTheChat: recorded.messages, conversations: chatConversations });
    playbook.chat.reply({ channel, thread: '1699.000001', user: playbookUser, text: 'approve' });
    playbook.chat.reply({ channel, thread: '1699.000002', user: playbookUser, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now() + farAhead);

    expect((await recordsOf(playbook.ledger, 'request_answered')).map(({ context }) => context['runId'])).toEqual(
      expect.arrayContaining([toldBefore, waitingUntold]),
    );
    expect(playbook.chat.reactions()).toEqual([]);
    expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'post_message')).toEqual([]);
  });
});

function lineWith(written: Readonly<Record<string, Schema.Json>>): TellingRoute {
  return { when: 'all', line: { tool: 'post', with: { channel: '{{ sent.conversation }}', ...written } } };
}

describe('the words of how a request ended', () => {
  it('are Studio’s, naming who answered in Auto and the words of their answer', () => {
    expect([
      endingWords({ fact: 'f', kind: 'answered', by: 'June Park', words: ['approve'] }),
      endingWords({ fact: 'f', kind: 'answered', by: 'June Park', words: [] }),
      endingWords({ fact: 'f', kind: 'expired' }),
      endingWords({ fact: 'f', kind: 'cancelled' }),
    ]).toEqual([
      'Answered in Auto by June Park: approve.',
      'Answered in Auto by June Park.',
      'Expired unanswered.',
      'Cancelled unanswered.',
    ]);
  });

  it('name the request by the day and time it was sent, in UTC, where the line is not under its message', () => {
    expect(namingTheRequest(Date.parse('2026-11-09T09:00:00.000Z'), 'Expired unanswered.')).toBe(
      'The request sent 9 Nov, 09:00 UTC: Expired unanswered.',
    );
  });
});

describe('a line placed by the request’s message', () => {
  it('reads sent.id in any of its arguments, however deep, and none without a line or that reading', () => {
    expect([
      isPlacedByTheRequest(lineWith({ thread: '{{ reply.to | default: sent.id }}' })),
      isPlacedByTheRequest(lineWith({ body: { reply: ['{{ sent.id }}'] } })),
      isPlacedByTheRequest(lineWith({ body: { text: '{{ message }}', count: 1, empty: null } })),
      isPlacedByTheRequest({ when: 'all' }),
    ]).toEqual([true, true, false, false]);
  });
});

const recorded = recordedTellingsBefore();

async function waitingSinceBefore(): Promise<ChatHarness> {
  const ledger = ledgerHoldingRuns(chatProjections);
  await keptAsRecorded(ledger.service, recorded.facts);
  return chatHarness({ ledger, inTheChat: recorded.messages });
}

function tellingsCalled(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'post_message')
    .map(({ input }) => [input['thread_ts'], input['text']]);
}

describe('a request main told once, in a chat whose connection posts as the person who answers', () => {
  it('reads its telling back once as a reply it refuses untold, since main kept no message of it, and tells it nothing more', async () => {
    const playbook = await waitingSinceBefore();

    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.reply({ channel, thread: '1699.000001', user: playbookUser, text: 'later' });
    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(
      (await recordsOf(playbook.ledger, 'reply_refused')).map(({ data, context }) => [context['runId'], data]),
    ).toMatchObject([
      [toldBefore, { reply: { id: '1699.000003' }, told: true }],
      [toldBefore, { reply: { id: '1699.000004' }, told: false }],
      [toldBefore, { reply: { id: '1699.000005' }, told: false }],
    ]);
    expect(tellingsCalled(playbook)).toEqual([]);
  });

  it('still takes its answer, and the request beside it is told once of a reply that is no answer, which it then knows as its own', async () => {
    const playbook = await waitingSinceBefore();
    playbook.chat.reply({ channel, thread: '1699.000001', user: playbookUser, text: 'approve' });
    playbook.chat.reply({ channel, thread: '1699.000002', user: playbookUser, text: 'later' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(recorded.lastAt + 60_000);

    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { context: { runId: toldBefore }, data: { answer: { choice: 'approve' } } },
    ]);
    expect(
      (await recordsOf(playbook.ledger, 'reply_refused')).map(({ data, context }) => [context['runId'], data]),
    ).toMatchObject([
      [toldBefore, { reply: { id: '1699.000003' }, told: true }],
      [toldBefore, { reply: { id: '1699.000004' }, told: false }],
      [waitingUntold, { reply: { id: '1699.000006' }, told: true }],
    ]);
    expect(tellingsCalled(playbook)).toEqual([
      [
        '1699.000002',
        "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.",
      ],
    ]);
    expect(await playbook.runOf(waitingUntold)).toMatchObject({ output: { status: 'started' } });
  });
});
