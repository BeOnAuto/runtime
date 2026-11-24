import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { afterTheParts, failingToRecord, recordingAnswer, recordingParts } from '../testing/click-failures.ts';
import { actionOf, choiceDocument, choiceInputValue, clicking, clickedRun } from '../testing/clicked-cards.ts';
import { recordsOf } from '../testing/index.ts';

describe('a click the run cannot record', () => {
  it('is left unrecorded where its parts cannot be', async () => {
    const card = await clicking(choiceDocument, choiceInputValue, failingToRecord(recordingParts));

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'));

    expect(performed).toMatchObject([{ outcome: 'unrecorded' }]);
  });

  it('is left unrecorded where the answer its parts complete cannot be, and draws nothing', async () => {
    const card = await clicking(choiceDocument, choiceInputValue, failingToRecord(recordingAnswer));

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'));

    expect(performed).toMatchObject([{ outcome: 'unrecorded' }]);
    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toHaveLength(1);
    expect(card.edits()).toEqual([]);
  });
});

describe('a click whose request is answered by someone else while it is taken', () => {
  it('records its parts, finishes nothing, and leaves the other answer as it is', async () => {
    const interfering = async (): Promise<void> => {
      await card.playbook.call(answerInteraction, { run_id: clickedRun, answer: { choice: 'reject' } });
    };
    const card = await clicking(choiceDocument, choiceInputValue, afterTheParts(interfering));

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'));

    expect(performed).toMatchObject([{ outcome: 'taken' }]);
    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'reject' } } },
    ]);
  });
});

describe('a click of someone else, while another click would interfere', () => {
  it('is refused as it would be, the work of its refusal being none of the parts', async () => {
    const card = await clicking(
      choiceDocument,
      choiceInputValue,
      afterTheParts(async () => {}),
    );

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve'), 'U0STRANGER');

    expect(performed).toMatchObject([{ outcome: 'refused' }]);
  });
});

describe('a card drawn again', () => {
  it('is left as it was where the card cannot be drawn with what was answered', async () => {
    const linking = choiceDocument
      .replace('children: [approve, reject]', 'children: [approve, reject, link]')
      .concat(
        [
          '',
          '  link:',
          '    type: LinkButton',
          "    props: { label: Open, url: { $cond: { $state: /answered/choice/by }, $then: nowhere, $else: 'https://example.com' } }",
        ].join('\n'),
      );
    const card = await clicking(linking, choiceInputValue);

    await card.click(actionOf(card.shownFirst(), 'Approve'));

    expect(card.edits()).toEqual([]);
    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toHaveLength(1);
  });
});
