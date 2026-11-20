import type { ProjectedMessage } from '@on.auto/operations';
import { streamAddressed } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { clockKey, clockRows, goalClockIn, nextSummaryOf } from './clock-rows.ts';
import { rowFoldedOf } from './folded-rows.ts';

const at = (text: string) => Date.parse(text);

const daily = {
  id: 'controls-hold',
  statement: 'Keep every control holding each day.',
  window: { calendar: 'day' },
  success: {
    label: 'Failed controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'Held',
    failed: 'Broke',
  },
  notify: {
    passed: 'quiet',
    failed: 'now',
    overdue: 'now',
    through: 'tell-owner',
    summary: { cron: '0 9 1 * *', time_zone: 'UTC' },
  },
};

const { summary: _summary, ...unsummarised } = daily.notify;

const weekly = {
  id: 'paying-customers',
  statement: 'Bring in paying customers every week.',
  success: { label: 'Customers', settles: 'on_crossing', target: { at_least: 1 }, passed: 'Won', failed: 'Lost' },
  notify: {
    passed: 'summary',
    failed: 'summary',
    summary: { cron: '0 9 * * 5', through: 'weekly-note' },
  },
};

const created = (goal: unknown, moment = '2026-11-09T12:00:00.000Z') => ({
  type: 'goal_created',
  data: { playbook: 'alpha', position: 0, goal },
  moment,
});

const updated = (goal: unknown, moment: string) => ({ type: 'goal_updated', data: { goal }, moment });

const opened = (opens: string) => ({
  type: 'goal_assessment_opened',
  data: {
    goal_version: 1,
    window: { opens, closes: opens, due: opens },
    rule: { settles: 'on_crossing', target: { at_most: 0 }, window: { calendar: 'day' } },
    milestones: [],
  },
});

const summarised = (due: string) => ({
  type: 'goal_summary_started',
  data: { due, window: { from: due, to: due }, run: `summary-of-${due}` },
});

interface Fact {
  readonly type: string;
  readonly data: unknown;
  readonly moment?: string;
}

const messageOf = ({ type, data, moment = '2026-11-09T12:00:00.000Z' }: Fact, position: number): ProjectedMessage => ({
  id: `fact-${String(position)}`,
  position,
  type,
  data,
  context: { at: moment, by: 'person:ada', definitionId: '019a8f00-0000-7000-8000-000000000001' },
});

const foldedOf = (facts: readonly Fact[]) =>
  rowFoldedOf(
    clockRows,
    facts.map((fact, position) => messageOf(fact, position)),
  );

const goalKey = 'definition/acme/019a8f00-0000-7000-8000-000000000001/';

describe('the clock row of a goal', () => {
  it('is one row under the goal’s own key, for the facts it folds alone', () => {
    expect(
      [
        'goal_created',
        'goal_updated',
        'goal_removed',
        'goal_assessment_opened',
        'goal_summary_started',
        'goal_reordered',
        'goal_agreed',
        'goal_overdue',
      ].map((type) => clockRows.keyOf?.(messageOf({ type, data: {} }, 0), streamAddressed(`${goalKey}goals/goal`))),
    ).toEqual([clockKey, clockKey, clockKey, clockKey, clockKey, undefined, undefined, undefined]);
    expect(clockRows.scopes).toEqual(['definition']);
  });

  it('keeps the windows opened and the summaries fired over a later save, and takes no other fact', () => {
    const due = '2026-11-13T09:00:00.000Z';
    const before = foldedOf([created(daily), opened('2026-11-10T00:00:00.000Z'), summarised(due)]);
    const { data } = opened(due);
    const { window: _window, ...unwindowed } = data;

    expect(
      foldedOf([
        created(daily),
        opened('2026-11-10T00:00:00.000Z'),
        summarised(due),
        { type: 'goal_assessment_opened', data: unwindowed },
        { type: 'goal_summary_started', data: { due } },
        updated({ ...daily, statement: 'Keep every control holding.' }, '2026-11-11T12:00:00.000Z'),
      ]),
    ).toEqual({ ...before, goal_version: 2 });
  });
});

describe('the clock row of a goal, of the facts that move no clock', () => {
  it('writes nothing for a fact that moves no clock, so a due its reader advanced stands', () => {
    const row = foldedOf([created(daily), opened('2026-11-10T00:00:00.000Z'), summarised('2026-12-01T09:00:00.000Z')]);
    const { data } = opened('2026-11-13T09:00:00.000Z');
    const { window: _window, ...unwindowed } = data;

    expect(
      [
        { type: 'goal_assessment_opened', data: unwindowed },
        opened('2026-11-09T00:00:00.000Z'),
        summarised('2026-11-20T09:00:00.000Z'),
        { type: 'goal_reordered', data: { position: 1 } },
      ].map((fact: Fact, position) => clockRows.rowAfter(row, messageOf(fact, position))),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(clockRows.advanced).toEqual([
      { column: 'opens_at', setBy: ['goal_created', 'goal_updated', 'goal_removed', 'goal_assessment_opened'] },
      { column: 'summary_at', setBy: ['goal_created', 'goal_updated', 'goal_removed', 'goal_summary_started'] },
    ]);
  });
});

describe('the clock row of a goal saved', () => {
  it('is kept from the goal’s creation, due at the next window to open and the next summary', () => {
    const row = foldedOf([created(daily)]);

    expect(row).toMatchObject({
      opens_at: at('2026-11-10T00:00:00.000Z'),
      summary_at: at('2026-12-01T09:00:00.000Z'),
    });
    expect(goalClockIn(row)).toMatchObject({ first_saved_at: at('2026-11-09T12:00:00.000Z') });
  });

  it('opens a window that starts at the very moment of the creation', () => {
    expect(foldedOf([created({ ...daily, notify: unsummarised }, '2026-11-10T00:00:00.000Z')])).toMatchObject({
      opens_at: at('2026-11-10T00:00:00.000Z'),
      summary_at: null,
    });
  });

  it('is no row before the goal is created, and takes no save of a goal it holds no row of', () => {
    expect([
      foldedOf([opened('2026-11-10T00:00:00.000Z')]),
      foldedOf([updated(daily, '2026-11-10T00:00:00.000Z')]),
      foldedOf([{ type: 'goal_removed', data: {} }]),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the clock row of a goal that ran', () => {
  it('moves the next window past the windows already opened, and the next summary past the summaries that fired', () => {
    expect(
      foldedOf([
        created(weekly),
        summarised('2026-11-13T09:00:00.000Z'),
        created(daily, '2026-11-09T12:00:00.000Z'),
        opened('2026-11-10T00:00:00.000Z'),
        opened('2026-11-09T00:00:00.000Z'),
        summarised('2026-12-01T09:00:00.000Z'),
      ]),
    ).toMatchObject({
      opens_at: at('2026-11-11T00:00:00.000Z'),
      summary_at: at('2027-01-01T09:00:00.000Z'),
    });
  });

  it('keeps the goal’s first save over later saves, and is due at once to end what the goal left open when it is retired', () => {
    const row = foldedOf([created(daily), updated({ ...daily, retired: true }, '2026-11-12T00:00:00.000Z')]);

    expect(row).toMatchObject({ opens_at: at('2026-11-12T00:00:00.000Z'), summary_at: null });
    expect(goalClockIn(row)).toMatchObject({ first_saved_at: at('2026-11-09T12:00:00.000Z'), retired: true });
  });
});

describe('the clock row of a goal removed', () => {
  it('is due for nothing once the goal is removed, whatever is recorded under its key after', () => {
    const removed = foldedOf([created(daily), { type: 'goal_removed', data: {} }]);

    expect([
      removed,
      foldedOf([
        created(daily),
        { type: 'goal_removed', data: {} },
        opened('2026-11-10T00:00:00.000Z'),
        summarised('2026-12-01T09:00:00.000Z'),
        updated(daily, '2026-11-12T00:00:00.000Z'),
      ]),
    ]).toMatchObject([
      { goal_version: 1, opens_at: null, summary_at: null },
      { goal_version: 1, opens_at: null, summary_at: null },
    ]);
    expect(goalClockIn(removed)).toMatchObject({ removed: true });
  });

  it('reads no clock from a row it cannot read, and no summary from a schedule that does not come round', () => {
    expect(goalClockIn({ clock: 'unreadable' })).toBeUndefined();
    expect(nextSummaryOf({ first_saved_at: 0, summary: { cron: '0 9 * * 5', time_zone: 'Europe/Berlin' } })).toBe(
      Date.parse('1970-01-02T08:00:00.000Z'),
    );
    expect(nextSummaryOf({ first_saved_at: 0, summary: { cron: 'never' } })).toBeNull();
  });
});

describe('the clock row of a goal retired before its clock ran', () => {
  it('keeps a due its clock has not worked yet when a window opens, and drops the one an opening meets', () => {
    const retiring = clockRows.rowAfter(
      { ...foldedOf([created(daily)]), opens_at: at('2026-11-09T18:00:00.000Z') },
      messageOf(opened('2026-11-09T00:00:00.000Z'), 1),
    );
    const unarmed = clockRows.rowAfter(
      { ...foldedOf([created(daily)]), opens_at: null },
      messageOf(opened('2026-11-10T00:00:00.000Z'), 1),
    );
    const met = clockRows.rowAfter(
      { ...foldedOf([created(daily)]), opens_at: at('2026-11-10T00:00:00.000Z') },
      messageOf(opened('2026-11-10T00:00:00.000Z'), 1),
    );

    expect([retiring, unarmed, met]).toMatchObject([
      { opens_at: at('2026-11-09T18:00:00.000Z') },
      { opens_at: at('2026-11-11T00:00:00.000Z') },
      { opens_at: at('2026-11-11T00:00:00.000Z') },
    ]);
  });
});

const workflowFact = (type: string, moment: string): ProjectedMessage => ({
  id: `definition-${type}`,
  position: 0,
  type,
  data: {},
  context: { at: moment, by: 'person:ada', definitionType: 'workflow', definitionName: 'check', definitionVersion: 1 },
});

describe('the clock row of a goal whose workflows are saved or resumed', () => {
  it('takes no fact of a workflow, which lies under the workflow’s own key: the clock reads when one was last saved as it works', () => {
    const quiet = { ...foldedOf([created(daily)]), opens_at: null };
    const facts = ['definition_created', 'definition_updated', 'definition_resumed', 'definition_restored'];

    expect(facts.map((type) => clockRows.rowAfter(quiet, workflowFact(type, '2026-11-10T10:00:00.000Z')))).toEqual(
      Array.from({ length: facts.length }),
    );
    expect(
      clockRows.keyOf?.(
        workflowFact('definition_resumed', '2026-11-10T10:00:00.000Z'),
        streamAddressed('definition/acme/d1/definitions/workflow'),
      ),
    ).toBeUndefined();
    expect([clockRows.kinds, facts.filter((type) => clockRows.types.includes(type))]).toEqual([
      ['goals', 'assessments', 'goal-summaries'],
      [],
    ]);
  });
});
