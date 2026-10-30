import { JsonPointer, type Schema } from 'effect';

import { headersTheRuntimeSets } from '../settings/reserved-headers.ts';
import type { Method, Parameter } from './api-document.ts';
import type { BodyOf, Placed } from './api-parameters.ts';
import type { Components } from './input-schemas.ts';
import { isSchemaObject } from './schema-translation.ts';

interface OperationContext {
  readonly components: Components;
  readonly sentHeaders: ReadonlySet<string>;
}

const mostReferenceHops = 8;

const componentReference = '#/components/schemas/';

function componentAt(reference: string, components: Components): Schema.Json | undefined {
  if (!reference.startsWith(componentReference)) {
    return undefined;
  }
  const name = JsonPointer.unescapeToken(reference.slice(componentReference.length));
  return Object.hasOwn(components.written, name) ? components.written[name] : undefined;
}

function isObjectSchema(schema: Schema.Json | undefined, components: Components): boolean {
  let current = schema;
  for (let hops = 0; hops <= mostReferenceHops && isSchemaObject(current); hops += 1) {
    const reference = current['$ref'];
    if (typeof reference !== 'string') {
      const type = current['type'];
      return type === 'object' || (Array.isArray(type) && type.includes('object'));
    }
    current = componentAt(reference, components);
  }
  return false;
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

function unsentWords({ in: place, name }: Parameter): string {
  if (place === 'cookie') {
    return `it needs the cookie ${name}, which a function cannot send`;
  }
  return runtimeHeaders.has(name.toLowerCase())
    ? `it needs the header ${name}, which the runtime sets itself and neither a function nor the headers of the entry can give`
    : `it needs the header ${name}, which a function cannot send; the headers of the entry can give it`;
}

function neededBecause(sent: readonly Parameter[], sentHeaders: ReadonlySet<string>): string | undefined {
  const needed = sent.find((each) => isUnsent(each, sentHeaders));
  return needed === undefined ? undefined : unsentWords(needed);
}

export function leftOutBecause(
  method: Method,
  parameters: readonly Placed<Parameter>[],
  body: BodyOf,
  { components, sentHeaders }: OperationContext,
): string | undefined {
  const sent = parameters.map(({ value }) => value);
  const unsendable = methodBecause(method, body) ?? serializedBecause(sent) ?? neededBecause(sent, sentHeaders);
  if (unsendable !== undefined) {
    return unsendable;
  }
  const objectQuery = sent.find((each) => each.in === 'query' && isObjectSchema(each.schema, components));
  if (objectQuery !== undefined) {
    return `its query parameter ${objectQuery.name} is an object, which a call does not send in a query`;
  }
  if (body.kind === 'other') {
    return `its body is ${body.mediaType}, and a call sends a body only as JSON`;
  }
  const inputs = [
    ...sent.flatMap((each) => (each.in === 'path' || each.in === 'query' ? [each.name] : [])),
    ...(body.kind === 'json' ? ['body'] : []),
  ];
  const shared = sharedNameOf(inputs);
  return shared === undefined ? undefined : `two of its inputs are named ${shared}`;
}
