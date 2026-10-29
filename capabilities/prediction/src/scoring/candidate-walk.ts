import { Effect } from 'effect';

import {
  aMinute,
  recordedWork,
  restingUntil,
  type Performing,
  type PerformedStep,
} from '../build-work/build-performing.ts';
import { untilTheRunEnds } from '../build-work/run-watch.ts';
import type { BuildWorkOf } from '../facts/build-facts.ts';
import type { ModelFile, ModelOutcome, WalkAnswer } from '../model-processes/model-processes.ts';
import {
  readsTheCalendar,
  type ExecutingRuntime,
  type RuntimeNamed,
  executesFormat,
} from '../runtimes/model-runtimes.ts';
import { baselineWalks } from './baselines.ts';
import { verdictOf, type Scoring } from './candidate-scoring.ts';
import { remainingOfTheOrigins } from './scoring-grid.ts';
import { featureNamesOf, givenIndexesOf, scoringOf, type ScoredBuild } from './scoring-inputs.ts';

type Disqualified = BuildWorkOf<'candidate_disqualified'>['data'];

type Interrupted = Exclude<ModelOutcome<WalkAnswer>, { readonly ended: 'answered' }>;

const cancelled: ModelOutcome<WalkAnswer> = { ended: 'cancelled', milliseconds: 0 };

function disqualifiedOf(sha256: string, outcome: Interrupted): Disqualified | undefined {
  if (outcome.ended === 'timed_out' || outcome.ended === 'out_of_memory') {
    return { sha256, because: outcome.ended };
  }
  if (outcome.ended === 'crashed') {
    return { sha256, because: 'crashed', detail: outcome.detail };
  }
  return outcome.ended === 'badly' ? { sha256, because: 'answered_badly', detail: outcome.detail } : undefined;
}

interface Walked {
  readonly runtime: RuntimeNamed;
  readonly sha256: string;
}

function answeredFact(scoring: Scoring, walked: Walked, answer: WalkAnswer, milliseconds: number) {
  const { runtime, sha256 } = walked;
  const verdict = verdictOf(scoring, baselineWalks(scoring), answer);
  return verdict.verdict === 'scored'
    ? {
        type: 'candidate_scored',
        data: {
          sha256,
          runtime: { ...runtime },
          scores: verdict.scores,
          coverage: verdict.coverage,
          against: verdict.against,
          duration_ms: Math.round(milliseconds),
        },
      }
    : { type: 'candidate_disqualified', data: { sha256, because: verdict.because, detail: verdict.detail } };
}

interface Walking<Placing> {
  readonly executing: ExecutingRuntime;
  readonly sha256: string;
  readonly placed: Effect.Effect<ModelFile, Placing>;
  readonly format: string;
}

export function walkedCandidate<Placing>(
  performing: Performing,
  { document, assembled }: ScoredBuild,
  { executing, sha256, placed, format }: Walking<Placing>,
): Effect.Effect<void, Effect.Error<PerformedStep> | Placing> {
  const { ports, build, now } = performing;
  const { org } = build.address;
  return Effect.gen(function* () {
    const { path: rows, scoring } = yield* scoringOf(ports, build, document, assembled);
    const walk = ports.models.walk(org, executing.runtime, placed, {
      rows,
      window: assembled.window,
      holdout: assembled.holdout,
      steps: scoring.grid.steps,
      features: featureNamesOf(document).length,
      given: givenIndexesOf(document),
      remaining: remainingOfTheOrigins(scoring.grid),
      first: readsTheCalendar(executing.runtime) ? scoring.grid.first : null,
    });
    const outcome = yield* Effect.raceFirst(walk, Effect.as(untilTheRunEnds(ports, build.address), cancelled));
    if (outcome.ended === 'answered') {
      const walked = { runtime: executing.named, sha256 };
      return yield* recordedWork(performing, answeredFact(scoring, walked, outcome.answer, outcome.milliseconds));
    }
    if (outcome.ended === 'unlicensed') {
      const { feature } = outcome;
      const which = executesFormat(format);
      const { detail } = yield* ports.features.refusal({ org, feature, which });
      const data = { sha256, because: 'feature_unlicensed', detail, feature };
      return yield* recordedWork(performing, { type: 'candidate_disqualified', data });
    }
    const disqualified = disqualifiedOf(sha256, outcome);
    return disqualified === undefined
      ? yield* restingUntil(performing, now + aMinute)
      : yield* recordedWork(performing, { type: 'candidate_disqualified', data: disqualified });
  });
}
