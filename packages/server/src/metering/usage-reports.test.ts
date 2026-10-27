import { movedClock } from '@on.auto/workflow-host/testing';
import { describe, expect, it } from 'vitest';

import { accountsServed, servedBy } from '../testing/accounts/licensed-server.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { until } from '../testing/waiting/until.ts';

const anHourAndAMinute = 3_660_000;

describe('a licensed runtime', () => {
  it('reports the count it projected to the account every hour, with its checkpoint, and once more as it stops', async () => {
    const clock = movedClock(Date.now());
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, { clock });
    await tallied(server);
    await tallied(server);
    clock.moveTo(clock.now() + anHourAndAMinute);
    const reports = await until(
      () => accounts.account.reports(),
      (taken) => taken.some(({ actions }) => actions === 2),
    );
    const sentBeforeTheStop = accounts.account.reportsSent();
    await server.stop();

    expect([reports.at(-1)?.actions, reports.at(-1)?.through?.length]).toEqual([2, 1]);
    expect(accounts.account.reportsSent()).toBe(sentBeforeTheStop + 1);
  }, 60_000);
});
