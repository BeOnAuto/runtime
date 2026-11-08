import { pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { schemaNodes, type Path, type SchemaNode } from './schema-nodes.ts';

export interface PortabilityIssue extends SchemaIssue {
  readonly providers: readonly string[];
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

function rootIssues(root: Schema.JsonObject): readonly PortabilityIssue[] {
  return root['type'] === 'object'
    ? []
    : portabilityIssue(['type'], 'The root of the schema should be "type": "object"', objectAtRoot);
}

function boundIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  return boundKeywords
    .filter((keyword) => schema[keyword] !== undefined)
    .flatMap((keyword) =>
      portabilityIssue(
        [...path, keyword],
        `${keyword} is not enforced while Anthropic models write a tool's arguments; arguments outside it reach the tool, which may refuse them`,
        anthropicModels,
      ),
    );
}

function oneOfIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  return schema['oneOf'] === undefined
    ? []
    : portabilityIssue(
        [...path, 'oneOf'],
        "oneOf is not enforced while Anthropic models write a tool's arguments; arguments matching more than one branch reach the tool, which may refuse them",
        anthropicModels,
      );
}

function formatIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  const format = schema['format'];
  return format === undefined || anthropicFormats.has(format)
    ? []
    : portabilityIssue([...path, 'format'], 'Anthropic models do not accept this format', anthropicModels);
}

const toolInputRules: readonly ((node: SchemaNode) => readonly PortabilityIssue[])[] = [
  boundIssues,
  oneOfIssues,
  formatIssues,
];

export function toolInputPortabilityOf(root: Schema.JsonObject): readonly PortabilityIssue[] {
  return [...rootIssues(root), ...schemaNodes(root).flatMap((node) => toolInputRules.flatMap((rule) => rule(node)))];
}
