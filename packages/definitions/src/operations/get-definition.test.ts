import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { playbookWithTheWorkflow, resultOfTheGreeting, workflowWithItsPage } from '../testing/page-playbooks.ts';

const someWords: unknown = expect.any(String);

const anId: unknown = expect.any(String);

const { createDefinition, getDefinition, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const plainOverview = 'Keeps the text the team pastes in, as they wrote it.';

async function withActiveAndRetiredDefinitions() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text', overview: plainOverview }),
  );
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale', source: 'old' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }), later);
  return definitions;
}

describe('get_definition', () => {
  it('reads a definition with its document and the overview its author wrote, active or retired, from JSON and from a query string', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain' }))).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'probe',
        name: 'plain',
        definition_id: anId,
        version: 1,
        status: 'active',
        media_type: 'text/plain',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
        source: 'text',
        overview: plainOverview,
      },
    });
    expect(
      await call(getDefinition, asQueryString(toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }))),
    ).toMatchObject({ status: 'succeeded', output: { status: 'retired', retired_at: later, source: 'old' } });
  });
});

describe('get_definition rejecting', () => {
  it('a definition the capability does not have in the playbook, and a type the server does not run', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition plain in this playbook',
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: someWords }],
    });
  });

  it('a malformed name and a field the operation does not know', async () => {
    expect(
      await harness().call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'no_where', verbose: true })),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/verbose' }, { pointer: '/name' }] });
  });
});

const plainRead = {
  type: 'probe',
  name: 'plain',
  definition_id: 'id-of-plain',
  version: 1,
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
  source: 'text',
};

function queuedStanding(queued: number): Readonly<Record<string, unknown>> {
  return { queued, next_queued_start: queued === 0 ? null : '2026-10-01T09:01:00.000Z' };
}

function wordsRead(status: string, standing?: Readonly<Record<string, unknown>>): string | undefined {
  return getDefinition.registration.plainLanguage?.outcome(
    { ...plainRead, status, ...(standing === undefined ? {} : { standing }) },
    { type: 'probe', name: 'plain' },
  );
}

function refusalOf(queued: number): string | undefined {
  return wordsRead('paused', queuedStanding(queued))?.split('; ').at(-1);
}

describe('the words get_definition answers for a definition whose standing has runs queued', () => {
  it('add how many, in use or paused, and nothing when none is queued, for another standing, or once it is retired', () => {
    const added = [
      wordsRead('active', queuedStanding(2)),
      wordsRead('active', queuedStanding(1)),
      wordsRead('paused', queuedStanding(2)),
      wordsRead('paused', queuedStanding(1)),
    ];

    expect(new Set([...added, wordsRead('active'), wordsRead('paused')]).size).toBe(6);
    expect([
      wordsRead('active', queuedStanding(0)),
      wordsRead('active', { dataset: { rows: 3 } }),
      wordsRead('retired', queuedStanding(2)),
    ]).toEqual([wordsRead('active'), wordsRead('active'), wordsRead('retired')]);
  });

  it('say what happens to the runs of a paused workflow one way for one run queued and another for several', () => {
    expect([refusalOf(1), refusalOf(2)]).not.toContain(undefined);
    expect(refusalOf(3)).toBe(refusalOf(2));
    expect(refusalOf(1)).not.toBe(refusalOf(2));
  });
});

function sampleOf(greeting: string): string {
  return JSON.stringify({ greeting, input: {} });
}

describe('a sample output given as JSON text', () => {
  it('is rendered over as the value it holds where the output schema of the definition takes it, and refused as given where not', async () => {
    const { updating, reading, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    const workflow = { type: 'workflow', name: 'morning-social-content' };
    await updating({ ...workflow, source: workflowWithItsPage(resultOfTheGreeting) });
    const rendered = { status: 'succeeded', output: { page: { result: 'Good morning from version 2' } } };

    expect([
      await reading({ ...workflow, render: true, sample_output: sampleOf('Good morning') }),
      await rendering({ ...workflow, sample_output: sampleOf('Good morning') }),
      await rendering({ ...workflow, sample_output: sampleOf('Hi') }),
    ]).toMatchObject([
      rendered,
      rendered,
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/sample_output' }] },
    ]);
  });
});
