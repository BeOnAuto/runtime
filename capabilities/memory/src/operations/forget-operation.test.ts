import { ScrubRefused } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { idOf, memoryHarness, type MemoryHarness } from '../testing/index.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function ofThePlaybook(id: string): string {
  return `playbook/acme/alpha/memories/${id}`;
}

function ofTheOrganization(id: string): string {
  return `org/acme/memories/${id}`;
}

async function textsIn(harness: MemoryHarness, stream: string): Promise<readonly (string | null)[]> {
  const facts = await harness.factsOf(stream);
  return facts.flatMap((fact) => (fact.type === 'memory_remembered' ? [fact.data.text] : []));
}

async function typesIn(harness: MemoryHarness, stream: string): Promise<readonly string[]> {
  return (await harness.factsOf(stream)).map(({ type }) => type);
}

describe('forget', () => {
  it('forgets a memory, so no recall finds it, and answers as before when asked again', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Wrong all along' });

    const forgotten = await harness.call(harness.operations.forget, { id });
    const again = await harness.call(harness.operations.forget, { id });

    expect([forgotten, again]).toMatchObject([
      { status: 'succeeded', output: { id, scope: 'playbook', status: 'forgotten' } },
      { status: 'succeeded', output: { id, scope: 'playbook', status: 'forgotten' } },
    ]);
    expect(await typesIn(harness, ofThePlaybook(id))).toEqual(['memory_remembered', 'memory_forgotten']);
    expect((await harness.rowsOf(alpha))[0]?.row).toMatchObject({ status: 'forgotten', text: 'Wrong all along' });
  });

  it("finds a memory of the organization by its id, and refuses an id neither the playbook's nor the organization's memories hold", async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Of the team', scope: 'organization' });

    const forgotten = await harness.call(harness.operations.forget, { id });
    const unknown = await harness.call(harness.operations.forget, { id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

    expect(forgotten).toMatchObject({ output: { scope: 'organization', status: 'forgotten' } });
    expect(unknown).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail:
        "There is no memory 019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a among the playbook's memories or its organization's",
    });
  });

  it('refuses to forget a memory that was moved, naming the memory it was moved as', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Moved away' });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id, to: 'organization' }));

    expect(await harness.call(harness.operations.forget, { id })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: `The memory ${id} was moved to the organization's memories as ${movedAs}, so forget the memory it was moved as`,
    });
  });
});

describe('forget, erasing the text', () => {
  it('forgets the memory, then erases the text, tags and days of every version of it from the ledger, each erasure a fact, and leaves who wrote it, when, and when it expires', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({
      text: 'A secret',
      tags: ['private'],
      about: { from: '2026-10-01', to: '2026-10-31' },
      expires: 'P30D',
    });
    await harness.call(harness.operations.remember, { text: 'A newer secret', replaces: id });

    const erased = await harness.call(
      harness.operations.forget,
      { id, erase: true },
      { at: '2026-10-02T09:00:00.000Z' },
    );
    const again = await harness.call(harness.operations.forget, { id, erase: true });
    const forgottenAfter = await harness.call(harness.operations.forget, { id });

    expect([erased, again, forgottenAfter]).toMatchObject([
      { output: { status: 'erased' } },
      { output: { status: 'erased' } },
      { output: { status: 'erased' } },
    ]);
    expect(await harness.factsOf(ofThePlaybook(id))).toMatchObject([
      { type: 'memory_remembered', context: { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' } },
      { type: 'memory_remembered', data: { version: 2, text: null, tags: [], replaces_version: 1 } },
      { type: 'memory_forgotten', data: { version: 2 } },
      { type: 'memory_erased', data: { version: 2 } },
      { type: 'memory_erased', data: { version: 1 } },
    ]);
    expect((await harness.factsOf(ofThePlaybook(id)))[0]?.data).toEqual({
      version: 1,
      tags: [],
      expires_at: '2026-10-31T09:00:00.000Z',
      text: null,
      erased_at: '2026-10-02T09:00:00.000Z',
    });
    expect(await typesIn(harness, ofThePlaybook(id))).toHaveLength(5);
    expect((await harness.rowsOf(alpha))[0]?.row).toMatchObject({
      status: 'erased',
      text: null,
      characters: 0,
      tags: '[]',
      about_from: null,
      about_to: null,
    });
  });
});

describe('forget, erasing the text of a memory that moved', () => {
  it('erases a memory that was moved together with the memory it was moved as, whichever of the two is named', async () => {
    const harness = memoryHarness();
    const first = await harness.rememberedId({ text: 'Moved, then erased' });
    const second = await harness.rememberedId({ text: 'Moved, then erased by its new id' });
    const firstAs = idOf(await harness.call(harness.operations.moveMemory, { id: first, to: 'organization' }));
    const secondAs = idOf(await harness.call(harness.operations.moveMemory, { id: second, to: 'organization' }));

    await harness.call(harness.operations.forget, { id: first, erase: true });
    await harness.call(harness.operations.forget, { id: secondAs, erase: true });

    expect([
      await textsIn(harness, ofThePlaybook(first)),
      await textsIn(harness, ofTheOrganization(firstAs)),
      await textsIn(harness, ofThePlaybook(second)),
      await textsIn(harness, ofTheOrganization(secondAs)),
    ]).toEqual([[null], [null], [null], [null]]);
  });

  it("erases a memory moved from the organization's memories together with the one it was moved from", async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Of the team, then of alpha', scope: 'organization' });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id, to: 'playbook' }));

    await harness.call(harness.operations.forget, { id: movedAs, erase: true });

    expect([await textsIn(harness, ofTheOrganization(id)), await textsIn(harness, ofThePlaybook(movedAs))]).toEqual([
      [null],
      [null],
    ]);
  });

  it('says why the text could not be erased where the ledger refuses the scrub', async () => {
    const harness = memoryHarness({
      over: (ledger) => ({
        ...ledger,
        scrubFact: () => Effect.fail(new ScrubRefused({ because: 'not_its_shape', detail: 'The data does not fit' })),
      }),
    });
    const id = await harness.rememberedId({ text: 'Kept for good' });

    expect(await harness.call(harness.operations.forget, { id, erase: true })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: `The text of the memory ${id} could not be erased: The data does not fit`,
    });
  });
});

describe('the words of forget', () => {
  it('say whether it forgot a memory or erased it too', () => {
    const { plainLanguage } = memoryHarness().operations.forget.registration;
    const id = '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

    expect([
      plainLanguage?.attempt({ id }),
      plainLanguage?.outcome({ id, scope: 'playbook', status: 'forgotten' }, { id }),
      plainLanguage?.outcome({ id, scope: 'playbook', status: 'erased' }, { id }),
    ]).toEqual([
      'forget the memory',
      'The memory is forgotten: no recall finds it any more.',
      'The memory is forgotten, and its text is erased from the ledger.',
    ]);
  });
});
