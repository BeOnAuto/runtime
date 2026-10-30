import type { CheckRequest, ProgramPool } from '@on.auto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const hundred = workflowSource(
  'hundred',
  [
    'do:',
    ...Array.from({ length: 100 }, (_, index) => `  - step${index}: { set: { n: '\${ ($data.n ?? 0) + ${index} }' } }`),
    '',
  ].join('\n'),
);

const refused = workflowSource(
  'refused',
  ['do:', "  - count: { set: { n: '${ $data.n + }' } }", "  - read: { set: { n: '${ $nope.n }' } }", ''].join('\n'),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function recordingChecks(): { readonly checked: readonly CheckRequest[]; readonly poolOf: ProgramPoolOf } {
  const checked: CheckRequest[] = [];
  const recording = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    check: (request, signal) => {
      checked.push(request);
      return pool.check(request, signal);
    },
  });
  return { checked, poolOf: (settings, handed) => recording(patientWorkerPool(settings, handed)) };
}

function saving(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source } });
}

describe('the expressions of a workflow, checked when it is saved, over HTTP', () => {
  it('checks nothing when the server starts, then a hundred expressions as one job, saves the workflow, and runs it', async () => {
    const { checked, poolOf } = recordingChecks();
    server = await servingWorkflows([], {}, poolOf);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const saved = await saving('hundred', hundred);
    const started = await server.call('POST', `${alpha}/definitions/workflow/hundred/run`, { body: { input: {} } });

    expect(saved).toMatchObject({
      status: 201,
      body: { type: 'workflow', name: 'hundred', version: 1, source: hundred },
    });
    expect(checked.map(({ expressions }) => expressions.length)).toEqual([100]);
    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: { status: 'succeeded', output: { n: 4950 } },
    });
  });

  it('refuses an expression that is not one, and one that names what its place lacks, at their lines', async () => {
    server = await servingWorkflows([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    expect(await saving('refused', refused)).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail:
              'Line 7, column 24: at /do/0/count/set/n: Expression expected; an expression is one TypeScript expression over $data, $context, $workflow, $runtime, $task, $input',
          },
          { pointer: '/source', detail: "Line 8, column 23: at /do/1/read/set/n: Cannot find name '$nope'." },
        ],
      },
    });
  });
});
