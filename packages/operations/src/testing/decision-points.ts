import { Effect } from 'effect';

import type { AccessDecision, AccessRequest, PolicyDecisionPoint } from '../index.ts';

export const allowedByTheTest: AccessDecision = { decision: 'allow', determiningPolicies: ['test-allow'], errors: [] };

export const deniedByTheTest: AccessDecision = { decision: 'deny', determiningPolicies: ['test-deny'], errors: [] };

interface RecordingDecisionPoint {
  readonly decisionPoint: PolicyDecisionPoint;
  readonly asked: () => readonly AccessRequest[];
}

export function recordingDecisionPoint(answer: (request: AccessRequest) => AccessDecision): RecordingDecisionPoint {
  const asked: AccessRequest[] = [];
  return {
    decisionPoint: {
      decide: (request) =>
        Effect.sync(() => {
          asked.push(request);
          return answer(request);
        }),
    },
    asked: () => asked,
  };
}
