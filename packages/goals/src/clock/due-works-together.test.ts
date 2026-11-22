import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { startsAnswering, type StartsSeen } from '../notices/notice-samples.ts';
import { noticesOwedOf } from '../notices/notice-starts.ts';
import { summariesDueOf } from '../summaries/summaries-due.ts';
import { clockHarnessOf, type ClockHarness } from './clock-harness.ts';
import { goalsClockOf } from './goals-clock.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

const summarised = {
  id: 'controls-hold',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'All controls held',
    failed: 'A control failed',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner', summary: { cron: '0 * * * *' } },
};

const owner = { id: 'person:owner', name: 'Owner' };

type Order = readonly (0 | 1 | 2)[];

const orders: readonly Order[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function earliestOf(moments: readonly (number | null)[]): number | null {
  const kept = moments.filter((moment) => moment !== null);
  return kept.length === 0 ? null : Math.min(...kept);
}

function togetherIn(works: readonly DueWork[]): DueWork {
  return {
    name: 'the due works of goals together',
    due: (now, most, callsOut) =>
      Effect.map(
        Effect.forEach(works, (work) => work.due(now, most, callsOut)),
        (items: readonly (readonly DueItem[])[]) => items.flat(),
      ),
    nextDueAt: (after, callsOut) =>
      Effect.map(
        Effect.forEach(works, (work) => work.nextDueAt(after, callsOut)),
        (moments: readonly (number | null)[]) => earliestOf(moments),
      ),
  };
}

function dueWorksIn(order: Order, seen: StartsSeen) {
  return (ports: Parameters<typeof goalsClockOf>[0]): DueWork => {
    const noticePorts = {
      ledger: ports.ledger,
      start: seen.start,
      playbookOf: () =>
        Effect.map(ports.registry.status({ org: 'acme', playbook: 'sales' }), (status) => ({ status, owner })),
    };
    const works = [goalsClockOf(ports), noticesOwedOf(noticePorts), summariesDueOf(noticePorts)];
    return togetherIn(order.map((index) => works[index]).filter((work) => work !== undefined));
  };
}

interface Together {
  readonly harness: ClockHarness;
  readonly seen: StartsSeen;
}

async function retiredFor(order: Order, until: string): Promise<Together> {
  const seen = startsAnswering(() => 'started');
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z', undefined, dueWorksIn(order, seen));
  await harness.book.workflowSaved('check', 1, checking);
  await harness.goalsSaved([summarised], '2026-11-08T12:00:00.000Z');
  await harness.observed('mon', { failed: 1 }, '2026-11-09T09:00:00.000Z');
  harness.statusIs('retired');
  await harness.steppedTo(until);
  return { harness, seen };
}

async function columnsOf(harness: ClockHarness) {
  const assessments = await harness.book.rows(assessmentsName);
  const clock = await harness.row(clocksName, clockKey);
  return {
    clock: [clock?.['opens_at'], clock?.['summary_at']],
    assessments: Object.keys(assessments)
      .toSorted()
      .map((key) => [assessments[key]?.['judging_due_at'], assessments[key]?.['notice_due_at']]),
  };
}

const wakesFrom = (harness: ClockHarness, from: string) =>
  harness.wakes.filter(({ at }) => at >= Date.parse(from)).map(({ at }) => new Date(at).toISOString());

async function factsOf({ harness }: Together): Promise<readonly string[]> {
  const assessed = Object.keys(await harness.book.rows(assessmentsName));
  const facts = await Promise.all(assessed.map((key) => harness.book.factsOf('controls-hold', `assessments/${key}`)));
  return facts.flat();
}

async function restored({ harness, seen }: Together): Promise<readonly boolean[]> {
  const from = seen.starts.length;
  harness.statusIs('active');
  await harness.steppedTo('2026-11-13T00:00:00.000Z');
  const references = seen.starts.slice(from).map(({ trigger }) => trigger.reference);
  return [
    references.some((reference) => reference.startsWith('goals/goal-of-controls-hold/assessments/')),
    references.includes('goals/goal-of-controls-hold/summaries/2026-11-13T00:00:00.000Z'),
  ];
}

const retiredWeek = [
  '2026-11-09T09:04:00.000Z',
  '2026-11-10T00:00:00.000Z',
  '2026-11-11T00:00:00.000Z',
  '2026-11-12T00:00:00.000Z',
  '2026-11-13T00:00:00.000Z',
  '2026-11-14T00:00:00.000Z',
  '2026-11-15T00:00:00.000Z',
  '2026-11-16T00:00:00.000Z',
];

const nextMidnight = Date.parse('2026-11-17T00:00:00.000Z');

describe('the clock, the notices and the summaries of a retired playbook, performing together', () => {
  it('wake it once a day in all for a week, whatever order they perform in, and leave no row due', async () => {
    const together = await Promise.all(orders.map((order) => retiredFor(order, '2026-11-16T12:00:00.000Z')));
    const columns = await Promise.all(together.map(({ harness }) => columnsOf(harness)));
    const facts = await Promise.all(together.map((each) => factsOf(each)));

    expect(together.map(({ harness }) => wakesFrom(harness, '2026-11-09T09:00:01.000Z'))).toEqual(
      orders.map(() => retiredWeek),
    );
    expect(columns).toEqual(orders.map(() => columns[0]));
    expect(columns[0]?.clock).toEqual([nextMidnight, nextMidnight]);
    expect(columns[0]?.assessments).toContainEqual([null, nextMidnight]);
    expect(new Set(together.map(({ seen }) => seen.starts.length)).size).toBe(1);
    expect(facts[0]).toContain('goal_assessed');
    expect(facts.flat().filter((type) => type.startsWith('goal_notice'))).toEqual([]);
  });

  it('send what they held back within a day of a restore, whatever order they perform in', async () => {
    const together = await Promise.all(orders.map((order) => retiredFor(order, '2026-11-12T12:00:00.000Z')));
    const before = together.map(({ seen }) => seen.starts.length);
    const after = await Promise.all(together.map((each) => restored(each)));

    expect(new Set(before).size).toBe(1);
    expect(after).toEqual(orders.map(() => [true, true]));
  });
});

const perThing = [
  { goal: 'controls-hold', purpose: 'Checks each control.', each: '/controls', per_id: '/id', measures: '/failed' },
];

const windowsOf = {
  week: { calendar: 'week', grace: 'PT1H' },
  month: { calendar: 'month', grace: 'PT1H' },
  none: undefined,
} as const;

function heldBy(window: keyof typeof windowsOf) {
  const { window: _daily, ...rest } = summarised;
  const chosen = windowsOf[window];
  return {
    ...rest,
    per: 'control',
    ...(chosen === undefined ? {} : { window: chosen }),
    notify: {
      passed: 'quiet',
      failed: 'now',
      ...(chosen === undefined ? {} : { overdue: 'now' }),
      through: 'tell-owner',
      summary: { cron: '0 9 * * *' },
    },
  };
}

const failing = (id: string) => ({ controls: [{ id, failed: 1 }] });

async function retiredWith(window: keyof typeof windowsOf): Promise<Together> {
  const seen = startsAnswering(() => 'started');
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z', undefined, dueWorksIn([0, 1, 2], seen));
  await harness.book.workflowSaved('check', 1, perThing);
  await harness.goalsSaved([heldBy(window)], '2026-11-08T12:00:00.000Z');
  await harness.observed('first', failing('door'), '2026-11-09T11:20:00.000Z');
  await harness.observed('second', failing('vault'), '2026-11-09T14:37:00.000Z');
  harness.statusIs('retired');
  await harness.steppedTo('2026-11-16T12:00:00.000Z');
  return { harness, seen };
}

const retiredMidnights = [10, 11, 12, 13, 14, 15, 16].map((date) => `2026-11-${String(date)}T00:00:00.000Z`);

async function summarisedAfterRestore({ harness, seen }: Together): Promise<readonly string[]> {
  const from = seen.starts.length;
  harness.statusIs('active');
  await harness.steppedTo('2026-11-17T00:00:00.000Z');
  return seen.starts
    .slice(from)
    .map(({ trigger }) => trigger.reference)
    .filter((reference) => reference.includes('/summaries/'));
}

const { window: _dailyWindow, ...summarisedWithNoWindow } = summarised;

async function retiredAt(at: string, goals: Parameters<ClockHarness['goalsSaved']>[0]) {
  const seen = startsAnswering(() => 'started');
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z', undefined, dueWorksIn([0, 1, 2], seen));
  await harness.goalsSaved(goals, at);
  harness.statusIs('retired');
  const saved = harness.wakes.length;
  await harness.steppedTo('2026-11-12T00:00:00.000Z');
  return { wakes: harness.wakes.slice(saved).map(({ at: woke }) => new Date(woke).toISOString()), starts: seen.starts };
}

describe('the clock, the notices and the summaries of a playbook retired around a UTC midnight', () => {
  it.each([
    ['a millisecond before it', '2026-11-09T23:59:59.999Z', '2026-11-10T00:00:00.000Z'],
    ['at it', '2026-11-10T00:00:00.000Z', '2026-11-10T01:00:00.000Z'],
    ['a millisecond after it', '2026-11-10T00:00:00.001Z', '2026-11-10T01:00:00.000Z'],
  ])(
    'wake it, saved and retired %s, when its hourly summary is next due and then at each UTC midnight, with a daily window or none',
    async (_named, at, summaryDue) => {
      const retired = await Promise.all([retiredAt(at, [summarised]), retiredAt(at, [summarisedWithNoWindow])]);
      const woken = { wakes: [summaryDue, '2026-11-11T00:00:00.000Z', '2026-11-12T00:00:00.000Z'], starts: [] };

      expect(retired).toEqual([woken, woken]);
    },
  );
});

describe('the clock, the notices and the summaries of a retired playbook whose goal has no daily boundary', () => {
  it.each(['week', 'month', 'none'] as const)(
    'share one daily time with a %s window, waking it once a day at the UTC midnight, and summarise at the first wake after a restore',
    async (window) => {
      const together = await retiredWith(window);
      const wakes = wakesFrom(together.harness, '2026-11-10T00:00:00.000Z');
      const summaries = await summarisedAfterRestore(together);

      expect(together.seen.starts.length).toBeGreaterThanOrEqual(2);
      expect(wakes).toEqual(retiredMidnights);
      expect(summaries).toEqual(['goals/goal-of-controls-hold/summaries/2026-11-16T09:00:00.000Z']);
      expect(wakesFrom(together.harness, '2026-11-16T12:00:00.000Z')).toEqual(['2026-11-17T00:00:00.000Z']);
    },
  );
});
