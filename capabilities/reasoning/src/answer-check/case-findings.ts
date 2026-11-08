import type { FailureIssue } from '../failure/failure-issue.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelResult, OutputMode, SchemaRefusal } from '../model/model-result.ts';

export type CheckOutcome =
  | 'passed'
  | 'passed_after_repair'
  | 'invalid'
  | 'schema_refused'
  | 'unavailable'
  | 'unreachable';

export interface CaseFinding {
  readonly outcome: CheckOutcome;
  readonly output_mode?: OutputMode;
  readonly detail?: string;
  readonly status?: number;
  readonly provider_message?: string;
  readonly issues?: readonly FailureIssue[];
  readonly schema_refusal?: SchemaRefusal;
  readonly cost_usd?: number;
}

const mostIssuesShown = 5;

const outcomeOfFailure: Readonly<Record<ModelFailure['_tag'], CheckOutcome>> = {
  output_invalid: 'invalid',
  content_refused: 'invalid',
  rate_limited: 'unavailable',
  provider_unavailable: 'unavailable',
  timed_out: 'unavailable',
  credentials_rejected: 'unreachable',
  definition_invalid: 'unreachable',
  model_not_allowed: 'unreachable',
  provider_not_configured: 'unreachable',
  request_too_long: 'unreachable',
};

export function refusedForTheSchema(refusal: SchemaRefusal | undefined): refusal is SchemaRefusal {
  return refusal !== undefined && refusal.outcome !== 'refused_again';
}

function shown(issues: readonly FailureIssue[] | undefined): Pick<CaseFinding, 'issues'> {
  return issues === undefined || issues.length === 0 ? {} : { issues: issues.slice(0, mostIssuesShown) };
}

function recordedOf(
  mode: OutputMode | undefined,
  cost: number | undefined,
): Pick<CaseFinding, 'output_mode' | 'cost_usd'> {
  return { ...(mode === undefined ? {} : { output_mode: mode }), ...(cost === undefined ? {} : { cost_usd: cost }) };
}

export function answeredFinding({
  repair,
  output_mode: mode,
  schema_refusal: refusal,
  cost_usd: cost,
}: ModelResult): CaseFinding {
  const recorded = recordedOf(mode, cost);
  if (refusedForTheSchema(refusal)) {
    return { outcome: 'schema_refused', ...recorded, schema_refusal: refusal };
  }
  return repair === undefined || !('issues' in repair)
    ? { outcome: 'passed', ...recorded }
    : { outcome: 'passed_after_repair', ...recorded, ...shown(repair.issues) };
}

export interface FailedCall {
  readonly _tag: ModelFailure['_tag'];
  readonly detail: string;
  readonly status?: number | null;
  readonly provider_message?: string | null;
  readonly issues?: readonly FailureIssue[];
  readonly output_mode?: OutputMode;
  readonly schema_refusal?: SchemaRefusal;
  readonly cost_usd?: number;
}

export function failedFinding(failure: FailedCall): CaseFinding {
  const { _tag: kind, detail, status, provider_message: said, schema_refusal: refusal } = failure;
  return {
    outcome: refusedForTheSchema(refusal) ? 'schema_refused' : outcomeOfFailure[kind],
    ...recordedOf(failure.output_mode, failure.cost_usd),
    detail,
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof said === 'string' ? { provider_message: said } : {}),
    ...shown(failure.issues),
    ...(refusal === undefined ? {} : { schema_refusal: refusal }),
  };
}

export function unclassifiedFinding(defect: unknown): CaseFinding {
  return { outcome: 'unavailable', detail: String(defect) };
}

export function checkFinding(outcome: CheckOutcome, detail: string, result: ModelResult): CaseFinding {
  return { outcome, ...recordedOf(result.output_mode, result.cost_usd), detail };
}
