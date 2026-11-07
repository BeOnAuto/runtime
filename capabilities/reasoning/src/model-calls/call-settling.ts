import { Array as Arr, Result } from 'effect';

import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import type { SchemaRefusal } from '../model/model-result.ts';
import { answerModeFor } from './answer-mode.ts';
import { refusedRequestFailure, type Refused } from './api-call-failure.ts';
import { attemptedCall, type Attempting, type CallReports, type SettledCall } from './call-attempt.ts';
import type { CallPolicy } from './call-policy.ts';
import { deadlineOf, msLeftOf, stoppedFailure } from './stopped-call.ts';

interface Failure {
  readonly provider: string | null;
  readonly _tag?: string;
  readonly status?: number | null;
  readonly provider_message?: string | null;
  readonly schema_refused?: true;
}

function refusedIn({ _tag: kind, status, provider_message: said }: Failure): Refused | undefined {
  return kind === 'definition_invalid' && (status === 400 || status === 422)
    ? { status, provider_message: said ?? null }
    : undefined;
}

function schemaRefusedIn(failure: Failure): Refused | undefined {
  return failure.schema_refused === true ? refusedIn(failure) : undefined;
}

function enforcesTheSchema(target: ModelTarget, { output }: ModelRequest): boolean {
  return output.type === 'json' && answerModeFor(target, output).mode === 'portable';
}

async function askedDescribed(
  target: ModelTarget,
  attempting: Attempting,
  reports: CallReports,
  refused: Refused,
): Promise<SettledCall> {
  const { provider } = target;
  const now = Date.now();
  const refusedRequest = { status: refused.status, duration_ms: now - attempting.calledAt };
  if (msLeftOf(attempting.request, attempting.calledAt, now) < refusedRequest.duration_ms) {
    const skipped: SchemaRefusal = { outcome: 'skipped', because: 'time', ...refusedRequest };
    return { settled: Result.fail(refusedRequestFailure(provider, refused, skipped)), ...reports };
  }
  const refusal: SchemaRefusal = { outcome: 'described', ...refusedRequest };
  const second = await attemptedCall({ ...target, takesSchemas: false }, { ...attempting, refusal });
  const again = Result.isFailure(second.settled) ? refusedIn(second.settled.failure) : undefined;
  const refusedAgain: SchemaRefusal = { outcome: 'refused_again', ...refusedRequest };
  const settled =
    again === undefined ? second.settled : Result.fail(refusedRequestFailure(provider, again, refusedAgain));
  return {
    settled,
    providerTexts: [...reports.providerTexts, ...second.providerTexts],
    operatorHint: second.operatorHint,
  };
}

export async function settledCall(
  target: ModelTarget,
  request: ModelRequest,
  interruption: Readonly<AbortSignal>,
  policy: CallPolicy,
): Promise<SettledCall> {
  const calledAt = Date.now();
  const deadline = deadlineOf(request);
  const signal = AbortSignal.any([interruption, ...Arr.fromNullishOr(deadline?.signal)]);
  const attempting = { request, signal, calledAt, policy, stopped: () => stoppedFailure(target.provider, deadline) };
  try {
    const first = await attemptedCall(target, attempting);
    const { settled, ...reports } = first;
    const refused =
      enforcesTheSchema(target, request) && Result.isFailure(settled) ? schemaRefusedIn(settled.failure) : undefined;
    return refused === undefined ? first : await askedDescribed(target, attempting, reports, refused);
  } finally {
    deadline?.ended();
  }
}
