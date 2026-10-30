import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

function detailing(type: string): Capability {
  return defineCapability({
    type,
    title: type,
    guide: { name: type },
    noun: { one: type, other: `${type}s` },
    describeOutput: () => 'It answered.',
    mediaType: 'application/json',
    parse: (source: string) => Effect.orDie(decodeDetails(source)),
    summarize: (details) => ({ details }),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const { createDefinition, getDefinition, listDefinitions, retireDefinition, updateDefinition } =
  definitionOperationsFor([probe().capability, detailing('workflow'), detailing('recall')]);

const toAlpha = toPlaybook('acme', 'alpha');

const plain = { type: 'probe', name: 'plain' };

function checkingPlain(name: string, ...steps: readonly number[]) {
  return {
    type: 'workflow',
    name,
    source: JSON.stringify({
      calls: [{ ...plain, steps: steps.map((number) => ({ number, name: `check-${number}` })) }],
    }),
  };
}

function rememberingPlain(name: string, type: string, attribute: object) {
  return { type: 'recall', name, source: JSON.stringify({ filters: [{ type, ...attribute }] }) };
}

const weeklyReview = {
  type: 'workflow',
  name: 'weekly-review',
  relation: 'calls',
  steps: [
    { number: 1, name: 'check-1' },
    { number: 3, name: 'check-3' },
  ],
};

describe('the definitions get_definition says use a definition', () => {
  it('are the active ones of its playbook, each with its relation, a workflow with the steps that call it', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('stale', 2)));
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'stale' }));
    await call(
      createDefinition,
      toAlpha(acmeAdmin, rememberingPlain('review-history', 'run_succeeded', { subject: 'probe/plain' })),
    );
    await call(
      createDefinition,
      toAlpha(
        acmeAdmin,
        rememberingPlain('plain-changes', 'definition_updated', { source: '/definitions/probe/plain' }),
      ),
    );
    await call(createDefinition, toPlaybook('acme', 'beta')(acmeAdmin, checkingPlain('elsewhere', 1)));

    expect(await call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: {
        used_by: [
          { type: 'recall', name: 'plain-changes', relation: 'remembers-changes' },
          { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
          weeklyReview,
        ],
      },
    });
  });

  it('are left out when none uses it, and not listed by list_definitions', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));

    expect(
      await call(getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' })),
    ).not.toHaveProperty('output.used_by');
    expect(await call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe' }))).not.toHaveProperty(
      'output.definitions.0.used_by',
    );
  });
});

describe('the definitions a saved definition is answered with as using it', () => {
  it('are those saved before it, on create, on update and on retire alike', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));
    const created = await call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    const updated = await call(updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'y' }));
    const retired = await call(retireDefinition, toAlpha(acmeAdmin, plain));

    expect([created, updated, retired]).toMatchObject([
      { status: 'succeeded', output: { version: 1, used_by: [weeklyReview] } },
      { status: 'succeeded', output: { version: 2, used_by: [weeklyReview] } },
      { status: 'succeeded', output: { status: 'retired', used_by: [weeklyReview] } },
    ]);
  });
});
