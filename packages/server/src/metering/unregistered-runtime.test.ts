import { problemIn, withMcpSession } from '@on.auto/api/testing';
import type { HostClock } from '@on.auto/workflow-host';
import { movedClock } from '@on.auto/workflow-host/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runtimeIdOf } from '../testing/accounts/licensed-server.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated, talliedTimes } from '../testing/servers/tally-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

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

const usedUp = {
  state: 'unregistered',
  free_runs: { used: 100, of: 100 },
  fallback: { per_day: 15, per_month: 75, used_today: 15, used_this_month: 15 },
  key_source: null,
};

function tomorrowOf(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
}

function licenseRequiredOf(runtimeId: string) {
  const page = `${studio}/licenses?installation=${runtimeId}`;
  return {
    kind: 'license_required',
    detail: `This runtime has used its 100 free runs. Without a license key, it runs at the free rate of 15 runs a UTC day and 75 a UTC month. It has used today's 15 free runs and can run again at 00:00 UTC on ${tomorrowOf(new Date())}. To run more, get a free key at ${page}, then activate it on the runtime.`,
    because: 'free_daily_limit',
    resolve_at: page,
    runtime_id: runtimeId,
  };
}

async function servedWithTally(clock?: HostClock): Promise<ReasoningServer> {
  const served = await servingWorkflows([], { STUDIO_ORIGIN: studio }, undefined, clock);
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

describe('a runtime nobody registered, after its 100 free runs and the 15 of the day', () => {
  let server: ReasoningServer;
  let admitted: readonly TestResponse[];

  beforeAll(async () => {
    server = await servedWithTally();
    admitted = await talliedTimes(server, 115);
  }, 120_000);

  afterAll(async () => {
    await server.stop();
  });

  it('refuses the next run over HTTP as license_required, saying when it can run again and where Studio registers it', async () => {
    const refused = await tallied(server);
    const problem = { type: 'https://on.auto/problems/license_required', reason: 'conflict' };

    expect(admitted.map(({ status }) => status)).toEqual(Array.from({ length: 115 }, () => 200));
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

  it('still reads its runs, its events and its license, which used its free runs for the day, and takes new definitions', async () => {
    const created = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'later', source: workflowSource('later', 'do:\n  - wait:\n      set: { waited: true }\n') },
    });

    expect((await server.call('GET', `${alpha}/runs`)).status).toBe(200);
    expect((await server.call('GET', `${alpha}/events`)).status).toBe(200);
    expect((await server.call('GET', '/v1/orgs/acme/license')).body).toMatchObject(usedUp);
    expect(created.status).toBe(201);
  });
});

describe('a workflow of a runtime nobody registered, started at its 114th run of a day', () => {
  it('has its first call admitted as the 115th, waits at its next for a license, saying where to get a key, and reaches its catch 24 hours on', async () => {
    const clock = movedClock(Date.now());
    const server = await servedWithTally(clock);
    try {
      await talliedTimes(server, 113);
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'edge', source: atTheEdge } });
      const started = await server.call('POST', `${alpha}/definitions/workflow/edge/run`, { body: { input: {} } });
      const run = runIdIn(started.body);
      const history = await until(
        () => server.call('GET', `${alpha}/runs/${run}/history?limit=100`),
        ({ body }) => JSON.stringify(body).includes('waits for a license'),
      );
      clock.moveTo(clock.now() + 24 * 60 * 60_000);
      const settled = await settledRun(server, `${alpha}/runs/${run}`);

      expect(JSON.stringify(history.body)).toContain(licenseRequiredOf(await runtimeIdOf(server)).resolve_at);
      expect(settled).toMatchObject({
        body: { status: 'succeeded', output: { kind: 'license_required', status: 409 } },
      });
    } finally {
      await server.stop();
    }
  }, 120_000);
});
