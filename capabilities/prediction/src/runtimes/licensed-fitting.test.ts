import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { askedBuild, runOf, savedFunction, visitsRows, workOf } from '../build-testing/built-versions.ts';
import { performedUntilQuiet } from '../build-testing/due-driving.ts';
import {
  licensedFormatFitter,
  licensedScriptedRuntime,
  licensesPage,
  scriptedFeature,
  scriptedRuntime,
  type ScriptedLicense,
} from '../runtime-testing/scripted-runtime.ts';
import { trainerlessDailyVisits } from '../testing/daily-documents.ts';
import type { PortOptions } from '../testing/prediction-ports.ts';

function wordsOf(which: string): string {
  return `This runtime's license does not include ${scriptedFeature}, which ${which}. The account holder or an organization admin can add it at ${licensesPage}.`;
}

async function fittedBuild(options: PortOptions) {
  const playbook = buildPlaybook(options);
  await savedFunction(playbook, { source: trainerlessDailyVisits(visitsRows.sha256) });
  const build = await askedBuild(playbook);
  await performedUntilQuiet(playbook);
  const work = await workOf(playbook, build);
  return {
    work,
    fitted: work.find(({ type }) => type === 'candidates_fitted')?.data,
    refused: work.filter(({ type }) => type === 'candidate_refused').map(({ data }) => data),
    run: await runOf(playbook, build),
  };
}

const licensed: ScriptedLicense = { features: [scriptedFeature] };

describe('a build of a function that names no trainer, fitted by a runtime that needs a feature of the license', () => {
  it('is fitted by that runtime while the license includes its feature, and by the next runtime that fits while it does not', async () => {
    const runtimes = [licensedScriptedRuntime, scriptedRuntime];
    const inForce = await fittedBuild({ runtimes, license: licensed });
    const lapsed = await fittedBuild({ runtimes });

    expect([inForce.fitted?.['runtime'], lapsed.fitted?.['runtime']]).toEqual([
      { name: 'licensed-scripted-runtime', version: '1.0.0' },
      { name: 'scripted-runtime', version: '1.0.0' },
    ]);
    expect([inForce.run, lapsed.run]).toMatchObject([
      { output: { status: 'succeeded', output: { version: 1 } } },
      { output: { status: 'succeeded', output: { version: 1 } } },
    ]);
  });

  it('fits nothing, saying why, when the license lapses between choosing the runtime and asking it to fit', async () => {
    const { fitted } = await fittedBuild({
      runtimes: [licensedScriptedRuntime],
      license: { ...licensed, lapsesAfter: 2 },
    });

    expect(fitted).toEqual({
      runtime: { name: 'licensed-scripted-runtime', version: '1.0.0' },
      candidates: [],
      detail: wordsOf('licensed-scripted-runtime needs to fit the models of this function'),
    });
  });
});

describe('the models a runtime fits in a format whose runtime needs a feature the license does not include', () => {
  it.each([
    ['before they are checked', {}],
    ['while the first is checked', { license: { ...licensed, lapsesAfter: 3 } }],
  ] as const)('are refused, each saying why, %s', async (_case, license) => {
    const { fitted, refused } = await fittedBuild({
      runtimes: [licensedFormatFitter, licensedScriptedRuntime],
      ...license,
    });
    const why = { because: 'feature_unlicensed', detail: wordsOf('executes scripted-licensed models') };

    expect([fitted?.['candidates'], refused]).toEqual([
      [],
      [expect.objectContaining(why), expect.objectContaining(why)],
    ]);
  });
});
