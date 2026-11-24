import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { clickDelivery } from '../clicks/click-delivery.ts';
import { redrawingConversations } from '../testing/chat-conversations.ts';
import { deliveringTo } from '../testing/delivered-conversations.ts';
import { threadDocument } from '../testing/documents.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { theChannel } from '../testing/woken-conversations.ts';

describe('a request with no button, asked through a provider that draws a message again', () => {
  it('is left as it was where the request has no button, and a sender too long to keep is passed over', async () => {
    const delivering = await deliveringTo({ conversations: redrawingConversations, document: threadDocument() });
    const { playbook, thread } = delivering;
    const delivery = clickDelivery({ ledger: playbook.ledger.service, tools: playbook.chat, record: playbook.record });
    const tooLong = { id: '1699.1', sender: 'x'.repeat(300), to: thread, action: 'auto-answer:1', time: 1 };

    await playbook.performDue(Date.now() + 3 * 86_400_000);
    await playbook.performDue(Date.now() + 3 * 86_400_000);
    const clicked = await Effect.runPromise(
      delivery({ playbook: alpha, connection: 'chat', conversation: theChannel, clicks: [tooLong] }, Date.now()),
    );

    expect(playbook.chat.edits()).toEqual([]);
    expect(clicked).toMatchObject([{ outcome: 'passed_over' }]);
  });
});
