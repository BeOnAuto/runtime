import { Clock, Effect } from 'effect';

import { timeoutFor } from '../capability/definition-request.ts';
import { LanguageModel } from '../model/language-model.ts';
import type { ModelRequest } from '../model/model-request.ts';
import {
  answeredFinding,
  failedFinding,
  unclassifiedFinding,
  type CaseFinding,
  type CheckOutcome,
} from './case-findings.ts';
import { checkCases, cityPopulation, type CaseKind, type CheckCase } from './check-cases.ts';
import { toolsCaseFinding } from './tools-case.ts';

export interface CaseReport extends CaseFinding {
  readonly case: string;
  readonly kind: CaseKind;
  readonly duration_ms: number;
}

export interface ModelReport {
  readonly model: string;
  readonly outcome: CheckOutcome;
  readonly cases: readonly CaseReport[];
}

export interface AnswerCheckReport {
  readonly checked_at: string;
  readonly models: readonly ModelReport[];
}

type Generate = LanguageModel['Service']['generate'];

const instructions = 'Answer the request in full, from the facts it gives and from what the tools it names answer.';

const answerTokens = 4096;

const modelsAtOnce = 4;

const fromTheWorst: readonly CheckOutcome[] = [
  'unreachable',
  'schema_refused',
  'invalid',
  'unavailable',
  'passed_after_repair',
  'passed',
];

function requestFor(model: string, { kind, prompt, output }: CheckCase): ModelRequest {
  return {
    model,
    instructions,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    output,
    settings: { max_output_tokens: answerTokens },
    timeout_ms: timeoutFor(answerTokens),
    ...(kind === 'tools' ? { tools: [cityPopulation] } : {}),
  };
}

function findingOf(generate: Generate, request: ModelRequest, { kind }: CheckCase): Effect.Effect<CaseFinding> {
  const found =
    kind === 'tools'
      ? toolsCaseFinding(generate, request)
      : Effect.match(generate(request), { onFailure: failedFinding, onSuccess: answeredFinding });
  return Effect.catchDefect(found, (defect) => Effect.succeed(unclassifiedFinding(defect)));
}

const caseReportOf = Effect.fnUntraced(function* (generate: Generate, model: string, checked: CheckCase) {
  const began = yield* Clock.currentTimeMillis;
  const finding = yield* findingOf(generate, requestFor(model, checked), checked);
  const ended = yield* Clock.currentTimeMillis;
  const report: CaseReport = { case: checked.name, kind: checked.kind, ...finding, duration_ms: ended - began };
  return report;
});

function verdictOf(cases: readonly CaseReport[]): CheckOutcome {
  return cases
    .filter(({ kind }) => kind !== 'canary')
    .reduce<CheckOutcome>(
      (worst, { outcome }) => (fromTheWorst.indexOf(outcome) < fromTheWorst.indexOf(worst) ? outcome : worst),
      'passed',
    );
}

const modelReportOf = Effect.fnUntraced(function* (generate: Generate, model: string) {
  const cases = yield* Effect.forEach(checkCases, (checked) => caseReportOf(generate, model, checked));
  const report: ModelReport = { model, outcome: verdictOf(cases), cases };
  return report;
});

export const answerCheck = Effect.fnUntraced(function* (models: readonly string[]) {
  const { generate } = yield* LanguageModel;
  const checkedAt = yield* Clock.currentTimeMillis;
  const checked = yield* Effect.forEach(models, (model) => modelReportOf(generate, model), {
    concurrency: modelsAtOnce,
  });
  const report: AnswerCheckReport = { checked_at: new Date(checkedAt).toISOString(), models: checked };
  return report;
});
