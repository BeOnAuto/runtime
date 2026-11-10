import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { coldEngineOn, keptAnswer, largeAnswer, pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import type { HeldContent } from '../machine/held-contents.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { keptBytesOf } from './run-cache.ts';

const answerText = JSON.stringify(largeAnswer);

describe('a run that keeps a value outside, loaded from its store again', () => {
  it('is reported at the digest and size it holds as loaded, before it reads the text in', () => {
    const driver = waitingOnItsPause();
    const cold = coldEngineOn(driver.ports);
    const stored = Effect.runSync(driver.ports.runStore.load(drivenRunId));
    const asLoaded = { ...loadedRunOf(stored), contents: new Map<string, HeldContent>() };
    const readIn = new Map<string, HeldContent>([[keptAnswer, { kind: 'read', text: answerText }]]);
    const before = driver.ports.reporter.reloads().length;

    Effect.runSync(cold.submit(pauseEnded(driver.state(drivenRunId))));

    expect(driver.ports.reporter.reloads().slice(before)).toEqual([
      { runId: drivenRunId, snapshot: false, events: stored.tail.length, keptBytes: keptBytesOf(asLoaded) },
    ]);
    expect(keptBytesOf({ ...asLoaded, contents: readIn }) - keptBytesOf(asLoaded)).toBe(answerText.length);
  });
});
