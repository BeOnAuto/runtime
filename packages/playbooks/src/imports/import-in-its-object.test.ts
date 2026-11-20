import { makeDispatcher, StudioLinks, type StudioPage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineImportPlaybookInItsObject } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory, refusedGoals } from '../testing/goals-in-memory.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { importsInItsObjectInMemory } from '../testing/imports-in-its-object-in-memory.ts';
import { refusedDefinition } from '../testing/imports-in-memory.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const toAcme = toOrg('acme');

const goals = '- id: paying-customers\n';

function definitionNamed(name: string) {
  return { type: 'probe', name, source: 'text', paused: false };
}

const five = ['first', 'second', 'third', 'fourth', 'fifth'].map((name) => definitionNamed(name));

const written = { format: 1, page: 'runs: Runs.', goals, definitions: five };

const importing = { playbook: 'alpha', import_id: 'import-one', title: 'Alpha', package: written };

const inAcme = { org: 'acme', playbook: 'alpha' };

const nothingWritten: unknown = expect.stringContaining('nothing was written');

function linkedTo(page?: StudioPage): string {
  return page === undefined ? 'studio:' : `studio:${Object.values(page).join('/')}`;
}

function importer() {
  const kept = goalsInMemory(pagesInMemory());
  const imports = importsInItsObjectInMemory(kept);
  const operation = defineImportPlaybookInItsObject(kept, imports);
  const parts = harness();
  const imported = (input: unknown = importing) =>
    parts.run(
      makeDispatcher([])
        .dispatchToOrg(operation.registration, toAcme(acmeAdmin, input))
        .pipe(Effect.provideService(StudioLinks, linkedTo)),
    );
  return { ...parts, imports, imported };
}

describe('import_playbook where the new playbook’s own object checks and writes', () => {
  it('reserves the id, has the object check and write, then makes the playbook and lets the reservation go', async () => {
    const { imported, imports } = importer();

    expect(await imported()).toEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: '',
        status: 'active',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
        page: { source: written.page },
        goals: { source: goals, versions: [{ id: 'paying-customers', version: 1 }], gaps: [] },
        studio: 'studio:goal/alpha/paying-customers',
        models_not_offered: [],
      },
    });
    expect(imports.copied(inAcme)).toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
    expect(imports.reservedFor(inAcme)).toBeUndefined();
  });
});

describe('import_playbook refused where the new playbook’s own object checks and writes', () => {
  it('refuses goals and definitions that fail together, writes no registry row, and lets the id go', async () => {
    const { imported, imports, ledger } = importer();
    const { goals: _goals, ...withoutGoals } = written;

    expect(
      await imported({
        ...importing,
        package: { ...written, goals: refusedGoals, definitions: [definitionNamed(refusedDefinition)] },
      }),
    ).toMatchObject({
      reason: 'invalid_input',
      detail: nothingWritten,
      issues: [{ pointer: '/package/goals' }, { pointer: '/package/definitions/0' }],
    });
    expect(
      await imported({ ...importing, package: { ...written, definitions: [definitionNamed(refusedDefinition)] } }),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/package/definitions/0' }] });
    expect(await imported({ ...importing, package: withoutGoals })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/package/goals' }],
    });
    expect(ledger.streamNames()).toEqual([]);
    expect(imports.reservedFor(inAcme)).toBeUndefined();
    const { title: _title, ...untitled } = importing;
    const { page: _page, ...withoutAPage } = written;
    expect(await imported({ ...untitled, import_id: 'import-two', package: withoutAPage })).toMatchObject({
      status: 'succeeded',
      output: { name: 'alpha' },
    });
  });
});

describe('import_playbook sent again where the new playbook’s own object checks and writes', () => {
  it('goes on after a cut, keeps the id reserved meanwhile, and answers the same once finished', async () => {
    const { imported, imports } = importer();
    imports.cutAfter(2);

    expect(await imported()).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect([imports.copied(inAcme), imports.reservedFor(inAcme)]).toEqual([['first', 'second'], 'import-one']);
    expect(await imported({ ...importing, import_id: 'import-two' })).toMatchObject({ reason: 'conflict' });
    expect(await imported()).toMatchObject({
      status: 'succeeded',
      output: { goals: { versions: [{ id: 'paying-customers', version: 1 }] } },
    });
    expect(await imported()).toMatchObject({
      status: 'succeeded',
      output: { id: 'alpha', studio: 'studio:goal/alpha/paying-customers' },
    });
    expect(imports.copied(inAcme)).toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
  });

  it('refuses another package or another import of a made playbook, a person’s playbook, and bad goals on a retry', async () => {
    const { imported, call } = importer();
    await imported();

    expect(await imported({ ...importing, package: { ...written, definitions: five.slice(1) } })).toMatchObject({
      reason: 'conflict',
    });
    expect(await imported({ ...importing, import_id: 'import-two' })).toMatchObject({
      reason: 'conflict',
      kind: 'taken',
    });
    expect(await imported({ ...importing, package: { ...written, goals: refusedGoals } })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/package/goals' }],
    });
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    expect(await imported({ ...importing, playbook: 'beta' })).toMatchObject({
      reason: 'conflict',
      kind: 'taken',
      detail: 'There is already a playbook beta in this org',
    });
  });
});
