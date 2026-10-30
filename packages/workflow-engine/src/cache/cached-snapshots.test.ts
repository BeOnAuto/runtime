import { describe, expect, it } from 'vitest';

import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import { eventBytesOf, type PositionedEvent } from '../run-log/run-event.ts';
import { isSnapshotDue, snapshotChunks, snapshotOf } from '../run-log/snapshot.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const holdingMuch = workflow(`
do:
  - hold: { set: {}, export: { as: '\${ ({ much: "x".repeat(1200000) }) }' } }
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1, pad: "y".repeat(65536) }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < 60 }', then: tick } }] }
`);

const utf8 = new TextEncoder();

function snapshotsDueAlong(events: readonly PositionedEvent[]): readonly number[] {
  const states = statesAlong(events);
  const since = { bytes: 0, snapshotBytes: 0 };
  return events.flatMap(({ version, event }, index) => {
    since.bytes += eventBytesOf(event);
    const state = states[index];
    if (state === undefined || !isSnapshotDue(since)) {
      return [];
    }
    const chunks = snapshotChunks(snapshotOf(state, version));
    since.snapshotBytes = chunks.reduce((sum, chunk) => sum + utf8.encode(chunk).byteLength, 0);
    since.bytes = 0;
    return [version];
  });
}

function ranToItsEnd(): MemoryDriver {
  const driver = testDriverOf();
  driver.start({ runId: drivenRunId, document: holdingMuch });
  driver.runUntilEnded(drivenRunId);
  return driver;
}

describe('a run the engine keeps between its inputs', () => {
  it('counts the bytes of the snapshot its store holds, so each snapshot is written when it is due', () => {
    const driver = ranToItsEnd();
    const events = driver.ports.runStore.events(drivenRunId);
    const saved = driver.ports.runStore.snapshotsSaved(drivenRunId);

    expect(statesAlong(events).at(-1)?.outcome).toMatchObject({ kind: 'completed' });
    expect(saved.length).toBeGreaterThan(2);
    expect(saved).toEqual(snapshotsDueAlong(events));
  });
});
