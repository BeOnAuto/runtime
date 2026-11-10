import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import type { HeldContent, HeldContents } from '../machine/held-contents.ts';
import type { HeldValue, KeptValue } from '../machine/held-value.ts';
import { heldBytesOf, MissingValue } from '../machine/held-values.ts';
import type { RunState } from '../machine/run-state.ts';
import { stateFormat, stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { runningState } from '../testing/runs.ts';
import {
  heapBytesPerJsonByte,
  keptBytesOf,
  mostHeapBytesPerCharacter,
  runCacheOf,
  type CachedRun,
} from './run-cache.ts';

const asciiText = JSON.stringify({ text: 'k'.repeat(100_000) });

const otherText = JSON.stringify({ text: '漢'.repeat(50_000) });

function keptOf(text: string): KeptValue {
  return { sha256: sha256Of(text), bytes: new TextEncoder().encode(text).byteLength };
}

const ticketId = 1;

const ticketBytes = runningState.machine.values[ticketId]?.bytes ?? 0;

function holding(kept: KeptValue): RunState {
  const values = { ...runningState.machine.values, [ticketId]: kept };
  const state = { ...runningState, machine: { ...runningState.machine, values } };
  return { ...state, heldBytes: heldBytesOf(state) };
}

function cached(
  state: RunState,
  contents: HeldContents = new Map(),
  format: number | null = stateFormatKeepingPayloads,
): CachedRun {
  const sinceSnapshot = { bytes: 0, snapshotBytes: 0 };
  return { state, version: 1, sinceSnapshot, format, contents };
}

function holdingWith(kept: KeptValue, contents: readonly (readonly [string, HeldContent])[]): CachedRun {
  return cached(holding(kept), new Map(contents));
}

function bytesAddedBy(kept: KeptValue, contents: readonly (readonly [string, HeldContent])[]): number {
  return keptBytesOf(holdingWith(kept, contents)) - keptBytesOf(cached(holding(kept)));
}

const ascii = keptOf(asciiText);

const other = keptOf(otherText);

describe('what the cache of loaded runs counts of a value kept outside', () => {
  it('counts the digest and size the state holds, not the bytes of the value, until its text is read in', () => {
    const state = holding(ascii);
    const pointer = JSON.stringify({ sha256: ascii.sha256, bytes: ascii.bytes }).length;

    expect(keptBytesOf(cached(state))).toBe(
      heapBytesPerJsonByte * (state.heldBytes - ascii.bytes + pointer + state.inbox.waitingBytes),
    );
    expect(state.heldBytes - runningState.heldBytes).toBe(ascii.bytes - ticketBytes);
  });

  it('counts a text read in at a byte a character where it is ASCII, and at two otherwise, the most a character takes', () => {
    const asciiRead = bytesAddedBy(ascii, [[ascii.sha256, { kind: 'read', text: asciiText }]]);
    const otherRead = bytesAddedBy(other, [[other.sha256, { kind: 'read', text: otherText }]]);

    expect([asciiRead, otherRead]).toEqual([asciiText.length, mostHeapBytesPerCharacter * otherText.length]);
    expect(otherRead).toBeLessThan(other.bytes);
  });

  it('counts nothing for a content missing or erased, and a text its state does not reach at two bytes a character', () => {
    const unreached = 'a text no value of the run names';

    expect([
      bytesAddedBy(ascii, [[ascii.sha256, { kind: 'missing' }]]),
      bytesAddedBy(ascii, [[ascii.sha256, { kind: 'erased' }]]),
      bytesAddedBy(ascii, [[sha256Of(unreached), { kind: 'read', text: unreached }]]),
    ]).toEqual([0, 0, mostHeapBytesPerCharacter * unreached.length]);
  });

  it('lets go of a run once the texts it read in take more than its bound, as it would a run that holds them inline', () => {
    const asLoaded = cached(holding(ascii));
    const cache = runCacheOf({ mostRuns: 10, mostBytes: keptBytesOf(asLoaded) + asciiText.length - 1 });
    cache.put('a', asLoaded);
    const keptAsLoaded = cache.get('a') !== undefined;
    cache.put('a', holdingWith(ascii, [[ascii.sha256, { kind: 'read', text: asciiText }]]));

    expect([keptAsLoaded, cache.get('a')]).toEqual([true, undefined]);
  });
});

const namingAValueItDoesNotHold: RunState = {
  ...runningState,
  machine: {
    ...runningState.machine,
    values: Object.fromEntries(
      Object.entries(runningState.machine.values).filter(([id]: readonly [string, HeldValue]) => id !== `${ticketId}`),
    ),
  },
};

function countedAt(format: number | null): () => number {
  return () => keptBytesOf(cached(namingAValueItDoesNotHold, new Map(), format));
}

describe('what the cache of loaded runs counts of a run below format 12, which can keep no value outside', () => {
  it('counts the bytes it holds as the cache did before format 12, without walking its values to find a kept one', () => {
    const asBefore = heapBytesPerJsonByte * (runningState.heldBytes + runningState.inbox.waitingBytes);

    expect([countedAt(null)(), countedAt(stateFormat)()]).toEqual([asBefore, asBefore]);
    expect(countedAt(stateFormatKeepingPayloads)).toThrow(MissingValue);
  });
});
