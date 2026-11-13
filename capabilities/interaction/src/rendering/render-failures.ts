import { SlackBlockError } from '@chat-adapter/slack/blocks';
import { Result } from 'effect';

function isTexts(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function issuesOfKnownFailure(error: unknown): readonly string[] | undefined {
  if (error instanceof Error && 'issues' in error && isTexts(error.issues)) {
    return error.issues;
  }
  return error instanceof SlackBlockError ? [error.message] : undefined;
}

export function attempted<A>(build: () => A): Result.Result<A, readonly string[]> {
  try {
    return Result.succeed(build());
  } catch (error) {
    const issues = issuesOfKnownFailure(error);
    if (issues === undefined) {
      throw error;
    }
    return Result.fail(issues);
  }
}
