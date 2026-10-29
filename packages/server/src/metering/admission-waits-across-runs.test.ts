import { describe, expect, it } from 'vitest';

import {
  aLedger,
  minute,
  movedOn,
  nineOClock,
  outOfCredits,
  refusedAtItsSecondCall,
  served,
} from '../testing/accounts/refused-workflows.ts';
import { refusingMeter } from '../testing/accounts/refusing-meter.ts';
import { defined, waitsOf } from '../testing/accounts/waiting-workflows.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';

describe('a workflow whose call the meter refuses for a license, or because it cannot ask the account', () => {
  it.each([
    [
      {
        kind: 'license_required',
        because: 'free_daily_limit',
        detail: 'This runtime has used its 100 free runs and today’s 15',
        resolve_at: 'https://studio.example.com/licenses',
      },
      'waits for a license',
    ],
    [{ kind: 'license_invalid', detail: 'The key was replaced' }, 'waits for its license to be put right'],
    [
      { kind: 'meter_unavailable', detail: 'The account could not be asked' },
      'waits until its account at Auto can be asked for credits',
    ],
  ] as const)(
    'waits too: %o',
    async (refusal, said) => {
      const { waits } = await refusedAtItsSecondCall(refusal);

      expect(waits[0]?.summary).toContain(`The step “tally” ${said}`);
    },
    60_000,
  );
});

describe('a workflow whose call the meter refuses for any other reason', () => {
  it('ends rejected at once, as before', async () => {
    const meter = refusingMeter();
    const server = await served({ meter, clock: nineOClock(), ledger: aLedger() });
    await defined(server);
    const started = await server.call('POST', `${alpha}/definitions/workflow/asking-then-tallying/run`, {
      body: { input: {} },
    });
    meter.refuse({ kind: 'account_closed', detail: 'The org was deleted' });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

    expect(settled.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'conflict', kind: 'account_closed' },
    });
    expect(await waitsOf(server, runIdIn(started.body))).toEqual([]);
  }, 60_000);
});

describe('a workflow whose call two levels below the run at the top is refused for credits', () => {
  it('waits at that step while the run at the top waits for it, both shown in the tree of the top, and both go on once admitted', async () => {
    const { server, top, workflow, asked, meter, clock, tally } = await refusedAtItsSecondCall(
      outOfCredits,
      'nesting-it',
    );
    const tree = await server.call('GET', `${alpha}/events?run_id=${top}&type=step_waiting&limit=100`);
    const topRun = await server.call('GET', `${alpha}/runs/${top}`);
    meter.admitAgain();
    movedOn(clock, minute);
    const settledTop = await settledRun(server, `${alpha}/runs/${top}`);

    expect(topRun.body).toMatchObject({ status: 'started' });
    expect(JSON.stringify(tree.body)).toContain('The step “tally” waits for credits');
    expect(settledTop.body).toMatchObject({ status: 'succeeded', output: { counted: true } });
    expect(server.modelCalls()).toBe(1);
    expect(meter.admitted()).toEqual([top, workflow, asked, tally(2)]);
  }, 60_000);
});

describe('a workflow that waits for credits on a server that stops', () => {
  it('waits on when another server starts over its ledger, and goes on from that step there once admitted', async () => {
    const { server, workflow, meter, clock, ledger, tally } = await refusedAtItsSecondCall();
    await server.stop();
    const admitting = refusingMeter();
    const after = await served({ meter: admitting, clock, ledger });
    const waiting = await after.call('GET', `${alpha}/runs/${workflow}`);
    movedOn(clock, minute);
    const settled = await settledRun(after, `${alpha}/runs/${workflow}`);

    expect(waiting.body).toMatchObject({ status: 'started' });
    expect(settled.body).toMatchObject({ status: 'succeeded', output: { counted: true } });
    expect(after.modelCalls()).toBe(0);
    expect(meter.refused()).toEqual([tally(1)]);
    expect(admitting.admitted()).toEqual([tally(2)]);
  }, 60_000);
});
