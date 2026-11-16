import type { RunEvent } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { now, runId, runKey, startOf } from '../testing/attempt-leases/left-by-dead-processes.ts';
import { as, endedOn, startedAfter, writer } from '../testing/attempt-leases/servers-after-dead-processes.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const callStarted: RunEvent = {
  type: 'tool_call_started',
  data: { number: 1, call_id: 'toolu_1', server: 'slack', tool: 'post_message', arguments_bytes: 2 },
};

const diedLongAgo = now - 1;

describe('a run within its call whose process died while it called a tool that may change something', () => {
  it('is ended once the lease of its attempt lapsed, saying whether that call did is not known, and is not run again under its id', async () => {
    const { server } = await startedAfter(
      {
        type: 'interaction',
        name: 'post',
        events: [startOf({ calls_tools: true }), callStarted],
        leases: [[`attempt/${runKey}/process-that-died/1`, 'process-that-died', diedLongAgo]],
      },
      [writer],
    );

    const ended = await endedOn(server, writer);
    const again = await server.call('POST', `${alpha}/definitions/interaction/post/run`, {
      body: { input: {}, run_id: runId },
      ...as(writer),
    });

    expect(ended.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'conflict', kind: 'effect_unknown', because: 'call_outcome_unknown' },
    });
    expect(again).toMatchObject({ status: 409, body: { kind: 'tools_called' } });
  });
});

describe('a run within its call whose process died after it took the lease of its attempt and recorded its start, before it named its token', () => {
  it('is ended as the attempt that holds it, once that lease lapsed, no live lease naming that attempt', async () => {
    const { server } = await startedAfter(
      {
        type: 'interaction',
        name: 'post',
        events: [startOf({ calls_tools: true })],
        leases: [[`attempt/${runKey}/process-that-died`, 'process-that-died', diedLongAgo]],
      },
      [writer],
    );

    expect((await endedOn(server, writer)).body).toMatchObject({ status: 'failed' });
  });
});

describe('a run whose first attempt died, which a retry under its id took up in another process that lives', () => {
  it('lets the lapsed lease of the first attempt go and leaves the retry running', async () => {
    const started = await startedAfter(
      {
        type: 'interaction',
        name: 'post',
        events: [startOf(), startOf()],
        leases: [
          [`attempt/${runKey}/process-that-died/1`, 'process-that-died', diedLongAgo],
          [`attempt/${runKey}/process-that-lives/2`, 'process-that-lives', now + 3_600_000],
        ],
      },
      [writer],
    );

    const leases = await until(started.leaseNames, (names) => !names.includes(`attempt/${runKey}/process-that-died/1`));
    const run = await started.server.call('GET', `${alpha}/runs/${runId}`, as(writer));

    expect(leases).toEqual([`attempt/${runKey}/process-that-lives/2`]);
    expect(run.body).toMatchObject({ status: 'started' });
  });
});
