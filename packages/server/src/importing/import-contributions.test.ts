import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const goals = [
  '- id: orders',
  '  statement: Answer every order the same day.',
  '  success:',
  '    label: Orders answered',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Answered',
  '    failed: Missed',
  '  milestones:',
  '    - { id: received, label: Order in, by: auto }',
  '    - { id: approved, label: Approved, by: person }',
  '    - { id: answered, label: Answered, by: auto }',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

function workflowSource(contributes: readonly string[]): string {
  return [
    'document:',
    "  dsl: '1.0.3'",
    '  namespace: sales',
    '  name: answered',
    "  version: '1.0.0'",
    'do:',
    '  - answered:',
    '      set:',
    '        answered: true',
    ...contributes,
  ].join('\n');
}

const contributing = (marks: string) => [
  'contributes:',
  '  - goal: orders',
  '    purpose: Answers each order.',
  `    marks: ${marks}`,
];

const importPath = '/v1/orgs/acme/playbooks/import';

const contributesWanted: unknown = expect.stringContaining('add contributes');

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function importOf(contributes: readonly string[], importId: string) {
  return {
    body: {
      playbook: 'copied',
      import_id: importId,
      package: {
        format: 1,
        goals,
        definitions: [{ type: 'workflow', name: 'answered', source: workflowSource(contributes), paused: false }],
      },
    },
  };
}

describe('an import whose workflows a save would refuse, on a server that keeps goals', () => {
  it('is refused with the words a save gives, under the definition, and writes nothing until the workflow fits', async () => {
    server = await servingReasoningWithGoals([], {});

    const misfit = await server.call('POST', importPath, importOf(contributing('shipped'), 'misfit'));
    expect(misfit).toMatchObject({
      status: 422,
      body: {
        errors: [
          {
            pointer: '/package/definitions/0/source/contributes/0/marks',
            detail:
              'The goal orders has no milestone shipped; mark one of its milestones: received, approved, answered',
          },
        ],
      },
    });
    expect(await server.call('POST', importPath, importOf([], 'silent'))).toMatchObject({
      status: 422,
      body: {
        errors: [{ pointer: '/package/definitions/0/source', detail: contributesWanted }],
      },
    });
    expect(await server.call('GET', '/v1/orgs/acme/playbooks/copied')).toMatchObject({ status: 404 });

    expect(await server.call('POST', importPath, importOf(contributing('answered'), 'fits'))).toMatchObject({
      status: 201,
    });
    expect(await server.call('GET', '/v1/orgs/acme/playbooks/copied/definitions/workflow')).toMatchObject({
      status: 200,
      body: { definitions: [{ name: 'answered', status: 'paused' }] },
    });
  });
});
