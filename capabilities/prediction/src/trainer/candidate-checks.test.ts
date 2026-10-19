import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { askedBuild, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { candidateBytes, candidateSha256, type CandidateName } from '../build-testing/due-driving.ts';
import { scriptedModels } from '../build-testing/scripted-models.ts';
import { uploadCandidate } from './candidate-upload.ts';

const endedWhileLoading: unknown = expect.stringMatching(/^The model process ended while it loaded the file: /u);

const question = { y: Float32Array.of(1), x: null, given: null, h: null, features: 0, givens: 0 };

function sent(playbook: BuildPlaybook, build: string, name: CandidateName) {
  return playbook.send(uploadCandidate(playbook.test.ports), { run_id: build }, candidateBytes(name));
}

async function waitingBuild(playbook: BuildPlaybook): Promise<string> {
  await savedFunction(playbook);
  return askedBuild(playbook);
}

describe('a candidate whose check ends without an answer', () => {
  it('is refused as one that does not load past the deadline of a check, out of memory, or when its process ends or answers badly', async () => {
    const scripted = scriptedModels();
    const hurried = buildPlaybook({
      module: scripted.module,
      deadlines: { check: 1500, run: 10_000, walk: 60_000, baselines: 30_000 },
    });
    const playbook = buildPlaybook({ module: scripted.module });
    const hurriedBuild = await waitingBuild(hurried);
    const build = await waitingBuild(playbook);

    scripted.next('sleeps');
    const late = await sent(hurried, hurriedBuild, 'visits-mean');
    scripted.next('allocates');
    const exhausted = await sent(playbook, build, 'visits-last');
    scripted.next('exits');
    const exited = await sent(playbook, build, 'visits-wide');
    scripted.next('badly');
    const badly = await sent(playbook, build, 'visits-narrow');

    expect([late, exhausted, exited, badly]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The file could not be loaded within the 30 s a check takes',
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The file needed more memory to load than a model process has',
      },
      { status: 'rejected', reason: 'invalid_input', detail: endedWhileLoading },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The model process ended while it loaded the file: The scripted model answered badly',
      },
    ]);
  });
});

describe('a candidate uploaded while every model process is taken', () => {
  it('is told every model process is busy, and nothing is recorded of it', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({
      module: scripted.module,
      processes: 2,
      deadlines: { check: 300, run: 60_000, walk: 60_000, baselines: 30_000 },
    });
    const build = await waitingBuild(playbook);
    scripted.next('sleeps');
    const { models } = playbook.test.ports;
    void Effect.runPromise(models.run({ sha256: 'held', path: '/held.onnx' }, question));
    void Effect.runPromise(models.run({ sha256: 'held', path: '/held.onnx' }, question));
    await scripted.untilSleeping(['run', 'run']);

    expect(await sent(playbook, build, 'visits-mean')).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_busy',
      detail: 'Every model process is busy; try again shortly',
    });
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual(['dataset_assembled']);
  });
  it('is told every model process is busy before its body is read while builds hold every scoring permit, so a question keeps its process', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    const { permits } = playbook.test.ports;
    const taken = [permits.take(), permits.take()];

    const refused = await sent(playbook, build, 'visits-mean');
    const written = existsSync(join(playbook.test.directory, 'models', candidateSha256('visits-mean')));
    for (const release of taken) {
      release?.();
    }

    expect(refused).toMatchObject({ status: 'rejected', reason: 'unavailable', kind: 'model_process_busy' });
    expect(written).toBe(false);
    expect(await sent(playbook, build, 'visits-mean')).toMatchObject({ status: 'succeeded' });
  });
});
