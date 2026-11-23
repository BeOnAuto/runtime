import { Result, Schema } from 'effect';

import { parseJsonBody } from '../operations/request-body.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf } from '../problem/problem.ts';
import type { QueryAsked } from './query-answers.ts';

const QueryAskedSchema = Schema.Struct({
  query: Schema.String,
  variables: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  operationName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  extensions: Schema.optionalKey(Schema.Unknown),
});

const askedOf = Schema.decodeUnknownResult(QueryAskedSchema);

const notAQuery = problemOf('bad_request', 'The body is a GraphQL request, an object with its query as text');

export async function queryAskedIn(request: Request): Promise<Result.Result<QueryAsked, Problem>> {
  const body = await parseJsonBody(request);
  return Result.flatMap(body, (fields) => Result.mapError(askedOf(fields), () => notAQuery));
}
