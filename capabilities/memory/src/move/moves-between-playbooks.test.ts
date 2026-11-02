import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { idOf, memoryHarness, type MemoryHarness } from '../testing/index.ts';

interface ErasedMidMove {
  readonly harness: MemoryHarness;
  readonly erasures: readonly Outcome[];
  readonly arm: (id: string) => void;
}

function erasedOnceTheMoveMarksIt(): ErasedMidMove {
  const erasures: Outcome[] = [];
  let armed: string | undefined;
  const erasing = (id: string) =>
    Effect.map(
      Effect.promise(() => harness.call(harness.operations.forget, { id, erase: true })),
      (erased) => {
        erasures.push(erased);
      },
    );
  const harness: MemoryHarness = memoryHarness({
    over: (ledger) => ({
      ...ledger,
      execute: (stream, decider, command, lineage) => {
        const source = stream.startsWith('org/acme/memories/') ? armed : undefined;
        armed = source === undefined ? armed : undefined;
        const between = source === undefined ? Effect.void : erasing(source);
        return Effect.andThen(between, ledger.execute(stream, decider, command, lineage));
      },
    }),
  });
  return {
    harness,
    erasures,
    arm: (id) => {
      armed = id;
    },
  };
}

async function textsIn(harness: MemoryHarness, stream: string): Promise<readonly (string | null)[]> {
  const facts = await harness.factsOf(stream);
  return facts.flatMap((fact) => (fact.type === 'memory_remembered' ? [fact.data.text] : []));
}

describe("a memory of the organization's, moved into a playbook", () => {
  it('names the playbook it went to, and refuses a move into another playbook, naming where it went', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Moved twice', scope: 'organization' });

    const intoAlpha = await harness.call(harness.operations.moveMemory, { id, to: 'playbook' });
    const intoBeta = await harness.call(harness.operations.moveMemory, { id, to: 'playbook' }, { playbook: 'beta' });
    const againIntoAlpha = await harness.call(harness.operations.moveMemory, { id, to: 'playbook' });

    expect(await harness.factsOf(`org/acme/memories/${id}`)).toMatchObject([
      { type: 'memory_remembered' },
      { type: 'memory_moved', data: { to: 'playbook', as: idOf(intoAlpha), playbook: 'alpha' } },
    ]);
    expect(intoBeta).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: `The memory ${id} was moved to the memories of the playbook alpha as ${idOf(intoAlpha)}, so it cannot be moved`,
    });
    expect(idOf(againIntoAlpha)).toBe(idOf(intoAlpha));
    expect(await harness.rowsOf({ org: 'acme', playbook: 'beta' })).toEqual([]);
    expect((await harness.rowsOf({ org: 'acme', playbook: 'alpha' })).map(({ key }) => key)).toEqual([idOf(intoAlpha)]);
  });

  it('is erased by its id from any playbook, together with the memory it was moved as in the playbook that keeps it', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Secret of the team', scope: 'organization' });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id, to: 'playbook' }));

    const erased = await harness.call(harness.operations.forget, { id, erase: true }, { playbook: 'beta' });
    const recalled = await harness.call(harness.operations.recall, {}, { playbook: 'alpha' });

    expect(erased).toMatchObject({ status: 'succeeded', output: { id, scope: 'organization', status: 'erased' } });
    expect([
      await textsIn(harness, `org/acme/memories/${id}`),
      await textsIn(harness, `playbook/acme/alpha/memories/${movedAs}`),
    ]).toEqual([[null], [null]]);
    expect(recalled).toMatchObject({ status: 'succeeded', output: { memories: [] } });
    expect((await harness.rowsOf({ org: 'acme', playbook: 'alpha' }))[0]?.row).toMatchObject({
      status: 'erased',
      text: null,
    });
  });
});

describe("a memory of a playbook's, moved to its organization", () => {
  it('is erased by the id it was moved as from another playbook, together with the memory it was moved from', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Learned by alpha' });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id, to: 'organization' }));

    const erased = await harness.call(harness.operations.forget, { id: movedAs, erase: true }, { playbook: 'beta' });

    expect(erased).toMatchObject({ status: 'succeeded', output: { id: movedAs, status: 'erased' } });
    expect([
      await textsIn(harness, `org/acme/memories/${movedAs}`),
      await textsIn(harness, `playbook/acme/alpha/memories/${id}`),
    ]).toEqual([[null], [null]]);
  });
});

describe('a memory erased while it is moved', () => {
  it('keeps no copy where the erase lands after the move marked the memory and before it wrote the copy', async () => {
    const { harness, erasures, arm } = erasedOnceTheMoveMarksIt();
    const id = await harness.rememberedId({ text: 'Secret moved while erased' });
    arm(id);

    const moved = await harness.call(harness.operations.moveMemory, { id, to: 'organization' });
    const recalled = await harness.call(harness.operations.recall, {}, { playbook: 'beta' });

    expect(erasures).toMatchObject([{ status: 'succeeded', output: { id, status: 'erased' } }]);
    expect(moved).toMatchObject({ status: 'succeeded', output: { scope: 'organization' } });
    expect(await harness.factsOf(`org/acme/memories/${idOf(moved)}`)).toMatchObject([
      { type: 'memory_forgotten', data: { version: 0 } },
    ]);
    expect(await harness.factsOf(`org/acme/memories/${idOf(moved)}`)).toHaveLength(1);
    expect(await harness.rowsOf({ org: 'acme' })).toEqual([]);
    expect(recalled).toMatchObject({ status: 'succeeded', output: { memories: [] } });
    expect(await textsIn(harness, `playbook/acme/alpha/memories/${id}`)).toEqual([null]);
  });
});
