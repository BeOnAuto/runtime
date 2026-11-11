import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  answererId,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
  type FakeAnswer,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const joining = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const channel = '#approvals-sales';

const howToAnswer = 'To answer, reply with one of approve, reject; what follows is kept as the note.';

interface Asked {
  readonly playbook: ChatHarness;
  readonly thread: string;
}

async function askedOfThePersonItPostsAs(document = threadDocument()): Promise<Asked> {
  const playbook = await chatHarness({ postsAs: answererId, document });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

function readTurns(playbook: ChatHarness, turns: number, from = 0): Promise<unknown> {
  return Array.from({ length: turns }, (_, index) => from + index + 1).reduce<Promise<unknown>>(
    (before, turn) => before.then(() => playbook.performReads(Date.now() + farAhead * turn)),
    Promise.resolve(),
  );
}

function tellingsOf(playbook: ChatHarness): readonly (string | undefined)[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text }) => text);
}

async function refusalsOf(playbook: ChatHarness): Promise<readonly unknown[]> {
  return (await recordsOf(playbook.ledger, 'reply_refused')).map(({ data }) => data);
}

describe('a chat whose connection posts as the person who answers', () => {
  it('reads none of its own tellings back as their reply: one reply that is no answer is refused and told once', async () => {
    const { playbook, thread } = await askedOfThePersonItPostsAs();
    playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });

    await readTurns(playbook, 5);

    expect(await refusalsOf(playbook)).toMatchObject([{ because: 'not_an_answer', told: true }]);
    expect(tellingsOf(playbook)).toEqual([howToAnswer]);
    expect(await recordsOf(playbook.ledger, 'telling_succeeded')).toMatchObject([
      { data: { told_as: { conversation: channel, id: '1699.000003' } } },
    ]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered', reply_refusals: 1 });
  });

  it('still takes the answer the person replies after the telling', async () => {
    const { playbook, thread } = await askedOfThePersonItPostsAs();
    playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });
    await readTurns(playbook, 2);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });

    await readTurns(playbook, 2, 2);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toHaveLength(1);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' }, reply: { sender: answererId } } },
    ]);
  });

  it('passes over a telling in a chat without threads also once another request has joined the chat, which would make it ambiguous', async () => {
    const { playbook } = await askedOfThePersonItPostsAs(threadDocument({ replies: flatReplies }));
    playbook.chat.reply({ channel, user: answererId, text: 'maybe' });
    await readTurns(playbook, 1);
    await playbook.askInThread(joining);
    await playbook.performDue(Date.now());

    await readTurns(playbook, 3, 1);

    expect(await refusalsOf(playbook)).toMatchObject([{ because: 'not_an_answer', told: true }]);
    expect(tellingsOf(playbook)).toEqual([howToAnswer, expect.stringMatching(/^Please review the brief/u)]);
  });
});

const throughAnotherTool = threadDocument({
  replies: threadReplies.flatMap((line) => (line === '  tell:' ? [line, '    tool: post_reply'] : [line])),
});

describe('a telling whose message the playbook cannot know', () => {
  it('is the last its request makes: through a tool whose answer names no message, it is read back and refused untold, and so is every reply after it', async () => {
    const { playbook, thread } = await askedOfThePersonItPostsAs(throughAnotherTool);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });
    await readTurns(playbook, 2);
    playbook.chat.reply({ channel, thread, user: answererId, text: 'later' });

    await readTurns(playbook, 2, 2);

    expect(await refusalsOf(playbook)).toMatchObject([
      { reply: { id: '1699.000002' }, told: true },
      { reply: { id: '1699.000003' }, told: false },
      { reply: { id: '1699.000004' }, told: false },
    ]);
    expect(tellingsOf(playbook)).toEqual([howToAnswer]);
  });
});

async function refusedOnceWithItsTellingAnswered(telling: FakeAnswer): Promise<ChatHarness> {
  const { playbook, thread } = await askedOfThePersonItPostsAs();
  const [request] = playbook.chat.posted();
  const maybe = playbook.chat.reply({ channel, thread, user: answererId, text: 'maybe' });
  playbook.chat.answerNext(
    answered({ messages: [request, { ts: maybe, channel, user: answererId, text: 'maybe', thread_ts: thread }] }),
    telling,
  );
  await readTurns(playbook, 1);
  playbook.chat.reply({ channel, thread, user: answererId, text: 'later' });
  await readTurns(playbook, 2, 1);
  return playbook;
}

describe('a telling that failed', () => {
  it('is the last its request makes where the message may have been posted, as when the tool did not answer in time', async () => {
    const playbook = await refusedOnceWithItsTellingAnswered({
      outcome: 'timed_out',
      detail: 'The tool server did not answer in time',
      retryAfterMs: null,
    });

    expect(await refusalsOf(playbook)).toMatchObject([{ told: true }, { told: false }]);
    expect(await recordsOf(playbook.ledger, 'telling_failed')).toMatchObject([{ data: { because: 'timed_out' } }]);
  });

  it('is the last its request makes where the tool answered with no message where the delivery found one', async () => {
    const playbook = await refusedOnceWithItsTellingAnswered(answered({ ok: true }));

    expect(await refusalsOf(playbook)).toMatchObject([{ told: true }, { told: false }]);
    expect((await recordsOf(playbook.ledger, 'telling_succeeded')).map(({ data }) => JSON.stringify(data))).toEqual([
      expect.not.stringContaining('told_as'),
    ]);
  });

  it('leaves the next telling to its request where the tool refused before posting anything', async () => {
    const playbook = await refusedOnceWithItsTellingAnswered({
      outcome: 'tool_error',
      detail: 'channel_not_found',
      retryAfterMs: null,
    });

    expect(await refusalsOf(playbook)).toMatchObject([{ told: true }, { told: true }]);
    expect(tellingsOf(playbook)).toEqual([howToAnswer]);
  });
});

describe('a telling its server refused before posting anything', () => {
  it('leaves the next telling to its request where the server no longer offered the tool, or refused its arguments', async () => {
    const notOffered = await refusedOnceWithItsTellingAnswered({ kind: 'not_offered' });
    const refusedArguments = await refusedOnceWithItsTellingAnswered({
      outcome: 'arguments_refused',
      detail: 'invalid_arguments',
      retryAfterMs: null,
    });

    expect(
      await Promise.all(
        [notOffered, refusedArguments].map(async (playbook) => ({
          refusals: await refusalsOf(playbook),
          failed: await recordsOf(playbook.ledger, 'telling_failed'),
        })),
      ),
    ).toMatchObject([
      { refusals: [{ told: true }, { told: true }], failed: [{ data: { because: 'tool_not_offered' } }] },
      { refusals: [{ told: true }, { told: true }], failed: [{ data: { because: 'arguments_refused' } }] },
    ]);
  });
});
