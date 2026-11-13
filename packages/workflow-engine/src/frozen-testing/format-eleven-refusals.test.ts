import { describe, expect, it } from 'vitest';

import { drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { formatElevenRefusalsOf } from './format-eleven-refusals.ts';

const holding = workflow(`
do:
  - hold: { set: '\${ ({ text: "x".repeat(20000) }) }' }
  - pause: { wait: PT1M }
`);

function eventsOf(payloadOffloading: boolean) {
  return drivenRun(holding, { payloadOffloading }).events.map(({ event }) => event);
}

describe('the frozen schemas of format 11, the event and state schemas of the release before', () => {
  it('read every event a run writes keeping nothing outside, and every state it folds to, strictly', () => {
    expect(formatElevenRefusalsOf(eventsOf(false))).toEqual([]);
  });

  it('refuse an event of format 12 and a state that holds a value kept outside, naming where', () => {
    const refusals = formatElevenRefusalsOf(eventsOf(true));

    expect(refusals.map((refusal) => refusal.split(':')[0])).toEqual(
      expect.arrayContaining(['event 1', 'state after event 1']),
    );
  });
});
