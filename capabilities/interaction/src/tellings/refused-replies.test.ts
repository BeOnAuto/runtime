import { describe, expect, it } from 'vitest';

import {
  answered,
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

const stranger = 'U0STRANGER';

interface Asked {
  readonly playbook: ChatHarness;
  readonly thread: string;
}

async function asked(options: ChatHarnessOptions = {}): Promise<Asked> {
  const playbook = await chatHarness({
    conversations: chatConversations,
    document: threadDocument({ replies: threadRepliesTelling() }),
    ...options,
  });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

async function readAfter({ playbook, thread }: Asked, ...said: readonly (readonly [string, string])[]) {
  const replies = said.map(([user, text]) => playbook.chat.reply({ channel, thread, user, text }));
  await playbook.performReads(Date.now() + farAhead);
  await playbook.performDue(Date.now() + farAhead);
  return replies;
}

function linesOf(playbook: ChatHarness): readonly (string | undefined)[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text }) => text);
}

async function refusalsOf(playbook: ChatHarness): Promise<readonly unknown[]> {
  return (await recordsOf(playbook.ledger, 'reply_refused')).map(({ data }) => data);
}

const someoneElse = "This request is waiting for someone else's answer, so Auto didn't take this reply.";

const answeredAlready = "This request was already answered, so Auto didn't take this reply.";

const notAnAnswer =
  "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.";

const tooLong = 'That reply is too long for Auto to take. A reply can hold up to 8 KB of text.';

describe('an answer from someone the request does not wait on', () => {
  it('is told once that the request waits on someone else, keeping who gave it and never their words, while chatter is passed over', async () => {
    const thread = await asked();

    await readAfter(thread, [stranger, 'looks good to me'], [stranger, 'approve'], [stranger, 'approve, really']);

    expect(await refusalsOf(thread.playbook)).toEqual([
      expect.objectContaining({
        reply: { id: '1699.000003', sender: stranger },
        because: 'not_the_answerer',
        told: true,
      }),
    ]);
    expect(linesOf(thread.playbook)).toEqual([someoneElse]);
    expect(JSON.stringify(await refusalsOf(thread.playbook))).not.toContain('approve');
  });

  it('is told where the function writes tell: refusals, since its provider answers every reply', async () => {
    const thread = await asked({ document: threadDocument({ replies: threadRepliesTelling('  tell: refusals') }) });

    await readAfter(thread, [stranger, 'approve']);

    expect(linesOf(thread.playbook)).toEqual([someoneElse]);
  });

  it('is told nothing where the provider answers only refusals, as mail would', async () => {
    const thread = await asked({ conversations: { ...chatConversations, tell: 'refusals' } });

    await readAfter(thread, [stranger, 'approve']);

    expect(await refusalsOf(thread.playbook)).toMatchObject([{ because: 'not_the_answerer', told: false }]);
    expect(linesOf(thread.playbook)).toEqual([]);
  });
});

describe('a reply after the request took its answer, in the same read', () => {
  it('is told once that the request was answered already, after the answer is recorded and marked', async () => {
    const thread = await asked();

    await readAfter(thread, [answererId, 'approve'], [answererId, 'reject'], [answererId, 'reject, no']);

    expect(linesOf(thread.playbook)).toEqual([answeredAlready, 'Auto recorded your answer: approve.']);
    expect(await refusalsOf(thread.playbook)).toEqual([]);
  });

  it('is told nothing once the request has told the three lines it may', async () => {
    const thread = await asked();
    await readAfter(thread, [answererId, 'maybe'], [answererId, 'x'.repeat(8193)], [answererId, 'later']);

    await readAfter(thread, [answererId, 'approve'], [answererId, 'reject']);

    expect(linesOf(thread.playbook)).toEqual([
      notAnAnswer,
      tooLong,
      notAnAnswer,
      'Auto recorded your answer: approve.',
    ]);
  });

  it('is told nothing where the function says tell: none', async () => {
    const thread = await asked({ document: threadDocument({ replies: threadRepliesTelling('  tell: none') }) });

    await readAfter(thread, [answererId, 'approve'], [answererId, 'reject']);

    expect(linesOf(thread.playbook)).toEqual([]);
  });
});

describe('the lines a request tells of replies not taken', () => {
  it('never say the same words twice running', async () => {
    const thread = await asked();

    await readAfter(thread, [answererId, 'maybe'], [answererId, 'later'], [answererId, 'x'.repeat(8193)]);
    await readAfter(thread, [answererId, 'perhaps']);

    expect(await refusalsOf(thread.playbook)).toMatchObject([
      { told: true },
      { told: false },
      { told: true },
      { told: true },
    ]);
    expect(linesOf(thread.playbook)).toEqual([notAnAnswer, tooLong, notAnAnswer]);
  });
});

describe('a message its provider marks as posted by an app', () => {
  it('is passed over, neither taken, refused nor answered', async () => {
    const { playbook, thread } = await asked();
    playbook.chat.answerNext(
      answered({
        messages: [
          { ts: '1699.000005', channel, user: answererId, bot_id: 'B024BE7LH', text: 'approve', thread_ts: thread },
        ],
      }),
    );

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
    expect(linesOf(playbook)).toEqual([]);
  });
});
