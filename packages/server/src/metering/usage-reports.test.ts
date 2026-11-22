import { describe, expect, it } from 'vitest';

import { accountsServed, licensedServedBy, type Accounts } from '../testing/accounts/licensed-server.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { fewSweeps, steppedServerClock, type SteppedServerClock } from '../testing/waiting/stepped-server-clock.ts';

const anHourAndAMinute = 3_660_000;

const anHour = 3_600_000;

const fifteenMinutes = 900_000;

async function reportsAskedOnceAtRest(clock: SteppedServerClock, accounts: Accounts): Promise<number> {
  await clock.atRest();
  return accounts.reportsAsked();
}

describe('a licensed runtime', () => {
  it('reports the runs it admitted, and those on its license, to the account every hour, and once more as it stops', async () => {
    const clock = steppedServerClock();
    const accounts = await accountsServed();
    const server = await licensedServedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, { clock });
    await tallied(server);
    await tallied(server);
    clock.moveTo(clock.now() + anHourAndAMinute);
    const reports = await clock.swept.until(
      () => accounts.account.reports(),
      (taken) => taken.some(({ actions }) => actions === 2),
      fewSweeps,
    );
    const sentBeforeTheStop = accounts.account.reportsSent();
    await server.stop();

    expect(reports.at(-1)).toEqual({ actions: 2, licensed: 2 });
    expect(accounts.account.reportsSent()).toBe(sentBeforeTheStop + 1);
  });
});

describe('a licensed runtime whose report the account did not take', () => {
  it('asks the account again 15 minutes after, not sooner, and an hour after the report it took, not sooner', async () => {
    const clock = steppedServerClock();
    const accounts = await accountsServed();
    const server = await licensedServedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, { clock });
    await tallied(server);
    clock.moveTo(clock.now() + anHourAndAMinute);
    await clock.swept.until(
      () => accounts.account.reports(),
      (taken) => taken.some(({ actions }) => actions === 1),
      fewSweeps,
    );
    const askedWhileUp = accounts.reportsAsked();
    accounts.account.goDown();
    const untaken = clock.now() + anHour;
    clock.moveTo(untaken);
    const askedWhileDown = await clock.swept.until(
      () => accounts.reportsAsked(),
      (asked) => asked > askedWhileUp,
      fewSweeps,
    );
    const sentWhileDown = accounts.account.reportsSent();
    accounts.account.comeBack();
    clock.moveTo(untaken + fifteenMinutes - 1);
    const askedSooner = await reportsAskedOnceAtRest(clock, accounts);
    clock.moveTo(untaken + fifteenMinutes);
    await clock.swept.until(
      () => accounts.account.reportsSent(),
      (sent) => sent === sentWhileDown + 1,
      fewSweeps,
    );
    clock.moveTo(untaken + fifteenMinutes + anHour - 1);
    const askedWithinTheHour = await reportsAskedOnceAtRest(clock, accounts);
    clock.moveTo(untaken + fifteenMinutes + anHour);
    await clock.swept.until(
      () => accounts.account.reportsSent(),
      (sent) => sent === sentWhileDown + 2,
      fewSweeps,
    );

    expect([askedSooner, askedWithinTheHour]).toEqual([askedWhileDown, askedWhileDown + 1]);
    expect(accounts.account.reports().at(-1)?.actions).toBe(1);
  });
});
