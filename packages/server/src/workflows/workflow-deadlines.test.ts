import type { ProgramPool, ProgramRun } from '@on.auto/workflow-engine/dsl';
import { Function } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';

const pastItsDeadline: ProgramRun = {
  ran: 'exhausted',
  limit: 'deadline',
  issue: { detail: 'The program ran past its deadline', line: null },
  work: 0,
};

const counting = workflowSource('counting', "do:\n  - count: { set: { n: '${ 1 + 1 }' } }\n");

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function unitPastItsDeadline() {
  return { evaluate: Function.constant(pastItsDeadline), close: Function.constVoid };
}

function decidingPastTheDeadline(pool: ProgramPool): ProgramPool {
  const { machine } = pool.evaluations;
  return { ...pool, evaluations: { ...pool.evaluations, machine: { ...machine, unit: unitPastItsDeadline } } };
}

const poolOf: ProgramPoolOf = (settings) => decidingPastTheDeadline(patientWorkerPool(settings));

describe('the start of a workflow whose expressions run past the deadline of an input, over HTTP', () => {
  it('is unavailable, naming the expression, the deadline of an input and the step', async () => {
    server = await servingWorkflows([], {}, poolOf);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'counting', source: counting } });

    const started = await server.call('POST', `${alpha}/definitions/workflow/counting/run`, { body: { input: {} } });

    expect(started).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail:
          '1 + 1: The program ran past its deadline: the expressions of one input may take 2000 ms, at the step count.',
      },
    });
  });
});
