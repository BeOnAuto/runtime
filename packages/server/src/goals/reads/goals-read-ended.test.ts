import { GoalsReadSchema, type GoalsRead } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing, savedWorkflow, type Assessing } from '../../testing/goals/assessed-runs.ts';
import { wallClockGivenBack, wallClockTaken } from '../../testing/goals/woken-clock.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { until } from '../../testing/waiting/until.ts';

const day = 86_400_000;
const hour = 3_600_000;

const goalText = [
  '- id: never-checked',
  '  statement: Every control passes its daily check.',
  '  window: { calendar: day, grace: PT1H }',
  '  success:',
  '    label: Failing controls',
  '    settles: on_crossing',
  '    target: { at_most: 0 }',
  '    passed: All controls held',
  '    failed: A control failed',
  '  notify: { passed: quiet, failed: now, overdue: now, through: tell-owner }',
  '',
].join('\n');

const silent = [
  'contributes:',
  '  - goal: never-checked',
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  '    final: /all_reported',
  'do:',
  '  - check: { set: { failed: 0, all_reported: true } }',
];

const exactly = Schema.decodeUnknownSync(GoalsReadSchema, { onExcessProperty: 'error' });

interface Days {
  readonly assessed: Assessing;
  readonly tomorrow: number;
}

async function servedWithADay(): Promise<Days> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals: goalText });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  expect(await savedWorkflow(assessed.server, 'silent', silent)).toBe(201);
  const tomorrow = (Math.floor(assessed.clock.now() / day) + 1) * day;
  assessed.clock.moveTo(tomorrow);
  await rowHolding(assessed, tomorrow, (row) => row['open'] === true);
  return { assessed, tomorrow };
}

async function rowHolding(
  assessed: Assessing,
  opens: number,
  holds: (row: Readonly<Record<string, unknown>>) => boolean,
): Promise<void> {
  await until(
    () => assessed.rowsOf('goal_assessments'),
    (rows) => Object.values(rows).some((row) => row['window_opens'] === opens && holds(row)),
  );
}

async function assessmentsAt(assessed: Assessing) {
  const { status, body } = await assessed.server.call('GET', `${alpha}/goals`);
  expect(status).toBe(200);
  const read: GoalsRead = exactly(body);
  return read.goals[0]?.assessments;
}

const ofDay = (opens: number) => ({ window: { opens: new Date(opens).toISOString() } });

describe('the goals read of a Node server whose clock finds a day missed by its deadline', () => {
  it('shows the day overdue while it is open, and only as closed once it ended, boundary by boundary', async () => {
    const { assessed, tomorrow } = await servedWithADay();

    assessed.clock.moveTo(tomorrow + day + hour);
    await rowHolding(assessed, tomorrow, (row) => row['overdue'] === true);
    const overdue = await assessmentsAt(assessed);
    assessed.clock.moveTo(tomorrow + 2 * day + hour);
    await rowHolding(assessed, tomorrow, (row) => row['outcome'] === 'failed');
    const ended = await assessmentsAt(assessed);

    expect(overdue?.in_flight[0]).toMatchObject({
      ...ofDay(tomorrow),
      verdict: 'open',
      overdue_since: new Date(tomorrow + day + hour).toISOString(),
    });
    expect(ended?.closed).toMatchObject({
      total: 1,
      failed: 1,
      no_result: 0,
      latest: [
        { outcome: 'failed', by: 'deadline', at: new Date(tomorrow + day + hour).toISOString(), ...ofDay(tomorrow) },
      ],
    });
    expect(ended?.closed.latest[0]).not.toHaveProperty('value');
    expect(ended?.in_flight.map(({ window }) => window?.opens)).not.toContain(new Date(tomorrow).toISOString());
  });
});

describe('the goals read of a Node server whose clock comes back after a day was missed', () => {
  it('shows the day only as closed when its due and its end had both passed before the clock ran', async () => {
    const { assessed, tomorrow } = await servedWithADay();

    assessed.clock.moveTo(tomorrow + 2 * day + 2 * hour);
    await rowHolding(assessed, tomorrow, (row) => row['outcome'] === 'failed');
    const rows = await assessed.rowsOf('goal_assessments');
    const ended = await assessmentsAt(assessed);

    expect(Object.values(rows).find((row) => row['window_opens'] === tomorrow)).toMatchObject({
      overdue_since: tomorrow + day + hour,
      verdict: 'failed',
      closed_at: tomorrow + day + hour,
      closed_recorded_at: tomorrow + 2 * day + 2 * hour,
    });
    expect(ended?.closed).toMatchObject({
      total: 1,
      failed: 1,
      no_result: 0,
      latest: [{ outcome: 'failed', by: 'deadline', ...ofDay(tomorrow) }],
    });
    expect(ended?.current).toMatchObject({ ...ofDay(tomorrow), verdict: 'failed', verdict_by: 'deadline' });
    expect(ended?.current).not.toHaveProperty('overdue_since');
  });
});

const weekdaysFromSunday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const allDaysBut = (dayOff: number) =>
  goalText.replace(
    '{ calendar: day, grace: PT1H }',
    `{ calendar: day, grace: PT1H, days: [${weekdaysFromSunday.filter((_, index) => index !== new Date(dayOff).getUTCDay()).join(', ')}] }`,
  );

describe('the goals read of a Node server whose daily goal names its days', () => {
  it('opens no window on a day it does not judge and opens the next day, and the read names the days', async () => {
    const ledger = temporaryLedger();
    onTestFinished(wallClockGivenBack);
    const dayOff = (Math.floor(wallClockTaken() / day) + 1) * day;
    const assessed = await assessing({ ledger, goals: allDaysBut(dayOff) });
    onTestFinished(async () => {
      await assessed.server.stop();
      ledger.remove();
    });
    expect(await savedWorkflow(assessed.server, 'silent', silent)).toBe(201);
    const tomorrow = (Math.floor(assessed.clock.now() / day) + 1) * day;

    const clocks = await until(
      () => assessed.rowsOf('goal_clocks'),
      (held) => Object.values(held).some((row) => row['opens_at'] !== null),
    );
    assessed.clock.moveTo(tomorrow + 2 * hour);
    const onTheDayOff = await assessmentsAt(assessed);
    assessed.clock.moveTo(tomorrow + day);
    await rowHolding(assessed, tomorrow + day, (row) => row['open'] === true);
    const rows = await assessed.rowsOf('goal_assessments');
    const { body } = await assessed.server.call('GET', `${alpha}/goals`);

    expect(tomorrow).toBe(dayOff);
    expect(Object.values(clocks).map((row) => row['opens_at'])).toEqual([tomorrow + day]);
    expect(onTheDayOff).toMatchObject({ open_count: 0, current: null });
    expect(Object.values(rows).map((row) => row['window_opens'])).toEqual([tomorrow + day]);
    expect(exactly(body).goals[0]?.window).toMatchObject({
      days: weekdaysFromSunday.filter((_, index) => index !== new Date(dayOff).getUTCDay()),
    });
  });
});
