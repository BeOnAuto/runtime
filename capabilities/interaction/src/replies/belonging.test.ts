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
import { flatReplies } from '../testing/reading-documents.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const flat = { document: threadDocument({ replies: flatReplies }) };

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
      'Several questions are open here; reply to the message of the one you answer.',
    );
  });

  it('answers the one open request of a conversation when it names no message', async () => {
    const playbook = await chatHarness(flat);
    await delivered(playbook, first);
    playbook.chat.reply({ channel, user: answererId, text: 'yes' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());

    expect(await playbook.runOf(first)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' } },
    });
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
