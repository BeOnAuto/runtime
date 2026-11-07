import type { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ada, listedOf } from '../testing/harness.ts';
import { financeAndSales } from '../testing/scenario.ts';

function playbooksReadAtOnce() {
  const reading = new Map<string, number>();
  const most = { playbooks: 0 };
  const began = (playbook: string) =>
    Effect.sync(() => {
      reading.set(playbook, (reading.get(playbook) ?? 0) + 1);
      most.playbooks = Math.max(most.playbooks, reading.size);
    });
  const ended = (playbook: string) =>
    Effect.sync(() => {
      const left = (reading.get(playbook) ?? 0) - 1;
      if (left === 0) {
        reading.delete(playbook);
      } else {
        reading.set(playbook, left);
      }
    });
  const watched = <A, E, R>(playbook: string | undefined, read: Effect.Effect<A, E, R>) =>
    playbook === undefined
      ? read
      : Effect.acquireUseRelease(
          began(playbook),
          () => Effect.andThen(Effect.yieldNow, read),
          () => ended(playbook),
        );
  const reads = (ledger: Ledger['Service']): Ledger['Service'] => ({
    ...ledger,
    readProjectedRows: (projection, address, query) =>
      watched(address.playbook, ledger.readProjectedRows(projection, address, query)),
    countProjectedRows: (projection, address, where) =>
      watched(address.playbook, ledger.countProjectedRows(projection, address, where)),
  });
  return { most, reads };
}

describe('the playbooks list_activity reads', () => {
  it('are read at once, each playbook’s rows beside the others’, and answered as they are kept', async () => {
    const watching = playbooksReadAtOnce();
    const watched = await financeAndSales(watching.reads);
    const unwatched = await financeAndSales();

    const [listed, asKept] = [listedOf(await watched.list(ada)), listedOf(await unwatched.list(ada))];

    expect(listed).toEqual(asKept);
    expect(watching.most.playbooks).toBe(2);
  });
});
