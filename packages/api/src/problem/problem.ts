import {
  capitalized,
  isKindWithType,
  problemTypeOf,
  reasonOfKind,
  type KindWithType,
  type RejectionKind,
  type RejectionBecause,
  type UnavailableKind,
} from '@on.auto/operations';

import {
  problemTypes,
  type OptionalProblemMembers,
  type Problem,
  type ProblemReason,
  type ProblemType,
} from './problem-document.ts';

function kindProblemTypeOf(kind: KindWithType): Pick<ProblemType, 'status' | 'title'> {
  return { status: problemTypes[reasonOfKind(kind)].status, title: capitalized(kind.replaceAll('_', ' ')) };
}

interface TypedProblem {
  readonly type: string;
  readonly status: number;
  readonly title: string;
}

function problemTypeFor(reason: ProblemReason, kind: RejectionKind | undefined): TypedProblem {
  if (isKindWithType(kind)) {
    return { type: problemTypeOf(kind), ...kindProblemTypeOf(kind) };
  }
  const { status, title } = problemTypes[reason];
  return { type: problemTypeOf(reason), status, title };
}

export const problemMediaType = 'application/problem+json';

const retryAfterSeconds = '5';

const resolvedOnlyByChange: ReadonlySet<RejectionKind> = new Set<UnavailableKind>([
  'tools_unfinished',
  'tool_not_offered',
  'model_not_offered',
]);

const notResolvedByWaiting: ReadonlySet<RejectionBecause> = new Set<RejectionBecause>(['stalled']);

function isWorthRetrying({ reason, kind, because }: Problem): boolean {
  return (
    reason === 'unavailable' &&
    (kind === undefined || !resolvedOnlyByChange.has(kind)) &&
    (because === undefined || !notResolvedByWaiting.has(because))
  );
}

export function problemOf(reason: ProblemReason, detail: string, optional: OptionalProblemMembers = {}): Problem {
  const { type, status, title } = problemTypeFor(reason, optional.kind);
  return { type, title, status, detail, reason, ...optional };
}

export function internalErrorProblem(incident: string): Problem {
  return problemOf('internal', 'An unexpected error occurred', { instance: `urn:uuid:${incident}` });
}

export function problemResponse(problem: Problem, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      'content-type': problemMediaType,
      'cache-control': 'no-store',
      ...(isWorthRetrying(problem) ? { 'retry-after': retryAfterSeconds } : {}),
      ...headers,
    },
  });
}
