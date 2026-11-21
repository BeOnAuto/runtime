import { Effect } from 'effect';

import type { AccessDecision, AccessRequest, PolicyDecisionPoint } from '../index.ts';

export const allowedByTheTest: AccessDecision = { decision: 'allow', determiningPolicies: ['test-allow'], errors: [] };

export const deniedByTheTest: AccessDecision = { decision: 'deny', determiningPolicies: ['test-deny'], errors: [] };

export function decidingEach(decide: PolicyDecisionPoint['decide']): PolicyDecisionPoint {
  return { decide, decideBatch: (requests) => Effect.forEach(requests, decide) };
}

interface RecordingDecisionPoint {
  readonly decisionPoint: PolicyDecisionPoint;
  readonly asked: () => readonly AccessRequest[];
  readonly batches: () => readonly (readonly string[])[];
}

export function recordingDecisionPoint(answer: (request: AccessRequest) => AccessDecision): RecordingDecisionPoint {
  const asked: AccessRequest[] = [];
  const batches: (readonly string[])[] = [];
  const decide = (request: AccessRequest) =>
    Effect.sync(() => {
      asked.push(request);
      return answer(request);
    });
  return {
    decisionPoint: {
      decide,
      decideBatch: (requests) =>
        Effect.suspend(() => {
          batches.push(requests.map(({ action }) => action.name));
          return Effect.forEach(requests, decide);
        }),
    },
    asked: () => asked,
    batches: () => batches,
  };
}
