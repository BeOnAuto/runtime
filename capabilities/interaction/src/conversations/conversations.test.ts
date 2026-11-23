import type { RecordWork } from '@on.auto/definitions';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { waitBefore, wokenReadAt } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readings } from '../readings/reading-rows.ts';
import { openRequests } from '../requests/open-requests.ts';
import { answererId, chatHarness, farAhead, ledgerKeepingNames, recordsOf } from '../testing/index.ts';
import { replyWaitMsOf, waitBeforeRead } from './cadence.ts';
import { conversations } from './conversation-rows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const note = `the second point is wrong ${'é'.repeat(1500)}`;

function keepingOutside(record: RecordWork): RecordWork {
  return (run, work, lineage, rule) =>
    record(run, work, lineage, rule).pipe(Effect.provideService(PayloadOffloading, true));
}

describe('a long reply, where its playbook keeps large values outside its runs', () => {
  it('is taken at its first read and recorded inline, its store never asked, as an answer of 3 KiB is within what a fact keeps', async () => {
    const kept = ledgerKeepingNames([openRequests, conversations, readings]);
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

const second = 1000;

const day = 86_400 * second;

function readTimesOf(count: number): readonly number[] {
  const times: number[] = [];
  for (let read = 1; read <= count; read += 1) {
    times.push((times.at(-1) ?? 0) + waitBeforeRead(read));
  }
  return times;
}

const readTimes = readTimesOf(9000);

function readsToFindAnAnswerGivenAt(answeredAt: number): number {
  return readTimes.findIndex((readAt) => readAt >= answeredAt) + 1;
}

function readsWithin(open: number): number {
  return readTimes.filter((readAt) => readAt <= open).length;
}

describe('the cadence of reading a conversation', () => {
  it('reads at five seconds, doubles to forty, reads each minute to the eighteenth read and every five minutes after', () => {
    expect([1, 2, 3, 4, 5, 18, 19, 300].map((read) => waitBeforeRead(read) / second)).toEqual([
      5, 10, 20, 40, 60, 60, 300, 300,
    ]);
  });

  it('costs four reads for an answer within a minute and eighteen within a quarter of an hour, the last at 915 s', () => {
    expect([readsToFindAnAnswerGivenAt(60 * second), readsToFindAnAnswerGivenAt(900 * second)]).toEqual([4, 18]);
    expect(readTimes[17]).toBe(915 * second);
  });

  it('reads 302 times in a day and 8,654 times in thirty days', () => {
    expect([readsWithin(day), readsWithin(30 * day)]).toEqual([302, 8654]);
  });

  it('never waits less than the floor, and as long as a Retry-After asks, an hour at most', () => {
    const waits = [
      waitBefore({ baseMs: waitBeforeRead(1), floorMs: 60 * second, retryAfterMs: null }),
      waitBefore({ baseMs: waitBeforeRead(19), floorMs: 5 * second, retryAfterMs: null }),
      waitBefore({ baseMs: waitBeforeRead(1), floorMs: 5 * second, retryAfterMs: 120 * second }),
      waitBefore({ baseMs: waitBeforeRead(1), floorMs: 5 * second, retryAfterMs: 2 * day }),
    ];

    expect(waits.map((wait) => wait / second)).toEqual([60, 300, 120, 3600]);
  });
});

function dueAt(reads: number, now: number, anchor: number): number {
  return wokenReadAt({ now: now * second, floorMs: 5 * second, reads, anchor: anchor * second }) / second;
}

describe('the read a wake makes due', () => {
  it('comes a floor after the wake where it asks one read, wherever its conversation was last active', () => {
    expect([dueAt(1, 15, 0), dueAt(1, 15, 3), dueAt(1, 15, 7), dueAt(1, 15, 20)]).toEqual([20, 20, 20, 20]);
  });

  it('comes at the end of the window of as many floors as it asks reads, counted from when its conversation was last active, never within a floor of the wake', () => {
    expect([dueAt(3, 15, 0), dueAt(3, 16, 0), dueAt(3, 26, 0), dueAt(3, 15, 5), dueAt(3, 15, 10)]).toEqual([
      30, 30, 31, 20, 25,
    ]);
  });
});

describe('the shortest wait of a reading', () => {
  it('is the wait its replies set, and five seconds when they set none or one that is no duration', () => {
    expect([replyWaitMsOf({ wait: 'PT1M' }), replyWaitMsOf({}), replyWaitMsOf({ wait: 'soon' })]).toEqual([
      60_000, 5000, 5000,
    ]);
  });
});
