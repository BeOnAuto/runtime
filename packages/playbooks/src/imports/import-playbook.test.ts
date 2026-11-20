import { makeDispatcher, StudioLinks, type StudioPage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineImportPlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { goalsInMemory, refusedGoals } from '../testing/goals-in-memory.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { importsInMemory, refusedDefinition } from '../testing/imports-in-memory.ts';
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

const goalsNeeded: unknown = expect.stringContaining('needs the goals');

function linkedTo(page?: StudioPage): string {
  return page === undefined ? 'studio:' : `studio:${Object.values(page).join('/')}`;
}

function importer() {
  const pages = pagesInMemory();
  const kept = goalsInMemory(pages);
  const imports = importsInMemory();
  const operation = defineImportPlaybook(kept, imports);
  const parts = harness();
  const imported = (caller = acmeAdmin, input: unknown = importing) =>
    parts.run(
      makeDispatcher([])
        .dispatchToOrg(operation.registration, toAcme(caller, input))
        .pipe(Effect.provideService(StudioLinks, linkedTo)),
    );
  return { ...parts, pages, kept, imports, imported };
}

describe('import_playbook', () => {
  it('makes the playbook with its goals and its page, copies every definition, and answers its goal in Studio', async () => {
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
  });

  it('is named after its id without a title, and has no page without one', async () => {
    const { imported } = importer();
    const { page: _page, ...withoutAPage } = written;

    expect(
      await imported(acmeAdmin, { playbook: 'alpha', import_id: 'import-one', package: withoutAPage }),
    ).toMatchObject({ status: 'succeeded', output: { name: 'alpha' } });
  });
});

describe('import_playbook refused', () => {
  it('refuses a package without goals, or with goals or definitions that fail their checks, and writes nothing', async () => {
    const { imported, imports, ledger } = importer();
    const { goals: _goals, ...withoutGoals } = written;

    expect(await imported(acmeAdmin, { ...importing, package: withoutGoals })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: nothingWritten,
      issues: [{ pointer: '/package/goals', detail: goalsNeeded }],
    });
    expect(
      await imported(acmeAdmin, {
        ...importing,
        package: { ...written, goals: refusedGoals, definitions: [definitionNamed(refusedDefinition)] },
      }),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/package/goals' }, { pointer: '/package/definitions/0' }],
    });
    expect(
      await imported(acmeAdmin, { ...importing, package: { ...written, definitions: [definitionNamed('refused')] } }),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/package/definitions/0' }] });
    expect(ledger.streamNames()).toEqual([]);
    expect(imports.copied(inAcme)).toEqual([]);
  });
});

describe('import_playbook sent again', () => {
  it('goes on after a cut and ends with each definition once, and answers the same once finished', async () => {
    const { imported, imports } = importer();
    imports.cutAfter(2);

    expect(await imported()).toMatchObject({ status: 'rejected' });
    expect(imports.copied(inAcme)).toEqual(['first', 'second']);
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

  it('refuses another package under the same import, and an id another import or a person took', async () => {
    const { imported, call } = importer();
    await imported();

    expect(
      await imported(acmeAdmin, { ...importing, package: { ...written, definitions: five.slice(1) } }),
    ).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await imported(acmeAdmin, { ...importing, import_id: 'import-two' })).toMatchObject({
      reason: 'conflict',
    });
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    expect(await imported(acmeAdmin, { ...importing, playbook: 'beta' })).toMatchObject({
      reason: 'conflict',
      kind: 'taken',
      detail: 'There is already a playbook beta in this org',
    });
  });

  it('refuses to go on in a playbook its importer no longer holds', async () => {
    const { imported, imports, call } = importer();
    imports.cutAfter(1);
    await imported();
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));

    expect(await imported()).toMatchObject({ reason: 'conflict', kind: 'taken' });
    expect(await imported(adaOfAcme)).toMatchObject({ reason: 'conflict', kind: 'taken' });
  });
});
