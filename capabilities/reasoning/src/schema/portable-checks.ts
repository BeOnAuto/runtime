import { pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import {
  definitionsOf,
  entriesOf,
  isJsonObject,
  listOf,
  stringsOf,
  typesOf,
  type Definitions,
} from './schema-definitions.ts';
import type { Path } from './schema-nodes.ts';

export interface Budget {
  readonly unions: number;
  readonly depth: number;
  readonly properties: number;
  readonly enumValues: number;
  readonly characters: number;
}

export const portableBudget: Budget = {
  unions: 16,
  depth: 10,
  properties: 5000,
  enumValues: 1000,
  characters: 120_000,
};

const nothingCounted: Budget = { unions: 0, depth: 0, properties: 0, enumValues: 0, characters: 0 };

const portableKeywords: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
  '$ref',
  'description',
]);

function charactersOf(texts: readonly Schema.Json[]): number {
  return texts.reduce<number>((sum, text) => sum + (typeof text === 'string' ? text.length : 0), 0);
}

function isUnion(node: Schema.JsonObject): boolean {
  return typesOf(node).length > 1 || node['anyOf'] !== undefined;
}

function ownCount(node: Schema.JsonObject): Budget {
  const names = entriesOf(node['properties']).map(([name]) => name);
  const values = listOf(node['enum']);
  return {
    unions: isUnion(node) ? 1 : 0,
    depth: isJsonObject(node['properties']) ? 1 : 0,
    properties: names.length,
    enumValues: values.length,
    characters: charactersOf(names) + charactersOf(values),
  };
}

function added(one: Budget, other: Budget): Budget {
  return {
    unions: one.unions + other.unions,
    depth: Math.max(one.depth, other.depth),
    properties: one.properties + other.properties,
    enumValues: one.enumValues + other.enumValues,
    characters: one.characters + other.characters,
  };
}

interface Counting {
  readonly definitions: Definitions;
  readonly counted: Map<string, Budget>;
}

function countedReference(reference: string, counting: Counting): Budget {
  const known = counting.counted.get(reference);
  if (known !== undefined) {
    return known;
  }
  counting.counted.set(reference, nothingCounted);
  const counted = countedIn(counting.definitions.get(reference), counting);
  counting.counted.set(reference, counted);
  return counted;
}

function countedIn(node: Schema.Json | undefined, counting: Counting): Budget {
  if (!isJsonObject(node)) {
    return nothingCounted;
  }
  const reference = node['$ref'];
  if (typeof reference === 'string') {
    return countedReference(reference, counting);
  }
  const children = [
    ...entriesOf(node['properties']).map(([, property]) => property),
    ...listOf(node['anyOf']),
    node['items'],
  ];
  const own = ownCount(node);
  const below = children
    .map((child) => countedIn(child, counting))
    .reduce((sum, counted) => added(sum, counted), nothingCounted);
  return { ...added(own, below), depth: own.depth + below.depth };
}

export function budgetOf(sent: Schema.JsonObject): Budget {
  return countedIn(sent, { definitions: definitionsOf(sent), counted: new Map() });
}

const budgetWords: Readonly<Record<keyof Budget, (count: number, most: number) => string>> = {
  unions: (count, most) =>
    `${count} fields that may be null or are a choice of types, counted where each definition is used (most ${most})`,
  depth: (count, most) => `${count} levels of objects (most ${most})`,
  properties: (count, most) => `${count} properties (most ${most})`,
  enumValues: (count, most) => `${count} enum values (most ${most})`,
  characters: (count, most) => `${count} characters of names and enum values (most ${most})`,
};

const budgetRewrites: Readonly<Record<keyof Budget, string>> = {
  unions: 'make some of these fields required and of one type, or split the answer',
  depth: 'nest fewer levels of objects, or split the answer',
  properties: 'split the answer',
  enumValues: 'list fewer enum values, or split the answer',
  characters: 'use shorter names and enum values, or split the answer',
};

const measures: readonly (keyof Budget)[] = ['unions', 'depth', 'properties', 'enumValues', 'characters'];

export interface NotPortableIssue extends SchemaIssue {
  readonly rewrite?: string;
}

export function overBudget(budget: Budget): readonly NotPortableIssue[] {
  return measures.flatMap((measure) => {
    const count = budget[measure];
    const most = portableBudget[measure];
    return count > most
      ? [{ pointer: '', detail: budgetWords[measure](count, most), rewrite: budgetRewrites[measure] }]
      : [];
  });
}

function issueAt(path: Path, detail: string): readonly SchemaIssue[] {
  return [{ pointer: pointerOf(path), detail }];
}

function keywordIssues(node: Schema.JsonObject, path: Path): readonly SchemaIssue[] {
  return Object.keys(node)
    .filter((keyword) => !portableKeywords.has(keyword))
    .flatMap((keyword) => issueAt([...path, keyword], `${keyword} is not a keyword of the portable form`));
}

function aloneIssues(node: Schema.JsonObject, path: Path, sentDefinitions: Definitions): readonly SchemaIssue[] {
  const reference = node['$ref'];
  if (reference !== undefined) {
    const besides = Object.keys(node).length > 1 ? issueAt(path, 'a $ref with keywords beside it') : [];
    const target =
      typeof reference === 'string' && sentDefinitions.has(reference)
        ? []
        : issueAt(path, 'a $ref to no definition sent');
    return [...besides, ...target];
  }
  if (node['anyOf'] !== undefined) {
    const besides = Object.keys(node).some((keyword) => keyword !== 'anyOf' && keyword !== 'description');
    return besides ? issueAt(path, 'an anyOf with keywords beside it') : [];
  }
  return node['type'] === undefined ? issueAt(path, 'a schema with no type') : [];
}

function objectIssues(node: Schema.JsonObject, path: Path): readonly SchemaIssue[] {
  const properties = node['properties'];
  const names = Object.keys(isJsonObject(properties) ? properties : {});
  const required = stringsOf(node['required']);
  const everyRequired = names.length === required.length && names.every((name) => required.includes(name));
  return [
    ...(isJsonObject(properties) ? [] : issueAt(path, 'an object with no properties')),
    ...(everyRequired ? [] : issueAt(path, 'an object whose required list is not every property')),
    ...(node['additionalProperties'] === false ? [] : issueAt(path, 'an object that is not closed')),
  ];
}

interface Child {
  readonly schema: Schema.Json;
  readonly path: Path;
}

function childrenOf(node: Schema.JsonObject, path: Path): readonly Child[] {
  const items = node['items'];
  return [
    ...entriesOf(node['properties']).map(([name, schema]) => ({ schema, path: [...path, 'properties', name] })),
    ...listOf(node['anyOf']).map((schema, index) => ({ schema, path: [...path, 'anyOf', index] })),
    ...(items === undefined ? [] : [{ schema: items, path: [...path, 'items'] }]),
  ];
}

function nodeIssues(node: Schema.Json, path: Path, sentDefinitions: Definitions): readonly SchemaIssue[] {
  if (!isJsonObject(node)) {
    return issueAt(path, 'a schema that is not an object');
  }
  const types = typesOf(node);
  return [
    ...keywordIssues(node, path),
    ...aloneIssues(node, path, sentDefinitions),
    ...(types.includes('object') ? objectIssues(node, path) : []),
    ...(types.includes('array') && !isJsonObject(node['items']) ? issueAt(path, 'a list with no item schema') : []),
    ...childrenOf(node, path).flatMap((child) => nodeIssues(child.schema, child.path, sentDefinitions)),
  ];
}

export function portableIssues(sent: Schema.JsonObject): readonly SchemaIssue[] {
  const { $defs: definitions, ...root } = sent;
  const sentDefinitions = definitionsOf(sent);
  const oneObject = root['type'] === 'object' && root['anyOf'] === undefined;
  return [
    ...(oneObject ? [] : issueAt([], 'a root that is not one object')),
    ...nodeIssues(root, [], sentDefinitions),
    ...entriesOf(definitions).flatMap(([name, schema]) => nodeIssues(schema, ['$defs', name], sentDefinitions)),
  ];
}
