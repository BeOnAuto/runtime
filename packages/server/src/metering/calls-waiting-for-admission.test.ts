import { describe, expect, it } from 'vitest';

import {
  billing,
  day,
  minute,
  movedOn,
  outOfCredits,
  refusedAtItsSecondCall,
} from '../testing/accounts/refused-workflows.ts';
import { waitingAgain, waitsOf } from '../testing/accounts/waiting-workflows.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { settledRun } from '../testing/servers/workflow-server.ts';

const waitsForCredits = `The step “tally” waits for credits, since the account it runs under has used its free runs for the day; it can be put right at ${billing}. It tries again at 2026-10-28T09:01:00.000Z, and stops waiting at 2026-10-29T09:00:00.000Z.`;

describe('a workflow whose call the meter refuses for credits', () => {
  it('waits at that step, saying so in plain words with where to get credits, and is still started', async () => {
    const { server, workflow, waits, meter, tally } = await refusedAtItsSecondCall();
    const run = await server.call('GET', `${alpha}/runs/${workflow}`);

    expect(run.body).toMatchObject({ status: 'started' });
    expect(waits.map(({ summary }) => summary)).toEqual([waitsForCredits]);
    expect(waits[0]?.data).toMatchObject({
      waits_for: 'admission',
      times: 2,
      detail: outOfCredits.detail,
      kind: 'credits_exhausted',
      because: 'free_daily_limit',
      resolve_at: billing,
      retry_at: '2026-10-28T09:01:00.000Z',
      until: '2026-10-29T09:00:00.000Z',
    });
    expect(meter.refused()).toEqual([tally(1)]);
  }, 60_000);

  it('tries again after a minute, then after two, and once admitted goes on from that step without running or charging the earlier call again', async () => {
    const { server, workflow, asked, meter, clock, tally } = await refusedAtItsSecondCall();
    movedOn(clock, minute);
    const again = await waitingAgain(server, workflow, 2);
    meter.admitAgain();
    movedOn(clock, 2 * minute);
    const settled = await settledRun(server, `${alpha}/runs/${workflow}`);

    expect(again[1]?.data).toMatchObject({ times: 4, retry_at: '2026-10-28T09:03:00.000Z' });
    expect(settled.body).toMatchObject({ status: 'succeeded', output: { counted: true } });
    expect(server.modelCalls()).toBe(1);
    expect(meter.refused()).toEqual([tally(1), tally(2)]);
    expect(meter.admitted()).toEqual([workflow, asked, tally(3)]);
  }, 60_000);
});

describe('a workflow that waits for credits', () => {
  it('can be cancelled while it waits, and is never tried again', async () => {
    const { server, workflow, meter, clock } = await refusedAtItsSecondCall();
    const cancelled = await server.call('POST', `${alpha}/runs/${workflow}/cancel`, { body: { reason: 'Not today' } });
    const settled = await settledRun(server, `${alpha}/runs/${workflow}`);
    meter.admitAgain();
    movedOn(clock, 2 * minute);

    expect(cancelled.status).toBe(200);
    expect(settled.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not today' },
    });
    expect(await waitsOf(server, workflow)).toHaveLength(1);
    expect(meter.admitted()).toHaveLength(2);
  }, 60_000);

  it('ends rejected as before, in the words of its last refusal, once 24 hours have passed since the first', async () => {
    const { server, workflow, meter, clock, tally } = await refusedAtItsSecondCall();
    meter.refuse({ ...outOfCredits, detail: 'Still no credits for this run' });
    movedOn(clock, day);
    const settled = await settledRun(server, `${alpha}/runs/${workflow}`);

    expect(settled.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit' },
    });
    expect(JSON.stringify(settled.body)).toContain('Still no credits for this run');
    expect(meter.refused()).toEqual([tally(1), tally(2)]);
  }, 60_000);
});
