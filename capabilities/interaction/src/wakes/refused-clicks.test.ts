import { describe, expect, it } from 'vitest';

import { actionOf, clicking, rowsDocument, rowsInputValue } from '../testing/clicked-cards.ts';
import { answererId, recordsOf } from '../testing/index.ts';

const pastTheRoomOfACall = 3_600_000;

describe('a click of someone else', () => {
  it('is refused and told so in the thread, and draws nothing', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'), 'U0STRANGER');

    expect(performed).toMatchObject([{ outcome: 'refused' }]);
    expect(await recordsOf(card.playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'not_the_answerer', delivered: true } },
    ]);
    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toEqual([]);
    expect(card.edits()).toEqual([]);
    expect(card.playbook.chat.posted().at(-1)?.text).toBe(
      "This request is waiting for someone else's answer, so Auto didn't take this click.",
    );
  });

  it('is refused once where it is delivered twice, and left alone where there is no room to tell them', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);
    const action = actionOf(card.shownFirst(), 'Approve');

    const crowded = await card.click(action, 'U0STRANGER', '1699.6', { now: Date.now() - pastTheRoomOfACall });
    const first = await card.click(action, 'U0STRANGER', '1699.6');
    const again = await card.click(action, 'U0STRANGER', '1699.6');

    expect([crowded, first, again]).toMatchObject([
      [{ outcome: 'passed_over' }],
      [{ outcome: 'refused' }],
      [{ outcome: 'passed_over' }],
    ]);
  });
});

describe('a click that is passed over', () => {
  it('counts once where it is delivered twice', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);
    const first = actionOf(card.shownFirst(), 'Approve');

    const performed = [await card.click(first, answererId, '1699.7'), await card.click(first, answererId, '1699.7')];

    expect(performed).toMatchObject([[{ outcome: 'taken' }], [{ outcome: 'passed_over' }]]);
    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toHaveLength(1);
    expect(card.edits()).toHaveLength(1);
  });

  it('names no button the request sent, or comes after the request is answered, or names no message of it', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);
    const shown = card.shownFirst();

    const unknown = await card.click('auto-answer:forged');
    const elsewhere = await card.click(actionOf(shown, 'Approve'), answererId, '1699.4', { to: '1699.404' });
    await card.click(actionOf(shown, 'Approve all'));
    const late = await card.click(actionOf(shown, 'Approve', 0));

    expect([unknown, elsewhere, late]).toMatchObject([
      [{ outcome: 'passed_over' }],
      [{ outcome: 'passed_over' }],
      [{ outcome: 'passed_over' }],
    ]);
  });
});

describe('clicks delivered together', () => {
  it('are taken oldest first, each once, whatever order they came in', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);
    const shown = card.shownFirst();
    const click = (label: string, nth: number, id: string, time: number) => ({
      id,
      sender: answererId,
      to: card.thread,
      action: actionOf(shown, label, nth),
      time,
    });

    const performed = await card.clickAll([
      click('Reject', 1, '1699.9', 3),
      click('Approve', 0, '1699.2', 2),
      click('Approve', 0, '1699.2', 2),
      click('Approve', 1, '1699.1', 2),
    ]);

    expect(performed).toMatchObject([
      { id: '1699.1', outcome: 'taken' },
      { id: '1699.2', outcome: 'taken' },
      { id: '1699.9', outcome: 'passed_over' },
    ]);
  });
});
