import { Option } from 'effect';

import { restingUntil, type Performing, type PerformedStep } from '../build-work/build-performing.ts';
import { isProjected, type PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { decided } from '../models/model-commands.ts';
import {
  builtVersionOf,
  licensedPredictionsOf,
  unlicensedClosesOf,
  wasGraded,
  wasPredicted,
  type BuiltVersion,
  type ModelsState,
} from '../models/model-state.ts';
import { periodOfForm } from '../periods/grains.ts';
import { shadowVerdictOf } from './shadow-grades.ts';
import { graded, type Shadowing } from './shadow-grading.ts';
import { predicted } from './shadow-predictions.ts';
import { mostShadowCloses, shadowOrigins, targetsOf, type ShadowOrigin, type ShadowTarget } from './shadow-schedule.ts';

function unpredictedOf(
  { models, challenger, active }: Shadowing,
  origins: readonly ShadowOrigin[],
  now: number,
): { readonly origin: ShadowOrigin; readonly of: BuiltVersion } | undefined {
  return origins
    .filter(({ closesAt }) => closesAt <= now)
    .flatMap((origin) =>
      [challenger, active]
        .filter((of) => !wasPredicted(models, { version: challenger.version, of: of.version, origin: origin.form }))
        .map((of) => ({ origin, of })),
    )
    .at(0);
}

interface AimedTarget {
  readonly of: number;
  readonly target: ShadowTarget;
}

function targetsAimed({ document, models, challenger }: Shadowing): readonly AimedTarget[] {
  return licensedPredictionsOf(models, challenger.version).flatMap((each) =>
    targetsOf(document.predicts, Number(periodOfForm(document.predicts.period, each.origin))).map(
      (target): AimedTarget => ({ of: each.of, target }),
    ),
  );
}

function stepOver(performing: Performing, shadowing: Shadowing, closes: number): PerformedStep | undefined {
  const { document, models, challenger } = shadowing;
  const { now } = performing;
  const origins = shadowOrigins(document.predicts, challenger.builtAt, closes);
  const unpredicted = unpredictedOf(shadowing, origins, now);
  if (unpredicted !== undefined) {
    return predicted(performing, { document, challenger, ...unpredicted });
  }
  const targets = targetsAimed(shadowing);
  const due = targets.find(
    ({ of, target }) =>
      target.closesAt <= now && !wasGraded(models, { version: challenger.version, of, period: target.form }),
  );
  if (due !== undefined) {
    return graded(performing, shadowing, due.of, due.target);
  }
  const pending = [...origins.map(({ closesAt }) => closesAt), ...targets.map(({ target }) => target.closesAt)].filter(
    (at) => at > now,
  );
  return pending.length > 0 ? restingUntil(performing, Math.min(...pending)) : undefined;
}

function closesPredicted({ models, challenger }: Shadowing): number {
  return new Set(models.predicted.filter(({ version }) => version === challenger.version).map(({ origin }) => origin))
    .size;
}

function closesOf(shadowing: Shadowing): number {
  const { document, models, challenger } = shadowing;
  const asked = document.evaluation.shadowPeriods + unlicensedClosesOf(models, challenger.version);
  return Math.min(mostShadowCloses, Math.max(asked, closesPredicted(shadowing)));
}

function nextStep(performing: Performing, shadowing: Shadowing): PerformedStep {
  const { document, models, challenger } = shadowing;
  const closes = closesOf(shadowing);
  const step = stepOver(performing, shadowing, closes);
  if (step !== undefined) {
    return step;
  }
  const { metric } = document.evaluation;
  const verdict = shadowVerdictOf(models.graded, challenger.version, metric);
  if (verdict !== undefined) {
    return decided(performing, challenger, verdict, metric);
  }
  return closes < mostShadowCloses
    ? Option.getOrThrow(Option.fromNullishOr(stepOver(performing, shadowing, closes + 1)))
    : decided(
        performing,
        challenger,
        { passed: false, challenger: null, active: null, ungradedCloses: closes },
        metric,
      );
}

export function shadowStep(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  models: ModelsState,
  challenger: BuiltVersion,
): PerformedStep {
  const active = models.active === null ? undefined : builtVersionOf(models, models.active);
  const metric = document.evaluation.metric;
  if (
    active === undefined ||
    active.version === challenger.version ||
    document.evaluation.shadowPeriods === 0 ||
    !isProjected(document.data)
  ) {
    return decided(performing, challenger, { passed: true, challenger: null, active: null }, metric);
  }
  return nextStep(performing, { document, models, challenger, active });
}
