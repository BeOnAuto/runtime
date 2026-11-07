import type { Schema } from 'effect';

import { acceptsNull, entriesOf, enumValuesOf, stringsOf, typesOf, type Definitions } from './schema-definitions.ts';
import type { Path } from './schema-nodes.ts';

export interface ValueFacts {
  readonly node: Schema.JsonObject;
  readonly types: readonly string[];
  readonly values: readonly Schema.Json[] | undefined;
  readonly describesObject: boolean;
}

export interface Flag {
  readonly below: Path;
  readonly detail: string;
}

type ValueRule = (facts: ValueFacts, definitions: Definitions) => readonly Flag[];

function flagged(detail: string, below: Path = []): readonly Flag[] {
  return [{ below, detail }];
}

const anyValue: ValueRule = ({ types, values, describesObject }) =>
  types.length === 0 && values === undefined && !describesObject ? flagged('a value of any type') : [];

const anyObject: ValueRule = ({ node, describesObject }) => {
  const open = node['properties'] === undefined && node['additionalProperties'] !== false;
  return describesObject && open ? flagged('an object of any keys and values') : [];
};

const anyItems: ValueRule = ({ node, types }) =>
  types.includes('array') && node['items'] === undefined ? flagged('a list whose items may be of any type') : [];

const mixedEnum: ValueRule = ({ values }) => {
  const kinds = new Set((values ?? []).filter((value) => value !== null).map((value) => typeof value));
  return kinds.size > 1 ? flagged(`an enum that mixes kinds of value (${[...kinds].join(', ')})`) : [];
};

const missingProperties: ValueRule = ({ node, describesObject }) => {
  const named = new Set(entriesOf(node['properties']).map(([name]) => name));
  const missing = stringsOf(node['required']).filter((name) => !named.has(name));
  return describesObject && missing.length > 0
    ? flagged(`required names with no schema in properties: ${missing.join(', ')}`, ['required'])
    : [];
};

const countedBesideNulls: ValueRule = ({ node, describesObject }, definitions) => {
  const counted = node['minProperties'] !== undefined || node['maxProperties'] !== undefined;
  const required = new Set(stringsOf(node['required']));
  const nullableOptional = entriesOf(node['properties']).some(
    ([name, property]) => !required.has(name) && acceptsNull(definitions, property),
  );
  return describesObject && counted && nullableOptional
    ? flagged('a count of properties beside optional properties that may be null')
    : [];
};

const valueRules: readonly ValueRule[] = [
  anyValue,
  anyObject,
  anyItems,
  mixedEnum,
  missingProperties,
  countedBesideNulls,
];

export function valueFactsOf(node: Schema.JsonObject): ValueFacts {
  const types = typesOf(node);
  return {
    node,
    types,
    values: enumValuesOf(node),
    describesObject: types.includes('object') || node['properties'] !== undefined,
  };
}

export function valueFlags(facts: ValueFacts, definitions: Definitions): readonly Flag[] {
  return valueRules.flatMap((rule) => rule(facts, definitions));
}
