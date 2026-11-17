import { onTheStandingClock } from '@on.auto/definitions/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConversationLedger } from '../conversations/conversation-parts.ts';
import { conversationsDue } from '../conversations/conversations-due.ts';
import { answerInteraction } from '../requests/answer-interaction.ts';
import { dueInBothLanes } from '../testing/harness-parts.ts';
import { answererId, chatHarness, type ChatHarness, farAhead, recordsOf } from '../testing/index.ts';
import { answerOfReply, type ReplyRule } from './reply-rule.ts';

const approval: ReplyRule = {
  choice: { from: 'word', words: { approve: ['approved', 'yes', 'ok'], reject: ['rejected', 'no'] } },
  note: { from: 'rest' },
};

describe('the words of a reply, as the rule reads them', () => {
  it('take the first word, lowercased and stripped of punctuation, as a value or a word listed for one', () => {
    expect(
      ['approve', 'Approved!', '*yes*', 'OK.', 'no thanks', 'Reject'].map((words) => answerOfReply(approval, words)),
    ).toEqual([
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'reject', note: 'thanks' },
      { choice: 'reject' },
    ]);
  });

  it('keep what follows the first word, trimmed, as the part the rule names', () => {
    expect(answerOfReply(approval, '  reject,   the second point is wrong  ')).toEqual({
      choice: 'reject',
      note: 'the second point is wrong',
    });
  });

  it('read the first word whole, however long a run of punctuation it holds inside', () => {
    expect(answerOfReply(approval, `yes${'!'.repeat(100_000)}no`)).toBeUndefined();
  });

  it('strip a symbol of several parts from the edge of the first word', () => {
    expect(answerOfReply(approval, '👍🏽yes')).toEqual({ choice: 'approve' });
  });

  it('are no answer when the first word means no value, or there are no words at all', () => {
    expect([answerOfReply(approval, 'maybe later'), answerOfReply(approval, '   ')]).toEqual([undefined, undefined]);
  });

  it('take the whole reply, trimmed, for a part read as text', () => {
    expect(answerOfReply({ reason: { from: 'text' } }, '  Too costly this quarter. ')).toEqual({
      reason: 'Too costly this quarter.',
    });
  });
});

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function answeredMeanwhile(playbook: ChatHarness): ConversationLedger {
  const ledger = playbook.ledger.service;
  return {
    ...ledger,
    readProjectedRows: (name, place, query) =>
      Effect.tap(ledger.readProjectedRows(name, place, query), () =>
        Effect.promise(() => playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'reject' } })),
      ),
  };
}

function cancelledMeanwhile(playbook: ChatHarness): ConversationLedger {
  const ledger = playbook.ledger.service;
  return {
    ...ledger,
    readProjectedRows: (name, place, query) =>
      Effect.tap(ledger.readProjectedRows(name, place, query), () => Effect.promise(() => playbook.cancel(runId))),
  };
}

async function repliedInThread(text = 'approve'): Promise<ChatHarness> {
  const playbook = await chatHarness();
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [thread] = playbook.chat.posted().map(({ ts }) => ts);
  playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text });
  return playbook;
}

function readOver(playbook: ChatHarness, ledger: ConversationLedger) {
  const reads = conversationsDue({ ledger, tools: playbook.chat, record: playbook.record });
  const now = Date.now() + farAhead;
  return Effect.runPromise(
    Effect.exit(
      Effect.flatMap(
        Effect.promise(() => dueInBothLanes(reads, now)),
        (items) => onTheStandingClock(Effect.forEach(items, (item) => item.perform(now))),
      ),
    ),
  );
}

describe('a reply taken', () => {
  it('leaves the list of open requests at once, and the due work settles the run from the answer it brought', async () => {
    const playbook = await repliedInThread();

    const exit = await readOver(playbook, playbook.ledger.service);
    const afterReading = [await playbook.firstOpen(), await playbook.runOf(runId)];
    await playbook.performDue(Date.now());

    expect([Exit.isSuccess(exit), ...afterReading]).toMatchObject([true, undefined, { output: { status: 'started' } }]);
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: {} },
    });
    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' }, reply: { sender: answererId } } },
    ]);
  });
});

describe('a reply to a request answered while the conversation was read', () => {
  it('takes nothing, and the answer given first is the one the run takes', async () => {
    const playbook = await repliedInThread();

    await readOver(playbook, answeredMeanwhile(playbook));
    await playbook.performDue(Date.now());

    expect(
      (await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).map(({ type, data }) => [type, data]),
    ).toEqual([
      ['request_answered', { answer: { choice: 'reject' }, answered_by: { id: 'acme-admin', name: 'acme-admin' } }],
    ]);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { output: { choice: 'reject' } } });
  });
});

describe('a reply refused once a cancel of the run was asked while the conversation was read', () => {
  it('records nothing and tells nobody', async () => {
    const playbook = await repliedInThread('maybe later');

    const exit = await readOver(playbook, cancelledMeanwhile(playbook));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await recordsOf(playbook.ledger, 'run_cancel_requested', 'reply_refused', 'telling_started')).toMatchObject([
      { type: 'run_cancel_requested' },
    ]);
    expect(playbook.chat.posted()).toHaveLength(1);
  });
});
