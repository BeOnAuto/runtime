import type { ConflictKind } from '../outcome/conflict.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type PredictionKind =
  | Extract<
      ConflictKind,
      | 'no_active_version'
      | 'data_changed'
      | 'build_in_flight'
      | 'dataset_too_large'
      | 'baseline_perfect'
      | 'unscorable'
      | 'not_a_build'
      | 'build_ended'
      | 'no_trainer'
      | 'already_active'
    >
  | Extract<UnavailableKind, 'builds_full' | 'dataset_not_ready' | 'model_process_busy' | 'model_process_failed'>;

export const predictionExplanations: Readonly<Record<PredictionKind, Explanation>> = {
  no_active_version: {
    why: 'the function has no active version, and no model runtime of this server answers a function with none',
    remedy: 'It answers once a build has given it an active version: ask for one with the input { build: {} }.',
  },
  data_changed: {
    why: 'the data part of the function changed since its active version was built, so that model no longer fits its rows',
    remedy: 'It answers again once a build over the data part as it now stands has given it an active version.',
  },
  build_in_flight: {
    why: 'a build of the function is already in flight',
    remedy: 'It can be asked again once that build has ended, or after cancelling it; get_definition shows it.',
  },
  dataset_too_large: {
    why: 'its dataset holds more rows or series than a build takes',
    remedy:
      'This can be put right on your side: a narrower window or fewer series make it fit; the details below give the figures.',
  },
  baseline_perfect: {
    why: 'a baseline its candidates must beat already predicts every period held back as well as a score can, so no candidate can beat it',
    remedy:
      'Nothing on your side changes that: a build can be asked for again once the series has moved in the periods it holds back.',
  },
  unscorable: {
    why: 'no series of its dataset moved during the periods a build trains on, so no candidate could be judged against its baselines',
    remedy:
      'This can be put right on your side: the metric winkler or quantile judges a candidate without that movement; otherwise a build can be asked for again once a series has moved in the periods it trains on.',
  },
  not_a_build: {
    why: 'the run named is not a build of a prediction function',
    remedy: 'Name the run of a build, as the request of that build shows.',
  },
  build_ended: {
    why: 'the build has ended or has taken its answer, so it takes nothing more from its trainer',
    remedy: 'A new build can be asked for with the input { build: {} }.',
  },
  no_trainer: {
    why: 'the build asks no trainer, since its function names none, so the playbook fits its candidates itself',
    remedy: 'Nothing waits for a trainer: get_run shows the build as it scores the candidates it fitted.',
  },
  already_active: {
    why: 'that version is already the active one',
    remedy: 'Nothing needs to change; get_definition shows the active version.',
  },
  builds_full: {
    why: 'this server is scoring as many builds as it may at once',
    remedy: 'Nothing needs to change: trying again once one of them has scored should work.',
  },
  dataset_not_ready: {
    why: 'its dataset is still being built from the playbook’s history',
    remedy: 'Nothing needs to change: trying again once get_definition shows the dataset live should work.',
  },
  model_process_busy: {
    why: 'every model process of this server is busy',
    remedy: 'Nothing needs to change: trying again shortly should work.',
  },
  model_process_failed: {
    why: 'the process that runs the model ended, or answered something other than finite numbers, before it answered',
    remedy: 'Trying again starts a new process; if it keeps happening, a new build gives the function another model.',
  },
};
