import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, memoryHarness, type MemoryHarness } from '../testing/index.ts';

const ListingSchema = Schema.Struct({
  output: Schema.Struct({
    memories: Schema.Array(
      Schema.Struct({
        text: Schema.NullOr(Schema.String),
        status: Schema.String,
        playbook: Schema.optionalKey(Schema.String),
      }),
    ),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const listingOf = Schema.decodeUnknownSync(ListingSchema);

function cursorAfter({ output }: typeof ListingSchema.Type): string {
  return output.next_cursor ?? '';
}

async function keptAcross(harness: MemoryHarness): Promise<void> {
  const forgotten = await harness.rememberedId({ text: 'Forgotten' }, { at: '2026-10-01T09:00:00.000Z' });
  await harness.call(harness.operations.forget, { id: forgotten });
  await harness.rememberedId({ text: 'Of the team', scope: 'organization' }, { at: '2026-10-02T09:00:00.000Z' });
  await harness.rememberedId({ text: 'Of beta' }, { playbook: 'beta', at: '2026-10-03T09:00:00.000Z' });
  await harness.rememberedId(
    { text: 'Kept', about: { from: '2026-10-01', to: '2026-10-02' } },
    { at: '2026-10-04T09:00:00.000Z' },
  );
}

describe('list_memories of a playbook', () => {
  it("lists the playbook's memories and its organization's, newest first, whatever became of each, a page at a time", async () => {
    const harness = memoryHarness();
    await keptAcross(harness);

    const first = listingOf(await harness.call(harness.operations.listMemories, { limit: 2 }));
    const second = listingOf(
      await harness.call(harness.operations.listMemories, { limit: 2, cursor: cursorAfter(first) }),
    );

    expect(first.output).toMatchObject({
      memories: [
        { text: 'Kept', status: 'kept' },
        { text: 'Of the team', status: 'kept' },
      ],
      has_more: true,
    });
    expect(second.output).toEqual({
      memories: [{ text: 'Forgotten', status: 'forgotten', playbook: 'alpha' }],
      has_more: false,
      next_cursor: null,
    });
  });

  it('refuses a cursor it did not give', async () => {
    const harness = memoryHarness();

    expect(await harness.call(harness.operations.listMemories, { cursor: 'not-a-cursor' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor' }],
    });
  });
});

describe('list_memories of an organization', () => {
  it('lists the memories of the organization and of every playbook of it the caller may read, with the playbook of each', async () => {
    const harness = memoryHarness();
    await harness.playbookCreated('alpha');
    await harness.playbookCreated('beta');
    await keptAcross(harness);

    const everything = listingOf(await harness.callInOrg(harness.operations.listOrgMemories, {}));
    const ofAlpha = listingOf(
      await harness.callInOrg(
        harness.operations.listOrgMemories,
        {},
        { caller: { ...acmeAdmin, playbooks: ['alpha'] } },
      ),
    );

    expect(everything.output.memories).toEqual([
      { text: 'Kept', status: 'kept', playbook: 'alpha' },
      { text: 'Of beta', status: 'kept', playbook: 'beta' },
      { text: 'Of the team', status: 'kept' },
      { text: 'Forgotten', status: 'forgotten', playbook: 'alpha' },
    ]);
    expect(ofAlpha.output.memories.map(({ text }) => text)).toEqual(['Kept', 'Of the team', 'Forgotten']);
  });
});
