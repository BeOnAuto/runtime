import { seriesShape } from '@on.auto/definitions';
import { issuesDetail, type SchemaIssue } from '@on.auto/json-schema';
import { Unavailable } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

const rangeOfAPredictedPoint = /^\/lines\/1\/points\/\d+\/(?:low|high)$/u;

function isRangeIssue({ pointer }: SchemaIssue): boolean {
  return rangeOfAPredictedPoint.test(pointer);
}

export function checkedAnswer(output: Schema.Json): Effect.Effect<void, Unavailable> {
  const issues = seriesShape.check(output);
  if (issues.length === 0) {
    return Effect.void;
  }
  const detail = issuesDetail(issues, 'output');
  return issues.every((issue) => isRangeIssue(issue))
    ? Effect.fail(
        new Unavailable({
          detail: `The answer does not match the series shape: ${detail}`,
          kind: 'model_process_failed',
          because: 'not_in_order',
        }),
      )
    : Effect.die(new Error(`The runtime built an answer that does not match the series shape: ${detail}`));
}
