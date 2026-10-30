import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, farAhead, recordsOf, type ChatHarness } from '../testing/index.ts';
import { threadRepliesWith } from '../testing/reading-documents.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const channel = '#approvals-sales';

async function askedAndDelivered(playbook: ChatHarness): Promise<string> {
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [thread = ''] = playbook.chat.posted().map(({ ts }) => ts);
  return thread;
}

async function refusedAfter(...texts: readonly (string | null)[]) {
  const playbook = await chatHarness();
  const thread = await askedAndDelivered(playbook);
  for (const text of texts) {
    playbook.chat.reply({ channel, thread, user: answererId, ...(text === null ? {} : { text }) });
  }
  await playbook.performReads(Date.now() + farAhead);
  return { playbook, thread, refused: await recordsOf(playbook.ledger, 'reply_refused') };
}

function tellingsOf(playbook: ChatHarness): readonly (string | undefined)[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text }) => text);
}

describe('a reply from the answerer the rule cannot read', () => {
  it('is refused as no answer, and the party told how to answer in the thread, the telling caused by the refusal', async () => {
    const { playbook, thread, refused } = await refusedAfter('maybe later');
    const [started] = await recordsOf(playbook.ledger, 'telling_started');

    expect(refused).toMatchObject([
      {
        type: 'reply_refused',
        data: { server: 'chat', tool: 'thread_replies', because: 'not_an_answer', told: true },
      },
    ]);
    expect(playbook.chat.posted().at(-1)).toMatchObject({
      thread_ts: thread,
      text: 'To answer, reply with one of approve, reject; what follows is kept as the note.',
    });
    expect(started?.causationId).toBe(refused[0]?.id);
    expect(started?.context).toMatchObject({
      runId,
      definitionType: 'interaction',
      definitionName: 'approve-brief',
      definitionVersion: 1,
    });
    expect((await recordsOf(playbook.ledger, 'telling_succeeded')).map(({ causationId }) => causationId)).toEqual([
      started?.id,
    ]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered', reply_refusals: 1 });
  });

  it('is refused with its issues when its answer does not fit, too long, or with no words at all', async () => {
    const { playbook, refused } = await refusedAfter(`approve ${'x'.repeat(2001)}`, 'x'.repeat(8193), null);

    expect(refused.map(({ data }) => data)).toMatchObject([
      { because: 'invalid', issues: [{ pointer: '/answer/note' }] },
      { because: 'too_long' },
      { because: 'not_an_answer' },
    ]);
    expect(tellingsOf(playbook)).toEqual([
      'That reply is not an answer this request takes: note: expected at most 2,000 characters. To answer, reply with one of approve, reject; what follows is kept as the note.',
      'A reply may hold at most 8,192 bytes.',
      'To answer, reply with one of approve, reject; what follows is kept as the note.',
    ]);
  });
});

describe('a refusal whose telling does not fit the arguments of the tool', () => {
  it('is recorded as not told, and nothing is sent', async () => {
    const playbook = await chatHarness({
      document: threadRepliesWith(
        "      text: '{{ message }}'",
        "      text: '{% for i in (1..300) %}{{ message }}{% endfor %}'",
      ),
    });
    const thread = await askedAndDelivered(playbook);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([{ data: { told: false } }]);
    expect(tellingsOf(playbook)).toEqual([]);
  });
});

describe('the refusals of one request', () => {
  it('tell the party three times at most, and record ten at most, past which a reply leaves no trace', async () => {
    const { playbook, refused } = await refusedAfter(...Array.from({ length: 12 }, (_, index) => `maybe ${index}`));

    expect(refused).toMatchObject([
      ...Array.from({ length: 3 }, () => ({ data: { told: true } })),
      ...Array.from({ length: 7 }, () => ({ data: { told: false } })),
    ]);
    expect(refused).toHaveLength(10);
    expect(tellingsOf(playbook)).toHaveLength(3);
    expect(await playbook.firstOpen()).toMatchObject({ reply_refusals: 10 });
  });
});
