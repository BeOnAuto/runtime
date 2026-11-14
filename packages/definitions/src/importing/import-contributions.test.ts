import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { contributesWantedWords, contributionWords } from '../contributions/contribution-words.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { importChecked } from './import-checks.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const decodedDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ steps: Schema.Number, contributes: Schema.optionalKey(Schema.Json) })),
);

const contributing: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedDocument(source)),
  summarize: ({ contributes }) => (contributes === undefined ? {} : { details: { contributes } }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const capabilities = [contributing, probe().capability];

const goals = [
  '- id: paying-customers',
  '  statement: Bring in paying customers through my experiments.',
  '  per: experiment',
  '  success:',
  '    label: New paying customers',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Brought a customer',
  '    failed: Brought no customer',
  '  milestones:',
  '    - { id: chosen, label: Idea chosen, by: person }',
  '    - { id: live, label: Taken live, by: person }',
  '    - { id: measured, label: Measured, by: auto }',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

interface PortableDefinition {
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly paused: boolean;
}

const workflowOf = (name: string, contributes?: unknown): PortableDefinition => ({
  type: 'workflow',
  name,
  source: JSON.stringify(contributes === undefined ? { steps: 1 } : { steps: 1, contributes }),
  paused: false,
});

const WrittenDefinition = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  source: Schema.String,
  paused: Schema.Boolean,
});

const checkImport = defineCommand('playbook', {
  name: 'check_import',
  title: 'Check import',
  description: 'Checks a package as an import does.',
  route: { method: 'POST', path: '/check-import' },
  inputSchema: Schema.Struct({
    goals: Schema.optionalKey(Schema.String),
    definitions: Schema.Array(WrittenDefinition),
  }),
  outputSchema: Schema.Struct({
    issues: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
  }),
  reasons: [],
  handle: ({ goals: held, definitions }) =>
    Effect.map(
      importChecked({
        capabilities,
        pages: uncheckedPages,
        servers: { present: () => Effect.succeed(new Set<string>()) },
        offers: () => true,
      })({ format: 1, ...(held === undefined ? {} : { goals: held }), definitions }),
      ({ issues }) => ({ issues }),
    ),
});

async function issuesOf(definitions: readonly PortableDefinition[], held: string | null = goals) {
  const outcome = await harness().call(
    checkImport,
    toAlpha(acmeAdmin, { ...(held === null ? {} : { goals: held }), definitions }),
  );
  return Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ issues: Schema.Array(Schema.Unknown) }) }))(
    outcome,
  ).output.issues;
}

const measuring = {
  goal: 'paying-customers',
  purpose: 'Measures what each experiment brought in.',
  per_id: '/id',
  marks: 'measured',
};

describe("an import's workflows, against the package's own goals", () => {
  it('are refused as a save refuses them: without contributes, or naming a milestone the goal lacks', async () => {
    const misfit = { ...measuring, marks: 'shipped' };
    expect(await issuesOf([workflowOf('silent'), probeOf('helper'), workflowOf('misfit', [misfit])])).toEqual([
      { pointer: '/package/definitions/0/source', detail: contributesWantedWords },
      {
        pointer: '/package/definitions/2/source/contributes/0/marks',
        detail: contributionWords.unknownMilestone('paying-customers', 'shipped', ['chosen', 'live', 'measured']),
      },
    ]);
  });

  it('pass when they contribute to the goals as a save would take them', async () => {
    expect(await issuesOf([workflowOf('measuring', [measuring]), probeOf('helper')])).toEqual([]);
  });

  it('are not checked against goals the package does not hold, or holds unreadable, which the goals check names', async () => {
    expect(await issuesOf([workflowOf('silent')], null)).toEqual([]);
    expect(await issuesOf([workflowOf('silent')], 'goals')).toEqual([]);
  });
});

function probeOf(name: string): PortableDefinition {
  return { type: 'probe', name, source: 'text', paused: false };
}
