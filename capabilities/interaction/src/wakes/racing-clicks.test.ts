import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { settled } from '../schedule/request-ledger.ts';
import { interferingBeforeTheFirstEdit } from '../testing/click-failures.ts';
import { actionOf, clicking, clickedRun, rowsDocument, rowsInputValue } from '../testing/clicked-cards.ts';
import { recordsOf } from '../testing/index.ts';
import { alpha } from '../testing/interaction-harness.ts';

describe('two clicks close together', () => {
  it('leave the message showing the newest state, though the older click draws its card after the newer', async () => {
    const holder = { second: (): Promise<unknown> => Promise.resolve() };
    const card = await clicking(
      rowsDocument,
      rowsInputValue,
      undefined,
      interferingBeforeTheFirstEdit(() => holder.second()),
    );
    const shown = card.shownFirst();
    holder.second = () => card.click(actionOf(shown, 'Reject', 1), undefined, '1699.2');

    await card.click(actionOf(shown, 'Approve', 0), undefined, '1699.1');

    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(card.edits().length).toBeGreaterThanOrEqual(3);
    expect(card.shownLast()).toEqual([]);
    expect(card.edits().at(-1)?.text).toContain('Reject, by');
    expect(card.edits().at(-1)?.text).toContain('Approve, by');
  });
});

describe('a request that is cancelled after a click', () => {
  it('draws its card again as closed, with no button', async () => {
    const card = await clicking(rowsDocument, rowsInputValue);

    await card.click(actionOf(card.shownFirst(), 'Approve', 0));
    await card.playbook.cancel(clickedRun);
    const cancelled = { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: 'Cancelled' } as const;
    await Effect.runPromise(
      settled(card.playbook.ledger.service, { ...alpha, id: clickedRun }, cancelled, {
        causationId: null,
        correlationId: clickedRun,
      }),
    );
    await card.playbook.performDue(Date.now());
    await card.playbook.performDue(Date.now() + 1000);

    expect(card.shownLast()).toEqual([]);
    expect(card.edits().at(-1)?.text).toContain('Closed without an answer');
  });
});
