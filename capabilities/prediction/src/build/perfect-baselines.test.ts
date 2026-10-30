import type { RecordedContent } from '@on.auto/operations';
import { Effect, Fiber } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, askedBuild, buildAsked, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { scriptedModels } from '../build-testing/scripted-models.ts';
import type { ModelProcesses } from '../model-processes/model-processes.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';

const runIds = ['0199a3c4-7d2e-7c1a-9b3f-555555555561', '0199a3c4-7d2e-7c1a-9b3f-555555555562'];

const stillFrom = 30;

function stillOf(series: string): number {
  return series === 'north' ? 10 : 20;
}

function stillSeries(series: string, day: number): number {
  return day < stillFrom ? steadyVisits(series, day) : stillOf(series);
}

function southMoving(series: string, day: number): number {
  return series === 'south' ? steadyVisits(series, day) : stillSeries(series, day);
}

function movingOnlyWhenHeldBack(series: string, day: number): number {
  return day < 32 ? stillOf(series) : steadyVisits(series, day);
}

const still = dailyRows('visits', ['north', 'south'], 40, stillSeries);

const oneMoving = dailyRows('visits', ['north', 'south'], 40, southMoving);

const stillWhileTrained = dailyRows('visits', ['north', 'south'], 40, movingOnlyWhenHeldBack);

interface KeptTypes {
  readonly content: (kept: RecordedContent) => RecordedContent;
  readonly types: () => readonly string[];
}

function keptTypes(): KeptTypes {
  const types: string[] = [];
  return {
    content: (kept) => ({
      ...kept,
      put: (playbook, content) =>
        Effect.andThen(
          Effect.sync(() => {
            types.push(content.mediaType);
          }),
          kept.put(playbook, content),
        ),
    }),
    types: () => [...types],
  };
}

const heldWalk = {
  rows: '/held.csv',
  window: 3,
  holdout: 1,
  steps: 1,
  features: 0,
  given: [],
  remaining: null,
  first: null,
};

function heldBy(playbook: BuildPlaybook, model: string) {
  return Effect.runFork(
    playbook.test.ports.models.walk(
      'acme',
      scriptedRuntime,
      Effect.succeed({ sha256: model, path: `/${model}.scripted` }),
      heldWalk,
    ),
  );
}

interface CheckedBaselines {
  readonly models: (processes: ModelProcesses) => ModelProcesses;
  readonly untilChecking: () => Promise<void>;
}

function checkedBaselines(): CheckedBaselines {
  const checks: string[] = [];
  return {
    models: (processes) => ({
      ...processes,
      baselines: (rows, job) =>
        Effect.andThen(
          Effect.sync(() => {
            checks.push(rows.sha256);
          }),
          processes.baselines(rows, job),
        ),
    }),
    untilChecking: () =>
      vi.waitFor(
        () => {
          expect(checks).toHaveLength(1);
        },
        { timeout: 25_000, interval: 20 },
      ),
  };
}

describe('a build whose baseline already predicts every period held back exactly', () => {
  it('is refused once its rows are written, before its brief is kept or its trainer asked, and takes none of the builds of the day', async () => {
    const kept = keptTypes();
    const playbook = buildPlaybook({ bounds: { buildsPerDay: 1 }, content: kept.content });
    await savedFunction(playbook, { rows: still });
    const keptBefore = kept.types().length;
    const refused = [
      await asked(playbook, { build: {} }, { runId: String(runIds[0]) }),
      await asked(playbook, { build: {} }, { runId: String(runIds[1]) }),
    ];

    expect(refused).toMatchObject(
      runIds.map(() => ({
        status: 'rejected',
        reason: 'conflict',
        kind: 'baseline_perfect',
        detail:
          'The baseline persistence already scores 0 on mase at every period held back where mase scores it, the best a score can be, so no candidate can beat it; ask for a build once the series moves',
      })),
    );
    expect(kept.types().slice(keptBefore)).toEqual(['text/csv', 'text/csv', 'text/csv', 'text/csv']);
    expect(await Promise.all(runIds.map((runId) => workOf(playbook, runId)))).toEqual([[], []]);
    expect(await runOf(playbook, String(runIds[0]))).not.toHaveProperty('output.record');
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [] },
    });
  });
});

describe('a build whose baseline does not score 0 where its metric scores it', () => {
  it('goes ahead and asks its trainer when the baseline misses a period held back of one series', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook, { rows: oneMoving });
    const build = await askedBuild(playbook);

    expect(await workOf(playbook, build)).toMatchObject([{ type: 'dataset_assembled' }]);
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [{ run_id: build }] },
    });
  });
});

describe('a build whose series did not move while trained', () => {
  it('is refused as unscorable before its brief is kept, since mase, which scales by that movement, judges no candidate', async () => {
    const kept = keptTypes();
    const playbook = buildPlaybook({ content: kept.content });
    await savedFunction(playbook, { rows: stillWhileTrained });
    const keptBefore = kept.types().length;

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unscorable',
      detail:
        'No series moved during the periods a build trains on, so mase, which scales each error by that movement, scores no period held back and no candidate could be judged against the baselines; ask for a build once a series moves, or judge candidates by winkler or quantile',
    });
    expect(kept.types().slice(keptBefore)).toEqual(['text/csv', 'text/csv']);
  });
});

describe('a build whose baselines cannot be checked', () => {
  it('is refused as unavailable while every model process a build may hold is busy', async () => {
    const scripted = scriptedModels();
    const deadlines = { check: 60_000, run: 10_000, walk: 60_000, baselines: 300, fit: 30_000 };
    const playbook = buildPlaybook({ module: scripted.module, deadlines, processes: 3, longJobs: 2 });
    await savedFunction(playbook, { rows: still });
    scripted.next('sleeps');
    heldBy(playbook, 'first');
    heldBy(playbook, 'second');
    await scripted.untilSleeping(['walk', 'walk']);
    const whileBusy = await buildAsked(playbook);

    expect(whileBusy).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_busy',
      detail:
        'Every model process a build may hold stayed busy checking or scoring while the build waited for one; ask for the build again shortly',
    });
  });

  it('is refused as unavailable when the process that checks them ends before it answers', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({ module: scripted.module });
    await savedFunction(playbook, { rows: still });
    scripted.next('exits');

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      because: 'baseline_check',
      detail: 'The model process that checks the baselines ended before it answered; ask for the build again',
    });
  });
});

describe('a build whose baselines wait for a model process', () => {
  it('waits within the 30 seconds of its check for a process a build may hold, and checks them once one is free', async () => {
    const scripted = scriptedModels();
    const checked = checkedBaselines();
    const playbook = buildPlaybook({ module: scripted.module, processes: 3, longJobs: 2, models: checked.models });
    await savedFunction(playbook, { rows: still });
    scripted.next('sleeps');
    const first = heldBy(playbook, 'first');
    heldBy(playbook, 'second');
    await scripted.untilSleeping(['walk', 'walk']);
    scripted.next('real');
    const asking = buildAsked(playbook);
    await checked.untilChecking();
    await Effect.runPromise(Fiber.interrupt(first));

    expect(await asking).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'baseline_perfect' });
  });
});
