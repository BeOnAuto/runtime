import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  askedBuild,
  buildRoute,
  builtFrom,
  candidateBytes,
  candidateRecipe,
  digestOf,
  endedRun,
  readOf,
  refusedBeforeTheBody,
  savedVisits,
  sentCandidate,
  standingWhen,
} from './build-calls.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const testTimeoutMs = 90_000;

const mebibyte = 1_048_576;

const signature = candidateRecipe('visits-mean');

const refusedAtFormat = {
  status: 422,
  body: {
    reason: 'invalid_input',
    errors: [
      {
        pointer: '/format',
        detail: 'The format graph is not one this server executes for this function, which takes series',
      },
    ],
  },
};

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], { WORKFLOW_SWEEP_INTERVAL: 'PT0.05S', ...environment });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

describe('a build of a prediction function over HTTP', { timeout: testTimeoutMs }, () => {
  it('serves its trainer the brief and the rows, takes a candidate, the same bytes again alike, with its one format named or left out, scores it and builds a version', async () => {
    const server = await serving();
    await savedVisits(server);
    const build = await askedBuild(server);
    const brief = await readOf(server, buildRoute(build, 'brief'));
    const rows = await readOf(server, buildRoute(build, 'rows'));
    const listed = await server.call('GET', `${alpha}/interactions?to=trainer`);
    const candidate = candidateBytes('visits-mean');
    const uploaded = await sentCandidate(server, build, candidate);
    const elsewise = await sentCandidate(server, build, candidate, 'graph');
    const unnamed = await sentCandidate(server, build, candidate, null);
    const answered = await server.call('POST', `${alpha}/runs/${build}/answer`, {
      body: { answer: { candidates: [digestOf(candidate)] } },
    });
    const ended = await endedRun(server, build);

    expect([brief.status, brief.type, rows.status, rows.type]).toEqual([200, 'text/markdown', 200, 'text/csv']);
    expect(brief.text).toBe(
      'Fit a model of the daily visits of each of 2 stores.\n\n## Candidates\n\nEach upload of a candidate takes a file in the format series.\n',
    );
    expect(rows.text.split('\r\n').slice(0, 2)).toEqual(['series,period,visits', 'north,2026-09-16,11']);
    expect(listed.body).toMatchObject({
      interactions: [{ run_id: build, type: 'prediction', function: 'daily-visits' }],
    });
    expect([uploaded, unnamed]).toEqual([
      { status: 200, body: { candidate: digestOf(candidate), bytes: candidate.length, format: 'series', signature } },
      { status: 200, body: { candidate: digestOf(candidate), bytes: candidate.length, format: 'series', signature } },
    ]);
    expect(elsewise).toMatchObject(refusedAtFormat);
    expect(answered.status).toBe(200);
    expect(ended).toMatchObject({
      status: 'succeeded',
      output: {
        version: 1,
        winner: digestOf(candidate),
        candidates: [{ sha256: digestOf(candidate), verdict: 'won' }],
      },
    });
  });
});

describe('the version a build over HTTP builds', { timeout: testTimeoutMs }, () => {
  it('is activated, answers a question, and is refused when it is activated again, as is a version not built', async () => {
    const server = await serving();
    await builtFrom(server, 'visits-mean');
    const standing = await standingWhen(server, 'daily-visits', { models: { active: { version: 1 } }, build: null });
    const asked = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
      body: { input: { series: 'south' } },
    });
    const activated = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/activate`, {
      body: { version: 1 },
    });
    const unbuilt = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/activate`, {
      body: { version: 2 },
    });

    expect(standing).toMatchObject({ standing: { dataset: { kind: 'uploaded' } } });
    expect(asked).toMatchObject({
      status: 200,
      body: {
        status: 'succeeded',
        record: { version: 1, runtime: { name: 'series' }, coverage: 0.8, origin: '2026-10-09' },
      },
    });
    expect(asked.body).toHaveProperty('output', {
      unit: 'visits',
      period: 'day',
      origin: '2026-10-09',
      lines: [
        {
          name: 'observed',
          points: [
            { at: '2026-10-06', value: 20 },
            { at: '2026-10-07', value: 21 },
            { at: '2026-10-08', value: 22 },
            { at: '2026-10-09', value: 20 },
          ],
        },
        {
          name: 'predicted',
          points: [
            { at: '2026-10-10', value: 21, low: 19.93204116821289, high: 22.06795883178711 },
            { at: '2026-10-11', value: 21, low: 19.93204116821289, high: 22.06795883178711 },
          ],
        },
      ],
    });
    expect([activated.status, activated.body]).toEqual([409, expect.objectContaining({ kind: 'already_active' })]);
    expect(unbuilt.status).toBe(404);
  });
});

describe('the routes a trainer calls', { timeout: testTimeoutMs }, () => {
  it('refuse a candidate with no Content-Length and one that says it is past 64 MiB before they read the body, and answer a run there is not as not found', async () => {
    const server = await serving();
    await savedVisits(server);
    const build = await askedBuild(server);
    const other = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

    const unsized = await refusedBeforeTheBody(server, build, {
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked',
    });
    const large = await refusedBeforeTheBody(server, build, {
      'content-type': 'application/octet-stream',
      'content-length': String(65 * mebibyte),
    });
    const missing = await readOf(server, `${alpha}/runs/${other}/build/brief`);

    expect([unsized.status, large.status]).toEqual([411, 413]);
    expect([missing.status, JSON.parse(missing.text)]).toEqual([
      404,
      expect.objectContaining({ reason: 'not_found', detail: 'There is no such run in this playbook' }),
    ]);
  });
});
