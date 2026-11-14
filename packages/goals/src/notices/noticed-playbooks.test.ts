import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { noticeBookOf, owner, sales } from './notice-samples.ts';
import { noticedKeptOf, noticedPlaybookIn, type NoticedPlaybook } from './noticed-playbooks.ts';

describe('the playbook a notice is sent for', () => {
  it('is unknown before it is created, then active with its owner, retired, and active again once restored', async () => {
    const book = noticeBookOf();
    const noticed = noticedPlaybookIn(book.ledger);
    const before = await Effect.runPromise(noticed(sales));
    await book.playbookCreated();
    await book.playbookFact('playbook_created', {
      playbook: 'other',
      name: 'Other',
      description: 'Other',
      created_by: { id: 'person:ben', name: 'Ben' },
    });
    await book.playbookFact('playbook_updated', { playbook: 'sales', name: 'Sales again' });
    const created = await Effect.runPromise(noticed(sales));
    await book.playbookRetired();
    const retired = await Effect.runPromise(noticed(sales));
    await book.playbookFact('playbook_restored', { playbook: 'sales' });
    const restored = await Effect.runPromise(noticed(sales));

    expect([before, created, retired, restored]).toEqual([
      { status: 'unknown' },
      { status: 'active', owner },
      { status: 'retired', owner },
      { status: 'active', owner },
    ]);
  });
});

describe('the playbook a notice is sent for, kept a while', () => {
  it('is asked once for every notice of a piece of work, and again once the while has passed', async () => {
    const asked: string[] = [];
    const clock = { now: 0 };
    const held: { answer: NoticedPlaybook } = { answer: { status: 'active', owner } };
    const kept = noticedKeptOf(
      ({ playbook }) =>
        Effect.sync(() => {
          asked.push(playbook);
          return held.answer;
        }),
      { keptMs: 5000, now: () => clock.now },
    );
    const first = await Promise.all(Array.from({ length: 10 }, () => Effect.runPromise(kept(sales))));
    clock.now = 5000;
    held.answer = { status: 'retired', owner };
    const later = await Effect.runPromise(kept(sales));

    expect(first).toEqual(Array.from({ length: 10 }, () => ({ status: 'active', owner })));
    expect([later, asked]).toEqual([{ status: 'retired', owner }, ['sales', 'sales']]);
  });
});
