import { describe, expect, it } from 'vitest';

import { explanationOf, unsuccessfulWords, rejected, type ExplainedRejection } from '../index.ts';

const ofPrediction: ReadonlyArray<readonly [ExplainedRejection, string]> = [
  [
    { reason: 'conflict', kind: 'no_active_version' },
    'the function has no active version, and no model runtime of this server answers a function with none',
  ],
  [
    { reason: 'conflict', kind: 'data_changed' },
    'the data part of the function changed since its active version was built, so that model no longer fits its rows',
  ],
  [{ reason: 'conflict', kind: 'build_in_flight' }, 'a build of the function is already in flight'],
  [{ reason: 'conflict', kind: 'dataset_too_large' }, 'its dataset holds more rows or series than a build takes'],
  [
    { reason: 'conflict', kind: 'baseline_perfect' },
    'a baseline its candidates must beat already predicts every period held back as well as a score can, so no candidate can beat it',
  ],
  [
    { reason: 'conflict', kind: 'unscorable' },
    'no series of its dataset moved during the periods a build trains on, so no candidate could be judged against its baselines',
  ],
  [{ reason: 'conflict', kind: 'not_a_build' }, 'the run named is not a build of a prediction function'],
  [
    { reason: 'conflict', kind: 'build_ended' },
    'the build has ended or has taken its answer, so it takes nothing more from its trainer',
  ],
  [
    { reason: 'conflict', kind: 'no_trainer' },
    'the build asks no trainer, since its function names none, so the playbook fits its candidates itself',
  ],
  [{ reason: 'conflict', kind: 'already_active' }, 'that version is already the active one'],
  [
    { reason: 'conflict', kind: 'feature_unlicensed' },
    'the license of this runtime does not include the feature the model runtime of its format needs',
  ],
  [{ reason: 'unavailable', kind: 'builds_full' }, 'this server is scoring as many builds as it may at once'],
  [
    { reason: 'unavailable', kind: 'builds_full', because: 'builds_of_the_day' },
    'the function has had its builds of the day',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready' },
    'its dataset is still being built from the playbook’s history',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready', because: 'stalled' },
    'its dataset stopped at an event its fold could not take',
  ],
  [{ reason: 'unavailable', kind: 'model_process_busy' }, 'every model process of this server is busy'],
  [
    { reason: 'unavailable', kind: 'model_process_failed' },
    'the process that runs the model ended, or answered something other than finite numbers, before it answered',
  ],
  [
    { reason: 'unavailable', kind: 'model_process_failed', because: 'not_finite' },
    'the model answered something other than finite numbers in the shape its signature gives',
  ],
  [
    { reason: 'unavailable', kind: 'model_process_failed', because: 'not_in_order' },
    'the model answered a low above its likely value or a high below it',
  ],
  [
    { reason: 'unavailable', kind: 'model_process_failed', because: 'baseline_check' },
    'the process that checks the build’s baselines ended before it answered',
  ],
  [
    { reason: 'unavailable', kind: 'model_process_failed', because: 'no_model_runtime' },
    'no model runtime this server has installed executes the model it needs, or fits its own for a function that names no trainer',
  ],
];

const aSentence: unknown = expect.stringMatching(/\.$/u);

describe('the explanation of a refusal of a prediction function', () => {
  it.each(ofPrediction)('explains %j and says what to do', (rejection, why) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy: aSentence });
  });

  it('says how to ask for a build when no version is active, and that nothing was changed', () => {
    expect(unsuccessfulWords('predict', 'command', rejected('conflict', 'x', undefined, 'no_active_version'))).toBe(
      'Could not predict: the function has no active version, and no model runtime of this server answers a function with none. Nothing was changed. It answers once a build has given it an active version: ask for one with the input { build: {} }.',
    );
  });

  it('says that the license lacks the feature a question’s model needs, and who can add it', () => {
    expect(unsuccessfulWords('predict', 'command', rejected('conflict', 'x', undefined, 'feature_unlicensed'))).toBe(
      'Could not predict: the license of this runtime does not include the feature the model runtime of its format needs. Nothing was changed. Trying again will not help until the account holder or an organization admin adds the feature to the license at the page the details name.',
    );
  });

  it('says that the process that checks a build’s baselines ended, and to ask for the build again', () => {
    expect(
      unsuccessfulWords('build', 'command', {
        ...rejected('unavailable', 'x', undefined, 'model_process_failed'),
        because: 'baseline_check',
      }),
    ).toBe(
      'Could not build: the process that checks the build’s baselines ended before it answered. Nothing was changed. Nothing needs to change: asking for the build again starts a new process to check them.',
    );
  });
});
