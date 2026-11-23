import { JsonPointer, Result, type Schema } from 'effect';

import { cutToDescriptionBound, toolBounds } from '../bounds/call-bounds.ts';
import type { ServedTool } from '../bounds/tool-results.ts';
import {
  annotationsOf,
  methods,
  type ApiDocument,
  type DocumentProblem,
  type Method,
  type Operation,
  type Parameter,
  type PathItem,
  type ReadDocument,
} from './api-document.ts';
import {
  answerBecauseOf,
  answersOf,
  bodyOf,
  collected,
  parametersOf,
  type AnswerSchemas,
  type BodyOf,
  type OperationBody,
  type Placed,
} from './api-parameters.ts';
import {
  argumentsOf,
  noPathValues,
  pathProblemsOf,
  pathValueProblemsOf,
  writtenPathOf,
  type PathValues,
} from './document-paths.ts';
import { documentBounds } from './document-reading.ts';
import { bytesOf, componentsOf, inputSchemaOf, oversizedBecause, type Components } from './input-schemas.ts';
import {
  leftOutReasonOf,
  operationNamed,
  requiredHeadersOf,
  unsentMethodsOf,
  type LeftOutOperation,
  type LeftOutReason,
} from './left-out.ts';
import { headersPlacedBy, requirementOf, type Placement, type Presented } from './security-schemes.ts';

interface PathInput {
  readonly name: string;
  readonly in: 'path';
}

export interface QueryInput {
  readonly name: string;
  readonly in: 'query';
  readonly joinsLists: boolean;
}

type ApiInput = PathInput | QueryInput;

export interface ApiOperation {
  readonly tool: ServedTool;
  readonly method: Method;
  readonly path: string;
  readonly inputs: readonly ApiInput[];
  readonly body: OperationBody | null;
  readonly credentials: readonly Placement[];
  readonly answers: AnswerSchemas;
}

export interface DerivedTools {
  readonly operations: readonly ApiOperation[];
  readonly leftOut: readonly LeftOutOperation[];
}

interface Located {
  readonly method: Method;
  readonly path: string;
  readonly written: string;
  readonly item: Placed<PathItem>;
  readonly operation: Placed<Operation>;
}

interface Offered {
  readonly operation: ApiOperation;
  readonly pointer: string;
}

type Derived =
  | { readonly kind: 'offered'; readonly offered: Offered }
  | { readonly kind: 'left_out'; readonly leftOut: LeftOutOperation };

type Deriving<A> = Result.Result<A, readonly DocumentProblem[]>;

interface Context {
  readonly components: Components;
  readonly presented: Presented;
  readonly pathValues: PathValues;
}

interface Sent extends Pick<ApiOperation, 'credentials' | 'answers'> {
  readonly parameters: readonly Placed<Parameter>[];
  readonly body: BodyOf;
}

const outsideToolNames = /[^A-Za-z0-9_.-]/gu;

const mostToolNameCharacters = 128;

function derivedName(method: Method, path: string): string {
  const segments = path
    .replace(/^\//u, '')
    .replaceAll(/\{([^{}]*)\}/gu, '$1')
    .replaceAll('/', '_');
  return `${method}_${segments}`.toLowerCase();
}

function toolNameOf({ method, path, operation }: Located): string {
  const given = operation.value.operationId?.trim() ?? '';
  const written = given === '' ? derivedName(method, path) : given;
  return written.replaceAll(outsideToolNames, '_').slice(0, mostToolNameCharacters);
}

function descriptionOf({ summary, description }: Operation): string | undefined {
  const written = [summary, description].flatMap((each) =>
    each === undefined || each.trim() === '' ? [] : [each.trim()],
  );
  return written.length === 0 ? undefined : cutToDescriptionBound(written.join('\n\n'));
}

function inputOf({ name, in: place, explode }: Parameter): readonly ApiInput[] {
  if (place === 'path') {
    return [{ name, in: 'path' }];
  }
  return place === 'query' ? [{ name, in: 'query', joinsLists: explode === false }] : [];
}

function inputsOf(parameters: readonly Placed<Parameter>[]): readonly ApiInput[] {
  return parameters.flatMap(({ value }) => inputOf(value));
}

function namedOperation({ method, path, operation }: Located): string {
  return operationNamed(method.toUpperCase(), path, operation.value);
}

function operationBodyOf(body: BodyOf): OperationBody | null {
  if (body.kind === 'json') {
    return { kind: 'json', mediaType: body.body.mediaType, required: body.body.required };
  }
  return body.kind === 'other' ? { ...body.body.sent, required: body.body.required } : null;
}

function offeredOf(located: Located, inputSchema: Schema.JsonObject, sent: Sent): Offered {
  const { parameters, body, credentials, answers } = sent;
  const description = descriptionOf(located.operation.value);
  const tool: ServedTool = {
    name: toolNameOf(located),
    ...(description === undefined ? {} : { description }),
    inputSchema,
    annotations: annotationsOf(located.method),
  };
  return {
    operation: {
      tool,
      method: located.method,
      path: located.written,
      inputs: inputsOf(parameters),
      body: operationBodyOf(body),
      credentials,
      answers,
    },
    pointer: located.operation.pointer,
  };
}

function leftOut(located: Located, reason: LeftOutReason): Derived {
  return { kind: 'left_out', leftOut: { operation: namedOperation(located), ...reason } };
}

function derivedAt(read: ReadDocument, context: Context, located: Located): Deriving<Derived> {
  const { components, presented, pathValues } = context;
  const parameters = Result.map(parametersOf(read.document, located.item, located.operation), (each) =>
    argumentsOf(each, pathValues),
  );
  const body = bodyOf(read, located.operation);
  if (Result.isFailure(parameters) || Result.isFailure(body)) {
    return Result.fail([
      ...(Result.isFailure(parameters) ? parameters.failure : []),
      ...(Result.isFailure(body) ? body.failure : []),
    ]);
  }
  const unnamed = requiredHeadersOf(parameters.success).filter((header) => !presented.headers.has(header));
  const requirement = requirementOf(read.document, located.operation.value, presented, new Set(unnamed));
  const placed = headersPlacedBy(requirement).map((name) => name.toLowerCase());
  const reason = leftOutReasonOf(located.method, parameters.success, body.success, {
    components,
    sentHeaders: new Set([...presented.headers, ...placed]),
  });
  if (reason !== undefined) {
    return Result.succeed(leftOut(located, reason));
  }
  const answerBecause = answerBecauseOf(read.document, located.operation);
  if (answerBecause !== undefined) {
    return Result.succeed(leftOut(located, { because: answerBecause }));
  }
  if (requirement.kind === 'unmet') {
    return Result.succeed(leftOut(located, { because: requirement.because }));
  }
  const answers = answersOf(read, located.operation, components.definitions);
  const sent = { parameters: parameters.success, body: body.success, credentials: requirement.placements, answers };
  return Result.map(inputSchemaOf(read.version, components, parameters.success, body.success), (inputSchema) => {
    const oversized = oversizedBecause(inputSchema);
    return oversized === undefined
      ? { kind: 'offered', offered: offeredOf(located, inputSchema.schema, sent) }
      : leftOut(located, { because: oversized });
  });
}

function locatedIn(document: ApiDocument, pathValues: PathValues): readonly Located[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]: readonly [string, PathItem]) => {
    const pointer = `/paths/${JsonPointer.escapeToken(path)}`;
    return methods.flatMap((method) => {
      const operation = item[method];
      return operation === undefined
        ? []
        : [
            {
              method,
              path,
              written: writtenPathOf(path, pathValues),
              item: { value: item, pointer },
              operation: { value: operation, pointer: `${pointer}/${method}` },
            },
          ];
    });
  });
}

function collisionsOf(offered: readonly Offered[]): readonly DocumentProblem[] {
  const first = new Map<string, string>();
  return offered.flatMap(({ operation, pointer }) => {
    const earlier = first.get(operation.tool.name);
    if (earlier === undefined) {
      first.set(operation.tool.name, pointer);
      return [];
    }
    return [
      {
        pointer,
        detail: `The tool name ${operation.tool.name} is the name of the operation at ${earlier} too; give one of them another operationId`,
      },
    ];
  });
}

function listingProblemsOf(offered: readonly Offered[]): readonly DocumentProblem[] {
  const bytes = bytesOf({ tools: offered.map(({ operation }) => operation.tool) });
  return bytes > toolBounds.httpAnswerBytes
    ? [
        {
          pointer: '/paths',
          detail: `The tools of the document take ${bytes} bytes as a listing, more than the ${toolBounds.httpAnswerBytes} bytes a listing of a tool server's tools may take`,
        },
      ]
    : [];
}

function toolsOf(derived: readonly Derived[], unsentMethods: readonly LeftOutOperation[]): Deriving<DerivedTools> {
  const offered = derived.flatMap((each) => (each.kind === 'offered' ? [each.offered] : []));
  const problems = [...collisionsOf(offered), ...listingProblemsOf(offered)];
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({
        operations: offered.map(({ operation }) => operation),
        leftOut: [...derived.flatMap((each) => (each.kind === 'left_out' ? [each.leftOut] : [])), ...unsentMethods],
      });
}

export function derivedTools(
  read: ReadDocument,
  presented: Presented,
  pathValues: PathValues = noPathValues,
): Deriving<DerivedTools> {
  const located = locatedIn(read.document, pathValues);
  if (located.length > documentBounds.operations) {
    return Result.fail([
      {
        pointer: '/paths',
        detail: `The document holds ${located.length} operations, more than the ${documentBounds.operations} a tool server may offer`,
      },
    ]);
  }
  const misplaced = [...pathProblemsOf(read.document), ...pathValueProblemsOf(read.document, pathValues)];
  if (misplaced.length > 0) {
    return Result.fail(misplaced);
  }
  return Result.flatMap(componentsOf(read), (components) => {
    const derived = collected(located, (each) => derivedAt(read, { components, presented, pathValues }, each));
    return Result.flatMap(derived, (each) => toolsOf(each, unsentMethodsOf(read.document)));
  });
}
