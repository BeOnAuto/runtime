import type { CheckJob } from '@on.auto/workflow-engine/dsl';
import { Predicate, type Schema } from 'effect';

import type { Place } from './module-rules.ts';

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

type Named = (definition: string) => string;

const jsonType = 'type Json = null | boolean | number | string | Json[] | { [key: string]: Json };';

const eventDeclaration = [
  'interface Event {',
  '  specversion?: string;',
  '  id: string;',
  '  type: string;',
  '  source: string;',
  '  subject?: string;',
  '  time?: string;',
  '  datacontenttype?: string;',
  '  dataschema?: string;',
  '  data?: Json;',
  '  causationid?: string;',
  '  correlationid?: string;',
  '  caller?: string;',
  '  definitionversion?: number;',
  '  depth?: number;',
  '  calldepth?: number;',
  '  calledby?: string;',
  '  triggerkind?: string;',
  '  triggerreference?: string;',
  '}',
].join('\n');

const identifier = /^[A-Za-z_$][\w$]*$/u;

const definitionReference = /^#\/(?:\$defs|definitions)\/(?<name>[^/]+)$/u;

const escaped = /[^A-Za-z0-9_]/gu;

function isObject(value: Json | undefined): value is JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function keyOf(name: string): string {
  return identifier.test(name) ? name : JSON.stringify(name);
}

function union(types: readonly string[]): string {
  const distinct = [...new Set(types)];
  return distinct.length === 1 ? distinct.join('') : `(${distinct.join(' | ')})`;
}

function intersection(types: readonly string[]): string {
  return types.length === 1 ? types.join('') : `(${types.join(' & ')})`;
}

function namedFor(root: string): Named {
  return (definition) =>
    `${root}_${definition.replaceAll(escaped, (character) => `$${String(character.codePointAt(0))}$`)}`;
}

function definitionsOf(schema: JsonObject): readonly (readonly [string, Json])[] {
  return ['definitions', '$defs'].flatMap((key) => {
    const found = schema[key];
    return isObject(found) ? Object.entries(found) : [];
  });
}

function arrayOf(schema: JsonObject, named: Named): string {
  const items = schema['items'];
  const prefix = schema['prefixItems'];
  const rest = items === undefined ? 'Json' : typeOf(items, named);
  if (!isList(prefix)) {
    return `${rest}[]`;
  }
  const leading = prefix.map((each) => typeOf(each, named));
  return items === false ? `[${leading.join(', ')}]` : `[${[...leading, `...${rest}[]`].join(', ')}]`;
}

function requiredOf(schema: JsonObject): ReadonlySet<Json> {
  const required = schema['required'];
  return new Set(isList(required) ? required : []);
}

function objectOf(schema: JsonObject, named: Named): string {
  const properties = schema['properties'];
  const additional = schema['additionalProperties'];
  if (!isObject(properties)) {
    if (additional === false) {
      return 'Record<string, never>';
    }
    return `{ [key: string]: ${additional === undefined ? 'Json' : typeOf(additional, named)} }`;
  }
  const required = requiredOf(schema);
  const fields = Object.entries(properties).map(
    ([name, property]: readonly [string, Json]) =>
      `${keyOf(name)}${required.has(name) ? '' : '?'}: ${typeOf(property, named)};`,
  );
  return `{ ${[...fields, ...(additional === true ? ['[key: string]: Json;'] : [])].join(' ')} }`;
}

const simpleTypes: ReadonlyMap<Json, string> = new Map([
  ['null', 'null'],
  ['boolean', 'boolean'],
  ['number', 'number'],
  ['integer', 'number'],
  ['string', 'string'],
]);

function kindType(kind: Json, schema: JsonObject, named: Named): string {
  if (kind === 'array') {
    return arrayOf(schema, named);
  }
  return simpleTypes.get(kind) ?? objectOf(schema, named);
}

function kindsOf(schema: JsonObject): readonly Json[] {
  const type = schema['type'];
  if (type !== undefined) {
    return isList(type) ? type : [type];
  }
  if (schema['properties'] !== undefined || schema['additionalProperties'] !== undefined) {
    return ['object'];
  }
  return schema['items'] !== undefined || schema['prefixItems'] !== undefined ? ['array'] : [];
}

function referenceOf(schema: JsonObject, named: Named): readonly string[] {
  const reference = schema['$ref'];
  const name = typeof reference === 'string' ? definitionReference.exec(reference)?.groups?.['name'] : undefined;
  return name === undefined ? [] : [named(name)];
}

function valuesOf(schema: JsonObject): readonly string[] {
  const listed = schema['enum'];
  if (isList(listed)) {
    return [union(listed.map((value) => JSON.stringify(value)))];
  }
  const constant = schema['const'];
  return constant === undefined ? [] : [JSON.stringify(constant)];
}

function baseOf(schema: JsonObject, named: Named): readonly string[] {
  const known = [...referenceOf(schema, named), ...valuesOf(schema)];
  if (known.length > 0) {
    return known;
  }
  if (isObject(schema['not'])) {
    return ['never'];
  }
  const kinds = kindsOf(schema);
  return kinds.length === 0 ? [] : [union(kinds.map((kind) => kindType(kind, schema, named)))];
}

function combinationsOf(schema: JsonObject, named: Named): readonly string[] {
  const alternatives = [schema['anyOf'], schema['oneOf']].flatMap((listed) =>
    isList(listed) ? [union(listed.map((each) => typeOf(each, named)))] : [],
  );
  const all = schema['allOf'];
  return [...alternatives, ...(isList(all) ? all.map((each) => typeOf(each, named)) : [])];
}

function typeOf(schema: Json, named: Named): string {
  if (!isObject(schema)) {
    return schema === true ? 'Json' : 'never';
  }
  const parts = [...baseOf(schema, named), ...combinationsOf(schema, named)];
  return parts.length === 0 ? 'Json' : intersection(parts);
}

export function declarationOf(root: string, schema?: JsonObject): string {
  if (schema === undefined) {
    return `type ${root} = Json;`;
  }
  const named = namedFor(root);
  const definitions = definitionsOf(schema).map(
    ([name, definition]) => `type ${named(name)} = ${typeOf(definition, named)};`,
  );
  return [...definitions, `type ${root} = ${typeOf(schema, named)};`].join('\n');
}

const placeTypes: Readonly<Record<Place, readonly (keyof CheckJob['schemas'])[]>> = {
  computation: ['input', 'output'],
  recall: ['view', 'input', 'output'],
};

const typeNames: Readonly<Record<keyof CheckJob['schemas'], string>> = {
  input: 'Input',
  output: 'Output',
  view: 'View',
};

export function declarationsOf({ module, schemas }: CheckJob): string {
  const types =
    module === undefined ? [] : placeTypes[module.place].map((name) => declarationOf(typeNames[name], schemas[name]));
  const event = module?.place === 'recall' ? [eventDeclaration] : [];
  return [jsonType, ...types, ...event].join('\n');
}
