import { advancedColumnsLeftBy, messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { performedOnce } from '../build-testing/due-driving.ts';
import { sentThrough } from '../build-testing/sent-builds.ts';
import { childIdOf } from '../build-work/child-runs.ts';
import { predictionBuildsName } from './build-rows.ts';
import { predictionBuilds } from './builds-projection.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

describe('the columns of the row of a build that its due work advances', () => {
  it('are each written by the folds that mean to set it: next_due_at by all but an upload, staged by an upload alone', () => {
    const folded = predictionBuilds.types.filter((type) => type !== 'run_deferred');

    expect(Object.fromEntries(folded.map((type) => [type, advancedColumnsLeftBy(predictionBuilds, type)]))).toEqual({
      run_started: ['staged'],
      request_answered: ['staged'],
      run_succeeded: ['staged'],
      run_rejected: ['staged'],
      run_failed: ['staged'],
      candidate_uploaded: ['next_due_at'],
      candidates_fitted: ['staged'],
      candidate_scored: ['staged'],
      candidate_disqualified: ['staged'],
      baseline_scored: ['staged'],
      baseline_not_walked: ['staged'],
      version_built: ['staged'],
      shadow_predicted: ['staged'],
      shadow_graded: ['staged'],
      shadow_passed: ['staged'],
      shadow_failed: ['staged'],
      version_activated: ['staged'],
      activation_refused: ['staged'],
    });
  });
});

describe('the cause of the row of a build', () => {
  it('is the message whose fold last changed the row, as the start of the child that carries the build to its trainer', async () => {
    const playbook = buildPlaybook();
    const build = await sentThrough(playbook);
    await performedOnce(playbook.due, playbook.now());
    const [kept] = await Effect.runPromise(
      playbook.test.ports.ledger.readProjectedRows(predictionBuildsName, alpha, {
        where: [{ column: 'row_key', equals: build }],
        orderBy: [],
        order: 'asc',
        limit: 1,
      }),
    );

    expect(kept?.row).toMatchObject({
      standing: 'waiting_for_trainer',
      next_due_at: null,
      cause: messageIdOf(`playbook/acme/alpha/runs/${childIdOf(build, '/request')}`, 1),
    });
  });
});
