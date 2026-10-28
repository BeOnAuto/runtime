import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { answered, askedBuild, builtFrom, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { performedOnce, performedUntilQuiet } from '../build-testing/due-driving.ts';
import { scriptedModels, type Script } from '../build-testing/scripted-models.ts';
import { candidateSha256, type CandidateName, uploaded } from '../runtime-testing/scripted-candidates.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';

const testTimeoutMs = 90_000;

function verdicts(names: readonly CandidateName[], verdict: readonly string[]) {
  return names.map((name, at) => ({ sha256: candidateSha256(name), verdict: verdict[at] }));
}

async function answeredWith(playbook: BuildPlaybook, names: readonly CandidateName[]): Promise<string> {
  await savedFunction(playbook);
  const build = await askedBuild(playbook);
  await uploaded(playbook, build, names);
  await answered(playbook, build, { candidates: names.map((name) => candidateSha256(name)) });
  return build;
}

const heldFed = { features: 0, given: 0, horizon: 2, totals: false };

describe('the scoring of the candidates of a build', { timeout: testTimeoutMs }, () => {
  it('walks each candidate in a model process, scores the baselines, and builds the version of the best that beats them', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await builtFrom(playbook, ['visits-mean', 'visits-even', 'visits-steady']);
    const work = await workOf(playbook, build);

    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          version: 1,
          winner: candidateSha256('visits-mean'),
          candidates: verdicts(['visits-mean', 'visits-even', 'visits-steady'], ['won', 'not_better', 'scored']),
        },
      },
    });
    expect(work.map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
      'candidate_uploaded',
      'candidate_uploaded',
      'candidate_scored',
      'candidate_disqualified',
      'candidate_scored',
      'baseline_scored',
    ]);
    expect(work[4]?.data).toMatchObject({
      runtime: { name: 'scripted-runtime', version: '1.0.0' },
      coverage: 1,
      against: [{ baseline: 'persistence', p_better: 1 }],
    });
  });
});

describe('the scoring of candidates none of which wins', { timeout: testTimeoutMs }, () => {
  it('builds no version when no candidate beats the baselines, naming why each lost', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const names: readonly CandidateName[] = ['visits-narrow', 'visits-not-a-number'];
    const build = await builtFrom(playbook, names);

    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          version: null,
          winner: null,
          candidates: verdicts(names, ['coverage_below_floor', 'answered_badly']),
        },
      },
    });
  });
});

describe('a candidate whose walk ends without an answer', { timeout: testTimeoutMs }, () => {
  it('is disqualified as timed out, out of memory, crashed or answering badly, as its model process ended', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({
      module: scripted.module,
      deadlines: { check: 30_000, run: 10_000, walk: 1500, baselines: 30_000, fit: 30_000 },
    });
    const names: readonly CandidateName[] = ['visits-mean', 'visits-last', 'visits-wide', 'visits-even'];
    const build = await answeredWith(playbook, names);
    const scripts: readonly Script[] = ['sleeps', 'allocates', 'exits', 'badly'];
    await scripts.reduce<Promise<unknown>>(
      (before, script) =>
        before.then(() => {
          scripted.next(script);
          return performedOnce(playbook.due, Date.now());
        }),
      Promise.resolve(),
    );
    scripted.next('real');
    await performedUntilQuiet(playbook);

    expect(
      (await workOf(playbook, build)).slice(5, 9).map(({ data }) => [data['because'], typeof data['detail']]),
    ).toEqual([
      ['timed_out', 'undefined'],
      ['out_of_memory', 'undefined'],
      ['crashed', 'string'],
      ['answered_badly', 'string'],
    ]);
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: null } } });
  });

  it('waits for a scoring permit when every one is taken, a minute at a time', async () => {
    const playbook = buildPlaybook();
    const build = await answeredWith(playbook, ['visits-mean']);
    const { permits } = playbook.test.ports;
    const taken = [permits.take(), permits.take()];
    await performedOnce(playbook.due, Date.now());
    const waited = await workOf(playbook, build);
    await performedOnce(playbook.due, Date.now() + 1000);
    const early = await workOf(playbook, build);
    for (const release of taken) {
      release?.();
    }
    await performedOnce(playbook.due, Date.now() + 61_000);

    expect([waited.length, early.length]).toEqual([2, 2]);
    expect((await workOf(playbook, build)).map(({ type }) => type).at(2)).toBe('candidate_scored');
  });
});

describe('a candidate whose file is no longer in the cache of the model processes', { timeout: testTimeoutMs }, () => {
  it('is read again from where its build staged it, and disqualified as not loaded once it is staged no more', async () => {
    const playbook = buildPlaybook();
    const build = await answeredWith(playbook, ['visits-mean', 'visits-steady']);
    rmSync(join(playbook.test.directory, 'models'), { recursive: true, force: true });
    rmSync(join(playbook.test.directory, 'rows'), { recursive: true, force: true });
    await performedOnce(playbook.due, Date.now());
    rmSync(join(playbook.test.directory, 'models'), { recursive: true, force: true });
    await Effect.runPromise(playbook.test.ports.ledger.content.unstage({ org: 'acme', playbook: 'alpha' }, build));
    await performedOnce(playbook.due, Date.now());

    expect((await workOf(playbook, build)).slice(3).map(({ type, data }) => [type, data['detail']])).toEqual([
      ['candidate_scored', undefined],
      [
        'candidate_disqualified',
        `Candidate ${candidateSha256('visits-steady').slice(0, 12)}… is no longer staged under its build`,
      ],
    ]);
  });
});

describe(
  'a candidate whose format no model runtime of the server executes any more',
  { timeout: testTimeoutMs },
  () => {
    it('is disqualified as not loaded, naming its format', async () => {
      const runtimes = [scriptedRuntime];
      const playbook = buildPlaybook({ runtimes });
      const build = await answeredWith(playbook, ['visits-mean']);
      runtimes.splice(0);
      await performedOnce(playbook.due, Date.now());

      expect((await workOf(playbook, build)).at(-1)).toMatchObject({
        type: 'candidate_disqualified',
        data: {
          because: 'not_loaded',
          detail: 'No model runtime this server has installed executes the format scripted of the candidate',
        },
      });
    });
  },
);

describe('a candidate scored while every model process is taken', { timeout: testTimeoutMs }, () => {
  it('waits a minute and is scored once a process is free', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({
      module: scripted.module,
      deadlines: { check: 30_000, run: 10_000, walk: 1500, baselines: 30_000, fit: 30_000 },
    });
    const build = await answeredWith(playbook, ['visits-mean']);
    const { models } = playbook.test.ports;
    scripted.next('held');
    const held = ['first', 'second'].map((sha256) =>
      Effect.runPromiseExit(models.check(scriptedRuntime, { sha256, path: `/${sha256}.scripted` }, heldFed)),
    );
    await scripted.untilSleeping(['check', 'check']);
    await performedOnce(playbook.due, Date.now());
    const waited = await workOf(playbook, build);
    scripted.next('real');
    await Promise.all(held);
    await performedOnce(playbook.due, Date.now() + 61_000);

    expect(waited).toHaveLength(2);
    expect((await workOf(playbook, build)).at(2)).toMatchObject({ type: 'candidate_scored' });
  });
});
