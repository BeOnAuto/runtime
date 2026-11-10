import type { RecordWork } from '@on.auto/definitions';
import { PayloadsOutside } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readings } from '../readings/reading-rows.ts';
import { openRequests } from '../requests/open-requests.ts';
import { answererId, chatHarness, farAhead, recordsOf } from '../testing/index.ts';
import { conversations } from './conversation-rows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const note = `the second point is wrong ${'é'.repeat(1500)}`;

function keepingOutside(record: RecordWork): RecordWork {
  return (run, work, lineage, rule) =>
    record(run, work, lineage, rule).pipe(Effect.provideService(PayloadsOutside, true));
}

describe('a long reply, where its playbook keeps large values outside its runs', () => {
  it('is taken at its first read and recorded inline, its store never asked, as an answer of 3 KiB is within what a fact keeps', async () => {
    const kept = memoryLedger(undefined, [openRequests, conversations, readings]);
    const puts: string[] = [];
    const failingPut = {
      ...kept.service.content,
      put: () => {
        puts.push('put');
        return Effect.die(new Error('The bucket did not answer'));
      },
    };
    const ledger = { ...kept, service: { ...kept.service, content: failingPut } };
    const playbook = await chatHarness({ ledger, recording: keepingOutside });
    await playbook.askInThread(runId);
    await playbook.performDue(Date.now());
    const [thread] = playbook.chat.posted().map(({ ts }) => ts);
    playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text: `Reject, ${note}` });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'reject', note }, reply: { sender: answererId } } },
    ]);
    expect(puts).toEqual([]);
  });
});
