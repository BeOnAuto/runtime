import { isRefusal, type Authenticator, type Refusal } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import { mcpEndpointPathOf, unauthenticatedChallenge } from './challenges.ts';

const bearerCredentials = /^Bearer +([\w.~+/-]+=*) *$/iu;

const malformedCredentials = problemOf(
  'bad_request',
  'The Authorization header must hold exactly one API key or access token, as Bearer <key or token>',
);

function malformed(): Response {
  return problemResponse(malformedCredentials, { 'www-authenticate': 'Bearer error="invalid_request"' });
}

function detailOf({ because }: Refusal, missing: string): string {
  return because === undefined ? missing : `The token was refused: ${because}`;
}

export function authenticate({ authenticate: authenticated, resource }: Authenticator): MiddlewareHandler<ApiEnv> {
  const missing =
    resource === undefined ? 'A valid API key is required' : 'A valid API key or access token is required';
  return async (c, next) => {
    const authorization = c.req.header('authorization');
    const presented = authorization === undefined ? undefined : bearerCredentials.exec(authorization)?.[1];
    if (authorization !== undefined && presented === undefined) {
      return malformed();
    }
    const authentication = await authenticated(presented, mcpEndpointPathOf(c.req.path), c.req.header('origin'));
    if (isRefusal(authentication)) {
      return problemResponse(problemOf('unauthenticated', detailOf(authentication, missing)), {
        'www-authenticate': unauthenticatedChallenge(resource, presented !== undefined),
      });
    }
    c.set('principal', authentication);
    return next();
  };
}
