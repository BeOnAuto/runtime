import { placeholdersIn } from '@on.auto/config';
import {
  ImpersonationSchema,
  SubjectTokenSchema,
  exchangeParametersTheRuntimeSets,
  isJsonPointer,
  jwtTokenType,
  setInEveryTokenRequestWords,
  type Impersonation,
} from '@on.auto/tool-servers';
import { Schema } from 'effect';

export const exchangeFields = {
  audience: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "For token_exchange, the audience parameter of the exchange, RFC 8693's name for the service a token is asked for, written as the service's documentation gives it. Each {name} in it is a placeholder of the way or of the provider",
    }),
  ),
  subject_token: Schema.optionalKey(
    SubjectTokenSchema.annotate({
      description: `For token_exchange, the token Auto signs for the organization and exchanges: its type, ${jwtTokenType}, and its audience, the aud claim the service expects. Each {name} in the audience is a placeholder of the way or of the provider`,
    }),
  ),
  impersonation: Schema.optionalKey(
    ImpersonationSchema.annotate({
      description:
        "For token_exchange, a second request that turns the exchanged token into the token of the account the connection acts as, as a service account's impersonation does: its method, POST; its https URL, each {name} in it a placeholder; in request, where the way's scopes go in its JSON body; and in issued, where its answer names the token and the time it ends. The way's scope then goes in this request, and the exchange's own scope in parameters",
    }),
  ),
  managed_service_account: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description:
        "For token_exchange, true where the account is one whoever runs Auto creates for the connection and removes with it. The way's placeholders are then filled by Auto, and a person is asked none of them. A runtime that cannot create such accounts does not offer the way",
    }),
  ),
  read_only: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'For token_exchange, true where a connection made this way is given only the tools marked reads',
    }),
  ),
};

export const exchangeFieldNames = [
  'audience',
  'subject_token',
  'impersonation',
  'managed_service_account',
  'read_only',
] as const;

const valuesBesideTheSteps: readonly string[] = ['issuer', 'subject'];

export const parametersNamingATokenType: readonly string[] = ['requested_token_type'];

interface Instructed {
  readonly instructions: string;
}

interface ExchangeSteps {
  readonly key_page?: Instructed | undefined;
  readonly pages?: readonly Instructed[] | undefined;
  readonly key?: Instructed | undefined;
  readonly connected?: Instructed | undefined;
}

export interface ExchangingWay {
  readonly kind: string;
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly impersonation?: Impersonation | undefined;
  readonly placeholders?: Readonly<Record<string, unknown>> | undefined;
  readonly steps?: ExchangeSteps | undefined;
}

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const notAPointerIntoTheBody = 'Expected a JSON Pointer into the JSON body of the request, such as /scope';

const notAPointerIntoTheAnswer = 'Expected a JSON Pointer into the answer, such as /access_token';

function parameterIssuesOf({ parameters = {}, impersonation }: ExchangingWay): readonly WayIssue[] {
  return exchangeParametersTheRuntimeSets(parameters, impersonation !== undefined).map((name) => ({
    path: ['parameters', name],
    issue: setInEveryTokenRequestWords(name),
  }));
}

function pointerIssuesOf({ impersonation }: ExchangingWay): readonly WayIssue[] {
  if (impersonation === undefined) {
    return [];
  }
  const scope = isJsonPointer(impersonation.request.scope)
    ? []
    : [{ path: ['impersonation', 'request', 'scope'], issue: notAPointerIntoTheBody }];
  const issued = Object.entries(impersonation.issued)
    .filter(([, pointer]: readonly [string, string]) => !isJsonPointer(pointer))
    .map(([name]: readonly [string, string]) => ({
      path: ['impersonation', 'issued', name],
      issue: notAPointerIntoTheAnswer,
    }));
  return [...scope, ...issued];
}

function unknownInStepIssue(name: string): string {
  return `Expected {issuer}, {subject} or a placeholder of this way: {${name}} names no value the page gives beside the steps`;
}

interface InstructedStep {
  readonly path: readonly string[];
  readonly step: Instructed;
}

function instructedStepsOf({
  key_page: keyPage,
  pages = [],
  key,
  connected,
}: ExchangeSteps): readonly InstructedStep[] {
  return [
    ...(keyPage === undefined ? [] : [{ path: ['steps', 'key_page', 'instructions'], step: keyPage }]),
    ...pages.map((page, index) => ({ path: ['steps', 'pages', String(index), 'instructions'], step: page })),
    ...(key === undefined ? [] : [{ path: ['steps', 'key', 'instructions'], step: key }]),
    ...(connected === undefined ? [] : [{ path: ['steps', 'connected', 'instructions'], step: connected }]),
  ];
}

function stepIssuesOf({ steps, placeholders = {} }: ExchangingWay): readonly WayIssue[] {
  const given = new Set([...valuesBesideTheSteps, ...Object.keys(placeholders)]);
  return instructedStepsOf(steps ?? {}).flatMap(({ path, step }) =>
    [...new Set(placeholdersIn(step.instructions))]
      .filter((name) => !given.has(name))
      .map((name) => ({ path, issue: unknownInStepIssue(name) })),
  );
}

export function exchangeIssuesOf(way: ExchangingWay): readonly WayIssue[] {
  return way.kind === 'token_exchange'
    ? [...parameterIssuesOf(way), ...pointerIssuesOf(way), ...stepIssuesOf(way)]
    : [];
}
