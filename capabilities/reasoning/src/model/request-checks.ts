import { Effect } from 'effect';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { FailureIssue } from '../failure/failure-issue.ts';
import type { ModelRequest } from './model-request.ts';

function issue(pointer: string, detail: string): readonly FailureIssue[] {
  return [{ pointer, detail }];
}

function countIssues(pointer: string, value: number | undefined, least: number): readonly FailureIssue[] {
  const valid = value === undefined || (Number.isSafeInteger(value) && value >= least);
  return valid ? [] : issue(pointer, `Expected an integer of ${least} or more`);
}

function finiteIssues(pointer: string, value: number | undefined): readonly FailureIssue[] {
  return value === undefined || Number.isFinite(value) ? [] : issue(pointer, 'Expected a finite number');
}

export function requestIssues(request: ModelRequest): readonly FailureIssue[] {
  const { settings } = request;
  return [
    ...(request.messages.length === 0 ? issue('/messages', 'Expected at least one message') : []),
    ...countIssues('/settings/max_output_tokens', settings.max_output_tokens, 1),
    ...finiteIssues('/settings/temperature', settings.temperature),
    ...finiteIssues('/settings/top_p', settings.top_p),
    ...countIssues('/settings/seed', settings.seed, 0),
    ...countIssues('/timeout_ms', request.timeout_ms, 1),
  ];
}

export function checkedRequest(request: ModelRequest): Effect.Effect<void, DefinitionInvalid> {
  const issues = requestIssues(request);
  return issues.length === 0
    ? Effect.void
    : Effect.fail(
        new DefinitionInvalid({
          detail: 'The request is not valid',
          provider: null,
          status: null,
          provider_message: null,
          issues,
        }),
      );
}
