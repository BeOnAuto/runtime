import { Schema } from 'effect';

import { TokenRequestSchema } from '../assertions/token-requests.ts';

export const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange';

export const jwtTokenType = 'urn:ietf:params:oauth:token-type:jwt';

export const SubjectTokenSchema = Schema.Struct({
  type: Schema.Literal(jwtTokenType).annotate({
    description: `The type of the subject token, ${jwtTokenType}, a JWT the runtime signs`,
  }),
  audience: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'The aud claim of the JWT the runtime signs, which names the service it is for',
  }),
});

export type SubjectToken = typeof SubjectTokenSchema.Type;

export const ImpersonationSchema = Schema.Struct({
  method: TokenRequestSchema.fields.method,
  url: Schema.String.annotate({
    description:
      'The https URL the request is sent to, with the exchanged token as its Bearer, that answers the token of the account',
  }),
  request: Schema.Struct({
    scope: Schema.String.annotate({
      description: 'The JSON Pointer to the place in the JSON body where the scopes go, as a list',
    }),
  }).annotate({ description: 'Where the JSON body of the request carries what it asks' }),
  issued: TokenRequestSchema.fields.issued,
});

export type Impersonation = typeof ImpersonationSchema.Type;

export interface TokenExchange {
  readonly token_endpoint: string;
  readonly audience: string;
  readonly subject_token: SubjectToken;
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly impersonation?: Impersonation | undefined;
}

const setInEveryExchange: readonly string[] = ['grant_type', 'subject_token', 'subject_token_type', 'audience'];

const setWhereNothingImpersonates: readonly string[] = [...setInEveryExchange, 'scope'];

export function exchangeParametersTheRuntimeSets(
  parameters: Readonly<Record<string, string>>,
  impersonates: boolean,
): readonly string[] {
  const set = impersonates ? setInEveryExchange : setWhereNothingImpersonates;
  return Object.keys(parameters).filter((name) => set.includes(name));
}
