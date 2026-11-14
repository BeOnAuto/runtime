import { describe, expect, it } from 'vitest';

import { portableExportOf } from '../portable/portable-export.ts';
import { packageDigest } from '../portable/portable-package.ts';
import { acmeAdmin, acmeReader } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { defineExportPlaybook } from './export-playbook.ts';
import { savedGoals, savedPage, savePlaybook } from './playbook-saving.ts';

const capabilities = [echo, { ...echo, type: 'reasoning' }, { ...echo, type: 'workflow' }];

const exportPlaybook = defineExportPlaybook(capabilities, uncheckedPages);

const { createDefinition, pauseDefinition, retireDefinition } = definitionOperationsFor(capabilities);

const toAlpha = toPlaybook('acme', 'alpha');

const greeting = (words: string) => JSON.stringify({ greeting: words });

const overview = 'Mails ops@shop.example\nwith the answer';

const answer = {
  type: 'reasoning',
  name: 'answer',
  source: greeting('answer'),
  overview,
  diagram: 'flowchart LR\n  a --> b',
};

const created = [
  { type: 'workflow', name: 'daily', source: greeting('daily') },
  answer,
  { type: 'echo', name: 'greeter', source: greeting('hello') },
  { type: 'echo', name: 'gone', source: greeting('bye') },
];

const expected = {
  format: 1,
  page: savedPage,
  goals: savedGoals,
  definitions: [
    { ...answer, paused: false },
    { type: 'echo', name: 'greeter', source: greeting('hello'), paused: true },
    { type: 'workflow', name: 'daily', source: greeting('daily'), paused: false },
  ],
};

async function aPlaybookWithEverything(definitions: Harness): Promise<void> {
  await definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals: savedGoals }));
  const creating = (hour: number) =>
    definitions.call(createDefinition, toAlpha(acmeAdmin, created[hour]), `2026-10-01T1${hour}:00:00.000Z`);
  await creating(0);
  await creating(1);
  await creating(2);
  await creating(3);
  await definitions.call(pauseDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greeter' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'gone' }));
}

describe('the export of a playbook', () => {
  it('holds no page, no goals and no definition where the playbook has none, with the digest of that package', async () => {
    const definitions = harness();

    expect(await definitions.call(exportPlaybook, toAlpha(acmeReader))).toEqual({
      status: 'succeeded',
      output: {
        format: 1,
        digest: packageDigest({ format: 1, definitions: [] }),
        definitions: [],
        needs: { connections: [], types: [], models: [] },
        findings: [],
      },
    });
  });

  it('holds the page and goals as saved and every active and paused definition, functions first, each as it was created', async () => {
    const definitions = harness();
    await aPlaybookWithEverything(definitions);

    expect(await definitions.call(exportPlaybook, toAlpha(acmeReader))).toEqual({
      status: 'succeeded',
      output: {
        ...expected,
        digest: packageDigest(expected),
        needs: { connections: [], types: ['echo', 'reasoning', 'workflow'], models: [] },
        findings: portableExportOf(expected).findings,
      },
    });
  });

  it('finds a value wherever it occurs, by the definition and the text that holds it', () => {
    expect(
      portableExportOf(expected).findings.map(({ value, occurrences }) => ({ value, occurrences })),
    ).toContainEqual({
      value: 'ops@shop.example',
      occurrences: [{ part: 'definition', name: 'reasoning/answer', field: 'overview', line: 1 }],
    });
  });

  it('takes no query parameters', async () => {
    const definitions = harness();

    expect(await definitions.call(exportPlaybook, asQueryString(toAlpha(acmeReader, { all: 'true' })))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });
});
