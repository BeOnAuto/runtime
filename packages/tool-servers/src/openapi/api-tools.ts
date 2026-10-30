import { JsonPointer, Result, type Schema } from 'effect';

import { cutToDescriptionBound, toolBounds } from '../bounds/call-bounds.ts';
import type { ListedTool, ToolAnnotations } from '../bounds/tool-results.ts';
import {
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
  answersOf,
  bodyOf,
  collected,
  parametersOf,
  type AnswerSchemas,
  type BodyOf,
  type JsonBody,
  type Placed,
} from './api-parameters.ts';
import { keepsItsSegments } from './api-requests.ts';
import { documentBounds } from './document-reading.ts';
import { bytesOf, componentsOf, inputSchemaOf, oversizedBecause, type Components } from './input-schemas.ts';
import { leftOutBecause, requiredHeadersOf } from './left-out.ts';
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
  readonly tool: ListedTool;
  readonly method: Method;
  readonly path: string;
  readonly inputs: readonly ApiInput[];
  readonly body: Pick<JsonBody, 'mediaType' | 'required'> | null;
  readonly credentials: readonly Placement[];
  readonly answers: AnswerSchemas;
}

export interface LeftOutOperation {
  readonly operation: string;
  readonly because: string;
}

export interface DerivedTools {
  readonly operations: readonly ApiOperation[];
  readonly leftOut: readonly LeftOutOperation[];
}

interface Located {
  readonly method: Method;
  readonly path: string;
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
}

interface Sent extends Pick<ApiOperation, 'credentials' | 'answers'> {
  readonly parameters: readonly Placed<Parameter>[];
  readonly body: BodyOf;
}

const outsideToolNames = /[^A-Za-z0-9_.-]/gu;

const mostToolNameCharacters = 128;

const notBelowTheBase =
  'Expected a path that begins with /, since a path written otherwise joins the host or the port of base_url and a call would go elsewhere';

const leavesItself =
  'A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it';

const readOnlyMethods: ReadonlySet<Method> = new Set(['get', 'head']);

const idempotentMethods: ReadonlySet<Method> = new Set(['get', 'head', 'put', 'delete']);

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

function annotationsOf(method: Method): ToolAnnotations {
  return {
    ...(readOnlyMethods.has(method) ? { readOnlyHint: true } : {}),
    ...(method === 'delete' ? { destructiveHint: true } : {}),
    ...(idempotentMethods.has(method) ? { idempotentHint: true } : {}),
    openWorldHint: true,
  };
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
  const route = `${method.toUpperCase()} ${path}`;
  const given = operation.value.operationId;
  return given === undefined ? route : `${given} (${route})`;
}

function offeredOf(located: Located, inputSchema: Schema.JsonObject, sent: Sent): Offered {
  const { parameters, body, credentials, answers } = sent;
  const description = descriptionOf(located.operation.value);
  const tool: ListedTool = {
    name: toolNameOf(located),
    ...(description === undefined ? {} : { description }),
    inputSchema,
    annotations: annotationsOf(located.method),
  };
  return {
    operation: {
      tool,
      method: located.method,
      path: located.path,
      inputs: inputsOf(parameters),
      body: body.kind === 'json' ? { mediaType: body.body.mediaType, required: body.body.required } : null,
      credentials,
      answers,
    },
    pointer: located.operation.pointer,
  };
}

function leftOut(located: Located, because: string): Derived {
  return { kind: 'left_out', leftOut: { operation: namedOperation(located), because } };
}

function derivedAt(read: ReadDocument, { components, presented }: Context, located: Located): Deriving<Derived> {
  const parameters = parametersOf(read.document, located.item, located.operation);
  const body = bodyOf(read.document, located.operation);
  if (Result.isFailure(parameters) || Result.isFailure(body)) {
    return Result.fail([
      ...(Result.isFailure(parameters) ? parameters.failure : []),
      ...(Result.isFailure(body) ? body.failure : []),
    ]);
  }
  const unnamed = requiredHeadersOf(parameters.success).filter((header) => !presented.headers.has(header));
  const requirement = requirementOf(read.document, located.operation.value, presented, new Set(unnamed));
  const placed = headersPlacedBy(requirement).map((name) => name.toLowerCase());
  const because = leftOutBecause(located.method, parameters.success, body.success, {
    components,
    sentHeaders: new Set([...presented.headers, ...placed]),
  });
  if (because !== undefined) {
    return Result.succeed(leftOut(located, because));
  }
  if (requirement.kind === 'unmet') {
    return Result.succeed(leftOut(located, requirement.because));
  }
  const answers = answersOf(read, located.operation, components.definitions);
  const sent = { parameters: parameters.success, body: body.success, credentials: requirement.placements, answers };
  return Result.map(inputSchemaOf(read.version, components, parameters.success, body.success), (inputSchema) => {
    const oversized = oversizedBecause(inputSchema);
    return oversized === undefined
      ? { kind: 'offered', offered: offeredOf(located, inputSchema.schema, sent) }
      : leftOut(located, oversized);
  });
}

function locatedIn(document: ApiDocument): readonly Located[] {
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

function toolsOf(derived: readonly Derived[]): Deriving<DerivedTools> {
  const offered = derived.flatMap((each) => (each.kind === 'offered' ? [each.offered] : []));
  const problems = [...collisionsOf(offered), ...listingProblemsOf(offered)];
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({
        operations: offered.map(({ operation }) => operation),
        leftOut: derived.flatMap((each) => (each.kind === 'left_out' ? [each.leftOut] : [])),
      });
}

function pathProblemsOf(document: ApiDocument): readonly DocumentProblem[] {
  return Object.keys(document.paths ?? {}).flatMap((path) => {
    const pointer = `/paths/${JsonPointer.escapeToken(path)}`;
    if (!path.startsWith('/')) {
      return [{ pointer, detail: notBelowTheBase }];
    }
    return keepsItsSegments(path) && !/[?#]/u.test(path) ? [] : [{ pointer, detail: leavesItself }];
  });
}

export function derivedTools(read: ReadDocument, presented: Presented): Deriving<DerivedTools> {
  const located = locatedIn(read.document);
  if (located.length > documentBounds.operations) {
    return Result.fail([
      {
        pointer: '/paths',
        detail: `The document holds ${located.length} operations, more than the ${documentBounds.operations} a tool server may offer`,
      },
    ]);
  }
  const misplaced = pathProblemsOf(read.document);
  if (misplaced.length > 0) {
    return Result.fail(misplaced);
  }
  return Result.flatMap(componentsOf(read), (components) => {
    const derived = collected(located, (each) => derivedAt(read, { components, presented }, each));
    return Result.flatMap(derived, toolsOf);
  });
}
