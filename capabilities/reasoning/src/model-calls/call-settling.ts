import { Array as Arr, Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import { UnclassifiedModelError } from '../failure/unclassified-model-error.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { failedRepairOf, RepairFailed, type Answered } from './answer-settling.ts';
import { scrubberFor, type CallPolicy } from './call-policy.ts';
import { classified, operatorHintOf, providerTextOf, type ProviderText } from './failure-classification.ts';
import { modelAnswer } from './model-call.ts';
import { deadlineOf, stoppedFailure } from './stopped-call.ts';

type Settled = Result.Result<Answered, ModelFailure | UnclassifiedModelError>;

export interface CallReports {
  readonly providerText: ProviderText | null;
  readonly operatorHint: string | null;
}

export interface SettledCall extends CallReports {
  readonly settled: Settled;
}

export async function settledCall(
  target: ModelTarget,
  request: ModelRequest,
  interruption: Readonly<AbortSignal>,
  policy: CallPolicy,
): Promise<SettledCall> {
  const deadline = deadlineOf(request);
  const signal = AbortSignal.any([interruption, ...Arr.fromNullishOr(deadline?.signal)]);
  try {
    return {
      settled: await modelAnswer(target, request, signal, policy.telemetry),
      providerText: null,
      operatorHint: null,
    };
  } catch (error) {
    const { provider } = target;
    const scrub = scrubberFor(policy, request);
    const context = {
      provider,
      configured: policy.configured,
      now: Date.now(),
      showsProviderMessages: policy.showsProviderMessages(provider),
      scrub,
      lastInputTokens: null,
    };
    const reason = error instanceof RepairFailed ? error.cause : error;
    const failure = stoppedFailure(provider, deadline) ?? classified(reason, context);
    const reports = {
      providerText: providerTextOf(reason, scrub),
      operatorHint: operatorHintOf(reason, provider, scrub),
    };
    if (error instanceof RepairFailed && !(failure instanceof UnclassifiedModelError)) {
      const { _tag: because } = failure;
      return { settled: failedRepairOf(target, error.unrepaired, because, context.now), ...reports };
    }
    return { settled: Result.fail(failure), ...reports };
  } finally {
    deadline?.ended();
  }
}
