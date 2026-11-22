import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { controls } from '../assessor/assessor-ledger.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockHarnessOf, type ClockHarness } from './clock-harness.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

const owner = { id: 'person:owner', name: 'Owner' };

const day = (date: string) => Date.parse(`2026-11-${date}T00:00:00.000Z`);

async function openedWindowsOf(harness: ClockHarness): Promise<readonly number[]> {
  const rows = await harness.book.rows(assessmentsName);
  return Object.values(rows)
    .map((row) => Number(row['window_opens']))
    .toSorted((one, other) => one - other);
}

async function reportingSince(workflows: readonly string[]): Promise<ClockHarness> {
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
  await Promise.all(workflows.map((workflow) => harness.book.workflowSaved(workflow, 1, checking)));
  await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
  await harness.steppedTo('2026-11-09T23:00:00.000Z');
  return harness;
}

interface Change {
  readonly workflow: string;
  readonly type: string;
  readonly at: string;
  readonly data?: Schema.Json;
}

function workflowChangedAt(harness: ClockHarness, { workflow, type, at, data = {} }: Change) {
  harness.movedTo(Date.parse(at));
  return harness.book.workflowChanged(workflow, type, data, {
    at,
    definitionType: 'workflow',
    definitionName: workflow,
    definitionVersion: 1,
  });
}

describe('the clock of a calendar goal nothing reports', () => {
  it('is due at each opening and opens nothing', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
    await harness.steppedTo('2026-11-11T01:00:00.000Z');

    expect(harness.wakes.map(({ at }) => new Date(at).toISOString())).toEqual([
      '2026-11-09T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
    ]);
    expect(await openedWindowsOf(harness)).toEqual([]);
  });
});

describe('a late clock, read against when the playbook’s workflows were last saved', () => {
  it('keeps shut the window a workflow was saved in, and opens the next', async () => {
    const harness = await reportingSince(['check']);
    await workflowChangedAt(harness, {
      workflow: 'check',
      type: 'definition_updated',
      at: '2026-11-10T10:00:00.000Z',
      data: { content: { source: 'document: check', details: { contributes: checking } } },
    });
    await harness.steppedTo('2026-11-11T01:00:00.000Z');

    expect(await openedWindowsOf(harness)).toEqual([day('09'), day('11')]);
  });

  it('keeps shut the window a workflow was resumed in', async () => {
    const harness = await reportingSince(['check']);
    await workflowChangedAt(harness, { workflow: 'check', type: 'definition_resumed', at: '2026-11-10T10:00:00.000Z' });
    await harness.steppedTo('2026-11-10T11:00:00.000Z');

    expect(await openedWindowsOf(harness)).toEqual([day('09')]);
  });
});

describe('a late clock, against workflows paused, retired or of another playbook', () => {
  it('opens the window a workflow was paused in while another reports, a pause arming nothing', async () => {
    const harness = await reportingSince(['check', 'recheck']);
    await workflowChangedAt(harness, {
      workflow: 'check',
      type: 'definition_paused',
      at: '2026-11-10T08:00:00.000Z',
      data: { paused_by: owner },
    });
    await harness.steppedTo('2026-11-10T09:00:00.000Z');

    expect(await openedWindowsOf(harness)).toEqual([day('09'), day('10')]);
  });

  it('takes the last save of a workflow retired since, which still keeps shut the window it was saved in', async () => {
    const harness = await reportingSince(['check', 'old-check']);
    await workflowChangedAt(harness, {
      workflow: 'old-check',
      type: 'definition_updated',
      at: '2026-11-10T10:00:00.000Z',
      data: { content: { source: 'document: old-check' } },
    });
    await workflowChangedAt(harness, {
      workflow: 'old-check',
      type: 'definition_retired',
      at: '2026-11-10T10:05:00.000Z',
    });
    await harness.steppedTo('2026-11-10T11:00:00.000Z');

    expect(await openedWindowsOf(harness)).toEqual([day('09')]);
  });

  it('is armed by no workflow of another playbook', async () => {
    const harness = await reportingSince(['check']);
    harness.movedTo(Date.parse('2026-11-10T10:00:00.000Z'));
    await harness.book.workflowChanged(
      'elsewhere',
      'definition_created',
      { content: { source: 'document: elsewhere' }, created_by: owner, playbook: 'beta' },
      { at: '2026-11-10T10:00:00.000Z', definitionType: 'workflow', definitionName: 'elsewhere', definitionVersion: 1 },
    );
    await harness.steppedTo('2026-11-10T11:00:00.000Z');

    expect(await openedWindowsOf(harness)).toEqual([day('09'), day('10')]);
  });
});
