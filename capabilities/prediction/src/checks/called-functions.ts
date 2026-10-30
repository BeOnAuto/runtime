import type { SavedDefinition, SavedDefinitions } from '@on.auto/definitions';
import { issueAt, type DocumentIssue } from '@on.auto/definitions/document';
import { compileJsonSchema } from '@on.auto/json-schema';
import { Effect, Result, type Schema } from 'effect';

import { isMapping } from '../document/checked-parts.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

interface Called {
  readonly name: string;
  readonly pointer: string;
  readonly purpose: string;
  readonly input: Schema.Json;
  readonly inputWords: string;
  readonly outputFits: (schema: Schema.JsonObject) => boolean;
  readonly outputWords: string;
}

const interactionType = 'interaction';

function propertyOf(schema: Schema.JsonObject, name: string): Schema.JsonObject | undefined {
  const properties = schema['properties'];
  const property = isMapping(properties) ? properties[name] : undefined;
  return isMapping(property) ? property : undefined;
}

function sameMembers(found: Schema.Json | undefined, expected: readonly string[]): boolean {
  return Array.isArray(found) && found.length === expected.length && expected.every((member) => found.includes(member));
}

function takesADecision(schema: Schema.JsonObject): boolean {
  const decision = propertyOf(schema, 'decision');
  return (
    schema['type'] === 'object' &&
    sameMembers(schema['required'], ['decision']) &&
    sameMembers(decision?.['enum'], ['approve', 'reject'])
  );
}

function takesCandidates(schema: Schema.JsonObject): boolean {
  const candidates = propertyOf(schema, 'candidates');
  const items = candidates?.['items'];
  return (
    schema['type'] === 'object' &&
    sameMembers(schema['required'], ['candidates']) &&
    candidates?.['type'] === 'array' &&
    isMapping(items) &&
    items['type'] === 'string'
  );
}

function refusalOf(schema: Schema.JsonObject | undefined, value: Schema.Json): string | undefined {
  if (schema === undefined) {
    return undefined;
  }
  const checked = Result.flatMap(compileJsonSchema(schema, { what: 'input', nesting: 64 }), (compiled) =>
    compiled.validate(value),
  );
  return Result.isSuccess(checked)
    ? undefined
    : checked.failure.map(({ pointer, detail }) => `${pointer === '' ? 'its root' : pointer}: ${detail}`).join('; ');
}

function approvalOf({ evaluation }: PredictionFunctionDefinitionDocument): readonly Called[] {
  const { activate } = evaluation;
  return activate === 'automatic'
    ? []
    : [
        {
          name: activate.approved,
          pointer: '/evaluation/activate/approved',
          purpose: 'approves a version',
          input: { function: 'prediction-function', version: 1, card: {} },
          inputWords: '{ function, version, card }, which an approval is asked with',
          outputFits: takesADecision,
          outputWords: 'an object whose one required property decision is approve or reject',
        },
      ];
}

function sendingOf({ source }: PredictionFunctionDefinitionDocument): readonly Called[] {
  const through = source?.through;
  return through === undefined
    ? []
    : [
        {
          name: through,
          pointer: '/source/through',
          purpose: 'sends a build to its trainer',
          input: { build: {} },
          inputWords: '{ build: {} }, which a build is sent with',
          outputFits: takesCandidates,
          outputWords:
            'an object whose one required property candidates is a list of the SHA-256 of each candidate as text',
        },
      ];
}

function fitIssues(called: Called, saved: SavedDefinition): readonly string[] {
  const refused = refusalOf(saved.inputSchema, called.input);
  const input =
    refused === undefined ? [] : [`The input schema of ${called.name} does not take ${called.inputWords}: ${refused}`];
  const output =
    saved.outputSchema !== undefined && called.outputFits(saved.outputSchema)
      ? []
      : [`The output schema of ${called.name}, the function that ${called.purpose}, is not ${called.outputWords}`];
  return [...input, ...output];
}

function issuesOf(
  called: Called,
  lines: PredictionFunctionDefinitionDocument['lines'],
  saved: SavedDefinitions,
): Effect.Effect<readonly DocumentIssue[]> {
  return Effect.map(saved.active(interactionType, called.name), (found) => {
    const details =
      found === undefined
        ? [`${called.name} is not an active interaction function of this playbook; save it first, or name one that is`]
        : fitIssues(called, found);
    return details.map((detail) => issueAt(lines, called.pointer, detail));
  });
}

export function calledFunctionIssues(
  document: PredictionFunctionDefinitionDocument,
  saved: SavedDefinitions,
): Effect.Effect<readonly DocumentIssue[]> {
  return Effect.map(
    Effect.forEach([...approvalOf(document), ...sendingOf(document)], (called) =>
      issuesOf(called, document.lines, saved),
    ),
    (issues: readonly (readonly DocumentIssue[])[]) => issues.flat(),
  );
}
