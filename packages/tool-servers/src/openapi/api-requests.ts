import { Buffer } from 'node:buffer';

import { Predicate, Redacted, Result } from 'effect';

import type { ApiOperation, QueryInput } from './api-tools.ts';
import type { Placement } from './security-schemes.ts';

export interface ApiEndpoint {
  readonly baseUrl: string;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query: ReadonlyMap<string, Redacted.Redacted>;
}

export interface ApiRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly usesToken: boolean;
}

type Scalar = string | number | boolean;

type Built<A> = Result.Result<A, string>;

const dotSegment = /^(?:\.|%2e){1,2}$/iu;

const segmentSeparators = /[/\\]/u;

const droppedByAddresses = /[\t\n\r]/gu;

export function keepsItsSegments(path: string): boolean {
  return !path
    .replaceAll(droppedByAddresses, '')
    .split(segmentSeparators)
    .some((segment) => dotSegment.test(segment));
}

export function isUnderBase(baseUrl: string, address: string): boolean {
  const base = URL.parse(baseUrl);
  const url = URL.parse(address);
  if (base === null || url === null || base.origin === 'null' || url.origin !== base.origin) {
    return false;
  }
  const basePath = base.pathname === '/' ? '' : base.pathname;
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function scalarsOf(name: string, value: unknown): Built<readonly string[]> {
  if (value === null || value === undefined) {
    return Result.succeed([]);
  }
  if (isScalar(value)) {
    return Result.succeed([String(value)]);
  }
  return Array.isArray(value) && value.every((item) => isScalar(item))
    ? Result.succeed(value.map(String))
    : Result.fail(`The argument ${name} is an object, which a call does not send in a path or a query`);
}

function pathOf(operation: ApiOperation, input: Readonly<Record<string, unknown>>): Built<string> {
  let path = operation.path;
  for (const { name } of operation.inputs.filter((each) => each.in === 'path')) {
    const values = scalarsOf(name, input[name]);
    if (Result.isFailure(values)) {
      return Result.fail(values.failure);
    }
    if (values.success.length === 0) {
      return Result.fail(`The arguments give no ${name}, which the path of this operation needs`);
    }
    if (values.success.includes('')) {
      return Result.fail(`The argument ${name} is empty, which a path argument may not be`);
    }
    path = path.replaceAll(`{${name}}`, values.success.map((value) => encodeURIComponent(value)).join(','));
  }
  return keepsItsSegments(path)
    ? Result.succeed(path)
    : Result.fail('The path arguments would take the call out of the path of this operation, as a . or a .. does');
}

function formEncoded(text: string): string {
  return new URLSearchParams([['', text]]).toString().slice('='.length);
}

function pairOf(name: string, values: readonly string[]): string {
  return `${formEncoded(name)}=${values.map((value) => formEncoded(value)).join(',')}`;
}

function pairsOf({ name, joinsLists }: QueryInput, values: readonly string[]): readonly string[] {
  if (values.length === 0) {
    return [];
  }
  return joinsLists ? [pairOf(name, values)] : values.map((value) => pairOf(name, [value]));
}

function queryOf(
  operation: ApiOperation,
  input: Readonly<Record<string, unknown>>,
  endpoint: ApiEndpoint,
): Built<string> {
  const pairs: string[] = [];
  for (const queried of operation.inputs.filter((each) => each.in === 'query')) {
    const values = scalarsOf(queried.name, input[queried.name]);
    if (Result.isFailure(values)) {
      return Result.fail(values.failure);
    }
    pairs.push(...pairsOf(queried, values.success));
  }
  for (const [name, value] of endpoint.query) {
    pairs.push(pairOf(name, [Redacted.value(value)]));
  }
  for (const placement of operation.credentials) {
    if (placement.kind === 'query') {
      pairs.push(pairOf(placement.name, [Redacted.value(placement.value)]));
    }
  }
  return Result.succeed(pairs.length === 0 ? '' : `?${pairs.join('&')}`);
}

function unknownArgument(operation: ApiOperation, input: Readonly<Record<string, unknown>>): string | undefined {
  const taken = new Set([...operation.inputs.map(({ name }) => name), ...(operation.body === null ? [] : ['body'])]);
  const unknown = Object.keys(input).find((name) => !taken.has(name));
  return unknown === undefined ? undefined : `The arguments give ${unknown}, which this operation does not take`;
}

function bodyOf(operation: ApiOperation, input: Readonly<Record<string, unknown>>): Built<string | null> {
  if (operation.body === null || !Predicate.hasProperty(input, 'body')) {
    return operation.body?.required === true
      ? Result.fail('The arguments give no body, which this operation needs')
      : Result.succeed(null);
  }
  return Result.succeed(JSON.stringify(input['body']));
}

function credentialHeader(placement: Placement): readonly (readonly [string, string])[] {
  if (placement.kind === 'header') {
    return [[placement.name, Redacted.value(placement.value)]];
  }
  if (placement.kind === 'bearer') {
    return [['Authorization', `Bearer ${Redacted.value(placement.value)}`]];
  }
  return placement.kind === 'basic'
    ? [['Authorization', `Basic ${Buffer.from(Redacted.value(placement.value)).toString('base64')}`]]
    : [];
}

function headersOf(operation: ApiOperation, endpoint: ApiEndpoint, body: string | null): Record<string, string> {
  return {
    ...Object.fromEntries(
      [...endpoint.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
    ),
    ...Object.fromEntries(operation.credentials.flatMap((placement) => credentialHeader(placement))),
    accept: 'application/json',
    ...(body === null || operation.body === null ? {} : { 'content-type': operation.body.mediaType }),
  };
}

export function apiRequestOf(
  operation: ApiOperation,
  input: Readonly<Record<string, unknown>>,
  endpoint: ApiEndpoint,
): Built<ApiRequest> {
  const unknown = unknownArgument(operation, input);
  if (unknown !== undefined) {
    return Result.fail(unknown);
  }
  return Result.flatMap(pathOf(operation, input), (path) =>
    Result.flatMap(queryOf(operation, input, endpoint), (query) =>
      Result.map(bodyOf(operation, input), (body) => ({
        url: `${endpoint.baseUrl}${path}${query}`,
        method: operation.method.toUpperCase(),
        headers: headersOf(operation, endpoint, body),
        body,
        usesToken: operation.credentials.some(({ kind }) => kind === 'token'),
      })),
    ),
  );
}
