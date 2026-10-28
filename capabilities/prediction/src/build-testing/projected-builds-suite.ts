import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { inlineScriptedRuntime, scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { asked, builtFrom, modelFactsOf, standingOf } from './built-versions.ts';
import { performedOnce, performedUntilQuiet } from './due-driving.ts';
import { gappyVisits, quietVisits, visits } from './projected-fixtures.ts';
import { day, projectedSales, type Projected, type Sales } from './projected-visits.ts';

const testTimeoutMs = 120_000;

type Script = Parameters<Projected['scripted']['next']>[0];

const aRest = 2 * 60_000;

const heldFed = { features: 0, given: 0, horizon: 2, totals: false };

function performedIn(projected: Projected, turns: readonly Script[], rested = 0): Promise<unknown> {
  const ahead = projected.playbook.now() + 4 * day + rested * aRest;
  return turns.reduce<Promise<unknown>>(
    (before, script, turn) =>
      before.then(() => {
        projected.scripted.next(script);
        return performedOnce(projected.playbook.due, ahead + turn * aRest);
      }),
    Promise.resolve(),
  );
}

async function challenged(settingsOf: SettingsOf, sales: Sales = visits): Promise<Projected> {
  const projected = await projectedSales(settingsOf, sales);
  await builtFrom(projected.playbook, ['visits-mean']);
  await builtFrom(projected.playbook, ['visits-mean']);
  return projected;
}

function decidesAShadow({ type }: { readonly type: string }): boolean {
  return type === 'shadow_passed' || type === 'shadow_failed';
}

function settlesAVersion({ type }: { readonly type: string }): boolean {
  return decidesAShadow({ type }) || type === 'activation_refused';
}

function typesOf(facts: readonly { readonly type: string }[]): readonly string[] {
  return facts.map(({ type }) => type);
}

function shadowDecisions(settingsOf: SettingsOf): void {
  it('predicts with each version at each close, grades them once the periods close, and activates a challenger that does no worse', async () => {
    const projected = await challenged(settingsOf, quietVisits);
    const waiting = await standingOf(projected.playbook);
    await performedUntilQuiet(projected.playbook, 4 * day);
    const facts = await modelFactsOf(projected.playbook);

    expect(waiting).toMatchObject({
      output: {
        standing: { models: { active: { version: 1 }, challenger: { version: 2, shadow: { predicted: 0 } } } },
      },
    });
    expect(typesOf(facts).filter((type) => type === 'shadow_predicted')).toHaveLength(4);
    expect(facts.find(({ type }) => type === 'shadow_predicted')).toMatchObject({
      data: { runtime: { name: 'scripted-runtime', version: '1.0.0' } },
    });
    expect(typesOf(facts).filter((type) => type === 'shadow_graded').length).toBeGreaterThanOrEqual(4);
    expect(facts.at(-2)).toMatchObject({ type: 'shadow_passed', data: { version: 2, metric: 'mase' } });
    expect(facts.at(-1)).toMatchObject({ type: 'version_activated', data: { version: 2, rule: 'automatic' } });
  });

  it('refuses a challenger that does worse than the active version over the same closes', async () => {
    const projected = await challenged(settingsOf);
    await performedIn(projected, ['shifted', 'real', 'shifted', 'real']);
    projected.scripted.next('real');
    await performedUntilQuiet(projected.playbook, 4 * day);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.at(-2)).toMatchObject({ type: 'shadow_failed', data: { version: 2 } });
    expect(facts.at(-1)).toMatchObject({ type: 'activation_refused', data: { version: 2, because: 'shadow_failed' } });
  });
}

function shadowLeavesOut(settingsOf: SettingsOf): void {
  it.each<{ readonly script: Script; readonly answered: string }>([
    { script: 'not-finite', answered: 'a number that is not finite' },
    { script: 'walks-low-above', answered: 'a low above its likely value' },
  ])(
    'keeps out of its predictions a series a walk answered $answered for, and refuses a challenger that answered nothing beside an active version that did',
    async ({ script }) => {
      const projected = await challenged(settingsOf);
      await performedIn(projected, [script, 'real', script, 'real']);
      projected.scripted.next('real');
      await performedUntilQuiet(projected.playbook, 4 * day);
      const facts = await modelFactsOf(projected.playbook);

      expect(facts.filter(({ type }) => type === 'shadow_predicted')).toMatchObject([
        { data: { of: 2, count: 0, missing: 2 } },
        { data: { of: 1, count: 2, missing: 0 } },
        { data: { of: 2, count: 0, missing: 2 } },
        { data: { of: 1, count: 2, missing: 0 } },
      ]);
      expect(facts.at(-2)).toMatchObject({ type: 'shadow_failed', data: { version: 2, challenger: null } });
      expect(facts.at(-1)).toMatchObject({
        type: 'activation_refused',
        data: { version: 2, because: 'shadow_failed' },
      });
    },
  );
}

function shadowSuperseded(settingsOf: SettingsOf): void {
  it('refuses a challenger as superseded when a newer version is built during its shadow, which then shadows in its place', async () => {
    const projected = await challenged(settingsOf, quietVisits);
    await builtFrom(projected.playbook, ['visits-mean']);
    await performedUntilQuiet(projected.playbook, 4 * day);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.filter(({ type }) => type === 'activation_refused')).toMatchObject([
      { data: { version: 2, because: 'superseded' } },
    ]);
    expect(facts.filter((fact) => decidesAShadow(fact))).toMatchObject([
      { data: { version: 1 } },
      { data: { version: 3 } },
    ]);
    expect(facts.at(-1)).toMatchObject({ type: 'version_activated', data: { version: 3, rule: 'automatic' } });
  });
}

function shadowWaits(settingsOf: SettingsOf): void {
  it('waits for a scoring permit and for its dataset at a close, and counts a prediction no process answered as none', async () => {
    const projected = await challenged(settingsOf);
    rmSync(join(projected.playbook.test.directory, 'models'), { recursive: true, force: true });
    const { permits } = projected.playbook.test.ports;
    const taken = [permits.take(), permits.take()];
    await performedIn(projected, ['real']);
    for (const release of taken) {
      release?.();
    }
    projected.read('empty');
    await performedIn(projected, ['real'], 1);
    projected.read('live');
    await performedIn(projected, ['exits'], 2);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.filter(({ type }) => type === 'shadow_predicted')).toMatchObject([{ data: { of: 2, count: 0 } }]);
  });

  it('waits while every model process is taken, grades with no truth while its dataset is not made, and decides only at a later close that has one', async () => {
    const projected = await challenged(settingsOf, {
      ...visits,
      deadlines: { check: 30_000, run: 10_000, walk: 1500, baselines: 30_000, fit: 30_000 },
    });
    const { models } = projected.playbook.test.ports;
    projected.scripted.next('held');
    const held = ['first', 'second'].map((sha256) =>
      Effect.runPromiseExit(models.check(scriptedRuntime, { sha256, path: `/${sha256}.scripted` }, heldFed)),
    );
    await projected.scripted.untilSleeping(['check', 'check']);
    await performedIn(projected, ['held']);
    projected.scripted.next('real');
    await Promise.all(held);
    await performedIn(projected, ['real', 'real', 'real', 'real'], 1);
    projected.read('empty');
    await performedUntilQuiet(projected.playbook, 4 * day);
    const undecided = await modelFactsOf(projected.playbook);
    projected.read('live');
    await performedUntilQuiet(projected.playbook, 5 * day);
    const decisions = (await modelFactsOf(projected.playbook)).filter((fact) => decidesAShadow(fact));

    expect(undecided.filter(({ type }) => type === 'shadow_predicted')).toHaveLength(4);
    expect(undecided.find(({ type }) => type === 'shadow_graded')).toMatchObject({ data: { graded: 0, answered: 0 } });
    expect(undecided.filter((fact) => decidesAShadow(fact))).toMatchObject([{ data: { version: 1 } }]);
    expect(decisions).toMatchObject([{ data: { version: 1 } }, { data: { version: 2 } }]);
  });
}

function shadowWithoutARuntime(settingsOf: SettingsOf): void {
  it('predicts nothing with a version whose format no model runtime of the server executes any more, and names no runtime', async () => {
    const runtimes = [scriptedRuntime];
    const projected = await challenged(settingsOf, { ...visits, runtimes });
    runtimes.splice(0);
    await performedIn(projected, ['real']);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.filter(({ type }) => type === 'shadow_predicted')).toMatchObject([
      { data: { of: 2, count: 0, missing: 0, runtime: null } },
    ]);
  });
}

function shadowInline(settingsOf: SettingsOf): void {
  it('scores, shadows and activates the versions of a runtime bound inline in the server’s own process, which reads the calendar', async () => {
    const projected = await challenged(settingsOf, { ...quietVisits, runtimes: [inlineScriptedRuntime] });
    await performedUntilQuiet(projected.playbook, 4 * day);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.find(({ type }) => type === 'shadow_predicted')).toMatchObject({
      data: { runtime: { name: 'inline-scripted-runtime', version: '1.0.0' } },
    });
    expect(facts.at(-1)).toMatchObject({ type: 'version_activated', data: { version: 2 } });
  });
}

function shadowUngraded(settingsOf: SettingsOf): void {
  it('fails once it has predicted at the most closes a shadow may without a series both versions answered', async () => {
    const projected = await challenged(settingsOf);
    projected.scripted.next('not-finite');
    await performedUntilQuiet(projected.playbook, 60 * day, 512);
    const facts = await modelFactsOf(projected.playbook);

    expect(facts.filter(({ type }) => type === 'shadow_predicted')).toHaveLength(2 * 52);
    expect(facts.filter((fact) => settlesAVersion(fact))).toMatchObject([
      { type: 'shadow_passed', data: { version: 1 } },
      { type: 'shadow_failed', data: { version: 2, challenger: null, active: null, ungraded_closes: 52 } },
      { type: 'activation_refused', data: { version: 2, because: 'shadow_failed' } },
    ]);
    expect(await standingOf(projected.playbook)).toMatchObject({ output: { standing: { build: null } } });
  });
}

function shadowGaps(settingsOf: SettingsOf): void {
  it('shadows a series observed every other day, which has no scale, and a period whose truth was not given', async () => {
    const projected = await projectedSales(settingsOf, gappyVisits);
    await builtFrom(projected.playbook, ['visits-observed-mean']);
    await builtFrom(projected.playbook, ['visits-observed-mean']);
    const east = await asked(projected.playbook, { series: 'east', horizon: 1 });
    await performedUntilQuiet(projected.playbook, 4 * day);
    const graded = (await modelFactsOf(projected.playbook)).filter(({ type }) => type === 'shadow_graded');

    expect(east).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          lines: [
            { name: 'observed', points: [{ value: 30 }, { value: 30 }] },
            { name: 'predicted', points: [{ value: 30, low: 28, high: 32 }] },
          ],
        },
      },
    });
    expect(graded.length).toBeGreaterThanOrEqual(4);
    expect(graded[0]).toMatchObject({ data: { graded: 3, missing: 1 } });
  });
}

export function projectedBuildsSuite(settingsOf: SettingsOf): void {
  describe('the shadow of a challenger over a series with gaps', { timeout: testTimeoutMs }, () => {
    shadowGaps(settingsOf);
  });

  describe('the shadow of a challenger over a projected dataset', { timeout: testTimeoutMs }, () => {
    shadowDecisions(settingsOf);
    shadowLeavesOut(settingsOf);
  });

  describe('the shadow of a challenger that has to wait', { timeout: testTimeoutMs }, () => {
    shadowWaits(settingsOf);
  });

  describe('the shadow of a challenger whose runtime is gone', { timeout: testTimeoutMs }, () => {
    shadowWithoutARuntime(settingsOf);
  });

  describe(
    'the shadow of a challenger whose runtime runs in the server’s own process',
    { timeout: testTimeoutMs },
    () => {
      shadowInline(settingsOf);
    },
  );

  describe('the shadow of a challenger that a newer version supersedes', { timeout: testTimeoutMs }, () => {
    shadowSuperseded(settingsOf);
  });

  describe('the shadow of a challenger that no close grades', { timeout: testTimeoutMs }, () => {
    shadowUngraded(settingsOf);
  });
}
