import { GoalsEventSchema } from '@on.auto/definitions/goals';
import { factTypesOf, type ProjectedMessage } from '@on.auto/operations';
import type { SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsLedger } from '../engine/goals-engine.ts';
import { rowFoldedOf } from './folded-rows.ts';
import { goalRefusalsStreamIdOf, goalSummariesStreamIdOf, refusedOfKey } from './goal-streams.ts';
import { noticeDays, noticeDayOf } from './notice-days.ts';
import { observationRows, observedEntryKeyOf } from './observation-rows.ts';
import { refusalRows } from './refusal-rows.ts';

const messageOf = (type: string, data: unknown, at: string, position = 0): ProjectedMessage => ({
  id: `fact-${String(position)}`,
  position,
  type,
  data,
  context: { at, by: 'playbook:alpha' },
});

const observationStream = {
  kind: 'assessments',
  id: 'assessment',
  scope: 'playbook',
  prefix: 'playbook/acme/alpha/',
  address: { org: 'acme', playbook: 'alpha' },
} as const;

describe('the tables of goals', () => {
  it('fold the facts of goals and nothing else', () => {
    const goalTypes = new Set(
      [...goalsLedger.factSchemas, GoalsEventSchema].flatMap((schema: { readonly ast: SchemaAST.AST }) =>
        factTypesOf(schema),
      ),
    );

    expect(goalsLedger.projections.flatMap(({ types }) => types).filter((type) => !goalTypes.has(type))).toEqual([]);
    expect(goalsLedger.projections.map(({ name, version }) => `${name}_${String(version)}`)).toEqual([
      'goal_assessments_5',
      'goal_clocks_1',
      'goal_refusals_1',
      'goal_notice_days_1',
      'goal_summaries_1',
      'goal_observations_1',
      'activity_goals_3',
      'activity_goal_overdues_1',
      'activity_dismissals_1',
    ]);
  });
});

describe('the refused observations of a goal and a workflow', () => {
  it('are one row, with the latest refusal, when it was made and how many were made', () => {
    expect(
      rowFoldedOf(refusalRows, [
        messageOf('goal_observation_refused', { run: 'run-1', detail: 'No measure' }, '2026-11-09T10:00:00.000Z'),
        messageOf('goal_observation_refused', { run: 'run-2', detail: 'No title' }, '2026-11-09T10:01:00.000Z', 1),
        messageOf('goal_observation_refused', { detail: 'unreadable' }, '2026-11-09T10:02:00.000Z', 2),
      ]),
    ).toEqual({ run: 'run-2', detail: 'No title', at: Date.parse('2026-11-09T10:01:00.000Z'), refusals: 2 });
  });

  it('are kept under the goal and the workflow, which their key gives back', () => {
    const key = goalRefusalsStreamIdOf({ goal: 'paying-customers', workflow: 'measure-experiments' });

    expect([
      key,
      refusedOfKey(key),
      refusedOfKey('paying-customers'),
      goalSummariesStreamIdOf('paying-customers'),
    ]).toEqual([
      'paying-customers.measure-experiments',
      { goal: 'paying-customers', workflow: 'measure-experiments' },
      undefined,
      'paying-customers',
    ]);
  });
});

describe('the notices and summaries started in a day', () => {
  it('are counted in one row a UTC day, by the moment each start was seen', () => {
    const stream = observationStream;
    const started = [
      messageOf('goal_notice_started', {}, '2026-11-09T23:59:59.000Z'),
      messageOf('goal_summary_started', {}, '2026-11-09T00:00:00.000Z', 1),
    ];

    expect([
      ...started.map((message) => noticeDays.keyOf?.(message, stream)),
      noticeDays.keyOf?.(messageOf('goal_overdue', {}, '2026-11-09T10:00:00.000Z'), observationStream),
      noticeDays.keyOf?.(messageOf('goal_notice_started', {}, 'not a moment'), stream),
      rowFoldedOf(noticeDays, started),
      noticeDayOf(Date.parse('2026-11-10T00:00:00.000Z')),
    ]).toEqual(['2026-11-09', '2026-11-09', undefined, undefined, { started: 2 }, '2026-11-10']);
  });
});

const observed = (at: string, run: string, position: number) =>
  messageOf(
    'goal_observed',
    { source: { record: `record-${run}`, run, workflow: 'measure-experiments', version: 3, entry: 1 }, at },
    at,
    position,
  );

describe('the latest observation of a workflow’s contribution', () => {
  it('is one row a workflow version and entry, keyed from the observation, with the latest run it observed', () => {
    const key = observedEntryKeyOf({ workflow: 'measure-experiments', version: 3, entry: 1 });

    expect([
      key,
      observationRows.keyOf?.(observed('2026-11-09T10:00:00.000Z', 'run-1', 0), observationStream),
      observationRows.keyOf?.(
        messageOf('goal_overdue', { since: '2026-11-09T10:00:00.000Z', told: 'now' }, '2026-11-09T10:00:00.000Z'),
        observationStream,
      ),
      rowFoldedOf(observationRows, [
        observed('2026-11-09T10:00:00.000Z', 'run-1', 0),
        observed('2026-11-09T11:00:00.000Z', 'run-2', 1),
        observed('2026-11-09T10:30:00.000Z', 'run-3', 2),
      ]),
      observationRows.rowAfter(undefined, messageOf('goal_overdue', {}, '2026-11-09T10:00:00.000Z')),
    ]).toEqual([
      'measure-experiments/3/1',
      'measure-experiments/3/1',
      undefined,
      {
        workflow: 'measure-experiments',
        version: 3,
        entry: 1,
        observed_at: Date.parse('2026-11-09T11:00:00.000Z'),
        run: 'run-2',
      },
      undefined,
    ]);
  });
});
