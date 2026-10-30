import { seriesShape } from '@on.auto/definitions';
import { issuesDetail } from '@on.auto/json-schema';
import { Effect, type Schema } from 'effect';

export function checkedAnswer(output: Schema.Json): Effect.Effect<void> {
  const issues = seriesShape.check(output);
  return issues.length === 0
    ? Effect.void
    : Effect.die(
        new Error(
          `The runtime built an answer that does not match the series shape: ${issuesDetail(issues, 'output')}`,
        ),
      );
}
