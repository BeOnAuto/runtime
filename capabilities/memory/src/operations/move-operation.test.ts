import { Conflict, type Ledger } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { MemoryLedger } from '../capability/memory-ports.ts';
import { idOf, memoryHarness } from '../testing/index.ts';

function refusingTheFirstAppendTo(prefix: string): (ledger: Ledger['Service']) => MemoryLedger {
  let appends = 0;
  return (ledger) => ({
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      Effect.suspend(() => {
        const ofThePrefix = stream.startsWith(prefix);
        appends += ofThePrefix ? 1 : 0;
        return ofThePrefix && appends === 1
          ? Effect.fail(new Conflict({ detail: 'The ledger stopped' }))
          : ledger.execute(stream, decider, command, lineage);
      }),
  });
}

describe('move_memory, from the playbook to its organization', () => {
  it('moves the memory as a new one, which every playbook recalls, and marks the one moved', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({
      text: 'The team ships on Thursdays',
      tags: ['releases'],
      about: { from: '2026-10-01', to: '2026-12-31' },
      expires: 'P90D',
    });

    const moved = await harness.call(harness.operations.moveMemory, { id, to: 'organization' });
    const again = await harness.call(harness.operations.moveMemory, { id, to: 'organization' });
    const recalled = await harness.call(harness.operations.recall, {}, { playbook: 'beta' });

    expect(moved).toMatchObject({ status: 'succeeded', output: { version: 1, scope: 'organization' } });
    expect(idOf(again)).toBe(idOf(moved));
    expect(recalled).toMatchObject({
      output: {
        memories: [{ id: idOf(moved), scope: 'organization', tags: ['releases'], about: { from: '2026-10-01' } }],
      },
    });
    expect((await harness.rowsOf({ org: 'acme', playbook: 'alpha' }))[0]?.row).toMatchObject({ status: 'moved' });
  });

  it('keeps on the new memory where it was moved from, and on the one moved where it went', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Moved with its expiry', expires: 'P90D' });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id, to: 'organization' }));

    expect(await harness.factsOf(`org/acme/memories/${movedAs}`)).toMatchObject([
      {
        type: 'memory_remembered',
        data: {
          version: 1,
          moved_from: { scope: 'playbook', playbook: 'alpha', id },
          expires_at: '2026-12-30T09:00:00.000Z',
        },
      },
    ]);
    expect(await harness.factsOf(`playbook/acme/alpha/memories/${id}`)).toMatchObject([
      { type: 'memory_remembered' },
      { type: 'memory_moved', data: { to: 'organization', as: movedAs } },
    ]);
  });
});

describe('move_memory, cut short', () => {
  it('completes a move cut short after the memory was marked moved, under the same new id, rather than keeping the memory twice', async () => {
    const harness = memoryHarness({ over: refusingTheFirstAppendTo('org/acme/memories/') });
    const id = await harness.rememberedId({ text: 'Moved in two goes' });

    const cut = await harness.call(harness.operations.moveMemory, { id, to: 'organization' });
    const keptThere = await harness.rowsOf({ org: 'acme' });
    const completed = await harness.call(harness.operations.moveMemory, { id, to: 'organization' });

    expect(cut).toMatchObject({ status: 'rejected', detail: 'The ledger stopped' });
    expect(keptThere).toEqual([]);
    expect(completed).toMatchObject({ status: 'succeeded', output: { scope: 'organization' } });
    expect((await harness.rowsOf({ org: 'acme' })).map(({ key }) => key)).toEqual([idOf(completed)]);
    expect((await harness.rowsOf({ org: 'acme', playbook: 'alpha' }))[0]?.row).toMatchObject({ status: 'moved' });
  });
});

describe('move_memory, from the organization and out of bounds', () => {
  it("moves an organization's memory to the playbook that asks", async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Only this playbook needs it', scope: 'organization' });

    const moved = await harness.call(harness.operations.moveMemory, { id, to: 'playbook' }, { playbook: 'beta' });

    expect(await harness.factsOf(`playbook/acme/beta/memories/${idOf(moved)}`)).toMatchObject([
      { data: { moved_from: { scope: 'organization', id } } },
    ]);
  });

  it('refuses a memory that is not in the other scope, and one that was forgotten', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Stays' });
    const forgotten = await harness.rememberedId({ text: 'Gone' });
    await harness.call(harness.operations.forget, { id: forgotten });

    const sameScope = await harness.call(harness.operations.moveMemory, { id, to: 'playbook' });
    const refused = await harness.call(harness.operations.moveMemory, { id: forgotten, to: 'organization' });

    expect([sameScope, refused]).toMatchObject([
      { status: 'rejected', reason: 'not_found', detail: `There is no memory ${id} among the organization's memories` },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: `The memory ${forgotten} was forgotten, so it cannot be moved`,
      },
    ]);
  });
});
