import { computationBounds } from '@on.auto/computation';
import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { checkingWithin } from '@on.auto/definitions/testing';
import { programPool } from '@on.auto/workflow-engine/dsl';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const blockingOnTwoRows = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { parentPort, threadId } from 'node:worker_threads';",
      'let jobs = 0;',
      "parentPort.on('message', ({ job, request }) => {",
      '  jobs += 1;',
      '  if (JSON.parse(request.arguments[0]).rows.length === 2) { while (true) {} }',
      '  const output = JSON.stringify({ jobs, thread: threadId });',
      "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
      '});',
    ].join('\n'),
  )}`,
);

const decodeRan = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }) }),
);

const timerSlackMs = 2;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function ran(rows: number) {
  return server.call('POST', `${alpha}/definitions/computation/pace/run`, { body: { input: campaignRows(rows) } });
}

async function ranOn(rows: number) {
  return decodeRan((await ran(rows)).body).output;
}

describe('a run of a computation function that does not end by itself, over HTTP', () => {
  it('is unavailable once its warm worker is terminated at the deadline, while another worker answers and the server answers other requests', async () => {
    server = await servingReasoning([], {}, undefined, {
      programPoolOf: ({ workers }) =>
        checkingWithin(
          programPool({ workers, heapMegabytes: computationBounds.heapMegabytes, worker: blockingOnTwoRows }),
        ),
    });
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'pace', source: campaignPace } });
    const warm = await ranOn(3);
    const started = performance.now();
    const settled = { run: false };

    const running = ran(2).then((response) => {
      settled.run = true;
      return { response, milliseconds: performance.now() - started };
    });
    const meanwhile = await server.call('GET', `${alpha}/definitions/computation/pace`);
    const elsewhere = await ranOn(3);
    const answeredFirst = !settled.run;
    const { response, milliseconds } = await running;
    const after = await ranOn(3);

    expect(meanwhile).toMatchObject({ status: 200, body: { name: 'pace' } });
    expect([answeredFirst, elsewhere.jobs]).toEqual([true, 1]);
    expect(elsewhere.thread).not.toBe(warm.thread);
    expect(response).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'The run took longer than the 10000 ms a computation function may run, and was stopped',
      },
    });
    expect(milliseconds).toBeGreaterThanOrEqual(computationBounds.deadlineMs - timerSlackMs);
    expect(after).toEqual({ jobs: 2, thread: elsewhere.thread });
  });
});
