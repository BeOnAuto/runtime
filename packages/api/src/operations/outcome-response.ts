import type { Settled } from '@on.auto/operations';

import type { ChallengeHeaders } from '../authentication/challenges.ts';
import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';

export interface OutcomeAnswering {
  readonly status: number;
  readonly signal: AbortSignal;
  readonly forbidden: ChallengeHeaders;
}

export function toHttpResponse(settled: Settled, answering: OutcomeAnswering): Response {
  if (settled.status !== 'succeeded') {
    const problem = problemOfOutcome(settled, answering.signal.aborted);
    return problemResponse(problem, problem.reason === 'forbidden' ? answering.forbidden : {});
  }
  return Response.json(settled.output, { status: answering.status, headers: { 'cache-control': 'no-store' } });
}
