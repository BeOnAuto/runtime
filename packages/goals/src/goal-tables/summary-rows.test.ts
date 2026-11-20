import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { summariesStreamId } from '../goal-facts/goal-facts.ts';
import { rowFoldedOf } from './folded-rows.ts';
import { summaryRows } from './summary-rows.ts';

const messageOf = (type: string, data: unknown, at: string, position = 0): ProjectedMessage => ({
  id: `fact-${String(position)}`,
  position,
  type,
  data,
  context: { at, by: 'playbook:alpha' },
});

const summariesStream = { kind: 'goal-summaries', id: 'summary' };

const started = (due: string, run: string, position: number) =>
  messageOf('goal_summary_started', { due, window: { from: due, to: due }, run }, due, position);

const refused = (retry: string | undefined, position: number) =>
  messageOf(
    'goal_notice_refused',
    {
      change: 'summary',
      attempt: position,
      detail: 'unavailable',
      ...(retry === undefined ? {} : { retry_at: retry }),
    },
    '2026-11-20T09:00:01.000Z',
    position,
  );

describe('the summaries of a goal', () => {
  it('are one row under the goal’s own stream, with the last summary started and its run', () => {
    expect([summaryRows.keyOf, rowFoldedOf(summaryRows, [started('2026-11-13T09:00:00.000Z', 'run-1', 0)])]).toEqual([
      undefined,
      {
        last_due: Date.parse('2026-11-13T09:00:00.000Z'),
        last_run: 'run-1',
        started_at: Date.parse('2026-11-13T09:00:00.000Z'),
        refused_at: null,
        attempt: null,
        detail: null,
        retry_at: null,
      },
    ]);
    expect(summariesStream.id).toBe(summariesStreamId);
  });
});

describe('the summaries of a goal refused', () => {
  it('keep a refused start and its retry, folded from the refusal, until a later start clears it', () => {
    const once = rowFoldedOf(summaryRows, [
      started('2026-11-13T09:00:00.000Z', 'run-1', 0),
      refused('2026-11-20T09:05:00.000Z', 1),
    ]);
    const given = rowFoldedOf(summaryRows, [refused(undefined, 1)]);

    expect([once, given]).toEqual([
      {
        last_due: Date.parse('2026-11-13T09:00:00.000Z'),
        last_run: 'run-1',
        started_at: Date.parse('2026-11-13T09:00:00.000Z'),
        refused_at: Date.parse('2026-11-20T09:00:01.000Z'),
        attempt: 1,
        detail: 'unavailable',
        retry_at: Date.parse('2026-11-20T09:05:00.000Z'),
      },
      {
        last_due: null,
        last_run: null,
        started_at: null,
        refused_at: Date.parse('2026-11-20T09:00:01.000Z'),
        attempt: 1,
        detail: 'unavailable',
        retry_at: null,
      },
    ]);
  });

  it('clear a refusal at a later start, and let the clock move a retry it made', () => {
    expect(
      rowFoldedOf(summaryRows, [
        refused('2026-11-20T09:05:00.000Z', 1),
        started('2026-11-20T09:00:00.000Z', 'run-2', 2),
      ]),
    ).toMatchObject({
      last_run: 'run-2',
      refused_at: null,
      retry_at: null,
    });
    expect(summaryRows.advanced).toEqual([
      { column: 'retry_at', setBy: ['goal_summary_started', 'goal_notice_refused'] },
    ]);
  });
});

describe('the summaries of a goal, of other facts', () => {
  it('take no refusal of an assessment’s notice and no fact they cannot read', () => {
    expect([
      summaryRows.rowAfter(
        undefined,
        messageOf('goal_notice_refused', { change: 'failed', attempt: 1, detail: 'gone' }, '2026-11-20T09:00:00.000Z'),
      ),
      summaryRows.rowAfter(undefined, messageOf('goal_summary_started', { due: 'soon' }, '2026-11-20T09:00:00.000Z')),
    ]).toEqual([undefined, undefined]);
  });
});
