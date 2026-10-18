import { isKnownKeyword, pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { schemaNodes, type Path, type SchemaNode } from './schema-nodes.ts';

export interface PortabilityIssue extends SchemaIssue {
  readonly providers: readonly string[];
}

export interface Portability {
  readonly not_portable: readonly PortabilityIssue[];
  readonly unchecked: readonly SchemaIssue[];
}

const anthropicModels = ['anthropic', 'bedrock', 'bedrock-anthropic', 'vertex-anthropic'];
const strictOpenAi = ['openai', 'azure'];
const objectAtRoot = [...anthropicModels, ...strictOpenAi];

const boundKeywords = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

const anthropicFormats: ReadonlySet<Schema.Json> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

function portabilityIssue(path: Path, detail: string, providers: readonly string[]): readonly PortabilityIssue[] {
  return [{ pointer: pointerOf(path), detail, providers }];
}

function describesObject(schema: Schema.JsonObject): boolean {
  const type = schema['type'];
  const types: readonly Schema.Json[] = Array.isArray(type) ? type : [type ?? null];
  return types.includes('object') || schema['properties'] !== undefined;
}

function rootIssues(root: Schema.JsonObject): readonly PortabilityIssue[] {
  return root['type'] === 'object'
    ? []
    : portabilityIssue(['type'], 'The root of the schema should be "type": "object"', objectAtRoot);
}

function closedObjectIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  if (!describesObject(schema) || schema['additionalProperties'] === false) {
    return [];
  }
  return portabilityIssue(
    path,
    'An object should set "additionalProperties": false; strict structured outputs reject open objects',
    strictOpenAi,
  );
}

function requiredKeyIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  const properties = schema['properties'];
  const required = schema['required'];
  const names = properties !== null && typeof properties === 'object' ? Object.keys(properties) : [];
  const requiredNames: readonly Schema.Json[] = Array.isArray(required) ? required : [];
  const optional = names.filter((name) => !requiredNames.includes(name));
  return optional.length === 0
    ? []
    : portabilityIssue(
        [...path, 'required'],
        `Every property should be required (make an optional one nullable instead): ${optional.join(', ')}`,
        strictOpenAi,
      );
}

interface Written {
  readonly unenforcedBound: (keyword: string) => string;
  readonly unenforcedOneOf: string;
}

const answers: Written = {
  unenforcedBound: (keyword) =>
    `${keyword} is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid`,
  unenforcedOneOf:
    'oneOf is sent to Anthropic models as anyOf; an answer matching more than one branch fails as output_invalid',
};

const toolArguments: Written = {
  unenforcedBound: (keyword) =>
    `${keyword} is not enforced while Anthropic models write a tool's arguments; arguments outside it reach the tool, which may refuse them`,
  unenforcedOneOf:
    "oneOf is not enforced while Anthropic models write a tool's arguments; arguments matching more than one branch reach the tool, which may refuse them",
};

function boundIssues({ schema, path }: SchemaNode, written: Written): readonly PortabilityIssue[] {
  return boundKeywords
    .filter((keyword) => schema[keyword] !== undefined)
    .flatMap((keyword) => portabilityIssue([...path, keyword], written.unenforcedBound(keyword), anthropicModels));
}

function oneOfIssues({ schema, path }: SchemaNode, written: Written): readonly PortabilityIssue[] {
  return schema['oneOf'] === undefined
    ? []
    : portabilityIssue([...path, 'oneOf'], written.unenforcedOneOf, anthropicModels);
}

function formatIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  const format = schema['format'];
  return format === undefined || anthropicFormats.has(format)
    ? []
    : portabilityIssue([...path, 'format'], 'Anthropic models do not accept this format', anthropicModels);
}

function uncheckedIssues({ schema, path }: SchemaNode): readonly SchemaIssue[] {
  return Object.keys(schema)
    .filter((keyword) => !isKnownKeyword(keyword))
    .map((keyword) => ({
      pointer: pointerOf([...path, keyword]),
      detail: `${keyword} is not a keyword this package checks; it is sent to the provider as written`,
    }));
}

type NodeRule = (node: SchemaNode, written: Written) => readonly PortabilityIssue[];

const answerRules: readonly NodeRule[] = [closedObjectIssues, requiredKeyIssues, boundIssues, oneOfIssues];

const toolArgumentRules: readonly NodeRule[] = [boundIssues, oneOfIssues, formatIssues];

function notPortable(
  root: Schema.JsonObject,
  nodes: readonly SchemaNode[],
  rules: readonly NodeRule[],
  written: Written,
): readonly PortabilityIssue[] {
  return [...rootIssues(root), ...nodes.flatMap((node) => rules.flatMap((rule) => rule(node, written)))];
}

export function portabilityOf(root: Schema.JsonObject): Portability {
  const nodes = schemaNodes(root);
  return {
    not_portable: notPortable(root, nodes, answerRules, answers),
    unchecked: nodes.flatMap((node) => uncheckedIssues(node)),
  };
}

export function toolInputPortabilityOf(root: Schema.JsonObject): readonly PortabilityIssue[] {
  return notPortable(root, schemaNodes(root), toolArgumentRules, toolArguments);
}
