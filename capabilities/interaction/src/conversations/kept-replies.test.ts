import type { RecordWork } from '@on.auto/definitions';
import { PayloadsOutside } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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
  it('is taken at its first read, recorded inline, while the store of its content takes no value', async () => {
    const kept = memoryLedger(undefined, [openRequests, conversations]);
    const failingPut = { ...kept.service.content, put: () => Effect.die(new Error('The bucket did not answer')) };
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
  });
});
