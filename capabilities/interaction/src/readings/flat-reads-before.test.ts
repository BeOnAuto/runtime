import { describe, expect, it } from 'vitest';

import { conversations } from '../conversations/conversation-rows.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  answererId,
  chatHarness,
  farAhead,
  flatReadsNamingReplies,
  keptAsRecorded,
  recordedFlatReadsNamingReplies,
  recordsOf,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';
import { readings } from './reading-rows.ts';

const { answeredOfOneCall, waitingOfOneCall, answeredOfAnother, waitingOfAnother } = flatReadsNamingReplies;

describe('requests main left waiting in channels read flat whose replies may name their message, each after an earlier request was answered there by a plain reply', () => {
  it('are read on from where each conversation was, so the earlier answer answers no later request and the next plain reply does', async () => {
    const recorded = recordedFlatReadsNamingReplies();
    const ledger = ledgerHoldingRuns([openRequests, conversations, readings]);
    await keptAsRecorded(ledger.service, recorded.facts);
    const playbook = await chatHarness({ ledger, inTheChat: recorded.messages });
    const settledAt = recorded.lastAt + 60_000;
    const runsOf = (runIds: readonly string[]) => Promise.all(runIds.map((runId) => playbook.runOf(runId)));

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(settledAt);
    const afterTheFirstRead = await runsOf([waitingOfOneCall, waitingOfAnother]);
    playbook.chat.reply({ channel: '#approvals-finance', user: answererId, text: 'reject' });
    playbook.chat.reply({ channel: '#approvals-hr', user: answererId, text: 'reject' });
    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(settledAt);

    expect(
      playbook.chat
        .calls()
        .filter(({ reference }) => reference.tool === 'thread_replies')
        .map(({ input }) => [input['channel'], input['oldest'], input['limit']]),
    ).toEqual([
      ['#approvals-finance', '1699.000003', undefined],
      ['#approvals-hr', '1699.000004', 20],
      ['#approvals-finance', '1699.000003', undefined],
      ['#approvals-hr', '1699.000004', 20],
    ]);
    expect(afterTheFirstRead).toMatchObject([{ output: { status: 'started' } }, { output: { status: 'started' } }]);
    expect(await runsOf([answeredOfOneCall, waitingOfOneCall, answeredOfAnother, waitingOfAnother])).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
    ]);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(4);
    expect(await recordsOf(playbook.ledger, 'reply_refused')).toEqual([]);
  });
});
