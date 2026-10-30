import type { ModelRuntime } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { answered, asked, askedBuild, readOf, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { performedUntilQuiet } from '../build-testing/due-driving.ts';
import { candidateBytes, candidateSha256 } from '../runtime-testing/scripted-candidates.ts';
import {
  licensedFormatFitter,
  licensedScriptedRuntime,
  licensesPage,
  scriptedFeature,
  scriptedRuntime,
  type ScriptedLicense,
} from '../runtime-testing/scripted-runtime.ts';
import { readBuildBrief } from '../trainer/build-reads.ts';
import { uploadCandidate } from '../trainer/candidate-upload.ts';

const runtimes = [licensedScriptedRuntime, scriptedRuntime];

const licensed: ScriptedLicense = { features: [scriptedFeature] };

function wordsOf(which: string): string {
  return `This runtime's license does not include ${scriptedFeature}, which ${which}. The account holder or an organization admin can add it at ${licensesPage}.`;
}

const unlicensed = {
  status: 'rejected',
  reason: 'conflict',
  kind: 'feature_unlicensed',
  detail: wordsOf('executes scripted-licensed models'),
  resolve_at: licensesPage,
};

function refusedRun(which: string) {
  return { status: 'rejected', reason: 'conflict', kind: 'feature_unlicensed', detail: wordsOf(which) };
}

function sent(playbook: BuildPlaybook, build: string, format?: string) {
  const input = format === undefined ? { run_id: build } : { run_id: build, format };
  return playbook.send(uploadCandidate(playbook.test.ports), input, candidateBytes('visits-mean'));
}

async function waitingBuild(playbook: BuildPlaybook): Promise<string> {
  await savedFunction(playbook);
  return askedBuild(playbook);
}

function candidatesOf(work: Awaited<ReturnType<typeof workOf>>) {
  return work.filter(({ type }) => type.startsWith('candidate'));
}

describe('a candidate in a format whose runtime needs a feature of the license', () => {
  it('is refused before its body is read while the license does not include it, which the brief does not offer', async () => {
    const playbook = buildPlaybook({ runtimes });
    const build = await waitingBuild(playbook);
    const refused = await sent(playbook, build, 'scripted-licensed');
    const brief = await readOf(playbook, readBuildBrief, build);

    expect(refused).toEqual(unlicensed);
    expect(await workOf(playbook, build)).toMatchObject([{ type: 'dataset_assembled' }]);
    expect(brief).toEqual(expect.stringContaining('Each upload of a candidate takes a file in the format scripted.'));
  });

  it('is refused unnamed when its format is the only one the function could take', async () => {
    const playbook = buildPlaybook({ runtimes: [licensedScriptedRuntime] });

    expect(await sent(playbook, await waitingBuild(playbook))).toEqual(unlicensed);
  });

  it('is checked by its runtime while the license includes it, and refused when the license lapses before its check', async () => {
    const playbook = buildPlaybook({ runtimes, license: licensed });
    const build = await waitingBuild(playbook);
    const lapsing = buildPlaybook({ runtimes, license: { ...licensed, lapsesAfter: 2 } });
    const lapsingBuild = await waitingBuild(lapsing);

    expect(await sent(playbook, build, 'scripted-licensed')).toMatchObject({
      status: 'succeeded',
      output: { format: 'scripted-licensed' },
    });
    expect((await workOf(playbook, build)).at(-1)).toMatchObject({
      type: 'candidate_uploaded',
      data: { runtime: { name: 'licensed-scripted-runtime', version: '1.0.0' } },
    });
    expect(await sent(lapsing, lapsingBuild, 'scripted-licensed')).toEqual(unlicensed);
    expect(candidatesOf(await workOf(lapsing, lapsingBuild))).toEqual([]);
  });
});

describe('a candidate whose runtime’s feature the license stops including', () => {
  it('is disqualified, never walked, when the license stops including it before it is scored', async () => {
    const playbook = buildPlaybook({ runtimes, license: { ...licensed, lapsesAfter: 3 } });
    const build = await waitingBuild(playbook);
    await sent(playbook, build, 'scripted-licensed');
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
    await performedUntilQuiet(playbook);

    expect(candidatesOf(await workOf(playbook, build))).toEqual([
      expect.objectContaining({ type: 'candidate_uploaded' }),
      {
        type: 'candidate_disqualified',
        data: {
          sha256: candidateSha256('visits-mean'),
          because: 'feature_unlicensed',
          detail: unlicensed.detail,
          feature: scriptedFeature,
        },
      },
    ]);
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: null } } });
  });

  it('waits, scoring nothing, while the license cannot be read', async () => {
    const playbook = buildPlaybook({ runtimes, license: { ...licensed, unreadableAfter: 3 } });
    const build = await waitingBuild(playbook);
    await sent(playbook, build, 'scripted-licensed');
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
    await performedUntilQuiet(playbook);

    expect(candidatesOf(await workOf(playbook, build))).toEqual([
      expect.objectContaining({ type: 'candidate_uploaded' }),
    ]);
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'started' } });
  });
});

async function activeLicensed(license: ScriptedLicense, listed: readonly ModelRuntime[] = runtimes) {
  const playbook = buildPlaybook({ runtimes: listed, license });
  const build = await waitingBuild(playbook);
  expect(await sent(playbook, build, 'scripted-licensed')).toMatchObject({ status: 'succeeded' });
  await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
  await performedUntilQuiet(playbook);
  return playbook;
}

describe('a question whose active version is in a format whose runtime needs a feature of the license', () => {
  it('is answered by that version while the license includes it, and from the default forecast once it does not, saying why', async () => {
    const features = [scriptedFeature];
    const playbook = await activeLicensed({ features });
    const answeredLicensed = await asked(playbook, { series: 'north', horizon: 1 });
    features.splice(0);
    const lapsed = await asked(playbook, { series: 'north', horizon: 1 });

    expect(answeredLicensed).toMatchObject({
      output: { status: 'succeeded', record: { version: 1, runtime: { name: 'licensed-scripted-runtime' } } },
    });
    expect(lapsed).toMatchObject({
      output: {
        status: 'succeeded',
        record: {
          version: null,
          default_forecast: true,
          because: 'feature_unlicensed',
          feature: scriptedFeature,
          runtime: { name: 'scripted-runtime', version: '1.0.0' },
        },
      },
    });
  });

  it('is refused in the words of the license once it does not, where no other runtime answers a default forecast', async () => {
    const features = [scriptedFeature];
    const playbook = await activeLicensed({ features }, [licensedScriptedRuntime]);
    features.splice(0);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toEqual(
      refusedRun('executes scripted-licensed models, the format of version 1'),
    );
  });
});

describe('a question whose active version and default forecast are both in a format whose runtime needs a feature', () => {
  it('is refused in the words of the license, naming the default forecast, once the license lapses', async () => {
    const features = [scriptedFeature];
    const playbook = await activeLicensed({ features }, [licensedFormatFitter, licensedScriptedRuntime]);
    features.splice(0);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toEqual(
      refusedRun('executes scripted-licensed models, the format of the default forecast'),
    );
  });
});

const unreadable = {
  status: 'rejected',
  reason: 'unavailable',
  kind: 'meter_unavailable',
  detail: 'The license could not be read',
};

describe('work that needs a feature while the license cannot be read', () => {
  it('answers an upload unavailable, before its body is read', async () => {
    const playbook = buildPlaybook({ runtimes, license: { ...licensed, unreadableAfter: 1 } });

    expect(await sent(playbook, await waitingBuild(playbook), 'scripted-licensed')).toMatchObject(unreadable);
  });

  it('answers a question unavailable', async () => {
    const playbook = buildPlaybook({
      runtimes: [licensedScriptedRuntime],
      license: { ...licensed, unreadableAfter: 0 },
    });
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject(unreadable);
  });
});

describe('the default forecast of a function', () => {
  it('is refused when its model is in a format whose runtime needs a feature the license does not include', async () => {
    const playbook = buildPlaybook({ runtimes: [licensedFormatFitter, licensedScriptedRuntime] });
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toEqual(
      refusedRun('executes scripted-licensed models, the format of the default forecast'),
    );
  });

  it('is refused when the license lapses between choosing its runtime and asking it', async () => {
    const playbook = buildPlaybook({ runtimes: [licensedScriptedRuntime], license: { ...licensed, lapsesAfter: 1 } });
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toEqual(
      refusedRun('licensed-scripted-runtime needs to answer the default forecast'),
    );
  });
});
