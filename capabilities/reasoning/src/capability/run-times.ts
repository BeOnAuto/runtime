import type { Resumption } from '@on.auto/definitions';
import { runBoundMs } from '@on.auto/tool-servers/policy';

import { approvalBounds } from '../approvals/approval-bounds.ts';
import { mostOutputTokens } from '../definition/definition-settings.ts';
import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import { cancelledAttemptOf } from './before-the-steps.ts';
import { resumesAfterMsOf, timeoutFor } from './definition-request.ts';

const longestWaitsMs = approvalBounds.requestsInRun * approvalBounds.waitMs;

export const longestAnyRunMs = runBoundMs(timeoutFor(mostOutputTokens)) + longestWaitsMs;

export function longestRunMsOf({ settings, tools }: ReasoningFunctionDefinitionDocument): number {
  const timeoutMs = timeoutFor(settings.max_output_tokens);
  return tools.length === 0 ? timeoutMs : runBoundMs(timeoutMs) + longestWaitsMs;
}

export function resumptionAfterCallsOf(callMs: number): Resumption<ReasoningFunctionDefinitionDocument> {
  return { afterMs: (definition) => resumesAfterMsOf(definition, callMs), cancelledAttempt: cancelledAttemptOf };
}
