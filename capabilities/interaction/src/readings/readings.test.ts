import type { Ledger } from '@on.auto/operations';
import { mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatProjections } from '../testing/chat-projections.ts';
import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  type ChatHarness,
  type FakeAnswer,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { ledgerHoldingRuns, type HarnessLedger } from '../testing/interaction-harness.ts';
import { flatNamingReplies, flatReplies, wholeAnswerReplies } from '../testing/reading-documents.ts';
import { turnBounds } from './turn-readings.ts';

const answeredFirst = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const askedAfter = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const shapes = [
  { shape: 'whose replies name no message', replies: flatReplies },
  { shape: 'whose replies may name their message in read.each.to', replies: flatNamingReplies },
] as const;

function readingMore(replies: readonly string[]): string {
  return threadDocument({ replies: replies.map((line) => (line === '  read:' ? '    limit: 20\n  read:' : line)) });
}

describe('a conversation whose read names no message, read by another call once an earlier request was answered in it', () => {
  it.each(shapes)(
    'is read on from where the conversation was, $shape, so the reply that answered the earlier request answers no later one',
    async ({ replies }) => {
      const playbook = await chatHarness({ document: threadDocument({ replies }), savedByAnEarlierRelease: true });
      await playbook.defineAsAnEarlierRelease('approve-plan', readingMore(replies));
      await playbook.askInThread(answeredFirst);
      await playbook.performDue(Date.now());
      playbook.chat.reply({ channel, user: answererId, text: 'approve' });
      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());
      await playbook.ask('approve-plan', { team: 'sales', owner: answererId, campaign: 'Autumn' }, askedAfter);
      await playbook.performDue(Date.now());

      await playbook.performReads(Date.now() + 2 * farAhead);
      await playbook.performDue(Date.now());
      const beforeItsReply = await playbook.runOf(askedAfter);
      playbook.chat.reply({ channel, user: answererId, text: 'reject' });
      await playbook.performReads(Date.now() + 3 * farAhead);
      await playbook.performDue(Date.now());

      expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies')).toMatchObject([
        { input: { oldest: '0' } },
        { input: { oldest: '1699.000002', limit: 20 } },
        { input: { oldest: '1699.000002', limit: 20 } },
      ]);
      expect([beforeItsReply, await playbook.runOf(answeredFirst), await playbook.runOf(askedAfter)]).toMatchObject([
        { output: { status: 'started' } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'reject' } } },
      ]);
    },
  );
});

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

function threadsRead(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => [input['ts'], input['oldest']]);
}

const failures: readonly FakeAnswer[] = [
  { outcome: 'timed_out', detail: 'The tool server did not answer within 30000 ms', retryAfterMs: null },
  { outcome: 'server_failure', detail: 'The tool server answered HTTP 429', retryAfterMs: 60_000 },
];

describe('the newer of two threads, once the older request is answered past the newer reply', () => {
  it.each(failures)(
    'is read from its own start, so its earlier approve is taken, after its first read ended $outcome',
    async (failure) => {
      const playbook = await chatHarness({ document: keyedByTheChannel });
      await playbook.askInThread(older);
      await playbook.askInThread(newer);
      await playbook.performDue(Date.now());
      const [olderThread = '', newerThread = ''] = playbook.chat.posted().map(({ ts }) => ts);
      const newerReply = playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });
      const olderReply = playbook.chat.reply({ channel, thread: olderThread, user: answererId, text: 'approve' });
      playbook.chat.answerNext(
        answered({
          messages: [
            { ts: olderThread, channel, user: 'playbook', text: 'ask' },
            { ts: olderReply, channel, user: answererId, text: 'approve', thread_ts: olderThread },
          ],
        }),
        failure,
      );

      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());
      await playbook.performReads(Date.now() + 2 * farAhead);
      await playbook.performDue(Date.now());

      expect(newerReply < olderReply).toBe(true);
      expect(threadsRead(playbook)).toEqual([
        [olderThread, '0'],
        [newerThread, '0'],
        [newerThread, '0'],
      ]);
      expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(2);
      expect([await playbook.runOf(older), await playbook.runOf(newer)]).toMatchObject([
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
      ]);
    },
  );
});

const runOfTheInput = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const readingTheInput = threadDocument({ replies: wholeAnswerReplies });

function readsOf(playbook: ChatHarness) {
  return playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies');
}

function ledgerLosingTheRun(lost: { readonly now: boolean }): HarnessLedger {
  const kept = ledgerHoldingRuns(chatProjections);
  const { holderOfStream } = kept.service;
  const holder: Ledger['Service']['holderOfStream'] = (named) =>
    lost.now && named.stream.endsWith(runOfTheInput) ? Effect.undefined : holderOfStream(named);
  return { ...kept, service: { ...kept.service, holderOfStream: holder } };
}

type ContentStore = 'answering' | 'lost' | 'silent';

function ledgerWhoseContentIs(store: { readonly now: ContentStore }): HarnessLedger {
  const kept = ledgerHoldingRuns(chatProjections);
  const { content } = kept.service;
  const silent = Effect.die(new Error('The store of kept content did not answer'));
  const whenAnswering = <A>(read: Effect.Effect<A>): Effect.Effect<A | undefined> =>
    ({ answering: read, lost: Effect.undefined, silent })[store.now];
  const read: Ledger['Service']['content'] = {
    ...content,
    get: (owner, sha256) => whenAnswering(content.get(owner, sha256)),
    getHead: (owner, sha256) => whenAnswering(content.getHead(owner, sha256)),
  };
  return { ...kept, service: { ...kept.service, content: read } };
}

async function deliveredWithAKeptInput(store: { readonly now: ContentStore }) {
  const playbook = await chatHarness({
    ledger: ledgerWhoseContentIs(store),
    document: readingTheInput,
    payloadOffloading: true,
  });
  await playbook.ask(
    'approve-brief',
    { team: 'sales', owner: answererId, campaign: 'Spring', brief: 'b'.repeat(mostInlinePayloadBytes) },
    runOfTheInput,
  );
  await playbook.performDue(Date.now());
  return playbook;
}

describe('a reading whose arguments read the run’s input, for a request whose run cannot be read', () => {
  it('is recorded not sent', async () => {
    const lost = { now: false };
    const playbook = await chatHarness({ ledger: ledgerLosingTheRun(lost), document: readingTheInput });
    await playbook.askInThread(runOfTheInput);
    await playbook.performDue(Date.now());
    lost.now = true;

    await playbook.performReads(Date.now() + farAhead);

    expect(readsOf(playbook)).toEqual([]);
    expect(await recordsOf(playbook.ledger, 'reading_failed')).toMatchObject([{ data: { because: 'not_sent' } }]);
  });
});

describe('a reading whose arguments read an input its playbook kept outside the run', () => {
  it('is recorded not sent once that input is missing, so the conversation rests and the request waits for answer_interaction', async () => {
    const store: { now: ContentStore } = { now: 'answering' };
    const playbook = await deliveredWithAKeptInput(store);
    store.now = 'lost';

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(readsOf(playbook)).toEqual([]);
    expect((await recordsOf(playbook.ledger, 'reading_failed')).map(({ data }) => data)).toMatchObject([
      { tool: 'thread_replies', because: 'not_sent' },
    ]);
    expect(row?.row).toMatchObject({ open: false, due_at: null });
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered' });
  });

  it('makes no read and records nothing while the store of that input does not answer, and reads once its hold has passed', async () => {
    const store: { now: ContentStore } = { now: 'answering' };
    const playbook = await deliveredWithAKeptInput(store);
    store.now = 'silent';
    const readAt = Date.now() + farAhead;

    await playbook.performReads(readAt);
    const [held] = await conversationRows(playbook.ledger);
    const recorded = await recordsOf(playbook.ledger, 'reading_failed', 'replies_read');
    const readsWhileSilent = readsOf(playbook).length;
    store.now = 'answering';
    playbook.chat.answerNext(answered([]));
    await playbook.performReads(readAt + turnBounds.holdMs);

    expect([held?.row, recorded, readsWhileSilent]).toMatchObject([
      { open: true, reads: 0, next_read_at: readAt + turnBounds.holdMs },
      [],
      0,
    ]);
    expect(readsOf(playbook)).toHaveLength(1);
  });
});

const timedThread = threadDocument({
  replies: threadReplies.map((line) =>
    line === '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }'
      ? '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts, time: /at }'
      : line,
  ),
});

const anyWords: unknown = expect.any(String);

function inTheThread(ts: string, text: string, at: unknown) {
  return { ts, user: answererId, text, thread_ts: '1699.000001', at };
}

async function readOnceInTheThread(...messages: readonly unknown[]) {
  const playbook = await chatHarness({ document: timedThread });
  await playbook.askInThread(runOfTheInput);
  await playbook.performDue(Date.now());
  playbook.chat.answerNext(answered({ messages }));
  await playbook.performReads(Date.now() + farAhead);
  await playbook.performDue(Date.now());
  return playbook;
}

describe('a read whose messages give the time each was written', () => {
  it('fails, taking and refusing nothing, where no message it lists holds a time it can read', async () => {
    const playbook = await readOnceInTheThread(inTheThread('1699.000002', 'approve', 'yesterday'));
    const recorded = await recordsOf(
      playbook.ledger,
      'reading_failed',
      'replies_read',
      'request_answered',
      'reply_refused',
    );

    expect(recorded).toMatchObject([{ type: 'reading_failed', data: { because: 'unreadable', detail: anyWords } }]);
    expect(await playbook.runOf(runOfTheInput)).toMatchObject({ output: { status: 'started' } });
  });

  it('passes over a message whose time it cannot read, and reads on, where another message holds one', async () => {
    const asked = Date.now();
    const playbook = await readOnceInTheThread(
      inTheThread('1699.000002', 'approve', 'yesterday'),
      inTheThread('1699.000003', 'reject', (asked + 60_000) / 1000),
    );

    expect(await recordsOf(playbook.ledger, 'reading_failed')).toEqual([]);
    expect(await playbook.runOf(runOfTheInput)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});
