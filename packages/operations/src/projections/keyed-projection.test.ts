import { describe, expect, it } from 'vitest';

import {
  advancedColumnsLeftBy,
  advancedColumnsOf,
  playbookStreamOf,
  requireAdvancedColumns,
  rowKeyOf,
} from './keyed-projection.ts';
import { runTallyRows } from './tally-rows.ts';
import { topicRows } from './topic-rows.ts';

describe('the stream of a playbook a fact was appended to', () => {
  it('is read as the playbook key, its playbook, the kind and the id, and nothing that names no kind and id', () => {
    expect([
      playbookStreamOf('playbook/acme/alpha/runs/r1'),
      playbookStreamOf('playbook/acme/alpha/runs'),
      playbookStreamOf('playbook/acme/alpha/runs/r1/nested'),
    ]).toEqual([
      { playbookKey: 'playbook/acme/alpha/', playbook: { org: 'acme', playbook: 'alpha' }, kind: 'runs', id: 'r1' },
      undefined,
      undefined,
    ]);
  });

  it('is no stream of a playbook outside the playbooks, though it names a kind and an id', () => {
    expect(playbookStreamOf('org/acme/alpha/runs/r1')).toBeUndefined();
  });
});

describe('the key of the row a fact changes', () => {
  const opened = {
    id: 'message-1',
    position: 1,
    type: 'topic_opened',
    data: { topic: 'spring', at: 0 },
    context: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
  };

  it('is the stream’s id by default, what the mapping says otherwise, and none for a kind it does not fold', () => {
    const run = {
      playbookKey: 'playbook/acme/alpha/',
      playbook: { org: 'acme', playbook: 'alpha' },
      kind: 'runs',
      id: 'r1',
    };

    expect([
      rowKeyOf(runTallyRows, opened, run),
      rowKeyOf(topicRows, opened, run),
      rowKeyOf(topicRows, opened, { ...run, kind: 'others' }),
    ]).toEqual(['r1', 'spring', undefined]);
  });
});

describe('the columns a reader advances', () => {
  it('are those a projection declares, each set by the fold only for the types it names for that column', () => {
    const noteOpens = {
      ...topicRows,
      advanced: [
        { column: 'open', setBy: ['topic_opened', 'topic_noted'] },
        { column: 'next_at', setBy: ['topic_opened'] },
      ],
    };

    expect([advancedColumnsOf(runTallyRows), advancedColumnsOf(topicRows)]).toEqual([
      [],
      ['open', 'next_at', 'due_at'],
    ]);
    expect([
      advancedColumnsLeftBy(topicRows, 'topic_opened'),
      advancedColumnsLeftBy(topicRows, 'topic_noted'),
      advancedColumnsLeftBy(noteOpens, 'topic_noted'),
      advancedColumnsLeftBy(runTallyRows, 'run_began'),
    ]).toEqual([[], ['open', 'next_at', 'due_at'], ['next_at'], []]);
  });

  it('refuse a column the projection does not let its reader advance', () => {
    expect(() => {
      requireAdvancedColumns(topicRows, { open: false });
    }).not.toThrow();
    expect(() => {
      requireAdvancedColumns(runTallyRows, { open: false });
    }).toThrow('The projection run_tallies does not let its reader advance the column open');
  });
});
