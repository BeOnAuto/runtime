import { Effect } from 'effect';

import { recordedWork, settledBuild, type Performing } from '../build-work/build-performing.ts';
import type { Baseline } from '../document/prediction-document.ts';
import type { BuildWorkOf } from '../facts/build-facts.ts';
import { executed, modelsOf } from '../models/model-commands.ts';
import { versionOfBuild } from '../models/model-state.ts';
import { baselineWalk } from './baselines.ts';
import { primaryOf } from './metrics.ts';
import { scoringOf, type ScoredBuild } from './scoring-inputs.ts';
import { versionCardOf, type TrainerAnswer } from './version-card.ts';

type CandidateScored = BuildWorkOf<'candidate_scored'>['data'];

interface Figured {
  readonly each: CandidateScored;
  readonly figure: number;
}

function baselineRecorded(performing: Performing, { document, assembled }: ScoredBuild, baseline: Baseline) {
  return Effect.gen(function* () {
    const { scoring } = yield* scoringOf(performing.ports, performing.build, document, assembled);
    const { scored } = baselineWalk(scoring, baseline);
    return yield* recordedWork(
      performing,
      scored.seriesWalked === 0
        ? { type: 'baseline_not_walked', data: { baseline, because: 'too_short' } }
        : {
            type: 'baseline_scored',
            data: { baseline, scores: scored.scores, coverage: scored.coverage, series_walked: scored.seriesWalked },
          },
    );
  });
}

function winnerOf(
  performing: Performing,
  { document }: ScoredBuild,
  candidates: readonly string[],
): CandidateScored | undefined {
  const { metric } = document.evaluation;
  const scored = candidates.flatMap((sha256) => {
    const decided = performing.build.decided.get(sha256);
    return decided?.type === 'candidate_scored' ? [decided.data] : [];
  });
  const figured = scored.map((each): Figured => ({
    each,
    figure: primaryOf(each.scores, metric) ?? Number.POSITIVE_INFINITY,
  }));
  return figured.reduce<Figured | null>(
    (best, next) => (best === null || next.figure < best.figure ? next : best),
    null,
  )?.each;
}

function verdictOf(performing: Performing, sha256: string, winner: string | undefined): string {
  const decided = performing.build.decided.get(sha256);
  if (sha256 === winner) {
    return 'won';
  }
  return decided?.type === 'candidate_disqualified' ? decided.data.because : 'scored';
}

export function endingStep(performing: Performing, scored: ScoredBuild, answer: TrainerAnswer): Effect.Effect<void> {
  const { ports, build } = performing;
  const missing = scored.document.evaluation.baselines.find((baseline) => !build.baselines.has(baseline));
  if (missing !== undefined) {
    return baselineRecorded(performing, scored, missing);
  }
  const winner = winnerOf(performing, scored, answer.candidates);
  return Effect.gen(function* () {
    const built = versionOfBuild(yield* modelsOf(performing), build.address.id);
    if (winner !== undefined && built === undefined) {
      const card = yield* versionCardOf(ports.ledger.content, { build, document: scored.document, answer, winner });
      return yield* executed(performing, (asked) => ({
        ...asked,
        type: 'build',
        definitionVersion: build.run.run.definition_version,
        card,
      }));
    }
    return yield* settledBuild(performing, {
      status: 'succeeded',
      output: {
        version: built?.version ?? null,
        winner: winner?.sha256 ?? null,
        candidates: answer.candidates.map((sha256) => ({
          sha256,
          verdict: verdictOf(performing, sha256, winner?.sha256),
        })),
      },
      record: {},
    });
  });
}
