import { describe, expect, it } from 'vitest';

import { redrawingConversations } from '../testing/chat-conversations.ts';
import { actionOf, buttonsIn, choiceDocument, choiceInputValue, clicking } from '../testing/clicked-cards.ts';
import { deliveringTo } from '../testing/delivered-conversations.ts';
import { recordsOf } from '../testing/index.ts';

describe('a card of one question with buttons', () => {
  it('finishes on the first click, with no mark on a message and no button left', async () => {
    const card = await clicking(choiceDocument, choiceInputValue);

    await card.click(actionOf(card.shownFirst(), 'Reject'));

    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'reject' } } },
    ]);
    expect(card.playbook.chat.reactions()).toEqual([]);
    expect(card.shownLast()).toEqual([]);
  });

  it('is still answered by a reply in its thread, and then draws no button', async () => {
    const delivering = await deliveringTo({ conversations: redrawingConversations, document: choiceDocument });

    const reply = delivering.written('approve');
    await delivering.delivered([reply]);

    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' }, reply: { id: reply.id } } },
    ]);
    expect(buttonsIn(delivering.playbook.chat.edits().at(-1)?.blocks)).toEqual([]);
  });

  it('is told of no button where it has no blocks', () => {
    expect(buttonsIn()).toEqual([]);
  });
});
