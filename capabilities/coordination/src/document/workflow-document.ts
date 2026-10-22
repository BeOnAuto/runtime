import { readYaml, type LocatedProblem, type Position, type YamlKind } from '@on.auto/config';
import { runnableExpression, type PlaybookOwnNames, type StrippedForms } from '@on.auto/definitions';
import { compileJsonSchema, type CompiledSchema } from '@on.auto/json-schema';
import { InvalidInput, type Issue } from '@on.auto/operations';
import {
  durationLimitRejections,
  entriesOf,
  isList,
  isObject,
  mostValueDepth,
  nestingRejections,
  objectField,
  pointerTo,
  workflowExpressionsOf,
  type Json,
  type JsonEntry,
  type JsonObject,
  type Rejection,
} from '@on.auto/workflow-engine';
import { Effect, Result } from 'effect';

import { dslProblems } from '../dsl/dsl-validation.ts';
import type { Problem } from '../dsl/schema-problems.ts';
import { workflowPolicyOf, type WorkflowPolicy } from './workflow-functions.ts';
import { outputShapeRejections } from './workflow-output.ts';

const thirtyDays = 2_592_000_000;

export type WorkflowDefinitionDocument = JsonObject;

export interface ReadWorkflow {
  readonly document: WorkflowDefinitionDocument;
  readonly inputSchema?: CompiledSchema;
  readonly locate: (pointer: string) => Position;
}

type CompiledInput = Result.Result<Pick<ReadWorkflow, 'inputSchema'>, readonly Problem[]>;

const workflowYaml: YamlKind = {
  noun: 'a workflow document',
  mapping: 'A workflow document is a YAML mapping, with document and do at its top',
  mostDepth: mostValueDepth,
  emptyIsMapping: false,
};

export interface LocatedIssue {
  readonly position: Position;
  readonly detail: string;
}

export const notRunnable = 'The workflow document is not a workflow this runtime runs';

export function inlineSchemaOf(document: JsonObject, part: 'input' | 'output'): JsonObject | undefined {
  return objectField(objectField(objectField(document, part) ?? {}, 'schema') ?? {}, 'document');
}

const inputSchemaPlace = '/input/schema/';

function compiledInputOf(document: JsonObject, rejections: readonly Rejection[]): CompiledInput {
  const schema = inlineSchemaOf(document, 'input');
  if (schema === undefined || rejections.some(({ pointer }) => pointer.startsWith(inputSchemaPlace))) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(schema, { what: 'input', nesting: mostValueDepth }), {
    onSuccess: (inputSchema) => ({ inputSchema }),
    onFailure: (issues) =>
      issues.map(({ pointer, detail }) => ({ pointer: `${inputSchemaPlace}document${pointer}`, detail })),
  });
}

function refusedIn(locate: ReadWorkflow['locate']) {
  return (problems: readonly Problem[]): Effect.Effect<never, InvalidInput> =>
    Effect.fail(
      invalidDocument(
        notRunnable,
        problems.map(({ pointer, detail }) => ({ position: locate(pointer), detail: `${placeOf(pointer)}${detail}` })),
      ),
    );
}

function readWorkflowDocument(
  source: string,
  policy: WorkflowPolicy,
  mostDuration = thirtyDays,
): Effect.Effect<ReadWorkflow, InvalidInput> {
  return Effect.suspend(() => {
    const reading = readYaml(source, workflowYaml);
    if ('problems' in reading) {
      return Effect.fail(invalidDocument('The workflow document is not YAML this runtime reads', reading.problems));
    }
    const { value, locate } = reading.document;
    const rejections = policy(value);
    const unreadable =
      nestingRejections(value).length > 0 || rejections.some(({ pointer }) => pointer === '/document/dsl');
    return Effect.flatMap(unreadable ? Effect.succeed([]) : dslProblemsBeside(value, rejections), (dsl) => {
      const found: readonly Problem[] = [
        ...dsl,
        ...rejections,
        ...(unreadable ? [] : durationLimitRejections(value, mostDuration)),
        ...outputShapeRejections(value),
      ];
      const refused = refusedIn(locate);
      return Result.match(compiledInputOf(value, rejections), {
        onFailure: (issues) => refused([...found, ...issues]),
        onSuccess: (input) =>
          found.length === 0 ? Effect.succeed({ document: value, ...input, locate }) : refused(found),
      });
    });
  });
}

function dslProblemsBeside(document: JsonObject, rejections: readonly Rejection[]): Effect.Effect<readonly Problem[]> {
  return Effect.map(
    Effect.promise(() => dslProblems(document, { connecting: rejections.length === 0 })),
    (problems) => problems.filter((problem) => !isShadowed(problem, rejections)),
  );
}

export function workflowReaderOf(
  names: PlaybookOwnNames,
): (source: string, mostDuration?: number) => Effect.Effect<ReadWorkflow, InvalidInput> {
  const policy = workflowPolicyOf(names);
  return (source, mostDuration) => readWorkflowDocument(source, policy, mostDuration);
}

export function parseWorkflowDocument(
  source: string,
  policy: WorkflowPolicy,
  mostDuration = thirtyDays,
): Effect.Effect<WorkflowDefinitionDocument, InvalidInput> {
  return Effect.map(readWorkflowDocument(source, policy, mostDuration), ({ document }) => document);
}

function isShadowed({ pointer }: Problem, rejections: readonly Rejection[]): boolean {
  return rejections.some(
    (rejection) =>
      rejection.pointer === pointer ||
      pointer.startsWith(`${rejection.pointer}/`) ||
      (pointer !== '' && rejection.pointer.startsWith(`${pointer}/`)),
  );
}

export function placeOf(pointer: string): string {
  return pointer === '' ? '' : `at ${pointer}: `;
}

export function invalidDocument(detail: string, problems: readonly (LocatedProblem | LocatedIssue)[]): InvalidInput {
  const issues: readonly Issue[] = problems
    .toSorted((left, right) =>
      left.position.line === right.position.line
        ? left.position.column - right.position.column
        : left.position.line - right.position.line,
    )
    .map(({ position, detail: problem }) => ({
      detail: `Line ${position.line}, column ${position.column}: ${problem}`,
      pointer: '',
    }));
  return new InvalidInput({ detail, issues });
}

type Replacements = ReadonlyMap<string, (text: string) => string>;

function runnableObject(object: JsonObject, pointer: string, replacements: Replacements): JsonObject {
  return Object.fromEntries(
    entriesOf(object).map(([key, item]: JsonEntry) => [key, runnableAt(item, pointerTo(pointer, key), replacements)]),
  );
}

function runnableAt(value: Json, pointer: string, replacements: Replacements): Json {
  const replace = replacements.get(pointer);
  if (replace !== undefined && typeof value === 'string') {
    return replace(value);
  }
  if (isList(value)) {
    return value.map((item, index) => runnableAt(item, pointerTo(pointer, index), replacements));
  }
  return isObject(value) ? runnableObject(value, pointer, replacements) : value;
}

export function runnableDocument(
  document: WorkflowDefinitionDocument,
  stripped: StrippedForms,
): WorkflowDefinitionDocument {
  const replacements: Replacements = new Map(
    workflowExpressionsOf(document).flatMap(({ pointer, source }) => {
      const javascript = runnableExpression(stripped, source);
      return javascript === source
        ? []
        : [[pointer, (text: string) => text.replace(source, () => javascript)] as const];
    }),
  );
  return replacements.size === 0 ? document : runnableObject(document, '', replacements);
}
