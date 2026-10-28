import { setTimeout } from 'node:timers/promises';

import { movedClock } from '@on.auto/workflow-host/testing';
import { describe, expect, it } from 'vitest';

import { accountsServed, servedBy, type Accounts } from '../testing/accounts/licensed-server.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { until } from '../testing/waiting/until.ts';

const anHourAndAMinute = 3_660_000;

const anHour = 3_600_000;

const fifteenMinutes = 900_000;

const timeForAnAskToArrive = 300;

async function reportsAskedOnceTheyCouldBe(accounts: Accounts): Promise<number> {
  await setTimeout(timeForAnAskToArrive);
  return accounts.reportsAsked();
}

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

describe('a licensed runtime whose report the account did not take', () => {
  it('asks the account again 15 minutes after, not sooner, and an hour after the report it took, not sooner', async () => {
    const clock = movedClock(Date.now());
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, { clock });
    await tallied(server);
    clock.moveTo(clock.now() + anHourAndAMinute);
    await until(
      () => accounts.account.reports(),
      (taken) => taken.some(({ actions }) => actions === 1),
    );
    const askedWhileUp = accounts.reportsAsked();
    accounts.account.goDown();
    const untaken = clock.now() + anHour;
    clock.moveTo(untaken);
    const askedWhileDown = await until(
      () => accounts.reportsAsked(),
      (asked) => asked > askedWhileUp,
    );
    const sentWhileDown = accounts.account.reportsSent();
    accounts.account.comeBack();
    clock.moveTo(untaken + fifteenMinutes - 1);
    const askedSooner = await reportsAskedOnceTheyCouldBe(accounts);
    clock.moveTo(untaken + fifteenMinutes);
    await until(
      () => accounts.account.reportsSent(),
      (sent) => sent === sentWhileDown + 1,
    );
    clock.moveTo(untaken + fifteenMinutes + anHour - 1);
    const askedWithinTheHour = await reportsAskedOnceTheyCouldBe(accounts);
    clock.moveTo(untaken + fifteenMinutes + anHour);
    await until(
      () => accounts.account.reportsSent(),
      (sent) => sent === sentWhileDown + 2,
    );

    expect([askedSooner, askedWithinTheHour]).toEqual([askedWhileDown, askedWhileDown + 1]);
    expect(accounts.account.reports().at(-1)?.actions).toBe(1);
  }, 60_000);
});
