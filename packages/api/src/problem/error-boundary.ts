import { randomUUIDv7, type CallSummary, type Failed } from '@on.auto/operations';

import { internalErrorProblem, problemResponse } from './problem.ts';

export type ReportIncident = (
  incident: string,
  error: Readonly<Error>,
  requestId: string,
  call: CallSummary | undefined,
) => void;

export type ReportThrown = (thrown: unknown, requestId: string, call?: CallSummary) => Failed;

export function failureOfThrown(reportIncident: ReportIncident): ReportThrown {
  return (thrown, requestId, call) => {
    const incident = randomUUIDv7();
    reportIncident(incident, asError(thrown), requestId, call);
    return { status: 'failed', incident };
  };
}

export function errorHandler(reportIncident: ReportIncident): (thrown: unknown, requestId: string) => Response {
  const reportThrown = failureOfThrown(reportIncident);
  return (thrown, requestId) => problemResponse(internalErrorProblem(reportThrown(thrown, requestId).incident));
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error('A value that is not an Error was thrown', { cause: thrown });
}
