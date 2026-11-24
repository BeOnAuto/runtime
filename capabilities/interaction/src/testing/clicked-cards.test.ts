import { describe, expect, it } from 'vitest';

import { actionOf, buttonsIn } from './clicked-cards.ts';

describe('the buttons of a message the tests click', () => {
  it('are found by their label, the nth of them, and none is found where there is no such button', () => {
    const shown = [
      { label: 'Approve', action: 'auto-answer:1' },
      { label: 'Approve', action: 'auto-answer:2' },
    ];

    expect([actionOf(shown, 'Approve'), actionOf(shown, 'Approve', 1)]).toEqual(['auto-answer:1', 'auto-answer:2']);
    expect(() => actionOf(shown, 'Reject')).toThrow('No Reject button');
  });

  it('are the buttons of the actions of its blocks, with no label from a context block', () => {
    const blocks = [
      { type: 'actions', elements: [{ action_id: 'auto-answer:1', text: { text: 'Approve' } }] },
      { type: 'context', elements: [{ text: 'Click a button' }] },
      { type: 'divider' },
    ];

    expect(buttonsIn(blocks)).toEqual([{ label: 'Approve', action: 'auto-answer:1' }]);
  });
});
