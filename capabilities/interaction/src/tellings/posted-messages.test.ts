import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  answered,
  answeredInAFile,
  answererId,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const ended = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const channel = '#approvals-sales';

describe('the message of a request that has ended', () => {
  it('is never read as a reply in a chat without threads whose connection posts as the person who answers', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    await playbook.call(answerInteraction, { run_id: ended, answer: { choice: 'approve' } });
    await playbook.performDue(Date.now());
    await playbook.askInThread(waiting);
    await playbook.performDue(Date.now());

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toMatchObject([
      { type: 'request_answered', context: { runId: ended } },
    ]);
    expect(playbook.chat.posted()).toHaveLength(2);
  });
});

describe('a telling whose answer names the message it posted but not its conversation', () => {
  it('is the last its request makes, since the playbook cannot know where it landed', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'maybe' });
    playbook.chat.answerNext(
      answered({ messages: [{ ts: '1699.000002', channel, user: answererId, text: 'maybe' }] }),
      answered({ ok: true, ts: '1699.000003' }),
    );
    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.reply({ channel, user: answererId, text: 'later' });

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect((await recordsOf(playbook.ledger, 'reply_refused')).map(({ data }) => data)).toMatchObject([
      { told: true },
      { told: false },
    ]);
  });
});

describe('a telling whose tool answered where its message landed in a file', () => {
  it('knows the message it posted from the text of the file', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'maybe' });
    playbook.chat.answerNext(
      answered({ messages: [{ ts: '1699.000002', channel, user: answererId, text: 'maybe' }] }),
      answeredInAFile({ ok: true, channel, ts: '1699.000003' }),
    );

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'telling_succeeded')).toMatchObject([
      { data: { told_as: { conversation: channel, id: '1699.000003' } } },
    ]);
  });
});
