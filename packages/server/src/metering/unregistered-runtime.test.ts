import { problemIn, withMcpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runtimeIdOf } from '../testing/accounts/licensed-server.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated, talliedTimes } from '../testing/servers/tally-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const studio = 'https://studio.example.com';

const atTheEdge = workflowSource(
  'edge',
  `do:
  - first:
      call: run_definition
      with: { type: workflow, name: tally }
  - second:
      try:
        - again: { call: run_definition, with: { type: workflow, name: tally } }
      catch:
        as: refusal
        do:
          - caught: { set: '\${ ({ kind: $refusal.kind, status: $refusal.status }) }' }
`,
);

const usedUp = { state: 'unregistered', free_runs: { used: 100, of: 100 }, key_source: null };

function licenseRequiredOf(runtimeId: string) {
  const page = `${studio}/licenses?installation=${runtimeId}`;
  return {
    kind: 'license_required',
    detail: `This runtime has used its 100 free runs. Get a free key at ${page}, then activate it on the runtime and run this again.`,
    resolve_at: page,
    runtime_id: runtimeId,
  };
}

async function servedWithTally(): Promise<ReasoningServer> {
  const served = await servingWorkflows([], { STUDIO_ORIGIN: studio });
  await tallyCreated(served);
  return served;
}

function talliedOverMcp(served: ReasoningServer) {
  return withMcpSession(
    'current revision',
    { url: `${served.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    (session) => session.callTool('run_definition', { type: 'workflow', name: 'tally', input: {} }),
  );
}

describe('a runtime nobody registered, after its 100 actions', () => {
  let server: ReasoningServer;
  let admitted: readonly TestResponse[];

  beforeAll(async () => {
    server = await servedWithTally();
    admitted = await talliedTimes(server, 100);
  }, 60_000);

  afterAll(async () => {
    await server.stop();
  });

  it('refuses the next run over HTTP as license_required, resolved where Studio registers it by its id', async () => {
    const refused = await tallied(server);
    const problem = { type: 'https://on.auto/problems/license_required', reason: 'conflict' };

    expect(admitted.map(({ status }) => status)).toEqual(Array.from({ length: 100 }, () => 200));
    expect(refused).toMatchObject({
      status: 409,
      body: { ...problem, ...licenseRequiredOf(await runtimeIdOf(server)) },
    });
  });

  it('answers a run asked again under the id of one it ran, which counts nothing more', async () => {
    const first = runIdIn(admitted[0]?.body);

    expect(await tallied(server, { run_id: first })).toMatchObject({ status: 200, body: { run_id: first } });
  });

  it('refuses the next run over MCP as a tool result that is an error, with the problem', async () => {
    const ran = await talliedOverMcp(server);

    expect({ isError: ran.isError, problem: problemIn(ran) }).toMatchObject({
      isError: true,
      problem: { status: 409, ...licenseRequiredOf(await runtimeIdOf(server)) },
    });
  });

  it('still reads its runs, its events and its license, which used its free runs, and takes new definitions', async () => {
    const created = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'later', source: workflowSource('later', 'do:\n  - wait:\n      set: { waited: true }\n') },
    });

    expect((await server.call('GET', `${alpha}/runs`)).status).toBe(200);
    expect((await server.call('GET', `${alpha}/events`)).status).toBe(200);
    expect((await server.call('GET', '/v1/orgs/acme/license')).body).toMatchObject(usedUp);
    expect(created.status).toBe(201);
  });
});

describe('a workflow of a runtime nobody registered, started at its 99th action', () => {
  it('has its first call admitted as the 100th, and its next refused, which it catches', async () => {
    const server = await servedWithTally();
    try {
      await talliedTimes(server, 98);
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'edge', source: atTheEdge } });
      const started = await server.call('POST', `${alpha}/definitions/workflow/edge/run`, { body: { input: {} } });
      const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

      expect(settled).toMatchObject({
        body: { status: 'succeeded', output: { kind: 'license_required', status: 409 } },
      });
    } finally {
      await server.stop();
    }
  }, 60_000);
});
