import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { dailyRows, uploadedDailyVisits } from '@on.auto/prediction/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { askedBuild, candidateBytes, digestOf, sentCandidate, standingWhen } from './build-calls.ts';
import { uploaded } from './dataset-uploads.ts';

function hundredsOfVisits(series: string, day: number): number {
  return (series === 'north' ? 130 : 140) + (day % 3);
}

const visitsInHundreds = dailyRows('visits', ['north', 'south'], 40, hundredsOfVisits);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function activeVisitsInHundreds(): Promise<void> {
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await uploaded(server.origin, visitsInHundreds.text);
  await server.call('POST', `${alpha}/definitions/prediction`, {
    body: { name: 'daily-visits', source: uploadedDailyVisits(visitsInHundreds.sha256) },
  });
  const build = await askedBuild(server);
  const candidate = candidateBytes('visits-mean');
  await sentCandidate(server, build, candidate);
  await server.call('POST', `${alpha}/runs/${build}/answer`, {
    body: { answer: { candidates: [digestOf(candidate)] } },
  });
  await standingWhen(server, 'daily-visits', { models: { active: { version: 1 } }, build: null });
}

describe('the plain words for a question to a prediction function over MCP', () => {
  it('say each predicted number in digits with its unit after it, and name no internal term', async () => {
    server = await servingReasoning([]);
    await activeVisitsInHundreds();

    const asked = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) =>
        session.callTool('run_definition', { type: 'prediction', name: 'daily-visits', input: { series: 'north' } }),
    );

    expect(plainTextIn(asked)).toContain(
      'it predicts 131 visits in 2026-10-10 (130 to 132 visits) and 131 visits in 2026-10-11 (130 to 132 visits)',
    );
    expect(internalTermsIn(plainTextIn(asked), ['visits'])).toEqual([]);
  });
});
