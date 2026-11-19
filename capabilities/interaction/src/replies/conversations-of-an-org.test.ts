import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, answererId, beta, chatHarness, farAhead, threadDocument, type ChatHarness } from '../testing/index.ts';
import { flatNamingReplies, flatReplies } from '../testing/reading-documents.ts';

const asked = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const askedToo = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const input = { team: 'sales', owner: answererId, campaign: 'Autumn' };

interface Open {
  readonly playbook: ChatHarness;
  readonly second: () => Promise<unknown>;
}

async function openInOneConversation(replies: readonly string[], inAnotherPlaybook: boolean): Promise<Open> {
  const document = threadDocument({ replies });
  const playbook = await chatHarness({ document, savedByAnEarlierRelease: true });
  const other = inAnotherPlaybook ? playbook.inPlaybook(beta) : playbook.inPlaybook({ org: 'acme', playbook: 'alpha' });
  await other.defineAsAnEarlierRelease('approve-plan', document);
  await playbook.askInThread(asked);
  await other.ask('approve-plan', input, askedToo);
  await playbook.performDue(Date.now());
  return { playbook, second: () => other.runOf(askedToo) };
}

async function decidedIn(playbook: ChatHarness): Promise<readonly unknown[]> {
  const types = ['request_answered', 'reply_refused'];
  const read = (at: PlaybookAddress) =>
    Effect.runPromise(
      playbook.ledger.service.readRecorded(
        at,
        { kind: 'everything' },
        { order: 'asc', limit: 100, types, dataOf: types },
      ),
    );
  const [ofAlpha, ofBeta] = await Promise.all([read(alpha), read(beta)]);
  return [...ofAlpha.records, ...ofBeta.records];
}

function readsOf(playbook: ChatHarness): number {
  return playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies').length;
}

const places = [
  { place: 'two definitions of one playbook', inAnotherPlaybook: false },
  { place: 'two playbooks of one org', inAnotherPlaybook: true },
] as const;

describe('requests of two functions open at once in one conversation whose replies name no message', () => {
  it.each(places)(
    'are read once, by one read, for $place, and a reply that names no message is refused once as ambiguous, answering neither',
    async ({ inAnotherPlaybook }) => {
      const { playbook, second } = await openInOneConversation(flatReplies, inAnotherPlaybook);
      playbook.chat.reply({ channel, user: answererId, text: 'approve' });

      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());

      expect(readsOf(playbook)).toBe(1);
      expect(await decidedIn(playbook)).toMatchObject([
        { type: 'reply_refused', data: { because: 'ambiguous', told: true } },
      ]);
      expect([await playbook.runOf(asked), await second()]).toMatchObject([
        { output: { status: 'started' } },
        { output: { status: 'started' } },
      ]);
    },
  );
});

describe('requests of two functions open at once in one conversation whose replies may name their message', () => {
  it.each(places)(
    'give a reply that names one message, for $place, to that request alone',
    async ({ inAnotherPlaybook }) => {
      const { playbook, second } = await openInOneConversation(flatNamingReplies, inAnotherPlaybook);
      const [, toTheSecond = ''] = playbook.chat.posted().map(({ ts }) => ts);
      playbook.chat.reply({ channel, thread: toTheSecond, user: answererId, text: 'reject' });

      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());

      expect(readsOf(playbook)).toBe(1);
      expect([await playbook.runOf(asked), await second()]).toMatchObject([
        { output: { status: 'started' } },
        { output: { status: 'succeeded', output: { choice: 'reject' } } },
      ]);
    },
  );
});
