import { figure } from '../capability/figures.ts';
import type { BuildWork, BuildWorkOf, Score } from './build-facts.ts';
import type { ModelFact, ModelFactOf } from './model-facts.ts';

function shortOf(sha256: string): string {
  return `${sha256.slice(0, 12)}…`;
}

function primaryWords(scores: readonly Score[]): string {
  const figures = scores.flatMap(({ mase }) => (mase === null ? [] : [mase]));
  return figures.length === 0
    ? 'no mase'
    : `mase ${figure(Number((figures.reduce((sum, value) => sum + value, 0) / figures.length).toPrecision(4)))}`;
}

const refusedWords: Readonly<Record<BuildWorkOf<'candidate_refused'>['data']['because'], string>> = {
  failed_to_load: 'the file is not a model the runtime loads',
  wrong_signature: 'its inputs or outputs are not the signature the playbook feeds',
  too_many: 'the build already has its 8 candidates',
};

const disqualifiedWords: Readonly<Record<BuildWorkOf<'candidate_disqualified'>['data']['because'], string>> = {
  timed_out: 'it took longer than its 10 minutes',
  out_of_memory: 'it needed more memory than a model process has',
  crashed: 'its model process ended before it answered',
  not_loaded: 'its file could not be loaded',
  answered_badly: 'it answered in the wrong shape or with a number that is not finite',
  coverage_below_floor: 'its interval held fewer truths than the floor',
  not_better: 'it did not beat every baseline with the confidence asked',
};

const buildWords = {
  dataset_assembled: ({
    rows,
    series,
    first_period: first,
    last_period: last,
    holdout,
  }: BuildWorkOf<'dataset_assembled'>['data']) =>
    `The dataset was read into the build's two files: ${figure(rows)} rows of ${figure(series)} series from ${first} to ${last}, the last ${figure(holdout)} periods held back from the trainer`,
  candidate_uploaded: ({ sha256, bytes, format, runtime }: BuildWorkOf<'candidate_uploaded'>['data']) =>
    `Candidate ${shortOf(sha256)} was uploaded, ${figure(bytes)} bytes in the format ${format}, which ${runtime.name} ${runtime.version} checked`,
  candidate_refused: ({ sha256, because }: BuildWorkOf<'candidate_refused'>['data']) =>
    `Candidate ${shortOf(sha256)} was refused: ${refusedWords[because]}`,
  candidate_scored: ({ sha256, scores, coverage }: BuildWorkOf<'candidate_scored'>['data']) =>
    `Candidate ${shortOf(sha256)} was scored on the held-back periods: ${primaryWords(scores)} over its horizons, its interval holding ${coverage === null ? 'none' : figure(coverage)} of the truths`,
  candidate_disqualified: ({ sha256, because }: BuildWorkOf<'candidate_disqualified'>['data']) =>
    `Candidate ${shortOf(sha256)} was disqualified: ${disqualifiedWords[because]}`,
  baseline_scored: ({ baseline, scores, series_walked: walked }: BuildWorkOf<'baseline_scored'>['data']) =>
    `The baseline ${baseline} was walked over ${figure(walked)} series: ${primaryWords(scores)}`,
  baseline_not_walked: ({ baseline }: BuildWorkOf<'baseline_not_walked'>['data']) =>
    `The baseline ${baseline} could not be walked: no series had a season observed before an origin`,
  candidates_fitted: ({ runtime, candidates, detail }: BuildWorkOf<'candidates_fitted'>['data']) => {
    if (runtime === null) {
      return 'No model runtime this server has installed fits its own models for the function, so the build fitted no candidate';
    }
    const fitter = `The model runtime ${runtime.name} ${runtime.version}`;
    return detail === undefined
      ? `${fitter} fitted ${figure(candidates.length)} candidates from the training rows, uploaded to the build as a trainer's are`
      : `${fitter} fitted no candidate: ${detail}`;
  },
};

const activatedWords: Readonly<Record<ModelFactOf<'version_activated'>['data']['rule'], string>> = {
  automatic: 'automatically after its shadow',
  approved: 'as its approver approved',
  requested: 'at the request of a caller',
};

const refusalWords: Readonly<Record<ModelFactOf<'activation_refused'>['data']['because'], string>> = {
  approver_rejected: 'its approver rejected it',
  unanswered: 'nobody answered its approval',
  shadow_failed: 'it did not pass its shadow beside the active version',
  superseded: 'a newer version was built while it waited',
};

function verdictWords({ version, metric, challenger, active }: ModelFactOf<'shadow_passed'>['data']): string {
  return challenger === null || active === null
    ? `version ${version}, with no active version graded beside it`
    : `version ${version}, ${metric} ${figure(challenger)} against ${figure(active)} of the active version`;
}

const modelWords = {
  version_built: ({ version, file }: ModelFactOf<'version_built'>['data']) =>
    `Version ${version} of the model was built from candidate ${shortOf(file.sha256)}`,
  shadow_predicted: ({ version, of, origin, count, missing }: ModelFactOf<'shadow_predicted'>['data']) =>
    `Version ${of} predicted ${figure(count)} series from ${origin} in the shadow of version ${version}, and ${figure(missing)} whose answer was not finite or had a low above its likely value or a high below it`,
  shadow_graded: ({ of, period, graded, answered, missing }: ModelFactOf<'shadow_graded'>['data']) =>
    `The shadow predictions of version ${of} for ${period} were graded: ${figure(graded)} graded beside the other version's, of ${figure(answered)} it answered, ${figure(missing)} without an answer or a truth`,
  shadow_passed: (data: ModelFactOf<'shadow_passed'>['data']) => `The shadow passed for ${verdictWords(data)}`,
  shadow_failed: (data: ModelFactOf<'shadow_failed'>['data']) =>
    data.ungraded_closes === undefined
      ? `The shadow failed for ${verdictWords(data)}`
      : `The shadow failed for version ${data.version}: none of its ${figure(data.ungraded_closes)} closes graded a series both versions predicted`,
  version_activated: ({ version, rule }: ModelFactOf<'version_activated'>['data']) =>
    `Version ${version} of the model was activated ${activatedWords[rule]}`,
  activation_refused: ({ version, because }: ModelFactOf<'activation_refused'>['data']) =>
    `Version ${version} of the model was not activated: ${refusalWords[because]}`,
  build_asked: ({ build }: ModelFactOf<'build_asked'>['data']) => `Build ${build} of the function was asked`,
  build_ended: ({ build }: ModelFactOf<'build_ended'>['data']) => `Build ${build} of the function ended`,
};

export function buildSummaryOf(work: BuildWork): string {
  if (work.type === 'dataset_assembled') {
    return buildWords.dataset_assembled(work.data);
  }
  if (work.type === 'candidate_uploaded') {
    return buildWords.candidate_uploaded(work.data);
  }
  if (work.type === 'candidate_refused') {
    return buildWords.candidate_refused(work.data);
  }
  if (work.type === 'candidate_scored') {
    return buildWords.candidate_scored(work.data);
  }
  if (work.type === 'candidate_disqualified') {
    return buildWords.candidate_disqualified(work.data);
  }
  if (work.type === 'candidates_fitted') {
    return buildWords.candidates_fitted(work.data);
  }
  return work.type === 'baseline_scored'
    ? buildWords.baseline_scored(work.data)
    : buildWords.baseline_not_walked(work.data);
}

function shadowSummaryOf(
  fact: ModelFactOf<'shadow_predicted' | 'shadow_graded' | 'shadow_passed' | 'shadow_failed'>,
): string {
  if (fact.type === 'shadow_predicted') {
    return modelWords.shadow_predicted(fact.data);
  }
  if (fact.type === 'shadow_graded') {
    return modelWords.shadow_graded(fact.data);
  }
  return fact.type === 'shadow_passed' ? modelWords.shadow_passed(fact.data) : modelWords.shadow_failed(fact.data);
}

export function modelSummaryOf(fact: ModelFact): string {
  if (fact.type === 'version_built') {
    return modelWords.version_built(fact.data);
  }
  if (fact.type === 'version_activated') {
    return modelWords.version_activated(fact.data);
  }
  if (fact.type === 'build_asked' || fact.type === 'build_ended') {
    return fact.type === 'build_asked' ? modelWords.build_asked(fact.data) : modelWords.build_ended(fact.data);
  }
  return fact.type === 'activation_refused' ? modelWords.activation_refused(fact.data) : shadowSummaryOf(fact);
}
