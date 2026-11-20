import { describe, expect, it } from 'vitest';

import { fellBackMessage } from '../read-model-staging/shadow-comparison.ts';
import type { ReadModelStaged } from '../read-model-testing/staged-ledger.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, type Harness } from '../testing/harness.ts';
import { ranWeekly } from '../testing/moved-runs.ts';
import { answerOf, callsGreet, greet, inAlpha, operations, toAlpha, weekly } from '../testing/moving.ts';
import { renamedIn, renaming, workflowsIn } from '../testing/renaming.ts';

const monthly = { type: 'workflow', name: 'monthly' };

const renamedToMonthly = { type: 'workflow', from: 'weekly', to: 'monthly' };

interface ReadPath {
  readonly path: string;
  readonly readModel?: ReadModelStaged;
}

const readPaths: readonly ReadPath[] = [
  { path: 'its facts' },
  { path: 'the read model', readModel: { stage: 'reads', folds: ['echo', 'workflow'] } },
];

describe.each(readPaths)('a workflow renamed by a fact on its stream, read from $path', ({ readModel }) => {
  it('is found by its new name with its id and version, not by its old one, and is listed once under the new', async () => {
    const definitions = harness(undefined, undefined, readModel);
    await inAlpha(definitions);
    const runId = await ranWeekly(definitions);
    const before = answerOf(await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)));

    await renamedIn(definitions, renamedToMonthly);

    expect([
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, monthly)),
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)),
      await definitions.call(operations.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' })),
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, monthly)),
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, weekly)),
      await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId })),
    ]).toMatchObject([
      { status: 'succeeded', output: { name: 'monthly', definition_id: before['definition_id'], version: 2 } },
      { status: 'rejected', reason: 'not_found' },
      { status: 'succeeded', output: { definitions: [{ name: 'monthly', definition_id: before['definition_id'] }] } },
      { status: 'succeeded', output: { runs: [{ run_id: runId, type: 'workflow', name: 'monthly' }] } },
      { status: 'succeeded', output: { runs: [] } },
      { status: 'succeeded', output: { run_id: runId, type: 'workflow', name: 'monthly' } },
    ]);
    expect(definitions.logged().filter(({ message }) => message === fellBackMessage)).toEqual([]);
  });

  it('frees its old name for another definition, and saves its next version under the new', async () => {
    const definitions = harness(undefined, undefined, readModel);
    await inAlpha(definitions);
    await renamedIn(definitions, renamedToMonthly);
    const answered = [
      await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...weekly, source: callsGreet() })),
      await definitions.call(
        operations.updateDefinition,
        toAlpha(acmeAdmin, { ...monthly, source: callsGreet({ again: true }) }),
      ),
      await definitions.call(operations.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' })),
    ];

    expect(answered).toMatchObject([
      { status: 'succeeded', output: { name: 'weekly', version: 1 } },
      { status: 'succeeded', output: { name: 'monthly', version: 3 } },
      { status: 'succeeded', output: { definitions: [{ name: 'monthly' }, { name: 'weekly' }] } },
    ]);
    expect(answered).not.toHaveProperty('1.output.updated_definitions');
  });
});

const salute = { type: 'echo', name: 'salute' };

const greetToSalute = { ...greet, new_name: 'salute' };

const approve = { type: 'asking', name: 'approve' };

const waiter = { type: 'workflow', name: 'waiter' };

const reading = (named: object) => JSON.stringify({ reads: [named] });

const filteringOn = (subject: string) => ({ on: [{ type: 'run_succeeded', subject }] });

const ofTheRunsOf = (subject: string) => [{ type: 'run_succeeded', subject }];

const countingRunsOf = (subject: string) => ({
  data: {
    language: 'typescript',
    source: { events: [{ type: 'run_succeeded', subject }, { type: 'run_failed' }] },
    views: { counted: 'series' },
    module: 'export function fold(view: View, event: Event): View {\n  return view;\n}',
  },
  runs: '{{ views.counted | json }}',
});

function readWorkflow(definitions: Harness, name: string) {
  return definitions.call(operations.getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name }));
}

const savedAgain = (...names: readonly string[]): readonly Readonly<Record<string, string>>[] =>
  names.map((name) => ({ type: 'workflow', name }));

const refusedInputs: readonly object[] = [
  { ...greetToSalute, source: '{"greeting":"Hi"}' },
  { ...greetToSalute, overview: 'Greets.' },
  { ...greetToSalute, diagram: 'none' },
  { ...greet, new_name: 'greet' },
  greet,
];

async function inAlphaWithItsUsers(definitions: Harness): Promise<void> {
  await inAlpha(definitions);
  await workflowsIn(definitions, {
    report: reading(greet),
    watch: JSON.stringify({ on: [...filteringOn('echo/greet').on, { type: 'com.acme.closed' }] }),
    counts: JSON.stringify({ page: countingRunsOf('echo/greet') }),
    listener: JSON.stringify({ listen: ofTheRunsOf('echo/greet') }),
    forecast: JSON.stringify({ data: ofTheRunsOf('echo/greet') }),
    notified: JSON.stringify({ on: [{ type: 'com.acme.greeted', subject: 'echo/greet' }] }),
    gone: callsGreet(),
  });
  await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'gone' }));
}

const usersAfter: readonly (readonly [string, object])[] = [
  ['weekly', { version: 3, source: callsGreet().replace('"greet"', '"salute"') }],
  ['report', { version: 2, source: reading(salute) }],
  ['watch', { version: 2, triggers: [{ filters: [{ attributes: { subject: 'echo/salute' } }, {}] }] }],
  ['counts', { version: 2, source: JSON.stringify({ page: countingRunsOf('echo/salute') }) }],
  ['listener', { version: 2, source: JSON.stringify({ listen: ofTheRunsOf('echo/salute') }) }],
  ['forecast', { version: 2, source: JSON.stringify({ data: ofTheRunsOf('echo/salute') }) }],
  ['notified', { version: 1, triggers: [{ filters: [{ attributes: { subject: 'echo/greet' } }] }] }],
  ['gone', { version: 1, status: 'retired', source: callsGreet() }],
];

describe('update_definition renaming a function with new_name', () => {
  it('keeps its id and version, and saves each definition that names it again with the new name, in one write', async () => {
    const definitions = harness();
    await inAlphaWithItsUsers(definitions);
    const before = answerOf(await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, greet)));

    expect(await renaming(definitions, greetToSalute)).toMatchObject({
      status: 'succeeded',
      output: {
        ...salute,
        definition_id: before['definition_id'],
        version: 2,
        used_by: [
          { type: 'workflow', name: 'report', relation: 'reads' },
          { type: 'workflow', name: 'weekly', relation: 'calls' },
        ],
        updated_definitions: savedAgain('counts', 'forecast', 'listener', 'report', 'watch', 'weekly'),
      },
    });
    expect(await Promise.all(usersAfter.map(([name]) => readWorkflow(definitions, name)))).toMatchObject(
      usersAfter.map(([, output]) => ({ output })),
    );
  });

  it('keeps its runs, and frees the old name at once', async () => {
    const definitions = harness();
    await inAlphaWithItsUsers(definitions);
    const ran = await definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...greet, input: {} }));
    await renaming(definitions, greetToSalute);

    expect([
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, salute)),
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, greet)),
      await definitions.call(
        operations.createDefinition,
        toAlpha(acmeAdmin, { ...greet, source: '{"greeting":"Hi"}' }),
      ),
    ]).toMatchObject([
      { status: 'succeeded', output: { runs: [{ run_id: answerOf(ran)['run_id'], ...salute }] } },
      { status: 'rejected', reason: 'not_found' },
      { status: 'succeeded', output: { ...greet, version: 1 } },
    ]);
  });
});

describe('update_definition renaming a workflow whose own document names it', () => {
  it('gives it a version of its own with the new name, and answers its runs under the new name', async () => {
    const definitions = harness();
    await inAlpha(definitions, callsGreet(filteringOn('workflow/weekly')));
    const runId = await ranWeekly(definitions);

    const renamed = await renaming(definitions, { ...weekly, new_name: 'monthly' });

    expect(renamed).toMatchObject({
      status: 'succeeded',
      output: {
        name: 'monthly',
        version: 3,
        triggers: [{ filters: [{ attributes: { subject: 'workflow/monthly' } }] }],
      },
    });
    expect(renamed).not.toHaveProperty('output.updated_definitions');
    expect(
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, { type: 'workflow', name: 'monthly' })),
    ).toMatchObject({ output: { runs: [{ run_id: runId }] } });
  });
});

describe('update_definition refusing what it is given for a rename', () => {
  it('refuses new_name with source or the texts of a version, the name it has, and neither, where each is', async () => {
    const definitions = harness();
    await inAlpha(definitions);

    expect(await Promise.all(refusedInputs.map((asked) => renaming(definitions, asked)))).toMatchObject(
      ['/new_name', '/overview', '/diagram', '/new_name', ''].map((pointer) => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer }],
      })),
    );
  });
});

describe('update_definition refusing a rename of what the playbook holds', () => {
  it('refuses a definition not there or retired, and a name held by another, active or retired, changing nothing', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...salute, source: '{"greeting":"Hi"}' }));
    const old = { type: 'echo', name: 'old' };
    await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...old, source: '{"greeting":"Yo"}' }));
    await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, old));
    const active = await renaming(definitions, greetToSalute);
    const retiredHolder = await renaming(definitions, { ...greet, new_name: 'old' });
    await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, salute));

    expect([
      active,
      retiredHolder,
      await renaming(definitions, { type: 'echo', name: 'nobody', new_name: 'somebody' }),
      await renaming(definitions, { ...salute, new_name: 'hail' }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'conflict', kind: 'retired' },
    ]);
    expect(await readWorkflow(definitions, 'weekly')).toMatchObject({ output: { version: 2, source: callsGreet() } });
  });
});

const inProgress = { status: 'rejected', reason: 'conflict', kind: 'runs_in_progress' };

async function renamedWithAWaitingRunOf(source: object) {
  const definitions = harness();
  await inAlpha(definitions);
  await workflowsIn(definitions, { waiter: JSON.stringify({ ...source, waits: true }) });
  await definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...waiter, input: {} }));
  return renaming(definitions, greetToSalute);
}

describe('update_definition refusing a rename while runs have not ended', () => {
  it('refuses while the definition, or a definition that uses it, has a run that has not ended', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...approve, source: 'Approve?' }));
    await workflowsIn(definitions, { waiter: callsGreet({ waits: true }) });
    const refusedAfterRuns = async () => {
      await definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...approve, input: {} }));
      await definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...waiter, input: {} }));
      return [
        await renaming(definitions, { ...approve, new_name: 'agree' }),
        await renaming(definitions, greetToSalute),
      ];
    };
    expect([...(await refusedAfterRuns()), ...(await refusedAfterRuns())]).toMatchObject([
      inProgress,
      inProgress,
      inProgress,
      inProgress,
    ]);
    expect(await readWorkflow(definitions, 'waiter')).toMatchObject({
      output: { version: 1, source: callsGreet({ waits: true }) },
    });
  });

  it('refuses while a definition that awaits its runs has a run that has not ended, and not one that only filters on them', async () => {
    expect([
      await renamedWithAWaitingRunOf({ listen: ofTheRunsOf('echo/greet') }),
      await renamedWithAWaitingRunOf({ data: ofTheRunsOf('echo/greet') }),
    ]).toMatchObject([inProgress, { status: 'succeeded', output: salute }]);
  });
});
