import { Clock, Effect, Result } from 'effect';

import { UnclassifiedModelError } from '../failure/unclassified-model-error.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResolution, ModelTarget } from '../model/model-resolution.ts';
import type { ModelResult } from '../model/model-result.ts';
import { checkedRequest } from '../model/request-checks.ts';
import type { CallPolicy } from './call-policy.ts';
import { settledCall, type CallReports } from './call-settling.ts';
import { callFailed, callSucceeded } from './model-metrics.ts';

function reportsOf(
  policy: CallPolicy,
  { provider }: ModelTarget,
  { model, run_id }: ModelRequest,
  { providerText, operatorHint }: CallReports,
): Effect.Effect<void> {
  const call = { provider, model, run_id: run_id ?? null };
  return Effect.all(
    [
      providerText === null ? Effect.void : policy.report({ ...call, ...providerText }),
      operatorHint === null ? Effect.void : policy.reportHint({ ...call, hint: operatorHint }),
    ],
    { discard: true },
  );
}

export type Generation = LanguageModel['Service'];

function admission(resolve: ModelResolution, policy: CallPolicy) {
  return Effect.fnUntraced(function* (request: ModelRequest) {
    yield* checkedRequest(request);
    const target = yield* Effect.fromResult(resolve(request.model));
    yield* Effect.fromResult(policy.admitsOptions(target.provider, request.provider_options));
    return target;
  });
}

export function generation(resolve: ModelResolution, policy: CallPolicy): Generation {
  const admitted = admission(resolve, policy);
  const generate = Effect.fnUntraced(function* (request: ModelRequest) {
    const target = yield* admitted(request);
    const started = yield* Clock.currentTimeMillis;
    const call = yield* Effect.promise((interruption: Readonly<AbortSignal>) =>
      settledCall(target, request, interruption, policy),
    );
    const finished = yield* Clock.currentTimeMillis;
    yield* reportsOf(policy, target, request, call);
    const { settled } = call;
    if (Result.isSuccess(settled)) {
      const result: ModelResult = { ...settled.success, duration_ms: finished - started };
      yield* callSucceeded(target, result);
      return result;
    }
    const failure = settled.failure;
    if (failure instanceof UnclassifiedModelError) {
      yield* callFailed(target, 'unclassified', finished - started);
      return yield* Effect.die(failure);
    }
    const { _tag: kind } = failure;
    yield* callFailed(target, kind, finished - started);
    return yield* Effect.fail(failure);
  });
  return { admit: (request) => Effect.asVoid(admitted(request)), generate };
}
