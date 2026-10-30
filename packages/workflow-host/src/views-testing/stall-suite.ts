import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { secondFoldWithBudget } from './pool-faults.ts';
import {
  delayingFolding,
  overrunningFold,
  overrunningFolding,
  overrunsItsDeadline,
  steppedClock,
  takesItsNeighboursTime,
  untilTried,
} from './stepped-sweeps.ts';
import { breakingFoldWorker, breaksTheWorker } from './test-fold-workers.ts';
import {
  collecting,
  counting,
  detailsOf,
  foldOf,
  foldedAll,
  isLive,
  isStalled,
  liveWith,
  succeeded,
} from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

const raisingWithTheEvent = foldOf(
  'if (event.data.output === "bad") throw new Error(`cannot take ${event.data.output}`);\n  return view + 1;',
);

function badFold(whenBad: string): string {
  return foldOf(`if (event.data.output === "bad") ${whenBad}\n  return view + 1;`);
}

const anyText: unknown = expect.any(String);

const sweptFrom = Date.parse('2026-10-06T09:00:00.000Z');

const sweepMs = 60_000;

const stallingFolds: readonly (readonly [string, string, Readonly<Record<string, unknown>>])[] = [
  ['raises with the event', raisingWithTheEvent, { kind: 'raised', message: 'Error: cannot take bad', line: 31 }],
  ['calls what is not a function', badFold('return view + event.data.output.toFixed();'), { kind: 'raised', line: 31 }],
  ['answers nothing', badFold('return undefined;'), { kind: 'unfit', line: null }],
  ['answers what JSON cannot carry', badFold('return Number.NaN;'), { kind: 'unfit', line: null }],
  ['does too much work', badFold('for (;;) {}'), { kind: 'work', line: null }],
  [
    'uses more memory than a page may',
    badFold('{\n    const kept = [];\n    for (;;) kept.push("y".repeat(1048576) + kept.length);\n  }'),
    { kind: 'memory', line: null },
  ],
  [
    'nests too deep',
    badFold(
      '{\n    let value = 0;\n    for (let level = 0; level < 600; level++) value = [value];\n    return value;\n  }',
    ),
    { kind: 'unfit', line: null },
  ],
  ['outgrows its bound', badFold('return "x".repeat(600000);'), { kind: 'size', line: null }],
];

async function threeRuns(views: ViewHarness): Promise<void> {
  await views.ranEach('reasoning/runs', ['good', 'bad', 'later']);
}

function stoppingTests(settingsOf: SettingsOf): void {
  it.each(stallingFolds)(
    'stops at the event when its fold %s, keeping what it folded before and naming the event',
    async (_way, fold, stall) => {
      const views = await viewHarness(await settingsOf());
      await views.saved('runs', detailsOf(fold, succeeded, { initial: 0 }));
      await threeRuns(views);
      views.start();

      const kept = await views.until('runs', isStalled);

      expect(kept).toMatchObject({ view: 1, folded: 1, stall: { ...stall, event: { type: 'run_succeeded' } } });
      expect(kept.stall?.event.id).toEqual(anyText);
      expect(kept.stall?.event.time).toBe('2026-10-06T10:00:00.000Z');
    },
  );

  it('stops when the view it folds is one its schema refuses', async () => {
    const views = await viewHarness(await settingsOf());
    const schema = { type: 'array', maxItems: 1 };
    await views.saved(
      'runs',
      detailsOf(foldOf('return [...view, event.data.output];'), succeeded, { initial: [], schema }),
    );
    await threeRuns(views);
    views.start();

    const kept = await views.until('runs', isStalled);

    expect(kept).toMatchObject({ view: ['good'], folded: 1, stall: { kind: 'schema', line: null } });
    expect(kept.stall?.message).toMatch(/^the view: Expected a value with a length of at most 1/u);
  });
}

function afterTheStallTests(settingsOf: SettingsOf): void {
  it('holds back no other view of the playbook, nor what the playbook records afterwards', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('stalling', detailsOf(raisingWithTheEvent, succeeded, { initial: 0 }));
    await views.saved('counting', counting);
    await threeRuns(views);
    views.start();

    await views.until('stalling', isStalled);
    await views.ran('reasoning/runs', 'after the stall');
    const kept = await views.until('counting', foldedAll(4));
    const stalling = await views.viewOf('stalling');

    expect([kept.view, stalling?.folded, stalling?.phase]).toEqual([4, 1, 'stalled']);
  });

  it('is tried again at each sweep when its fold runs past its deadline, counting the tries on its row, and stops after the tries it may have', async () => {
    const views = await viewHarness(await settingsOf());
    const clock = steppedClock(sweptFrom);
    await views.saved('runs', detailsOf(overrunningFold, succeeded, { initial: 0 }));
    await views.ranEach('reasoning/runs', ['good', overrunsItsDeadline, 'later']);
    views.start({ folding: overrunningFolding(), overtimesBeforeStall: 3, clock, sweepEveryMs: sweepMs });

    await untilTried(views, 'runs', 1);
    clock.step(sweepMs);
    await untilTried(views, 'runs', 2);
    clock.step(sweepMs);
    const kept = await views.until('runs', isStalled);

    expect(kept).toMatchObject({ view: 1, folded: 1, stall: { kind: 'time', line: null } });
    expect(kept.stall?.message).toBe('The fold was stopped by its deadline of 10000 ms 3 times');
  });
}

function lostPageTests(settingsOf: SettingsOf): void {
  it('keeps what it folded before the event its worker broke on, counting each try there, and then stalls', async () => {
    const views = await viewHarness(await settingsOf(), { foldWorker: breakingFoldWorker });
    await views.saved('outputs', collecting);
    await views.ranEach('reasoning/runs', [1, 2, breaksTheWorker]);
    views.start({ overtimesBeforeStall: 2, sweepEveryMs: 20 });

    const kept = await views.until('outputs', isStalled);

    expect(kept).toMatchObject({
      view: [1, 2],
      folded: 2,
      stall: {
        kind: 'crash',
        message: 'The fold was stopped by its crash 2 times',
        event: { type: 'run_succeeded' },
      },
    });
  });

  it('keeps every event it folded before the one its worker broke on, when folding up to it ends early', async () => {
    const views = await viewHarness(await settingsOf(), { foldWorker: breakingFoldWorker });
    await views.saved('outputs', collecting);
    await views.ranEach('reasoning/runs', [1, 2, breaksTheWorker]);
    const pool = secondFoldWithBudget(views.pool, 0);
    views.start({ pool, overtimesBeforeStall: 2, sweepEveryMs: 20 });

    const kept = await views.until('outputs', isStalled);

    expect(kept).toMatchObject({
      view: [1, 2],
      folded: 2,
      stall: { kind: 'crash', message: 'The fold was stopped by its crash 2 times' },
    });
  });
}

function neighbourTests(settingsOf: SettingsOf): void {
  it('never charges a view the time its neighbours took on the same event', async () => {
    const views = await viewHarness(await settingsOf());
    const names = ['first', 'second', 'third', 'fourth'];
    await names.reduce<Promise<unknown>>(
      (before, name) => before.then(() => views.saved(name, counting)),
      Promise.resolve(),
    );
    views.start({ folding: delayingFolding(), clock: steppedClock(sweptFrom), overtimesBeforeStall: 1 });
    await Promise.all(names.map((name) => views.until(name, isLive)));

    await views.ran('reasoning/runs', takesItsNeighboursTime);
    const kept = await Promise.all(names.map((name) => views.until(name, liveWith(1))));

    expect(kept.map(({ phase, view }) => [phase, view])).toEqual(names.map(() => ['live', 1]));
  });
}

export function stallSuite(settingsOf: SettingsOf): void {
  describe('a view that stalls', () => {
    stoppingTests(settingsOf);
    afterTheStallTests(settingsOf);
    lostPageTests(settingsOf);
    neighbourTests(settingsOf);
  });
}
