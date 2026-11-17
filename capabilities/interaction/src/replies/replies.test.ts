import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import { answererId, chatHarness, type ChatHarness, farAhead, recordsOf, threadDocument } from '../testing/index.ts';
import { threadRepliesWith } from '../testing/reading-documents.ts';
import type { ReplyRule } from './reply-rule.ts';
import { answeredAlreadyWords, type Refused, tellingWords } from './telling-words.ts';

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const toldAboutThePlan: unknown = expect.stringMatching(
  /^About the plan: Auto couldn't take that as an answer\. Reply with approve or reject\./u,
);

function keyedByTheChannel(told: string): string {
  return threadDocument({
    replies: threadReplies
      .filter((line) => !line.startsWith('  conversation:'))
      .map((line) => (line === "      text: '{{ message }}'" ? `      text: '${told}{{ message }}'` : line)),
  });
}

describe('a reply refused for the newer of two requests of different functions in one conversation', () => {
  it('is told through the tell of the function that asked it, not the older request’s', async () => {
    const playbook = await chatHarness({ document: keyedByTheChannel('') });
    await playbook.define('approve-plan', keyedByTheChannel('About the plan: '));
    await playbook.askInThread(older);
    await playbook.ask('approve-plan', { team: 'sales', owner: answererId, campaign: 'Autumn' }, newer);
    await playbook.performDue(Date.now());
    const [, newerThread] = playbook.chat.posted().map(({ ts }) => ts);
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'maybe' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'not_an_answer', told: true }, context: { runId: newer } },
    ]);
    expect(playbook.chat.posted().at(-1)).toMatchObject({
      thread_ts: newerThread,
      text: toldAboutThePlan,
    });
  });
});

const choice: ReplyRule = {
  choice: { from: 'word', words: { approve: [], revise: [] } },
  note: { from: 'rest' },
};

const reason: ReplyRule = { reason: { from: 'text' } };

const plainly: Refused = { rule: choice, because: 'not_an_answer', issues: [], open: 1, namesItsMessage: true };

describe('the words a reply that was not taken is told', () => {
  it('say Auto could not take it and how to answer, naming the words and what follows them', () => {
    expect([
      tellingWords(plainly),
      tellingWords({ ...plainly, rule: { choice: { from: 'word', words: { approve: [], revise: [] } } } }),
      tellingWords({ ...plainly, rule: reason }),
    ]).toEqual([
      "Auto couldn't take that as an answer. Reply with approve or revise. Anything after that word is kept as the note.",
      "Auto couldn't take that as an answer. Reply with approve or revise.",
      "Auto couldn't take that as an answer. Reply with your answer in words.",
    ]);
  });

  it('say what is wrong with an answer that does not fit, and how to answer', () => {
    const issues = [{ pointer: '/answer/note', detail: 'note: expected at most 2,000 characters' }];

    expect(tellingWords({ ...plainly, because: 'invalid', issues })).toBe(
      "Auto couldn't take that answer: note: expected at most 2,000 characters. Reply with approve or revise.",
    );
  });

  it('say a reply is too long, by the bound of a reply', () => {
    expect(tellingWords({ ...plainly, because: 'too_long' })).toBe(
      'That reply is too long for Auto to take. A reply can hold up to 8 KB of text.',
    );
  });

  it('say several requests are open, asking for a thread where a reply can name its message, and Auto where it cannot', () => {
    const ambiguous: Refused = { ...plainly, because: 'ambiguous' };

    expect([
      tellingWords(ambiguous),
      tellingWords({ ...ambiguous, namesItsMessage: false, open: 2 }),
      tellingWords({ ...ambiguous, namesItsMessage: false, open: 3 }),
    ]).toEqual([
      "More than one request is open here. Reply in the thread of the one you're answering.",
      "Two requests are open here, so Auto can't tell which one this answers. Neither was answered. Answer them in Auto, or reply here when one is left.",
      "3 requests are open here, so Auto can't tell which one this answers. None of them was answered. Answer them in Auto, or reply here when one is left.",
    ]);
  });

  it('say the request waits on someone else, or was answered already, so the reply was not taken', () => {
    expect([tellingWords({ ...plainly, because: 'not_the_answerer' }), answeredAlreadyWords]).toEqual([
      "This request is waiting for someone else's answer, so Auto didn't take this reply.",
      "This request was already answered, so Auto didn't take this reply.",
    ]);
  });
});

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

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
      text: "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.",
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
      "Auto couldn't take that answer: note: expected at most 2,000 characters. Reply with approve or reject.",
      'That reply is too long for Auto to take. A reply can hold up to 8 KB of text.',
      "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.",
    ]);
  });
});

describe('a refusal whose telling does not fit the arguments of the tool', () => {
  it('is recorded as not told, and nothing is sent', async () => {
    const playbook = await chatHarness({
      document: threadRepliesWith(
        "      text: '{{ message }}'",
        "      text: '{% for i in (1..12000) %}{{ message }}{% endfor %}'",
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
    const { playbook, refused } = await refusedAfter(
      ...Array.from({ length: 6 }, (_, index) => [`maybe ${index}`, 'x'.repeat(8193)]).flat(),
    );

    expect(refused).toMatchObject([
      ...Array.from({ length: 3 }, () => ({ data: { told: true } })),
      ...Array.from({ length: 7 }, () => ({ data: { told: false } })),
    ]);
    expect(refused).toHaveLength(10);
    expect(tellingsOf(playbook)).toHaveLength(3);
    expect(await playbook.firstOpen()).toMatchObject({ reply_refusals: 10 });
  });
});
