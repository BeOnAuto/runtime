import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { licensedScriptedRuntime, scriptedFeature, scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { builtFrom, modelFactsOf } from './built-versions.ts';
import { performedUntilQuiet } from './due-driving.ts';
import { quietVisits } from './projected-fixtures.ts';
import { day, projectedSales } from './projected-visits.ts';

const testTimeoutMs = 120_000;

const aFigure: unknown = expect.any(Number);

const decisions = new Set(['shadow_passed', 'shadow_failed', 'version_activated', 'activation_refused']);

function decidesTheChallenger({ type, data }: { readonly type: string; readonly data: unknown }): boolean {
  return decisions.has(type) && Reflect.get(new Object(data), 'version') === 2;
}

async function lapsedShadow(settingsOf: SettingsOf, formats: readonly [string, string]) {
  const features = [scriptedFeature];
  const runtimes = [licensedScriptedRuntime, scriptedRuntime];
  const projected = await projectedSales(settingsOf, { ...quietVisits, runtimes, license: { features } });
  const [active, challenger] = formats;
  await builtFrom(projected.playbook, ['visits-mean'], 'daily-visits', active);
  await builtFrom(projected.playbook, ['visits-mean'], 'daily-visits', challenger);
  features.splice(0);
  await performedUntilQuiet(projected.playbook, 2 * day);
  const lapsed = await modelFactsOf(projected.playbook);
  features.push(scriptedFeature);
  await performedUntilQuiet(projected.playbook, 6 * day);
  const after = await modelFactsOf(projected.playbook);
  return {
    skipped: lapsed.filter(
      ({ type, data }) => type === 'shadow_predicted' && Object.hasOwn(new Object(data), 'because'),
    ),
    decidedWhileLapsed: lapsed.filter((fact) => decidesTheChallenger(fact)),
    decided: after.filter((fact) => decidesTheChallenger(fact)),
  };
}

function shadowUnderALapse(settingsOf: SettingsOf): void {
  it.each([
    ['the active version', ['scripted-licensed', 'scripted']],
    ['the challenger', ['scripted', 'scripted-licensed']],
  ] as const)(
    'leaves the shadow undecided while the runtime of %s lacks its feature, and decides it on the closes after',
    async (_side, formats) => {
      const { skipped, decidedWhileLapsed, decided } = await lapsedShadow(settingsOf, formats);

      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped[0]).toMatchObject({
        data: { runtime: null, because: 'feature_unlicensed', feature: scriptedFeature },
      });
      expect(decidedWhileLapsed).toEqual([]);
      expect(decided).toMatchObject([
        { type: 'shadow_passed', data: { version: 2, challenger: aFigure, active: aFigure } },
        { type: 'version_activated', data: { version: 2, rule: 'automatic' } },
      ]);
    },
  );
}

export function projectedLicensedSuite(settingsOf: SettingsOf): void {
  describe('the shadow of a challenger under a lapse of the license', { timeout: testTimeoutMs }, () => {
    shadowUnderALapse(settingsOf);
  });
}
