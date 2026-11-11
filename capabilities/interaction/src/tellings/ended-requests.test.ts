import { deferredCanceller } from '@on.auto/definitions';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
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

const pastItsExpiry = 3 * 24 * farAhead;

interface Asked {
  readonly playbook: ChatHarness;
  readonly thread: string;
}

function documentTelling(...tell: readonly string[]): string {
  return threadDocument({ replies: threadRepliesTelling(...tell) });
}

const byTheProvider = { conversations: chatConversations, document: documentTelling() };

async function asked(options: ChatHarnessOptions = byTheProvider): Promise<Asked> {
  const playbook = await chatHarness(options);
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

async function cancelled(playbook: ChatHarness): Promise<void> {
  await playbook.cancel(runId);
  const address = { org: 'acme', playbook: 'alpha', id: runId };
  const asking = { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' } as const;
  await Effect.runPromise(
    deferredCanceller([playbook.capability], playbook.ledger.service)(address, asking, {
      causationId: null,
      correlationId: runId,
    }),
  );
}

async function dueTwice(playbook: ChatHarness, now: number): Promise<void> {
  await playbook.performDue(now);
  await playbook.performDue(now);
}

function linesOf(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text, thread_ts: thread }) => [thread, text]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a request that ends with no reply in its conversation', () => {
  it('says so once in the thread of its message: answered in Auto, by whom and with what words', async () => {
    const { playbook, thread } = await asked();

    await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve', note: 'Ready.' } });
    await dueTwice(playbook, Date.now() + farAhead);

    expect(linesOf(playbook)).toEqual([[thread, 'Answered in Auto by acme-admin: approve.']]);
    expect(await recordsOf(playbook.ledger, 'telling_started')).toMatchObject([
      { data: { about: 'ended', form: 'line' } },
    ]);
  });

  it('says it expired, or was cancelled, unanswered', async () => {
    const expiring = await asked();
    const cancelling = await asked();

    await dueTwice(expiring.playbook, Date.now() + pastItsExpiry);
    await cancelled(cancelling.playbook);
    await dueTwice(cancelling.playbook, Date.now() + farAhead);

    expect([linesOf(expiring.playbook), linesOf(cancelling.playbook)]).toEqual([
      [[expiring.thread, 'Expired unanswered.']],
      [[cancelling.thread, 'Cancelled unanswered.']],
    ]);
  });

  it('names the request by when it was sent where its line does not go under the request’s message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-09T09:00:00.000Z'));
    const reply = { ...chatConversations.reply, with: { channel: '{{ sent.conversation }}', text: '{{ message }}' } };
    const { playbook } = await asked({ ...byTheProvider, conversations: { ...chatConversations, reply } });

    await dueTwice(playbook, Date.now() + pastItsExpiry);

    expect(linesOf(playbook)).toEqual([[undefined, 'The request sent 9 Nov, 09:00 UTC: Expired unanswered.']]);
  });
});

describe('the end of a request that says nothing more', () => {
  it('is an answer by reply, which its own line already said', async () => {
    const { playbook, thread } = await asked();
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    await dueTwice(playbook, Date.now() + farAhead);
    await dueTwice(playbook, Date.now() + 2 * farAhead);

    expect(linesOf(playbook)).toEqual([[thread, 'Auto recorded your answer: approve.']]);
  });

  it('is any ending of a request asked with tell: refusals or none, or never sent', async () => {
    const refusals = await asked({ ...byTheProvider, document: documentTelling('  tell: refusals') });
    const none = await asked({ ...byTheProvider, document: documentTelling('  tell: none') });
    const unsent = await chatHarness(byTheProvider);
    await unsent.askInThread(runId);
    await cancelled(unsent);

    await Promise.all([refusals, none].map(({ playbook }) => dueTwice(playbook, Date.now() + pastItsExpiry)));
    await dueTwice(unsent, Date.now() + farAhead);

    expect([linesOf(refusals.playbook), linesOf(none.playbook), unsent.chat.posted()]).toEqual([[], [], []]);
  });
});

describe('the telling of an ending', () => {
  it('is made once after a restart between the ending and the telling, and once by two hosts at the same time', async () => {
    const { playbook: first, thread } = await asked();
    await cancelled(first);
    const again = await chatHarness({ ...byTheProvider, ledger: first.ledger, inTheChat: first.chat.posted() });
    const items = await again.dueItems(Date.now() + farAhead);

    await Promise.all([again.performAll(items, Date.now()), again.performAll(items, Date.now())]);
    await dueTwice(again, Date.now() + 2 * farAhead);

    expect(linesOf(first)).toEqual([]);
    expect(linesOf(again)).toEqual([[thread, 'Cancelled unanswered.']]);
    expect(await recordsOf(again.ledger, 'telling_started')).toHaveLength(1);
  });
});
