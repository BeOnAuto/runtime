import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { readOf, runOf, standingOf, workOf } from '../build-testing/built-versions.ts';
import { performedOnce, performedUntilQuiet } from '../build-testing/due-driving.ts';
import { sentThrough } from '../build-testing/sent-builds.ts';
import { predictionBuildsName } from '../builds/build-rows.ts';
import { uploaded } from '../runtime-testing/scripted-candidates.ts';
import { candidateSha256 } from '../runtime-testing/scripted-candidates.ts';
import { readBuildBrief } from '../trainer/build-reads.ts';
import { childIdOf } from './child-runs.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const endedUnanswered: unknown = expect.stringMatching(
  /^The interaction function send-build that carries the build to its trainer ended without an answer: /u,
);

function dueAgain(playbook: BuildPlaybook, build: string): Promise<void> {
  return Effect.runPromise(
    playbook.test.ports.ledger.advanceRow(predictionBuildsName, alpha, build, { set: { next_due_at: 0 }, when: [] }),
  );
}

describe('a build sent through an interaction function', () => {
  it('waits for its child, which the due work starts once under the id derived from the build, carrying the build', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    const child = childIdOf(build, '/request');
    await performedOnce(playbook.due, Date.now());
    await dueAgain(playbook, build);
    await performedOnce(playbook.due, Date.now());

    expect(await runOf(playbook, build)).toMatchObject({ output: { record: { waiting_for: { run: child } } } });
    expect(playbook.children()).toMatchObject([
      {
        type: 'interaction',
        name: 'send-build',
        runId: child,
        calledBy: { run_id: build, reference: '/request', run: 1 },
      },
    ]);
    expect(playbook.children()[0]?.input).toMatchObject({ build: { run_id: build, function: 'daily-visits' } });
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [{ run_id: child, function: 'send-build' }] },
    });
    expect(await standingOf(playbook)).toMatchObject({
      output: { standing: { build: { standing: 'waiting_for_trainer' } } },
    });
  });

  it('continues with the answer its child takes, and builds the version', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await performedOnce(playbook.due, Date.now());
    await uploaded(playbook, build, ['visits-mean']);
    await playbook.call(playbook.operations.answer, {
      run_id: childIdOf(build, '/request'),
      answer: { candidates: [candidateSha256('visits-mean')], recipe: 'The mean of the window' },
    });
    await performedOnce(playbook.due, Date.now());
    const answeredBeforeScoring = await readOf(playbook, readBuildBrief, build);
    await performedUntilQuiet(playbook);

    expect(answeredBeforeScoring).toMatchObject({ status: 'rejected', kind: 'build_ended' });
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: 1 } } });
  });
});

describe('a build sent through an interaction function that does not answer', () => {
  it('ends unanswered as its child expires', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook, 'PT1M');
    await performedOnce(playbook.due, Date.now());
    await performedUntilQuiet(playbook, 120_000);

    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unanswered',
          kind: 'expired',
          detail: endedUnanswered,
        },
      },
    });
  });
});

describe('a build sent through an interaction function that cannot carry it', () => {
  it('ends undelivered when its child cannot be started', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await playbook.call(playbook.operations.retire, { type: 'interaction', name: 'send-build' });
    await performedUntilQuiet(playbook);

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'undelivered' } },
    });
  });

  it('asks its child to cancel when it is cancelled itself, so the child takes no answer', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await performedOnce(playbook.due, Date.now());
    await playbook.cancelled(build);
    await performedUntilQuiet(playbook);

    expect(
      await playbook.call(playbook.operations.answer, {
        run_id: childIdOf(build, '/request'),
        answer: { candidates: [] },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'A cancel of the run was asked before it took an answer, so it takes none',
    });
  });
});

describe('a build sent through an interaction function, read and answered around its child', () => {
  it('serves its brief before its child starts, and leaves alone a run of the function that no build asked', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    const brief = await readOf(playbook, readBuildBrief, build);
    await playbook.call(playbook.operations.run, {
      type: 'interaction',
      name: 'send-build',
      input: { build: { run_id: 'asked-by-hand', function: 'daily-visits' } },
    });

    expect(brief).toMatch(/^Fit a model of the daily visits of each of 2 stores\.\n\n## Candidates\n/u);
    expect(await standingOf(playbook)).toMatchObject({ output: { standing: { build: { run_id: build } } } });
  });

  it('ends refused when its child answers a candidate that was never uploaded, as an inbox build refuses the answer', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await performedOnce(playbook.due, Date.now());
    await playbook.call(playbook.operations.answer, {
      run_id: childIdOf(build, '/request'),
      answer: { candidates: ['e'.repeat(64)] },
    });
    await performedUntilQuiet(playbook);

    expect(await workOf(playbook, build)).toMatchObject([{ type: 'dataset_assembled' }]);
    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          issues: [
            { pointer: '/answer/candidates/0', detail: 'Candidate eeeeeeeeeeee… was not uploaded to this build' },
          ],
        },
      },
    });
  });
});

describe('a build sent through an interaction function whose child is cancelled', () => {
  it('ends undelivered when its child is cancelled on its own', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await performedOnce(playbook.due, Date.now());
    await playbook.cancelled(childIdOf(build, '/request'));
    await performedUntilQuiet(playbook);

    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unanswered',
          kind: 'undelivered',
          detail:
            'The interaction function send-build that carries the build to its trainer ended without an answer: it ended rejected',
        },
      },
    });
  });
});
