import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordsOf } from '../testing/chat-harness.ts';
import { readOnce, theChannel } from '../testing/woken-conversations.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const fiveSeconds = 5000;

const theMessageAnswered: unknown = expect.any(String);

describe('a wake of a connection', () => {
  it('makes a conversation waiting through it due the shortest wait of its reading after the wake, its own next read kept', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt);

    expect(await waiting.row()).toEqual({ ...before, due_at: waiting.readAt + fiveSeconds });
  });

  it('answers nothing by itself: the read it makes due takes the reply, and says that a wake caused it', async () => {
    const waiting = await readOnce(runId);
    waiting.approve();
    await waiting.wake(waiting.readAt);
    const calls = waiting.playbook.chat.calls().length;

    expect(await recordsOf(waiting.playbook.ledger, 'request_answered')).toEqual([]);

    await waiting.playbook.performReads(waiting.readAt + fiveSeconds);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
    expect(await recordsOf(waiting.playbook.ledger, 'request_answered', 'replies_read')).toMatchObject([
      { type: 'request_answered', data: { answer: { choice: 'approve' }, reply: { to: theMessageAnswered } } },
      { type: 'replies_read', data: { server: 'chat', taken: 1, woken: true } },
    ]);
  });

  it('reads no sooner than the shortest wait after its last read', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    await waiting.wake(waiting.readAt);

    await waiting.playbook.performReads(waiting.readAt + fiveSeconds - 1);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls);
  });
});

describe('several wakes of a connection', () => {
  it('in a burst are one read', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    const burst = Array.from({ length: 100 }, (_, index) => waiting.readAt + index * 10);

    await Effect.runPromise(Effect.forEach(burst, (at) => Effect.promise(() => waiting.wake(at)), { discard: true }));
    await waiting.playbook.performReads(waiting.readAt + 2 * fiveSeconds);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
  });
});

describe('a wake and the timed read of the same conversation', () => {
  it('falling together are one read and one answer', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    waiting.approve();
    await waiting.wake(waiting.readAt);

    await waiting.playbook.performReads(waiting.readAt + 60_000);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
    expect(await recordsOf(waiting.playbook.ledger, 'request_answered')).toHaveLength(1);
  });

  it('leave the conversation as it is where the timed read is due within the shortest wait of the woken one, and that read says no wake caused it', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();
    waiting.approve();

    await waiting.wake(waiting.readAt + 2 * fiveSeconds + 2000);
    const after = await waiting.row();
    await waiting.playbook.performReads(waiting.readAt + 4 * fiveSeconds);
    const [read] = await recordsOf(waiting.playbook.ledger, 'replies_read');

    expect(after).toEqual(before);
    expect(read?.data).toMatchObject({ taken: 1 });
    expect(read?.data).not.toHaveProperty('woken');
  });
});

describe('a wake that names the conversation an arrival is about', () => {
  it('makes due the conversations of the requests whose messages were delivered there, and no other', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt, { conversation: '#approvals-marketing' });

    expect(await waiting.row()).toEqual(before);

    await waiting.wake(waiting.readAt, { conversation: theChannel });

    expect(await waiting.row()).toEqual({ ...before, due_at: waiting.readAt + fiveSeconds });
  });
});
