import { describe, expect, it } from 'vitest';

import {
  answered,
  answererId,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';
import { flatReplies, threadNamingNoMessageReplies, timedReplies } from '../testing/reading-documents.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const flat = { document: threadDocument({ replies: flatReplies }), savedByAnEarlierRelease: true };

async function delivered(playbook: ChatHarness, ...runIds: readonly string[]): Promise<readonly string[]> {
  await Promise.all(runIds.map((runId) => playbook.askInThread(runId)));
  await playbook.performDue(Date.now());
  return playbook.chat.posted().map(({ ts }) => ts);
}

describe('a reply in a conversation with several open requests', () => {
  it('answers the request whose message its thread began with, and none other', async () => {
    const playbook = await chatHarness();
    const [, secondThread] = await delivered(playbook, first, second);
    playbook.chat.reply({ channel, thread: secondThread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect([await playbook.runOf(first), await playbook.runOf(second)]).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });

  it('is refused as ambiguous on the newest when it names no message, and the party told to reply to one', async () => {
    const playbook = await chatHarness(flat);
    await delivered(playbook, first, second);
    playbook.chat.reply({ channel, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'ambiguous', told: true } },
    ]);
    expect(playbook.chat.posted().at(-1)?.text).toBe(
      "Two requests are open here, so Auto can't tell which one this answers. Neither was answered. Answer them in Auto, or reply here when one is left.",
    );
  });

  it('answers the one open request of a conversation when it names no message', async () => {
    const playbook = await chatHarness(flat);
    await delivered(playbook, first);
    playbook.chat.reply({ channel, user: answererId, text: 'yes' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect(await playbook.runOf(first)).toMatchObject(answeredWith('approve'));
  });
});

describe('an answer naming no message among several open requests from someone the newest does not wait on', () => {
  it('is passed over where its sender answers another of them, and refused as someone else’s where they answer none', async () => {
    const playbook = await chatHarness(flat);
    await playbook.askInThread(first, 'U0SAM');
    await playbook.askInThread(second);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: 'U0SAM', text: 'approve' });
    playbook.chat.reply({ channel, user: 'U0STRANGER', text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toMatchObject([
      { data: { reply: { sender: 'U0STRANGER' }, because: 'not_the_answerer' } },
    ]);
  });
});

type Order = 'oldest_first' | 'newest_first';

const orders: readonly Order[] = ['oldest_first', 'newest_first'];

const minute = 60_000;

function answeredWith(choice: string) {
  return { output: { status: 'succeeded', output: { choice } } };
}

function listedIn(order: Order, replies = flatReplies): string {
  return threadDocument({
    replies: replies.map((line) => (line === '    order: oldest_first' ? `    order: ${order}` : line)),
  });
}

interface Listing {
  readonly order: Order;
  readonly oldestFirst: readonly (readonly [string, string, string, number?])[];
}

function atOf(writtenMs: number | undefined) {
  return writtenMs === undefined ? {} : { at: writtenMs / 1000 };
}

function readLists(playbook: ChatHarness, { order, oldestFirst }: Listing) {
  const messages = oldestFirst.map(([ts, user, text, at]) => ({ ts, channel, user, text, ...atOf(at) }));
  playbook.chat.answerNext(answered({ messages: order === 'oldest_first' ? messages : messages.toReversed() }));
}

describe('a reply a read lists as older than the message of a request asked after it', () => {
  it.each(orders)(
    'answers none asked after it, so an earlier answer is not taken for a later request, %s',
    async (order) => {
      const playbook = await chatHarness({ document: listedIn(order), savedByAnEarlierRelease: true });
      const [firstMessage = ''] = await delivered(playbook, first);
      const approved = playbook.chat.reply({ channel, user: answererId, text: 'approve' });
      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());
      const [, secondMessage = ''] = await delivered(playbook, second);
      const listing = [
        [firstMessage, 'playbook', 'Please review'],
        [approved, answererId, 'approve'],
        [secondMessage, 'playbook', 'Please review'],
      ] as const;
      readLists(playbook, { order, oldestFirst: listing });

      await playbook.performReads(Date.now() + 2 * farAhead);
      await playbook.performDue(Date.now());

      expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toHaveLength(1);
      expect([await playbook.runOf(first), await playbook.runOf(second)]).toMatchObject([
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'started' } },
      ]);
    },
  );
});

describe('a reply a read lists between the messages of two open requests', () => {
  it.each(orders)('answers the open request asked before it, though its time is after both, %s', async (order) => {
    const asked = Date.now();
    const playbook = await chatHarness({ document: listedIn(order, timedReplies) });
    const [firstMessage = ''] = await delivered(playbook, first);
    const [, secondMessage = ''] = await delivered(playbook, second);
    const listing = [
      [firstMessage, 'playbook', 'Please review'],
      ['1699.000099', answererId, 'approve', asked + minute],
      [secondMessage, 'playbook', 'Please review'],
    ] as const;
    readLists(playbook, { order, oldestFirst: listing });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toEqual([]);
    expect([await playbook.runOf(first), await playbook.runOf(second)]).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'started' } },
    ]);
  });
});

function fromTheToolsStart(order: Order): string {
  const replies = flatReplies
    .filter((line) => !line.startsWith('    oldest:'))
    .map((line) => (line === '    order: oldest_first' ? `    order: ${order}` : line));
  return threadDocument({ replies });
}

const approvedLater = '1699.000099';

describe('a read from the tool’s start whose page does not reach the message of an open request', () => {
  it('passes over every message it lists for that request, listed oldest_first', async () => {
    const playbook = await chatHarness({ document: fromTheToolsStart('oldest_first'), savedByAnEarlierRelease: true });
    const [firstMessage = ''] = await delivered(playbook, first);
    const approved = playbook.chat.reply({ channel, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());
    await delivered(playbook, second);
    const page = [
      [firstMessage, 'playbook', 'Please review'],
      [approved, answererId, 'approve'],
    ] as const;
    readLists(playbook, { order: 'oldest_first', oldestFirst: page });

    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(Date.now());

    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(await playbook.runOf(second)).toMatchObject({ output: { status: 'started' } });
  });

  it('passes over, by its time, a reply written before the request was asked, and takes one written after', async () => {
    const asked = Date.now();
    const playbook = await chatHarness({ document: listedIn('oldest_first', timedReplies) });
    await delivered(playbook, first);
    const page = [
      ['1699.000098', answererId, 'approve', asked - 60 * minute],
      [approvedLater, answererId, 'reject', asked + minute],
    ] as const;
    readLists(playbook, { order: 'oldest_first', oldestFirst: page });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect(await playbook.runOf(first)).toMatchObject(answeredWith('reject'));
  });
});

const offeredShapes = [
  {
    shape: 'a read from the tool’s start, listed newest_first, whose page does not reach that message',
    document: fromTheToolsStart('newest_first'),
    order: 'newest_first',
  },
  {
    shape: 'a read from the tool’s start that lists no request’s message, as of the item a request created',
    document: fromTheToolsStart('oldest_first'),
    order: 'oldest_first',
  },
  {
    shape: 'a thread’s read that lists its replies without the message the thread began with',
    document: threadDocument({ replies: threadNamingNoMessageReplies }),
    order: 'oldest_first',
  },
] as const;

describe('a reply written after the request’s message, where the read does not list that message', () => {
  it.each(offeredShapes)('is offered to the request, in $shape', async ({ document, order }) => {
    const playbook = await chatHarness({ document, savedByAnEarlierRelease: true });
    await delivered(playbook, first);
    readLists(playbook, { order, oldestFirst: [[approvedLater, answererId, 'approve']] });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect(await playbook.runOf(first)).toMatchObject(answeredWith('approve'));
  });
});

function readAgain(playbook: ChatHarness, thread: string, ts: string, text: string) {
  playbook.chat.answerNext(answered({ messages: [{ ts, user: answererId, text, thread_ts: thread }] }));
}

describe('a reply the playbook has already met', () => {
  it('takes the first answer of a read, and a second reply with other words takes nothing', async () => {
    const playbook = await chatHarness();
    const [thread] = await delivered(playbook, first);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    playbook.chat.reply({ channel, thread, user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect((await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).map(({ type }) => type)).toEqual([
      'request_answered',
    ]);
    expect(await playbook.runOf(first)).toMatchObject({ output: { output: { choice: 'approve' } } });
  });

  it('refuses a reply read twice once, and tells the party once', async () => {
    const playbook = await chatHarness();
    const [thread = ''] = await delivered(playbook, first);
    const maybe = playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });
    await playbook.performReads(Date.now() + farAhead);
    readAgain(playbook, thread, maybe, 'maybe');

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toHaveLength(1);
    expect(playbook.chat.posted()).toHaveLength(2);
    expect(playbook.chat.calls().map(({ reference }) => reference.tool)).toEqual([
      'post_message',
      'thread_replies',
      'post_message',
      'thread_replies',
    ]);
  });

  it('takes nothing for a request whose run is being cancelled', async () => {
    const playbook = await chatHarness();
    const [thread] = await delivered(playbook, first);
    await playbook.cancel(first);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'cancelling' });
    expect(playbook.chat.calls().map(({ reference }) => reference.tool)).toEqual(['post_message']);
  });
});
