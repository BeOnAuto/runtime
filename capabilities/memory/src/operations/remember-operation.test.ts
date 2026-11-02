import { recordingMeter } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { idOf, memoryHarness } from '../testing/index.ts';

const memoryId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const alpha = { org: 'acme', playbook: 'alpha' };

describe('remember, for the playbook or its organization', () => {
  it('keeps a memory for the playbook as its first version, with its tags, its span and when it expires', async () => {
    const harness = memoryHarness();

    const kept = await harness.call(harness.operations.remember, {
      text: 'Ada prefers short answers',
      tags: ['ada', 'style'],
      about: { from: '2026-10-01', to: '2026-10-31' },
      expires: 'P7D',
    });
    const [row] = await harness.rowsOf(alpha);

    expect(kept).toMatchObject({ status: 'succeeded', output: { version: 1, scope: 'playbook' } });
    expect(idOf(kept)).toMatch(memoryId);
    expect(row?.row).toEqual({
      version: 1,
      text: 'Ada prefers short answers',
      characters: 25,
      tags: '["ada","style"]',
      about_from: '2026-10-01',
      about_to: '2026-10-31',
      expires_at: '2026-10-08T09:00:00.000Z',
      written_at: '2026-10-01T09:00:00.000Z',
      written_by: 'acme-admin',
      source_run: null,
      source_definition: null,
      status: 'kept',
    });
  });

  it('keeps a memory for the organization, which every playbook of it recalls', async () => {
    const harness = memoryHarness();

    const kept = await harness.call(harness.operations.remember, { text: 'We bill in euros', scope: 'organization' });
    const recalled = await harness.call(harness.operations.recall, {}, { playbook: 'beta' });

    expect(kept).toMatchObject({ output: { scope: 'organization' } });
    expect(recalled).toMatchObject({ output: { memories: [{ scope: 'organization', text: 'We bill in euros' }] } });
  });
});

describe('remember, replacing a memory', () => {
  it('keeps a new version of the memory it replaces, in the scope it names', async () => {
    const harness = memoryHarness();
    const id = await harness.rememberedId({ text: 'Bill in dollars', scope: 'organization' });

    const replaced = await harness.call(harness.operations.remember, {
      text: 'Bill in euros',
      scope: 'organization',
      replaces: id,
    });
    const elsewhere = await harness.call(harness.operations.remember, { text: 'Bill in yen', replaces: id });

    expect(replaced).toMatchObject({ output: { id, version: 2, scope: 'organization' } });
    expect(elsewhere).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no memory ${id} among the playbook's memories`,
    });
  });

  it('refuses to replace a memory that was forgotten, erased or moved, saying which', async () => {
    const harness = memoryHarness();
    const forgotten = await harness.rememberedId({ text: 'First' });
    const erased = await harness.rememberedId({ text: 'Second' });
    const moved = await harness.rememberedId({ text: 'Third' });
    await harness.call(harness.operations.forget, { id: forgotten });
    await harness.call(harness.operations.forget, { id: erased, erase: true });
    const movedAs = idOf(await harness.call(harness.operations.moveMemory, { id: moved, to: 'organization' }));

    const refusals = await Promise.all(
      [forgotten, erased, moved].map((id) =>
        harness.call(harness.operations.remember, { text: 'Again', replaces: id }),
      ),
    );

    expect(refusals).toMatchObject([
      { reason: 'conflict', detail: `The memory ${forgotten} was forgotten, so no new version can replace it` },
      { reason: 'conflict', detail: `The memory ${erased} was erased, so no new version can replace it` },
      {
        reason: 'conflict',
        detail: `The memory ${moved} was moved to the organization's memories as ${movedAs}, so no new version can replace it`,
      },
    ]);
  });
});

describe('remember, under an id already kept', () => {
  it('refuses to keep a second memory under an id already kept', async () => {
    const harness = memoryHarness({ newId: () => '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });
    await harness.rememberedId({ text: 'First' });

    expect(await harness.call(harness.operations.remember, { text: 'Second' })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The memory 019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a is kept already',
    });
  });
});

describe('remember, out of bounds', () => {
  it('refuses text, a tag, a span, a duration and an id out of bounds, at their fields', async () => {
    const harness = memoryHarness();

    const refused = await harness.call(harness.operations.remember, {
      text: 'x'.repeat(2001),
      tags: ['Upper'],
      about: { from: '2026-10-31', to: '2026-10-01' },
      expires: 'P3651D',
      replaces: 'not-an-id',
    });
    const tooMany = await harness.call(harness.operations.remember, {
      text: 'Tagged',
      tags: Array.from({ length: 9 }, (_, at) => `tag-${at}`),
    });

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        { pointer: '/text' },
        { pointer: '/tags/0' },
        { pointer: '/about' },
        { pointer: '/expires' },
        { pointer: '/replaces' },
      ],
    });
    expect(tooMany).toMatchObject({ status: 'rejected', issues: [{ pointer: '/tags' }] });
    expect(await harness.rowsOf(alpha)).toEqual([]);
  });

  it('refuses a new memory past the most a scope keeps, as memories_full, and still replaces one', async () => {
    const harness = memoryHarness({ mostKept: 1 });
    const id = await harness.rememberedId({ text: 'One' });

    const full = await harness.call(harness.operations.remember, { text: 'Two' });
    const replaced = await harness.call(harness.operations.remember, { text: 'One, again', replaces: id });

    expect(full).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'memories_full',
      detail: 'The playbook already keeps 1 memories, as many as it may: forget some before remembering more',
    });
    expect(replaced).toMatchObject({ status: 'succeeded', output: { version: 2 } });
  });
});

describe('the actions of an agent on its memories, under the meter', () => {
  it('are admitted one each, as the operation and the memory it acts on, before anything is kept', async () => {
    const meter = recordingMeter();
    const harness = memoryHarness({ meter: meter.layer });

    const id = await harness.rememberedId({ text: 'Admitted' });
    await harness.call(harness.operations.recall, {});
    await harness.call(harness.operations.forget, { id });
    meter.refuseNext('license_required');
    const refused = await harness.call(harness.operations.remember, { text: 'Refused' });

    expect(meter.admitted()).toMatchObject([
      { run_id: `remember:${id}`, definition_type: 'memory', definition_name: 'remember', agent_action: true },
      { definition_name: 'recall', started_by: 'acme-admin', agent_action: true },
      { run_id: `forget:${id}`, definition_name: 'forget' },
    ]);
    expect(refused).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'license_required' });
    expect((await harness.rowsOf(alpha)).map(({ row }) => row['text'])).toEqual(['Admitted']);
  });
});

describe('the actions of an agent on its memories that the meter admits on their own, or never sees', () => {
  it('admit each new version of a memory under an id of its own, and meter no remember or forget refused before it acts', async () => {
    const meter = recordingMeter();
    const harness = memoryHarness({ meter: meter.layer, mostKept: 1 });
    const unknown = '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
    const id = await harness.rememberedId({ text: 'First' });

    await harness.call(harness.operations.remember, { text: 'Second', replaces: id });
    const refused = [
      await harness.call(harness.operations.remember, { text: 'No room left' }),
      await harness.call(harness.operations.remember, { text: 'Of no memory', replaces: unknown }),
      await harness.call(harness.operations.forget, { id: unknown }),
    ];
    const [first, second, ...others] = meter.admitted().map(({ run_id: runId }) => runId);

    expect(refused).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'memories_full' },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
    expect(first).toBe(`remember:${id}`);
    expect(second).toMatch(/^remember:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(second).not.toBe(first);
    expect(others).toEqual([]);
  });
});

describe('the words of remember', () => {
  it('say what it kept, a first version or a later one', () => {
    const { plainLanguage } = memoryHarness().operations.remember.registration;

    expect([
      plainLanguage?.attempt({ text: 'x' }),
      plainLanguage?.outcome({ id: 'memory-1', version: 1, scope: 'playbook' }, { text: 'x' }),
      plainLanguage?.outcome({ id: 'memory-1', version: 3, scope: 'playbook' }, { text: 'x' }),
    ]).toEqual([
      'remember it',
      'The playbook remembers it now, and recall finds it.',
      'The playbook remembers it now as version 3 of the memory, which recall finds in place of the version before.',
    ]);
  });
});
