import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

const closing = workflow(`
schedule:
  on: { one: { with: { type: com.example.ledger.closed } } }
  every: PT1H
input:
  from: '\${ Array.isArray($data) ? { month: $data[0].data.month } : { due: $data.schedule.due } }'
do:
  - keep: { set: '\${ $data }' }
`);

describe('a workflow with an event trigger and a schedule', () => {
  it('tells the input of a run its event started from the input of a run its schedule started', async () => {
    const event = {
      specversion: '1.0',
      id: 'e1',
      source: '/ledger',
      type: 'com.example.ledger.closed',
      data: { month: 'september' },
    };

    const runs = [
      await interpret(closing, { input: [event] }),
      await interpret(closing, { input: { schedule: { due: '2026-10-01T10:00:00.000Z' } } }),
    ];

    expect(runs.map(({ ending }) => ending)).toEqual([
      { kind: 'completed', output: { month: 'september' } },
      { kind: 'completed', output: { due: '2026-10-01T10:00:00.000Z' } },
    ]);
  });
});
