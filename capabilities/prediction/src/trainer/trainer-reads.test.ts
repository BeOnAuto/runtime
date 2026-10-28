import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { answered, askedBuild, asked, readOf, savedFunction } from '../build-testing/built-versions.ts';
import { readBuildBrief, readBuildRows } from './build-reads.ts';
import { uploadCandidate } from './candidate-upload.ts';

const otherRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

const questionRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70';

describe('the reads of a build that waits for its trainer', () => {
  it('answer its brief as Markdown, closed by the formats its candidates take, and its training rows as CSV, the held-back periods left out', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const rows = String(await readOf(playbook, readBuildRows, build)).split('\r\n');

    expect(await readOf(playbook, readBuildBrief, build)).toBe(
      [
        'Fit a model of the daily visits of each of 2 stores.',
        '',
        '## Candidates',
        '',
        'Each upload of a candidate takes a file in the format scripted.',
        '',
      ].join('\n'),
    );
    expect([rows[0], rows[1], rows.length]).toEqual(['series,period,visits', 'north,2026-09-16,11', 2 * 16 + 2]);
  });
});

describe('the routes of a trainer on a run that is no build waiting for its answer', () => {
  it('answer a run there is not as not found, and refuse a question as no build', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await asked(playbook, { series: 'north', horizon: 1 }, { runId: questionRun });

    expect([
      await readOf(playbook, readBuildBrief, otherRun),
      await readOf(playbook, readBuildRows, questionRun),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found', detail: 'There is no such run in this playbook' },
      { status: 'rejected', reason: 'conflict', kind: 'not_a_build', detail: `Run ${questionRun} is not a build` },
    ]);
  });

  it('refuse a build that was refused as it started', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await askedBuild(playbook);
    await playbook.call(playbook.operations.run, {
      type: 'prediction',
      name: 'daily-visits',
      input: { build: {} },
      run_id: questionRun,
    });

    expect(await readOf(playbook, readBuildBrief, questionRun)).toMatchObject({
      status: 'rejected',
      kind: 'build_ended',
    });
  });

  it('refuse a build that took its answer or ended', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await answered(playbook, build, { candidates: [] });
    const taken = await readOf(playbook, readBuildBrief, build);
    await playbook.cancelled(build);

    expect([taken, await readOf(playbook, readBuildRows, build)]).toEqual([
      { status: 'rejected', reason: 'conflict', kind: 'build_ended', detail: 'The build has ended' },
      { status: 'rejected', reason: 'conflict', kind: 'build_ended', detail: 'The build has ended' },
    ]);
    expect(
      await playbook.send(uploadCandidate(playbook.test.ports), { run_id: build }, new Uint8Array([1])),
    ).toMatchObject({ status: 'rejected', kind: 'build_ended' });
  });
});
