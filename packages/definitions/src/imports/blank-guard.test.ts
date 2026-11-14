import { describe, expect, it } from 'vitest';

import { defineCreateDefinition } from '../operations/create-definition.ts';
import { makeDefinitionOperations } from '../operations/definition-operations.ts';
import { defineResumeDefinition } from '../operations/resume-definition.ts';
import { defineUpdateDefinition } from '../operations/update-definition.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, runContentHolders, toPlaybook } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';

const capabilities = [probe().capability];

const kept = {
  createDefinition: defineCreateDefinition(capabilities, uncheckedPages, { goals: true, messages: true }),
  updateDefinition: defineUpdateDefinition(capabilities, uncheckedPages, { goals: true, messages: true }),
  resumeDefinition: defineResumeDefinition(capabilities, true),
};

const { createDefinition, getDefinition, pauseDefinition, retireDefinition, restoreDefinition, updateDefinition } =
  definitionOperationsFor(capabilities);

const toAlpha = toPlaybook('acme', 'alpha');

const plain = { type: 'probe', name: 'plain' };

const blanked = 'post to AUTO_BLANK_CHANNEL';

const refusedFor = (change: string) => ({
  status: 'rejected',
  reason: 'conflict',
  detail: `Ask the person: What is the value of the blank CHANNEL? The source still holds it on line 1; write the value in its place ${change}`,
});

async function pausedWithABlank() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'post to C04ABC12DE' }));
  await definitions.call(pauseDefinition, toAlpha(acmeAdmin, plain));
  await definitions.call(kept.updateDefinition, toAlpha(acmeAdmin, { ...plain, source: blanked }));
  return definitions;
}

describe('where goals are kept, a definition that still holds a blank, created or saved', () => {
  it('cannot be created active, and nothing is recorded', async () => {
    const definitions = harness();

    expect(await definitions.call(kept.createDefinition, toAlpha(acmeAdmin, { ...plain, source: blanked }))).toEqual(
      refusedFor('before you create it'),
    );
    expect(await definitions.call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({ reason: 'not_found' });
  });

  it('cannot be saved while it is active, the version before kept', async () => {
    const definitions = harness();
    await definitions.call(kept.createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));

    expect(await definitions.call(kept.updateDefinition, toAlpha(acmeAdmin, { ...plain, source: blanked }))).toEqual(
      refusedFor('before you save it, because an active definition cannot keep a blank'),
    );
    expect(await definitions.call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      output: { version: 1, source: 'text' },
    });
  });
});

describe('where goals are kept, a definition that still holds a blank, resumed or restored', () => {
  it('may be saved while it is paused, but not resumed until its value is written in', async () => {
    const definitions = await pausedWithABlank();
    const resumed = await definitions.call(kept.resumeDefinition, toAlpha(acmeAdmin, plain));
    await definitions.call(kept.updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'post to C05XYZ34FG' }));

    expect(resumed).toEqual(refusedFor('with update_definition before you resume it'));
    expect(await definitions.call(kept.resumeDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 3, source: 'post to C05XYZ34FG' },
    });
  });

  it('is restored paused as any retired definition is, and a resumption of an active one records nothing', async () => {
    const definitions = await pausedWithABlank();
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, plain));

    expect(await definitions.call(restoreDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: { status: 'paused', source: blanked },
    });
    await definitions.call(kept.createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'other', source: 'text' }));
    expect(
      await definitions.call(kept.resumeDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'other' })),
    ).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 1 },
    });
  });
});

function creationServedWhereGoalsAreKept() {
  const served = makeDefinitionOperations(
    capabilities,
    uncheckedPages,
    { holders: runContentHolders },
    { goals: true, messages: true },
  ).find(({ registration }) => registration.name === 'create_definition');
  if (served === undefined) {
    throw new Error('The definition operations serve no create_definition');
  }
  return served;
}

describe('the definition operations composed where goals are kept', () => {
  it('refuse a definition that still holds a blank', async () => {
    const definitions = harness();

    expect(
      await definitions.call(creationServedWhereGoalsAreKept(), toAlpha(acmeAdmin, { ...plain, source: blanked })),
    ).toEqual(refusedFor('before you create it'));
  });
});

describe('where goals are not kept, a definition that holds a blank', () => {
  it('is created, saved and resumed as today', async () => {
    const definitions = harness();
    await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
    const updated = await definitions.call(updateDefinition, toAlpha(acmeAdmin, { ...plain, source: blanked }));

    expect(updated).toMatchObject({ status: 'succeeded', output: { status: 'active', version: 2, source: blanked } });
  });
});
