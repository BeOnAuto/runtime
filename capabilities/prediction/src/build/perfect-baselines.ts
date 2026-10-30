import { Conflict, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import { rowsFileOf } from '../scoring/scoring-inputs.ts';

function perfectAs(baseline: string, metric: string): Conflict {
  return new Conflict({
    detail: `The baseline ${baseline} already scores 0 on ${metric} at every period held back where ${metric} scores it, the best a score can be, so no candidate can beat it; ask for a build once the series moves`,
    kind: 'baseline_perfect',
  });
}

function unscorableAs(metric: string): Conflict {
  return new Conflict({
    detail: `No series moved during the periods a build trains on, so ${metric}, which scales each error by that movement, scores no period held back and no candidate could be judged against the baselines; ask for a build once a series moves, or judge candidates by winkler or quantile`,
    kind: 'unscorable',
  });
}

interface BaselinesFound {
  readonly perfect: string | null;
  readonly unscorable: boolean;
}

function refusalOf({ perfect, unscorable }: BaselinesFound, metric: string): Conflict | undefined {
  if (perfect !== null) {
    return perfectAs(perfect, metric);
  }
  return unscorable ? unscorableAs(metric) : undefined;
}

const busy = new Unavailable({
  detail:
    'Every model process a build may hold stayed busy checking or scoring while the build waited for one; ask for the build again shortly',
  kind: 'model_process_busy',
});

const ended = new Unavailable({
  detail: 'The model process that checks the baselines ended before it answered; ask for the build again',
  kind: 'model_process_failed',
  because: 'baseline_check',
});

export function candidatesJudgeable(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  { predicts, evaluation }: PredictionFunctionDefinitionDocument,
  assembled: Assembled,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const path = yield* rowsFileOf(ports, playbook, assembled.scoring_sha256);
    const outcome = yield* ports.models.baselines(
      { sha256: assembled.scoring_sha256, path },
      {
        period: predicts.period,
        horizons: predicts.horizons,
        accumulates: predicts.accumulates ?? null,
        season: predicts.season ?? null,
        window: assembled.window,
        holdout: assembled.holdout,
        firstPeriod: assembled.first_period,
        baselines: evaluation.baselines,
        metric: evaluation.metric,
      },
    );
    if (outcome.ended === 'busy') {
      return yield* Effect.fail(busy);
    }
    if (outcome.ended !== 'answered') {
      return yield* Effect.fail(ended);
    }
    const refusal = refusalOf(outcome.answer, evaluation.metric);
    return refusal === undefined ? undefined : yield* Effect.fail(refusal);
  });
}
