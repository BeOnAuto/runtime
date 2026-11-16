import type { Schema } from 'effect';

import { resolvedSchema } from '../request-bodies/part-places.ts';
import { headersTheRuntimeSets } from '../settings/reserved-headers.ts';
import type { ApiDocument, Method, Operation, Parameter, PathItem } from './api-document.ts';
import type { BodyOf, Placed } from './api-parameters.ts';
import type { Components } from './input-schemas.ts';

interface OperationContext {
  readonly components: Components;
  readonly sentHeaders: ReadonlySet<string>;
}

function isObjectSchema(schema: Schema.Json | undefined, components: Components): boolean {
  const type = resolvedSchema(schema, components.written)?.['type'];
  return type === 'object' || (Array.isArray(type) && type.includes('object'));
}

function sharedNameOf(names: readonly string[]): string | undefined {
  return names.find((name, index) => names.indexOf(name) < index);
}

const sentStyles: ReadonlyMap<Parameter['in'], string> = new Map([
  ['path', 'simple'],
  ['query', 'form'],
]);

function unsentStyleOf({ in: place, style }: Parameter): string | undefined {
  const sentStyle = sentStyles.get(place);
  return style === undefined || sentStyle === undefined || style === sentStyle ? undefined : style;
}

function methodBecause(method: Method, body: BodyOf): string | undefined {
  if (method === 'trace') {
    return 'a call cannot send TRACE, which fetch refuses';
  }
  return (method === 'get' || method === 'head') && body.kind !== 'none'
    ? `it takes a body, which a ${method.toUpperCase()} cannot carry`
    : undefined;
}

function serializedBecause(sent: readonly Parameter[]): string | undefined {
  for (const each of sent) {
    if (each.in === 'querystring') {
      return `its parameter ${each.name} is the whole query string, which a call does not send`;
    }
    const style = unsentStyleOf(each);
    if (style !== undefined) {
      return `its ${each.in} parameter ${each.name} is written with style ${style}, a form a call does not send`;
    }
  }
  return undefined;
}

const ignoredHeaders: ReadonlySet<string> = new Set(['accept', 'content-type', 'authorization']);

const runtimeHeaders = headersTheRuntimeSets('openapi').names;

function requiredHeaderOf({ in: place, name, required }: Parameter): string | undefined {
  const header = name.toLowerCase();
  return place === 'header' && required === true && !ignoredHeaders.has(header) ? header : undefined;
}

export function requiredHeadersOf(parameters: readonly Placed<Parameter>[]): readonly string[] {
  return parameters.flatMap(({ value }) => {
    const header = requiredHeaderOf(value);
    return header === undefined ? [] : [header];
  });
}

function isUnsent(parameter: Parameter, sentHeaders: ReadonlySet<string>): boolean {
  const header = requiredHeaderOf(parameter);
  return (
    (parameter.in === 'cookie' && parameter.required === true) || (header !== undefined && !sentHeaders.has(header))
  );
}

export interface LeftOutReason {
  readonly because: string;
  readonly header?: string;
}

function unsentReasonOf({ in: place, name }: Parameter): LeftOutReason {
  if (place === 'cookie') {
    return { because: `it needs the cookie ${name}, which a function cannot send` };
  }
  return runtimeHeaders.has(name.toLowerCase())
    ? {
        because: `it needs the header ${name}, which the runtime sets itself and neither a function nor the headers of the entry can give`,
      }
    : {
        because: `it needs the header ${name}, which a function cannot send; the headers of the entry can give it`,
        header: name,
      };
}

function neededReasonOf(sent: readonly Parameter[], sentHeaders: ReadonlySet<string>): LeftOutReason | undefined {
  const needed = sent.find((each) => isUnsent(each, sentHeaders));
  return needed === undefined ? undefined : unsentReasonOf(needed);
}

function becauseOf(sent: readonly Parameter[], body: BodyOf, components: Components): string | undefined {
  const objectQuery = sent.find((each) => each.in === 'query' && isObjectSchema(each.schema, components));
  if (objectQuery !== undefined) {
    return `its query parameter ${objectQuery.name} is an object, which a call does not send in a query`;
  }
  if (body.kind === 'unsent') {
    return body.because;
  }
  const inputs = [
    ...sent.flatMap((each) => (each.in === 'path' || each.in === 'query' ? [each.name] : [])),
    ...(body.kind === 'none' ? [] : ['body']),
  ];
  const shared = sharedNameOf(inputs);
  return shared === undefined ? undefined : `two of its inputs are named ${shared}`;
}

export function leftOutReasonOf(
  method: Method,
  parameters: readonly Placed<Parameter>[],
  body: BodyOf,
  { components, sentHeaders }: OperationContext,
): LeftOutReason | undefined {
  const sent = parameters.map(({ value }) => value);
  const unsendable = methodBecause(method, body) ?? serializedBecause(sent);
  if (unsendable !== undefined) {
    return { because: unsendable };
  }
  const because = becauseOf(sent, body, components);
  return neededReasonOf(sent, sentHeaders) ?? (because === undefined ? undefined : { because });
}

export interface LeftOutOperation extends LeftOutReason {
  readonly operation: string;
}

export function operationNamed(sentMethod: string, path: string, { operationId }: Operation): string {
  const route = `${sentMethod} ${path}`;
  return operationId === undefined ? route : `${operationId} (${route})`;
}

const queryUnsent = 'a call does not send QUERY';

function queryOf(path: string, { query }: PathItem): readonly LeftOutOperation[] {
  return query === undefined ? [] : [{ operation: operationNamed('QUERY', path, query), because: queryUnsent }];
}

function additionalOf(path: string, { additionalOperations = {} }: PathItem): readonly LeftOutOperation[] {
  return Object.entries(additionalOperations).map(([method, operation]: readonly [string, Operation]) => ({
    operation: operationNamed(method, path, operation),
    because: `a call does not send ${method}, a method OpenAPI lists only among additional operations`,
  }));
}

export function unsentMethodsOf(document: ApiDocument): readonly LeftOutOperation[] {
  const items = Object.entries(document.paths ?? {});
  return [
    ...items.flatMap(([path, item]: readonly [string, PathItem]) => queryOf(path, item)),
    ...items.flatMap(([path, item]: readonly [string, PathItem]) => additionalOf(path, item)),
  ];
}
