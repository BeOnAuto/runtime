import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  type FakeAnswer,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { newestFirstReplies, threadRepliesWith } from '../testing/reading-documents.ts';

const anyWords: unknown = expect.any(String);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fitsForTheSampleNotForTheRequest = `{% for i in (1..1048) %}${'a'.repeat(1000)}{% endfor %}${'a'.repeat(432)}${'{{ to }}'.repeat(20)}`;

const pastTheBoundOnceItHasACursor = '{% for i in (1..4300) %}{{ since }}{% endfor %}';

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
        detail: anyWords,
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

const aSize: unknown = expect.any(Number);

function textOf(text: string): FakeAnswer {
  return { outcome: 'result', answer: { content: [{ type: 'text', text }] }, detail: '', retryAfterMs: null };
}

async function readAfter(answer: FakeAnswer) {
  const playbook = await deliveredInThread();
  playbook.chat.answerNext(answer);
  const before = Date.now();
  await playbook.performReads(before + farAhead);
  const [read] = await recordsOf(playbook.ledger, 'reading_failed');
  const [row] = await conversationRows(playbook.ledger);
  return { playbook, read, row: row?.row, before };
}

async function failedRead(answer: FakeAnswer): Promise<readonly unknown[]> {
  const { read, row } = await readAfter(answer);
  return [read?.data, row?.['open']];
}

describe('a read that fails', () => {
  it('is recorded with what went wrong, and the cadence goes on', async () => {
    const answers: readonly FakeAnswer[] = [
      answered({ messages: [], padding: 'x'.repeat(70_000) }),
      textOf('Nothing new.'),
      answered({ messages: { ts: '1' } }),
      { outcome: 'result', answer: { content: [{ type: 'image' }] }, detail: '', retryAfterMs: null },
      { outcome: 'tool_error', detail: 'channel_not_found', retryAfterMs: null },
      { outcome: 'timed_out', detail: 'The tool server did not answer within 30000 ms', retryAfterMs: null },
      { outcome: 'cancelled', detail: '', retryAfterMs: null },
      { kind: 'unopened', detail: 'The tool server could not be reached' },
      { kind: 'not_offered' },
      { kind: 'asset_not_sent', because: 'asset_not_taken', detail: 'The argument /text is a file of image/png' },
    ];

    expect(await Promise.all(answers.map((answer) => failedRead(answer)))).toMatchObject([
      [{ because: 'too_large', result_bytes: aSize }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'tool_error' }, true],
      [{ because: 'timed_out' }, true],
      [{ because: 'cancelled' }, true],
      [{ because: 'server_failure' }, true],
      [{ because: 'tool_not_offered', server: 'chat', tool: 'thread_replies' }, true],
      [{ because: 'arguments_refused' }, true],
    ]);
  });

  it('waits as long as a server asked with Retry-After, an hour at most', async () => {
    const { read, row, before } = await readAfter({
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 429',
      retryAfterMs: 120_000,
    });

    expect(read?.data).toMatchObject({ because: 'server_failure', retry_after_ms: 120_000 });
    expect(Number(row?.['next_read_at'])).toBeGreaterThanOrEqual(before + 120_000);
  });
});

describe('a conversation whose reading tool its operator disallowed', () => {
  it('records a failed read, tool_not_offered, and the cadence goes on with the request open', async () => {
    const playbook = await deliveredInThread();
    playbook.chat.disallow('thread_replies');

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(await recordsOf(playbook.ledger, 'reading_failed')).toMatchObject([
      { data: { because: 'tool_not_offered' } },
    ]);
    expect(row?.row).toMatchObject({ open: true, reads: 1 });
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered' });
  });
});

describe('a conversation with nothing open in it', () => {
  it('rests, with no call, once its one request was answered through answer_interaction', async () => {
    const playbook = await deliveredInThread();
    await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } });

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect([row?.row['open'], row?.row['due_at'], playbook.chat.calls()]).toMatchObject([false, null, [{}]]);
  });
});

describe('a listed reply without an identity or a sender that fits', () => {
  it('is passed over, and the cursor moves to the newest identity that fits', async () => {
    const listed = [
      { user: answererId, text: 'approve' },
      { ts: '9.1', text: 'approve' },
      { ts: 'x'.repeat(300), user: answererId, text: 'approve' },
      { ts: '9.2', user: 'U'.repeat(300), text: 'approve' },
    ];
    const playbook = await deliveredInThread();
    playbook.chat.answerNext(answered({ messages: listed }));
    await playbook.performReads(Date.now() + farAhead);
    const [read] = await recordsOf(playbook.ledger, 'replies_read');

    expect(read?.data).toMatchObject({ replies: 4, taken: 0, refused: 0, since: '9.2' });
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered' });
  });
});
