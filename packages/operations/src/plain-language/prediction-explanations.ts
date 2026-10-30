import type { ConflictKind } from '../outcome/conflict.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type PredictionKind = Extract<ConflictKind, 'history_too_short'> | Extract<UnavailableKind, 'dataset_not_ready'>;

export const predictionExplanations: Readonly<Record<PredictionKind, Explanation>> = {
  history_too_short: {
    why: 'the history of the series is too short for the forecaster to backtest an answer',
    remedy: 'Nothing needs to change: asking again from the period the details below name should work.',
  },
  dataset_not_ready: {
    why: 'its dataset is still being built from the playbook’s history',
    remedy: 'Nothing needs to change: trying again once get_definition shows the dataset live should work.',
  },
};
