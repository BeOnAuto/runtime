import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { newRun } from '../machine/run-state.ts';
import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import { evolveRun, loadedRunOf } from '../run-log/run-fold.ts';
import { snapshotEveryBytes } from '../run-log/snapshot.ts';
import { workflow } from '../testing/workflows.ts';

const inputs = 3000;

const runId = '0199a3c4-7d2e-7c1a-9b3f-000000003000';

const ticking = workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1 }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < ${inputs - 1} }', then: tick } }] }
`);

describe(`a run of ${inputs} inputs`, () => {
  it(
    'resumes from its last snapshot and the events after it alone, to the state its whole stream folds to',
    { timeout: Number.POSITIVE_INFINITY },
    () => {
      const driver = testDriverOf();
      driver.start({ runId, document: ticking });
      driver.runUntilEnded(runId);
      const events = driver.ports.runStore.events(runId);
      const stored = Effect.runSync(driver.ports.runStore.load(runId));

      const resumed = loadedRunOf(stored);

      expect(events).toHaveLength(inputs);
      expect(stored.snapshot?.snapshot.version).toBeGreaterThan(inputs / 2);
      expect(resumed.sinceSnapshot.bytes).toBeLessThan(snapshotEveryBytes);
      expect(resumed.version).toBe(inputs);
      expect(resumed.state).toEqual(events.reduce((state, { event }) => evolveRun(state, event), newRun));
    },
  );
});
