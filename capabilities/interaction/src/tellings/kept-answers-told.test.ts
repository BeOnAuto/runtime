import type { RecordWork } from '@on.auto/definitions';
import { onTheStandingClock } from '@on.auto/definitions/testing';
import type { Ledger } from '@on.auto/operations';
import { PayloadOffloading, mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  answererId,
  chatConversations,
  chatHarness,
  chatProjections,
  farAhead,
  longNoteAnswerSchema,
  recordsOf,
  threadDocument,
  threadRepliesTelling,
  type ChatHarness,
  type HarnessLedger,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const channel = '#approvals-sales';

const pastTheBound = mostInlinePayloadBytes + 2;

const bytesOfAnEmptyNote = JSON.stringify({ choice: 'approve', note: '' }).length;

function noteOfBytes(bytes: number): string {
  return 'x'.repeat(bytes - bytesOfAnEmptyNote);
}

function noteDoubledInJsonOfBytes(bytes: number): string {
  return '"'.repeat((bytes - bytesOfAnEmptyNote) / 2);
}

type BucketTrouble = 'down' | 'lost';

function ledgerOverABucket(trouble: ReadonlySet<BucketTrouble>): HarnessLedger {
  const kept = ledgerHoldingRuns(chatProjections);
  const { content } = kept.service;
  const read: Ledger['Service']['content'] = {
    ...content,
    get: (owner, sha256) => {
      if (trouble.has('down')) {
        return Effect.die(new Error('The bucket did not answer'));
      }
      return trouble.has('lost') ? Effect.undefined : content.get(owner, sha256);
    },
    getHead: (owner, sha256) => (trouble.has('lost') ? Effect.undefined : content.getHead(owner, sha256)),
  };
  return { ...kept, service: { ...kept.service, content: read } };
}

function keepingOutside(record: RecordWork): RecordWork {
  return (run, work, lineage, rule) =>
    record(run, work, lineage, rule).pipe(Effect.provideService(PayloadOffloading, true));
}

interface Asking {
  readonly ledger?: HarnessLedger;
  readonly rule?: readonly string[];
}

async function asked({ ledger, rule }: Asking = {}): Promise<{
  readonly playbook: ChatHarness;
  readonly thread: string;
}> {
  const document = threadDocument({
    replies: threadRepliesTelling(),
    answer: longNoteAnswerSchema,
    ...(rule === undefined ? {} : { rule }),
  });
  const playbook = await chatHarness({
    conversations: chatConversations,
    document,
    payloadOffloading: true,
    recording: keepingOutside,
    ...(ledger === undefined ? {} : { ledger }),
  });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

function performedWith(offloading: boolean, playbook: ChatHarness, now: number): Promise<readonly string[]> {
  return Effect.runPromise(
    Effect.flatMap(
      Effect.promise(() => playbook.dueItems(now)),
      (items) =>
        onTheStandingClock(
          Effect.forEach(items, (item) =>
            item.perform(now).pipe(
              Effect.match({
                onFailure: ({ kind = 'none' }: { readonly kind?: string }) => kind,
                onSuccess: () => 'performed',
              }),
              Effect.provideService(PayloadOffloading, offloading),
            ),
          ),
        ),
    ),
  );
}

async function toldTwiceWith(offloading: boolean, playbook: ChatHarness, now: number): Promise<readonly string[]> {
  return [...(await performedWith(offloading, playbook, now)), ...(await performedWith(offloading, playbook, now))];
}

function linesOf(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text, thread_ts: thread }) => [thread, text]);
}

interface Told {
  readonly data: unknown;
  readonly lines: readonly unknown[];
  readonly thread: string;
}

function keepsItInline(data: unknown): boolean {
  return typeof data === 'object' && data !== null && Object.hasOwn(data, 'answer');
}

async function answeredInAutoAndTold(bytes: number, offloading: boolean): Promise<Told> {
  const { playbook, thread } = await asked();
  await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve', note: noteOfBytes(bytes) } });

  await toldTwiceWith(offloading, playbook, Date.now() + farAhead);

  const [answered] = await recordsOf(playbook.ledger, 'request_answered');
  return { data: answered?.data, lines: linesOf(playbook), thread };
}

async function repliedAndTold(bytes: number, offloading: boolean): Promise<Told> {
  const { playbook, thread } = await asked();
  playbook.chat.reply({ channel, thread, user: answererId, text: `approve ${noteDoubledInJsonOfBytes(bytes)}` });
  await playbook.performReads(Date.now() + farAhead);

  await toldTwiceWith(offloading, playbook, Date.now() + farAhead);
  await toldTwiceWith(offloading, playbook, Date.now() + 2 * farAhead);

  const [answered] = await recordsOf(playbook.ledger, 'request_answered');
  return { data: answered?.data, lines: linesOf(playbook), thread };
}

describe('an answer its playbook keeps outside the run, told in the chat', () => {
  it('is told with its words when answered in Auto past 16,384 bytes, with payload offloading on or off as it is told', async () => {
    const told = await Promise.all([
      answeredInAutoAndTold(pastTheBound, true),
      answeredInAutoAndTold(pastTheBound, false),
    ]);

    expect(told).toMatchObject(
      told.map(({ thread }) => ({
        data: { answer_bytes: pastTheBound },
        lines: [[thread, 'Answered in Auto by acme-admin: approve.']],
      })),
    );
    expect(told.map(({ data }) => keepsItInline(data))).toEqual([false, false]);
  });

  it('is told with its words when answered by a reply past 16,384 bytes, with payload offloading on or off as it is told', async () => {
    const told = await Promise.all([repliedAndTold(pastTheBound, true), repliedAndTold(pastTheBound, false)]);

    expect(told).toMatchObject(
      told.map(({ thread }) => ({
        data: { answer_bytes: pastTheBound },
        lines: [[thread, 'Auto recorded your answer: approve.']],
      })),
    );
  });

  it('is not kept at exactly 16,384 bytes, and its line says its words as before', async () => {
    const told = await Promise.all([
      answeredInAutoAndTold(mostInlinePayloadBytes, true),
      repliedAndTold(mostInlinePayloadBytes, true),
    ]);

    expect(told).toMatchObject([
      {
        data: { answer: { choice: 'approve', note: noteOfBytes(mostInlinePayloadBytes) } },
        lines: [[told[0]?.thread, 'Answered in Auto by acme-admin: approve.']],
      },
      {
        data: { answer: { choice: 'approve', note: noteDoubledInJsonOfBytes(mostInlinePayloadBytes) } },
        lines: [[told[1]?.thread, 'Auto recorded your answer: approve.']],
      },
    ]);
  });
});

describe('the telling of an answer kept outside the run', () => {
  it('waits while the answer cannot be read, its row still due, and tells its words once it can', async () => {
    const trouble = new Set<BucketTrouble>();
    const { playbook, thread } = await asked({ ledger: ledgerOverABucket(trouble) });
    await playbook.call(answerInteraction, {
      run_id: runId,
      answer: { choice: 'approve', note: noteOfBytes(pastTheBound) },
    });
    trouble.add('down');

    const whileDown = await toldTwiceWith(true, playbook, Date.now() + farAhead);
    const linesWhileDown = linesOf(playbook);
    trouble.delete('down');
    await toldTwiceWith(true, playbook, Date.now() + 2 * farAhead);

    expect(whileDown.filter((performed) => performed !== 'performed')).toEqual([
      'content_unavailable',
      'content_unavailable',
    ]);
    expect(linesWhileDown).toEqual([]);
    expect(linesOf(playbook)).toEqual([[thread, 'Answered in Auto by acme-admin: approve.']]);
  });

  it('tells the line without words when the answer kept is not in the content', async () => {
    const { playbook, thread } = await asked({ ledger: ledgerOverABucket(new Set(['lost'])) });
    await playbook.call(answerInteraction, {
      run_id: runId,
      answer: { choice: 'approve', note: noteOfBytes(pastTheBound) },
    });

    await toldTwiceWith(true, playbook, Date.now() + farAhead);

    expect(linesOf(playbook)).toEqual([[thread, 'Answered in Auto by acme-admin.']]);
  });

  it('reads no answer where its reply rule takes no word from it, so the line waits on nothing', async () => {
    const trouble = new Set<BucketTrouble>(['down']);
    const { playbook, thread } = await asked({ ledger: ledgerOverABucket(trouble), rule: ['reply:', '  note: text'] });
    await playbook.call(answerInteraction, {
      run_id: runId,
      answer: { choice: 'approve', note: noteOfBytes(pastTheBound) },
    });

    const performed = await toldTwiceWith(true, playbook, Date.now() + farAhead);

    expect(performed.every((outcome) => outcome === 'performed')).toBe(true);
    expect(linesOf(playbook)).toEqual([[thread, 'Answered in Auto by acme-admin.']]);
  });
});
