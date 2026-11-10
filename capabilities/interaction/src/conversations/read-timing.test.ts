import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { newestFirstReplies, threadRepliesWith } from '../testing/reading-documents.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fitsForTheSampleNotForTheRequest = `{% for i in (1..262) %}${'a'.repeat(1000)}{% endfor %}${'{{ to }}'.repeat(20)}`;

const pastTheBoundOnceItHasACursor = '{% for i in (1..1100) %}{{ since }}{% endfor %}';

async function deliveredInThread(document?: string) {
  const playbook = await chatHarness(document === undefined ? {} : { document });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  return playbook;
}

describe('a conversation read later', () => {
  it('is never joined by a request whose read renders no arguments for it, which waits for answer_interaction', async () => {
    const playbook = await deliveredInThread(
      threadRepliesWith("    ts: '{{ sent.id }}'", `    ts: '${fitsForTheSampleNotForTheRequest}'`),
    );

    await playbook.performReads(Date.now() + farAhead);

    expect(playbook.chat.calls()).toHaveLength(1);
    expect(await conversationRows(playbook.ledger)).toEqual([]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered', conversation: null });
  });

  it('sends no read whose arguments do not fit the cursor it reads from, records why, and rests the conversation', async () => {
    const playbook = await deliveredInThread(
      threadRepliesWith(`    oldest: '{{ since | default: "0" }}'`, `    oldest: '${pastTheBoundOnceItHasACursor}'`),
    );
    playbook.chat.answerNext(answered({ messages: [{ ts: 'x'.repeat(250), user: 'U1', text: 'hi' }] }));
    await playbook.performReads(Date.now() + farAhead);

    await playbook.performReads(Date.now() + 2 * farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(playbook.chat.calls()).toHaveLength(2);
    expect((await recordsOf(playbook.ledger, 'reading_failed')).map(({ data }) => data)).toMatchObject([
      {
        server: 'chat',
        tool: 'thread_replies',
        because: 'not_sent',
        detail: 'The argument oldest of the read renders more than the 262144 bytes a call may send',
      },
    ]);
    expect(row?.row).toMatchObject({ open: false, due_at: null });
  });

  it('is not read before the shortest wait its reading sets, counted from when a request joined it', async () => {
    const playbook = await deliveredInThread();

    await playbook.performReads(Date.now() + 30_000);
    const [row] = await conversationRows(playbook.ledger);

    expect(playbook.chat.calls()).toHaveLength(1);
    expect(row?.row).toMatchObject({ reads: 0, next_read_at: Number(row?.row['active_at']) + 60_000 });
  });
});

describe('the next read of the conversations', () => {
  it('is due when the soonest open conversation is', async () => {
    const playbook = await deliveredInThread();
    const [row] = await conversationRows(playbook.ledger);

    expect(await Effect.runPromise(playbook.reads.nextDueAt(0))).toBe(row?.row['due_at']);
    expect(
      await Effect.runPromise(Effect.all([playbook.reads.nextDueAt(0, true), playbook.reads.nextDueAt(0, false)])),
    ).toEqual([row?.row['due_at'], null]);
    expect(await Effect.runPromise(playbook.reads.due(Date.now() + farAhead, 16, false))).toEqual([]);
  });
});

describe('the cursor of a read', () => {
  it('is the newest reply the tool listed, first for a tool that lists newest first', async () => {
    const playbook = await deliveredInThread(threadDocument({ replies: newestFirstReplies }));
    playbook.chat.answerNext(
      answered({
        messages: [
          { ts: '9.3', user: 'U1' },
          { ts: '9.2', user: answererId, text: 'maybe' },
        ],
      }),
    );

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'replies_read')).toMatchObject([
      { data: { since: '9.3', replies: 2, refused: 1 } },
    ]);
  });
});
