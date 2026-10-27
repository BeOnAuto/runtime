import { movedClock } from '@on.auto/workflow-host/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallyCreated, talliedTimes } from '../testing/servers/tally-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const aMinuteAndASecond = 61_000;

const closing = workflowSource(
  'close-the-month',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { closed: true } }\n',
);

function closed(served: ReasoningServer): Promise<TestResponse> {
  return served.call('POST', `${alpha}/events`, {
    body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } } },
  });
}

describe('a trigger of a runtime nobody registered, after its 100 actions', () => {
  it('starts no run, and its refusal is recorded as a refused reaction that names the license', async () => {
    const clock = movedClock(Date.now());
    const server = await servingWorkflows([], {}, undefined, clock);
    onTestFinished(() => server.stop());
    await tallyCreated(server);
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'close-the-month', source: closing } });
    await talliedTimes(server, 100);
    const refusals = await until(
      async () => {
        await closed(server);
        clock.moveTo(clock.now() + aMinuteAndASecond);
        return server.call('GET', `${alpha}/events?type=reaction_refused`);
      },
      (response) => JSON.stringify(response.body).includes('reaction_refused'),
    );
    const runs = await server.call('GET', `${alpha}/runs?type=workflow&name=close-the-month`);

    expect(JSON.stringify(refusals.body)).toContain('license');
    expect(runs.body).toMatchObject({ runs: [] });
  }, 60_000);
});
