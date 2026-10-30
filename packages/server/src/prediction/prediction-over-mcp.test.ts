import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { publishedVisits, savedVisits, visitsToday } from './published-visits.ts';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('the plain words for a question to a prediction function over MCP', () => {
  it('say each predicted number in digits with its unit after it, the coverage of its ranges and the method, and name no internal term', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const visits = visitsToday();
    await savedVisits(server);
    await publishedVisits(server, visits, { north: 8 });

    const asked = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) =>
        session.callTool('run_definition', { type: 'prediction', name: 'daily-visits', input: { series: 'north' } }),
    );

    expect(plainTextIn(asked)).toContain(
      `From ${visits.dayOf(1)}, it predicts 11 visits in ${visits.dayOf(0)} (10 to 13 visits) and 11 visits in ${visits.dayOf(-1)} (9 to 12 visits), each range meant to hold the truth 8 times in 10, by carrying the last observed value forward.`,
    );
    expect(internalTermsIn(plainTextIn(asked), ['visits'])).toEqual([]);
  });
});
