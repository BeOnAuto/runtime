import {
  CancelledKindSchema,
  ConflictKindSchema,
  InvalidInputKindSchema,
  IssueSchema,
  RejectionBecauseSchema,
  UnansweredKindSchema,
  UnavailableKindSchema,
  kindsWithTypes,
  problemTypeOf,
} from '@on.auto/operations';
import { Schema } from 'effect';

function reasonOf<const R extends string>(
  reason: R,
  status: number,
  title: string,
  description: string,
): Schema.Literal<R> {
  return Schema.Literal(reason).annotate({ title, description, status });
}

const reasons = [
  reasonOf('invalid_input', 422, 'Invalid input', 'The input does not fit, with the errors that point at it'),
  reasonOf('forbidden', 403, 'Forbidden', 'The credentials may not do that'),
  reasonOf('not_found', 404, 'Not found', 'Something the request names does not exist'),
  reasonOf('conflict', 409, 'Conflict', 'The request clashes with what is there, such as a retired playbook'),
  reasonOf('unavailable', 503, 'Unavailable', 'Something the server relies on cannot serve now'),
  reasonOf('cancelled', 409, 'Cancelled', 'The run was cancelled, with the kind of its cancellation'),
  reasonOf('unanswered', 410, 'Unanswered', 'Nobody answered the request the run waited on'),
  reasonOf('client_closed_request', 499, 'Client closed request', 'The client went away before the answer'),
  reasonOf('bad_request', 400, 'Bad request', 'The request is malformed, such as a field given twice'),
  reasonOf('unauthenticated', 401, 'Unauthenticated', 'Credentials are missing or invalid'),
  reasonOf('origin_not_allowed', 403, 'Origin not allowed', 'A browser sent it from an origin the server refuses'),
  reasonOf('method_not_allowed', 405, 'Method not allowed', 'The path does not take that method'),
  reasonOf('length_required', 411, 'Length required', 'A body the route streams came without its length'),
  reasonOf('content_too_large', 413, 'Content too large', 'The body is larger than the operation takes'),
  reasonOf('unsupported_media_type', 415, 'Unsupported media type', 'The body is not of a type the operation takes'),
  reasonOf('internal', 500, 'Internal error', 'Something went wrong inside the server'),
];

const ProblemReasonSchema = Schema.Union(reasons).annotate({ description: 'Why the request did not succeed' });

export type ProblemReason = typeof ProblemReasonSchema.Type;

const RejectionKindSchema = Schema.Union([
  InvalidInputKindSchema,
  ConflictKindSchema,
  UnavailableKindSchema,
  CancelledKindSchema,
  UnansweredKindSchema,
]).annotate({ description: 'What kind of rejection it is, where the reason has kinds' });

const typesOfKinds = kindsWithTypes.map((kind) => problemTypeOf(kind)).join(', ');

export const ProblemSchema = Schema.Struct({
  type: Schema.String.annotate({
    description: `${problemTypeOf('<reason>')}, or the type of a kind that has one of its own: ${typesOfKinds}`,
  }),
  title: Schema.String.annotate({ description: 'The title of the type' }),
  status: Schema.Int.annotate({ description: 'The status of the answer' }),
  detail: Schema.String.annotate({ description: 'What happened to this request' }),
  reason: ProblemReasonSchema,
  instance: Schema.optionalKey(
    Schema.String.annotate({ description: 'urn:uuid:<id> of the incident the server logged it under' }),
  ),
  errors: Schema.optionalKey(Schema.Array(IssueSchema).annotate({ description: 'Each place the input is wrong' })),
  kind: Schema.optionalKey(RejectionKindSchema),
  because: Schema.optionalKey(RejectionBecauseSchema.annotate({ description: 'What the rejection comes from' })),
  resolve_at: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The absolute URL where a person resolves this refusal, such as the page of Studio that licenses this runtime',
    }),
  ),
  runtime_id: Schema.optionalKey(
    Schema.String.annotate({ description: 'The id of this runtime, on a refusal of its license or its meter' }),
  ),
}).annotate({ description: 'A problem document, as RFC 9457 defines it, with the members of this server' });

export type Problem = typeof ProblemSchema.Type;

export type ProblemIssue = typeof IssueSchema.Type;

export type OptionalProblemMembers = Pick<
  Problem,
  'instance' | 'errors' | 'kind' | 'because' | 'resolve_at' | 'runtime_id'
>;

const ProblemTypeSchema = Schema.Struct({ status: Schema.Int, title: Schema.String, description: Schema.String });

export type ProblemType = typeof ProblemTypeSchema.Type;

export const problemTypes = Schema.decodeUnknownSync(Schema.Record(ProblemReasonSchema, ProblemTypeSchema))(
  Object.fromEntries(reasons.map(({ literal, ast }) => [literal, ast.annotations])),
);

export const problemReasons: readonly ProblemReason[] = reasons.map(({ literal }) => literal);
