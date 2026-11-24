import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { clickAwaited, replyAwaited } from '../index.ts';
import { failingToRecord, recordingRefusals } from '../testing/click-failures.ts';
import {
  actionOf,
  choiceInputValue,
  clickedRun,
  clickingIn,
  quietRowsDocument,
  rowsInputValue,
} from '../testing/clicked-cards.ts';
import { answererId, notificationDocument, recordsOf } from '../testing/index.ts';
import { alpha } from '../testing/interaction-harness.ts';

const cardInADirectMessage = () => clickingIn(quietRowsDocument, rowsInputValue, answererId);

describe('a card with buttons and no replies, sent to a person in a direct message', () => {
  it('takes a click, keeps its parts, draws the card again and leaves the request open', async () => {
    const card = await cardInADirectMessage();

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve', 0));

    expect(performed).toMatchObject([{ outcome: 'taken' }]);
    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toHaveLength(1);
    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toEqual([]);
    expect(card.edits()).toHaveLength(1);
    expect(card.shownLast().map(({ label }) => label)).toEqual(['Approve', 'Reject', 'Approve all']);
    expect(card.edits().at(-1)?.text).toContain('Approve, by U024BE7LH');
  });

  it('finishes with the right output on the click that completes the answer, and leaves no button', async () => {
    const card = await cardInADirectMessage();
    const shown = card.shownFirst();

    await card.click(actionOf(shown, 'Approve', 0));
    await card.click(actionOf(shown, 'Reject', 1));
    await card.playbook.performDue(Date.now());

    expect(await card.playbook.runOf(clickedRun)).toMatchObject({
      output: { status: 'succeeded', output: { decisions: { a: 'approve', b: 'reject' } } },
    });
    expect(card.shownLast()).toEqual([]);
    expect(JSON.stringify(card.edits().at(-1)?.blocks)).toContain(`Reject, by <@${answererId}>`);
  });
});

describe('a card with buttons and no replies, as someone else clicks it', () => {
  it('refuses a click of someone else, and counts a click delivered twice once', async () => {
    const card = await cardInADirectMessage();
    const action = actionOf(card.shownFirst(), 'Approve', 0);

    const stranger = await card.click(action, 'U0STRANGER');
    const first = await card.click(action, answererId, '1699.1');
    const again = await card.click(action, answererId, '1699.1');

    expect([stranger, first, again]).toMatchObject([
      [{ outcome: 'refused' }],
      [{ outcome: 'taken' }],
      [{ outcome: 'passed_over', because: 'seen' }],
    ]);
    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toHaveLength(1);
  });

  it('tells the person who may not answer, in the thread of the card, once for each refusal up to the cap', async () => {
    const card = await cardInADirectMessage();
    const action = actionOf(card.shownFirst(), 'Approve', 0);

    await Promise.all(['1', '2', '3', '4', '5'].map((id) => card.click(action, 'U0STRANGER', `1699.${id}`)));
    const lines = card.playbook.chat.posted().slice(1);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.at(-1)).toMatchObject({
      thread_ts: card.thread,
      text: "This request is waiting for someone else's answer, so Auto didn't take this click.",
    });
  });
});

describe('a card with buttons and no replies, as its request ends', () => {
  it('draws the card again as closed where the request expires', async () => {
    const card = await cardInADirectMessage();

    await card.click(actionOf(card.shownFirst(), 'Approve', 0));
    await card.playbook.performDue(Date.now() + 3 * 86_400_000);
    await card.playbook.performDue(Date.now() + 3 * 86_400_000);

    expect(card.shownLast()).toEqual([]);
    expect(card.edits().at(-1)?.text).toContain('Closed without an answer');
  });
});

describe('a click that cannot be taken', () => {
  it('says why where the request is known: a button it did not send is recorded as refused, one after it ended is passed over as closed', async () => {
    const card = await cardInADirectMessage();
    const action = actionOf(card.shownFirst(), 'Approve all');

    const forged = await card.click('auto-answer:forged');
    await card.click(action);
    const late = await card.click(action, answererId, '1699.77');

    expect(forged).toMatchObject([{ outcome: 'passed_over', because: 'unknown_button' }]);
    expect(late).toMatchObject([{ outcome: 'passed_over', because: 'closed' }]);
    expect(await recordsOf(card.playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'unknown_button', told: false, delivered: true } },
    ]);
  });

  it('says why where no request was sent as the message', async () => {
    const card = await cardInADirectMessage();

    const performed = await card.click(actionOf(card.shownFirst(), 'Approve', 0), answererId, '1699.5', {
      to: '1699.404',
    });

    expect(performed).toMatchObject([{ outcome: 'passed_over', because: 'no_request' }]);
  });
});

describe('a click on a button the request did not send, where the refusal cannot be recorded', () => {
  it('is still passed over as such', async () => {
    const recording = failingToRecord(recordingRefusals);
    const card = await clickingIn(quietRowsDocument, rowsInputValue, answererId, recording);

    const performed = await card.click('auto-answer:forged');

    expect(performed).toMatchObject([{ outcome: 'passed_over', because: 'unknown_button' }]);
    expect(await recordsOf(card.playbook.ledger, 'reply_refused')).toEqual([]);
  });
});

describe('a click on the message of a notification', () => {
  it('is passed over, since a notification sent no button', async () => {
    const card = await clickingIn(notificationDocument(), choiceInputValue, '#approvals-U024BE7LH');

    const performed = await card.click('auto-answer:forged');

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
  });
});

describe('a request with buttons and no replies, as the door of the cloud asks about it', () => {
  it('waits for a click and for no reply', async () => {
    const card = await cardInADirectMessage();
    const ledger = card.playbook.ledger.service;
    const place = { playbook: alpha, connection: 'chat', conversation: answererId };
    const asked = { id: '1699.1', sender: answererId, to: card.thread };

    const [forClick, forReply] = await Promise.all([
      Effect.runPromise(clickAwaited({ ledger })(place, asked)),
      Effect.runPromise(replyAwaited({ ledger })(place, asked)),
    ]);

    expect([forClick.awaited, forReply.awaited]).toEqual([true, false]);
  });
});
