import { describe, expect, it } from 'vitest';

import {
  answererId,
  chatConversations,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  threadRepliesTelling,
  type ChatHarness,
  type ChatHarnessOptions,
} from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const channel = '#approvals-sales';

interface Asked {
  readonly playbook: ChatHarness;
  readonly thread: string;
}

async function asked(options: ChatHarnessOptions): Promise<Asked> {
  const playbook = await chatHarness(options);
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

interface Replied extends Asked {
  readonly replies: readonly string[];
}

async function repliedTo(options: ChatHarnessOptions, ...texts: readonly string[]): Promise<Replied> {
  const { playbook, thread } = await asked(options);
  const replies = texts.map((text) => playbook.chat.reply({ channel, thread, user: answererId, text }));
  await playbook.performReads(Date.now() + farAhead);
  await playbook.performDue(Date.now() + farAhead);
  return { playbook, thread, replies };
}

function linesOf(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text, thread_ts: thread }) => [thread, text]);
}

function documentTelling(...tell: readonly string[]): string {
  return threadDocument({ replies: threadRepliesTelling(...tell) });
}

const byTheProvider = { conversations: chatConversations, document: documentTelling() };

const howToAnswer =
  "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.";

const nobodyCouldBeTold: unknown = expect.stringMatching(
  /^Line \d+, \/replies\/tell: Nothing says how a reply is answered through chat, so nobody could be told what became of theirs; write tell\.with, the arguments of post_message that post under the message, or tell: none to stay silent$/u,
);

async function askedThroughAServerNotListed(): Promise<Asked & { readonly saved: unknown }> {
  const playbook = await chatHarness(byTheProvider);
  playbook.chat.unlist();
  const saved = await playbook.define('approve-plan', documentTelling());
  await playbook.ask('approve-plan', { team: 'sales', owner: answererId, campaign: 'Spring' }, runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '', saved };
}

describe('a reply taken through a chat whose provider replies and marks', () => {
  it('is marked on the reply and answered in its thread, both caused by the answer, where the function writes no tell', async () => {
    const { playbook, thread, replies } = await repliedTo(byTheProvider, 'approve, looks good');
    const [answered] = await recordsOf(playbook.ledger, 'request_answered');
    const started = await recordsOf(playbook.ledger, 'telling_started');

    expect(playbook.chat.reactions()).toEqual([{ channel, timestamp: replies[0], name: 'white_check_mark' }]);
    expect(linesOf(playbook)).toEqual([[thread, 'Auto recorded your answer: approve.']]);
    expect(started.map(({ data, causationId }) => [data, causationId])).toMatchObject([
      [{ tool: 'add_reaction', about: 'taken', form: 'mark' }, answered?.id],
      [{ tool: 'post_message', about: 'taken', form: 'line' }, answered?.id],
    ]);
    expect(answered?.data).toMatchObject({ reply: { id: replies[0], to: thread } });
  });

  it('says the answer is recorded and names no word where the rule takes the whole reply', async () => {
    const wholeReply = {
      conversations: chatConversations,
      document: threadDocument({ rule: ['reply:', '  choice: text'], replies: threadRepliesTelling() }),
    };
    const { playbook, thread } = await repliedTo(wholeReply, 'approve');

    expect(linesOf(playbook)).toEqual([[thread, 'Auto recorded your answer.']]);
  });
});

describe('the word a function writes in tell', () => {
  it('tells nothing, marks nothing and tells no refusal where the function says tell: none, as main did with no tell', async () => {
    const { playbook } = await repliedTo(
      { conversations: chatConversations, document: documentTelling('  tell: none') },
      'maybe',
      'approve',
    );

    expect([playbook.chat.reactions(), linesOf(playbook)]).toEqual([[], []]);
    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([{ data: { told: false } }]);
    expect(await recordsOf(playbook.ledger, 'telling_started')).toEqual([]);
  });

  it('marks the reply and says nothing more where the function says tell: refusals, and still tells a refusal', async () => {
    const { playbook, thread, replies } = await repliedTo(
      { conversations: chatConversations, document: documentTelling('  tell: refusals') },
      'maybe',
      'approve',
    );

    expect(playbook.chat.reactions()).toEqual([{ channel, timestamp: replies[1], name: 'white_check_mark' }]);
    expect(linesOf(playbook)).toEqual([[thread, howToAnswer]]);
  });

  it('answers the reply alone where the provider has no way to mark, and tells one line for each of two replies in one read', async () => {
    const { react: _, ...noMark } = chatConversations;
    const { playbook, thread } = await repliedTo(
      { conversations: noMark, document: documentTelling() },
      'maybe',
      'approve',
    );

    expect(playbook.chat.reactions()).toEqual([]);
    expect(linesOf(playbook)).toEqual([
      [thread, howToAnswer],
      [thread, 'Auto recorded your answer: approve.'],
    ]);
  });

  it('marks through the provider and answers through the function’s own tell, which tells all by the provider’s word', async () => {
    const { playbook, thread, replies } = await repliedTo(
      { conversations: chatConversations, document: threadDocument() },
      'approve',
    );

    expect(playbook.chat.reactions()).toEqual([{ channel, timestamp: replies[0], name: 'white_check_mark' }]);
    expect(linesOf(playbook)).toEqual([[thread, 'Auto recorded your answer: approve.']]);
  });
});

describe('a telling of a taken reply that cannot be sent', () => {
  it('is skipped and recorded, and the run still succeeds with its answer', async () => {
    const { playbook, thread } = await asked(byTheProvider);
    playbook.chat.disallow('add_reaction');
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);

    await playbook.performDue(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'telling_failed')).toMatchObject([
      { data: { because: 'tool_not_offered' } },
    ]);
    expect(linesOf(playbook)).toEqual([[thread, 'Auto recorded your answer: approve.']]);
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' } },
    });
  });
});

describe('the telling of a taken reply', () => {
  it('is made once after a restart between the answer and the telling, and once by two hosts at the same time', async () => {
    const { playbook: first, thread } = await asked(byTheProvider);
    first.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    await first.performReads(Date.now() + farAhead);
    const again = await chatHarness({ ...byTheProvider, ledger: first.ledger, inTheChat: first.chat.posted() });
    const items = await again.dueItems(Date.now() + farAhead);

    await Promise.all([again.performAll(items, Date.now()), again.performAll(items, Date.now())]);
    await again.performDue(Date.now() + 2 * farAhead);

    expect(first.chat.reactions()).toEqual([]);
    expect(again.chat.reactions()).toHaveLength(1);
    expect(linesOf(again)).toEqual([[thread, 'Auto recorded your answer: approve.']]);
    expect(await recordsOf(again.ledger, 'telling_started')).toHaveLength(2);
  });
});

describe('a function saved to read replies through a connection whose provider says nothing of replying', () => {
  it('is refused where it writes no tell, or a word that needs the provider, naming what to write', async () => {
    const playbook = await chatHarness();

    const outcomes = [
      await playbook.define('approve-plan', documentTelling()),
      await playbook.define('approve-plan', documentTelling('  tell: all')),
    ];

    expect(outcomes).toMatchObject(
      Array.from({ length: 2 }, () => ({
        status: 'rejected',
        issues: [
          {
            detail: nobodyCouldBeTold,
          },
        ],
      })),
    );
  });

  it('is saved where it writes tell: none or its own tell, or where the provider says how', async () => {
    const plain = await chatHarness();
    const declared = await chatHarness({ conversations: chatConversations });

    const silent = await plain.define('approve-plan', documentTelling('  tell: none'));
    const toldItsOwnWay = await plain.define('approve-plan-told', threadDocument());
    const byItsProvider = await declared.define('approve-plan', documentTelling());

    expect([silent, toldItsOwnWay, byItsProvider]).toMatchObject(
      Array.from({ length: 3 }, () => ({ status: 'succeeded' })),
    );
  });
});

describe('a function whose server the playbook cannot list just now', () => {
  it('is saved, and a request it asks keeps no way to reply, so a taken reply is told nothing', async () => {
    const { playbook, thread, saved } = await askedThroughAServerNotListed();
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now() + farAhead);

    expect(saved).toMatchObject({ status: 'succeeded' });
    expect([playbook.chat.reactions(), linesOf(playbook)]).toEqual([[], []]);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(1);
  });
});
