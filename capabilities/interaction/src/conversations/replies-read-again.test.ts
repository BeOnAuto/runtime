import type { RecordWork } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, conversationRows, farAhead, recordsOf } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const notNow = new Unavailable({ detail: 'The answer could not be recorded just now; ask again in a moment' });

function unavailableOnceForAnAnswer(record: RecordWork): RecordWork {
  const refused = { once: false };
  return (run, work, lineage, rule) => {
    const first = work.type === 'answer' && !refused.once;
    refused.once ||= first;
    return first ? Effect.fail(notNow) : record(run, work, lineage, rule);
  };
}

async function repliedTo(recording?: (record: RecordWork) => RecordWork) {
  const playbook = await chatHarness(recording === undefined ? {} : { recording });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [thread] = playbook.chat.posted().map(({ ts }) => ts);
  playbook.chat.reply({
    channel: '#approvals-sales',
    thread,
    user: answererId,
    text: 'Reject, the second point is wrong',
  });
  return playbook;
}

describe('a reply whose answer the run cannot record just now', () => {
  it('is read again at the next read, and taken then, where the read before left its cursor', async () => {
    const playbook = await repliedTo(unavailableOnceForAnAnswer);

    await playbook.performReads(Date.now() + farAhead);
    const answeredFirst = await recordsOf(playbook.ledger, 'request_answered');
    const [afterFirst] = await conversationRows(playbook.ledger);
    await playbook.performReads(Date.now() + 2 * farAhead);

    expect([answeredFirst, afterFirst?.row['since']]).toEqual([[], null]);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'reject' }, reply: { sender: answererId } } },
    ]);
  });

  it('is taken at once where the run records it', async () => {
    const playbook = await repliedTo();

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(1);
  });
});
