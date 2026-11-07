import { Array as Arr, Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import { UnclassifiedModelError } from '../failure/unclassified-model-error.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { failedRepairOf, RepairFailed, type Answered, type CallMode } from './answer-settling.ts';
import { scrubberFor, type CallPolicy } from './call-policy.ts';
import { classified, operatorHintOf, providerTextOf, type ProviderText } from './failure-classification.ts';
import { modelAnswer } from './model-call.ts';

export interface CallReports {
  readonly providerTexts: readonly ProviderText[];
  readonly operatorHint: string | null;
}

export interface SettledCall extends CallReports {
  readonly settled: Result.Result<Answered, ModelFailure | UnclassifiedModelError>;
}

export interface Attempting {
  readonly request: ModelRequest;
  readonly signal: Readonly<AbortSignal>;
  readonly calledAt: number;
  readonly policy: CallPolicy;
  readonly stopped: () => ModelFailure | undefined;
  readonly refusal?: CallMode['schema_refusal'];
}

function failedAttempt(target: ModelTarget, attempting: Attempting, error: unknown): SettledCall {
  const { provider } = target;
  const { request, policy, refusal } = attempting;
  const scrub = scrubberFor(policy, request);
  const now = Date.now();
  const showsProviderMessages = policy.showsProviderMessages(provider);
  const context = { provider, configured: policy.configured, now, showsProviderMessages, scrub, lastInputTokens: null };
  const reason = error instanceof RepairFailed ? error.cause : error;
  const failure = attempting.stopped() ?? classified(reason, context);
  const reports = {
    providerTexts: Arr.fromNullishOr(providerTextOf(reason, scrub)),
    operatorHint: operatorHintOf(reason, provider, scrub),
  };
  if (failure instanceof UnclassifiedModelError) {
    return { settled: Result.fail(failure), ...reports };
  }
  if (error instanceof RepairFailed) {
    const { _tag: because } = failure;
    return { settled: failedRepairOf(target, error.unrepaired, because, now), ...reports };
  }
  if (refusal === undefined) {
    return { settled: Result.fail(failure), ...reports };
  }
  return { settled: Result.fail(Object.assign(failure, { schema_refusal: refusal })), ...reports };
}

export async function attemptedCall(target: ModelTarget, attempting: Attempting): Promise<SettledCall> {
  const { request, signal, calledAt, policy, refusal } = attempting;
  try {
    const settled = await modelAnswer(target, request, { signal, telemetry: policy.telemetry, calledAt, refusal });
    return { settled, providerTexts: [], operatorHint: null };
  } catch (error) {
    return failedAttempt(target, attempting, error);
  }
}
