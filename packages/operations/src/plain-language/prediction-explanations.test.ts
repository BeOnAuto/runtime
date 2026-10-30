import { describe, expect, it } from 'vitest';

import { explanationOf, unsuccessfulWords, rejected, type ExplainedRejection } from '../index.ts';

const ofPrediction: ReadonlyArray<readonly [ExplainedRejection, string]> = [
  [
    { reason: 'conflict', kind: 'history_too_short' },
    'the history of the series is too short for the forecaster to backtest an answer',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready' },
    'its dataset is still being built from the playbook’s history',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready', because: 'stalled' },
    'its dataset stopped at an event its fold could not take',
  ],
];

const aSentence: unknown = expect.stringMatching(/\.$/u);

describe('the explanation of a refusal of a prediction function', () => {
  it.each(ofPrediction)('explains %j and says what to do', (rejection, why) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy: aSentence });
  });

  it('says that the history is too short, and to ask again from the period named', () => {
    expect(unsuccessfulWords('predict', 'command', rejected('conflict', 'x', undefined, 'history_too_short'))).toBe(
      'Could not predict: the history of the series is too short for the forecaster to backtest an answer. Nothing was changed. Nothing needs to change: asking again from the period the details below name should work.',
    );
  });
});
