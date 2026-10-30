import type { Settled, Succeeded } from '@on.auto/operations';

import type { ChallengeHeaders } from '../authentication/challenges.ts';
import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';
import { streamedResponse, type StreamServing } from './streamed-response.ts';

export interface OutcomeAnswering extends StreamServing {
  readonly forbidden: ChallengeHeaders;
}

export function toHttpResponse(settled: Settled<Succeeded>, answering: OutcomeAnswering): Response | Promise<Response> {
  if (settled.status !== 'succeeded') {
    const problem = problemOfOutcome(settled, answering.signal.aborted);
    return problemResponse(problem, problem.reason === 'forbidden' ? answering.forbidden : {});
  }
  return 'streamed' in settled
    ? streamedResponse(settled.streamed, answering)
    : Response.json(settled.output, { status: answering.status, headers: { 'cache-control': 'no-store' } });
}
