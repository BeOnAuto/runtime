import type { RouteRegistration } from '@on.auto/operations';

import { problemReasons, problemTypes, type ProblemReason } from '../problem/problem-document.ts';
import { problemMediaType } from '../problem/problem.ts';

export type OpenApiObject = Readonly<Record<string, unknown>>;

export interface ProblemAnswer {
  readonly status: number;
  readonly name: string;
  readonly response: OpenApiObject;
}

const answeredToEveryOperation: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'bad_request',
  'unauthenticated',
  'forbidden',
  'origin_not_allowed',
  'not_found',
  'method_not_allowed',
  'content_too_large',
  'unsupported_media_type',
  'invalid_input',
  'internal',
  'unavailable',
]);

type Header = readonly [name: string, header: OpenApiObject];

function headerOf(name: string, description: string): readonly Header[] {
  return [[name, { description, schema: { type: 'string' } }]];
}

const headersOfReasons: Readonly<Partial<Record<ProblemReason, readonly Header[]>>> = {
  unauthenticated: headerOf('WWW-Authenticate', 'Bearer, with error="invalid_token" when the key is not one'),
  method_not_allowed: headerOf('Allow', 'The methods the path takes'),
  unavailable: headerOf('Retry-After', 'The seconds to wait, when the same request may then succeed'),
};

const problemSchemaReference = { $ref: '#/components/schemas/problem' };

function retiredPlaybookOf({ scope, kind }: RouteRegistration): readonly ProblemReason[] {
  return scope === 'playbook' && kind === 'command' ? ['conflict'] : [];
}

function answeredReasonsOf(registration: RouteRegistration): ReadonlySet<ProblemReason> {
  return new Set([...answeredToEveryOperation, ...registration.reasons, ...retiredPlaybookOf(registration)]);
}

function responseOf(reasons: readonly ProblemReason[]): OpenApiObject {
  const headers = Object.fromEntries(reasons.flatMap((reason) => headersOfReasons[reason] ?? []));
  return {
    description: reasons.map((reason) => `${reason}: ${problemTypes[reason].description}.`).join(' '),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    content: { [problemMediaType]: { schema: problemSchemaReference } },
  };
}

const statuses = [...new Set(problemReasons.map((reason) => problemTypes[reason].status))].toSorted(
  (one, other) => one - other,
);

function problemAnswersOf(answered: ReadonlySet<ProblemReason>): readonly ProblemAnswer[] {
  return statuses.flatMap((status) => {
    const reasons = problemReasons.filter((reason) => answered.has(reason) && problemTypes[reason].status === status);
    return reasons.length === 0 ? [] : [{ status, name: reasons.join('_or_'), response: responseOf(reasons) }];
  });
}

export function problemAnswersOfOperation(registration: RouteRegistration): readonly ProblemAnswer[] {
  return problemAnswersOf(answeredReasonsOf(registration));
}

export function referencesTo(problems: readonly ProblemAnswer[]): OpenApiObject {
  return Object.fromEntries(problems.map(({ status, name }) => [status, { $ref: `#/components/responses/${name}` }]));
}
