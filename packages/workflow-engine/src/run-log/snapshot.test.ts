import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  isSnapshotDue,
  mostSnapshotChunkBytes,
  snapshotChunks,
  snapshotFromChunks,
  snapshotOf,
  stateFormat,
  stateInCurrentFormat,
  type Snapshot,
} from '../index.ts';
import { runningState } from '../testing/runs.ts';

const highSurrogate = /[\uD800-\uDBFF]$/u;

const lowSurrogate = /^[\uDC00-\uDFFF]/u;

const utf8 = new TextEncoder();

function snapshotHolding(text: string): Snapshot {
  const values = { ...runningState.machine.values, 0: { value: text, bytes: text.length } };
  return snapshotOf({ ...runningState, machine: { ...runningState.machine, values } }, 4000);
}

describe('a snapshot', () => {
  it('is due once the events since the last snapshot take as many bytes as it did, and at least 1 MiB', () => {
    expect([
      isSnapshotDue({ bytes: 1_048_575, snapshotBytes: 0 }),
      isSnapshotDue({ bytes: 1_048_576, snapshotBytes: 900_000 }),
      isSnapshotDue({ bytes: 2_000_000, snapshotBytes: 3_000_000 }),
      isSnapshotDue({ bytes: 3_000_000, snapshotBytes: 3_000_000 }),
    ]).toEqual([false, true, false, true]);
  });

  it('names its state format and the bytes of history it covers, and round-trips through its chunks', () => {
    const snapshot = snapshotOf(runningState, 1000);

    expect(snapshot).toMatchObject({
      format: stateFormat,
      runId: runningState.runId,
      version: 1000,
      historyBytes: 9000,
    });
    expect(snapshotFromChunks(snapshotChunks(snapshot))).toEqual(Result.succeed(snapshot));
    expect(stateInCurrentFormat(snapshot.format, snapshot.state)).toEqual(runningState);
  });

  it('is stored in chunks of at most 1 MiB of UTF-8, well under the 2 MB a row takes, that never split a character', () => {
    const snapshot = snapshotHolding(`${'😀'.repeat(300_000)}x${'€'.repeat(200_000)}é${'é'.repeat(300_000)}`);

    const chunks = snapshotChunks(snapshot);

    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((chunk) => utf8.encode(chunk).byteLength))).toBeLessThanOrEqual(
      mostSnapshotChunkBytes,
    );
    expect(chunks.filter((chunk) => highSurrogate.test(chunk))).toEqual([]);
    expect(chunks.filter((chunk) => lowSurrogate.test(chunk))).toEqual([]);
    expect(snapshotFromChunks(chunks)).toEqual(Result.succeed(snapshot));
  });

  it('is refused when its chunks do not make a snapshot', () => {
    const text = snapshotChunks(snapshotOf(runningState, 1)).join('').replace(`"format":${stateFormat}`, '"format":0');

    expect(Result.isFailure(snapshotFromChunks([text]))).toBe(true);
  });
});
