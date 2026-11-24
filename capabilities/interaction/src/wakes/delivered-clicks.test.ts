import { takesAnswerKey } from '@on.auto/tool-servers/policy';
import { describe, expect, it } from 'vitest';

import { actionOf, clicking, clickedRun, rowsDocument, rowsInputValue } from '../testing/clicked-cards.ts';
import { answererId, recordsOf } from '../testing/index.ts';

describe('a card of two rows of buttons and an Approve all', () => {
  it('shows each row its buttons, and Approve all', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    expect(card.shownFirst().map(({ label }) => label)).toEqual([
      'Approve',
      'Reject',
      'Approve',
      'Reject',
      'Approve all',
    ]);
  });

  it('keeps the request open after the click that sets one row, and draws the card again without that row', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'));

    expect(performed).toMatchObject([{ outcome: 'taken' }]);
    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toEqual([]);
    expect(card.edits()).toHaveLength(1);
    expect(card.shownLast().map(({ label }) => label)).toEqual(['Approve', 'Reject', 'Approve all']);
    expect(card.playbook.chat.calls().at(-1)?.meta).toMatchObject({ [takesAnswerKey]: true });
  });
});

describe('the second click on a card of two rows', () => {
  it('finishes with the right output, and leaves no button', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);
    const shown = card.shownFirst();

    await card.click(actionOf(shown, 'Approve', 0));
    await card.click(actionOf(shown, 'Reject', 1));
    await card.playbook.performDue(Date.now());

    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toMatchObject([
      {
        data: {
          answer: { decisions: { a: 'approve', b: 'reject' } },
          reply: { sender: answererId, to: card.thread },
          delivered: true,
        },
      },
    ]);
    expect(await card.playbook.runOf(clickedRun)).toMatchObject({
      output: { status: 'succeeded', output: { decisions: { a: 'approve', b: 'reject' } } },
    });
    expect(card.edits()).toHaveLength(2);
    expect(card.shownLast()).toEqual([]);
  });

  it('is not needed where Approve all sets both rows', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    await card.click(actionOf(card.shownFirst(), 'Approve all'));

    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { decisions: { a: 'approve', b: 'approve' } } } },
    ]);
    expect(card.shownLast()).toEqual([]);
  });

  it('draws the card again with no button when the request expires', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    await card.click(actionOf(card.shownFirst(), 'Approve'));
    await card.playbook.performDue(Date.now() + 3 * 86_400_000);
    await card.playbook.performDue(Date.now() + 3 * 86_400_000);

    expect(card.edits()).toHaveLength(2);
    expect(card.shownLast()).toEqual([]);
  });
});
