import { describe, expect, it } from 'vitest';

import {
  chatProjections,
  chatHarness,
  farAhead,
  keptAsRecorded,
  playbookUser,
  recordedTellingsBefore,
  recordsOf,
  tellingsBefore,
  type ChatHarness,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';

const { toldBefore, waitingUntold } = tellingsBefore;

const channel = '#approvals-sales';

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
