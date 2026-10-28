import { trainerlessDailyVisits, uploadedDailyVisits } from '@on.auto/prediction/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { askedBuild, endedRun, standingWhen, visits } from './build-calls.ts';
import { uploaded } from './dataset-uploads.ts';

const testTimeoutMs = 90_000;

const series = { name: 'series', version: release.version };

const someCandidates: unknown = expect.any(Array);

const HistorySchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Unknown })),
});

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servedWith(source: string): Promise<void> {
  server = await servingReasoning([], { WORKFLOW_SWEEP_INTERVAL: 'PT0.05S' });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  expect(await uploaded(server.origin, visits.text)).toMatchObject({ status: 200 });
  const created = await server.call('POST', `${alpha}/definitions/prediction`, {
    body: { name: 'daily-visits', source },
  });
  expect(created.status).toBe(201);
}

function question(): Promise<{ readonly status: number; readonly body: unknown }> {
  return server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
    body: { input: { series: 'south' } },
  });
}

async function workOf(build: string): Promise<readonly { readonly type: string; readonly data: unknown }[]> {
  const { body } = await server.call('GET', `${alpha}/runs/${build}/history`);
  return Schema.decodeUnknownSync(HistorySchema)(body).events;
}

describe('a prediction function answered by the runtime’s own models', { timeout: testTimeoutMs }, () => {
  it('answers a question from the default forecast before anyone has built, through the extension of the release', async () => {
    await servedWith(uploadedDailyVisits(visits.sha256));

    expect(await question()).toMatchObject({
      status: 200,
      body: {
        status: 'succeeded',
        output: { origin: '2026-10-09', lines: [{ name: 'observed' }, { name: 'predicted' }] },
        record: { version: null, default_forecast: true, runtime: series },
      },
    });
  });

  it('builds, with no trainer named, from the recipes the runtime fits itself, activates the one that beats the baselines and answers with it', async () => {
    await servedWith(trainerlessDailyVisits(visits.sha256));
    const build = await askedBuild(server);
    const ended = await endedRun(server, build);
    await standingWhen(server, 'daily-visits', { models: { active: { version: 1 } }, build: null });
    const work = await workOf(build);
    const fitted = work.find(({ type }) => type === 'candidates_fitted');

    expect(ended).toMatchObject({ status: 'succeeded', output: { version: 1 } });
    expect(work.find(({ type }) => type === 'candidate_uploaded')).toMatchObject({
      data: { format: 'series', runtime: series, signature: { recipe: 'mean' } },
    });
    expect(fitted).toMatchObject({ data: { runtime: series, candidates: someCandidates } });
    expect(work.map(({ type }) => type)).toContain('baseline_scored');
    expect(await question()).toMatchObject({
      status: 200,
      body: { status: 'succeeded', record: { version: 1, runtime: series } },
    });
  });
});
