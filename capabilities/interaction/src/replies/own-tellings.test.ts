import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import { answererId, chatHarness, farAhead, recordsOf, threadDocument } from '../testing/index.ts';

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const toldAboutThePlan: unknown = expect.stringMatching(
  /^About the plan: To answer, reply with one of approve, reject/u,
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
