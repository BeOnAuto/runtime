import { takesNoBody, type HttpBody, type InputEncoding, type RouteRegistration } from '@on.auto/operations';
import { Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf } from '../problem/problem.ts';
import { bodyTextOf, parseJsonBody, type JsonObject } from './request-body.ts';

export interface CallInput {
  readonly input: JsonObject;
  readonly encoding: InputEncoding;
}

const jsonBody: HttpBody = { kind: 'json' };

const bodyOnNone = Result.fail(problemOf('bad_request', 'This operation takes no body'));

const queryBesideABody = Result.fail(
  problemOf(
    'bad_request',
    'An operation called by POST or PUT takes no query parameters; send its input in the JSON body',
  ),
);

function givenTwice(name: string): Result.Result<never, Problem> {
  return Result.fail(problemOf('bad_request', `The field ${name} is given in more than one place`));
}

function queryFieldsOf(query: URLSearchParams): Result.Result<JsonObject, Problem> {
  const names = [...query.keys()];
  const repeated = names.find((name, position) => names.indexOf(name) !== position);
  return repeated === undefined ? Result.succeed(Object.fromEntries(query)) : givenTwice(repeated);
}

function combined(
  pathFields: JsonObject,
  given: JsonObject,
  encoding: InputEncoding,
): Result.Result<CallInput, Problem> {
  const repeated = Object.keys(given).find((name) => Object.hasOwn(pathFields, name));
  return repeated === undefined
    ? Result.succeed({ input: { ...given, ...pathFields }, encoding })
    : givenTwice(repeated);
}

async function noBodyIn(request: Request): Promise<Result.Result<JsonObject, Problem>> {
  return Result.flatMap(await bodyTextOf(request), (text) => (text === '' ? Result.succeed({}) : bodyOnNone));
}

export async function parseCallInput(
  c: Context<ApiEnv>,
  registration: RouteRegistration,
): Promise<Result.Result<CallInput, Problem>> {
  const pathFields = Object.fromEntries(registration.pathParameters.map((name) => [name, c.req.param(name)]));
  const query = new URL(c.req.url).searchParams;
  if (takesNoBody(registration.route)) {
    return Result.flatMap(queryFieldsOf(query), (given) => combined(pathFields, given, 'strings'));
  }
  const body = registration.servedOverHttpAlone ?? jsonBody;
  if (query.size > 0) {
    return queryBesideABody;
  }
  const given = body.kind === 'json' ? await parseJsonBody(c.req.raw) : await noBodyIn(c.req.raw);
  return Result.flatMap(given, (fields) => combined(pathFields, fields, 'json'));
}
