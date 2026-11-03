import { askedHandle, filmedBytes, shippedWithAFilm } from '@on.auto/generation/testing';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { gatewayOnTheLoopback, type GatewayOnTheLoopback } from '../testing/servers/generation-server.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const flight = [
  '---',
  'produces: video',
  'model: gateway/example/short-film',
  'parameters: { size: 720x1280, duration: 8 }',
  '---',
  'A drone flight over the warehouse.',
].join('\n');

const filming = `do:
  - film: { call: run_definition, with: { type: generation, name: flight } }
`;

const RunsSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })),
});

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

interface Filming {
  readonly server: ReasoningServer;
  readonly clock: MovedClock;
  readonly workflow: string;
  readonly generation: () => Promise<string>;
}

async function filmed(gateway: GatewayOnTheLoopback, environment: Readonly<Record<string, string>> = {}) {
  const clock = movedClock(Date.now());
  const server = await servingReasoning([], { MODEL_GATEWAYS: gateway.gateways, ...environment }, undefined, {
    clock,
    shippedFilesOver: shippedWithAFilm,
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/generation`, {
    body: { name: 'flight', source: flight, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'filming', source: workflowSource('filming', filming) },
  });
  const started = await server.call('POST', `${alpha}/definitions/workflow/filming/run`, { body: { input: {} } });
  const generation = async () => {
    const [run] = await until(
      async () => decodeRuns((await server.call('GET', `${alpha}/runs?type=generation&name=flight`)).body).runs,
      (runs) => runs.length > 0,
    );
    return String(run?.run_id);
  };
  const made: Filming = { server, clock, workflow: runIdIn(started.body), generation };
  return made;
}

function polledIn(gateway: GatewayOnTheLoopback, polls: number): Promise<unknown> {
  return until(
    () => Promise.resolve(gateway.asked().filter(({ path }) => path === `/v1/videos/${askedHandle}`).length),
    (asked) => asked >= polls,
  );
}

describe('a workflow step that runs a generation function whose video finishes later', () => {
  it('waits while the provider makes the video, as a step that waits on an interaction does, and goes on with the asset once it is kept', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server, clock, workflow, generation } = await filmed(gateway);
    const run = await generation();
    const waiting = [
      (await server.call('GET', `${alpha}/runs/${workflow}`)).body,
      (await server.call('GET', `${alpha}/runs/${run}`)).body,
    ];

    clock.moveTo(Date.now() + 6000);
    await polledIn(gateway, 1);
    clock.moveTo(Date.now() + 60_000);
    const ended = (await settledRun(server, `${alpha}/runs/${workflow}`)).body;

    expect(waiting).toMatchObject([{ status: 'started' }, { status: 'started', record: { handle: askedHandle } }]);
    expect(ended).toMatchObject({
      status: 'succeeded',
      output: { media_type: 'video/mp4', bytes: filmedBytes.byteLength },
    });
    expect((await server.call('GET', `${alpha}/runs/${run}`)).body).toMatchObject({
      status: 'succeeded',
      record: { model: 'gateway/example/short-film', own_key: true, cost_usd: 0.8 },
    });
    expect(gateway.asked().map(({ path }) => path)).toEqual([
      '/v1/videos',
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}/content`,
    ]);
  });
});

describe('a workflow step that runs a generation function whose video is not made in time', () => {
  it('ends the step unavailable once the video is not made within the time a run waits for it', async () => {
    const gateway = await gatewayOnTheLoopback([{ id: askedHandle, status: 'in_progress', progress: 1 }]);
    const { server, clock, workflow, generation } = await filmed(gateway, { GENERATION_WAIT_MINUTES: '1' });
    const run = await generation();

    clock.moveTo(Date.now() + 6000);
    await polledIn(gateway, 1);
    clock.moveTo(Date.now() + 120_000);
    const ended = (await settledRun(server, `${alpha}/runs/${workflow}`)).body;

    expect(ended).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
    expect((await server.call('GET', `${alpha}/runs/${run}`)).body).toMatchObject({
      status: 'rejected',
      rejection: {
        reason: 'unavailable',
        kind: 'generation_timed_out',
        detail:
          'The provider behind the gateway gateway had not made the video when the run had waited 1 minute for it, as long as a run waits; a new run asks for it again',
      },
    });
    expect(gateway.asked().some(({ path }) => path.endsWith('/content'))).toBe(false);
  });
});
