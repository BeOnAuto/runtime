import { JsonPointer, Predicate, Result, type Schema } from 'effect';

import type {
  ApiDocument,
  ApiResponse,
  DocumentProblem,
  Operation,
  Parameter,
  ParameterOrReference,
  PathItem,
  ReadDocument,
  RequestBody,
  RequestBodyOrReference,
  ResponseOrReference,
} from './api-document.ts';
import { standaloneOf, translatedSchema } from './schema-translation.ts';

export interface AnswerSchemas {
  readonly schemas: readonly Schema.Json[];
  readonly components: Readonly<Record<string, Schema.Json>>;
}

export const unschemedAnswers: AnswerSchemas = { schemas: [], components: {} };

export interface Placed<A> {
  readonly value: A;
  readonly pointer: string;
}

export interface JsonBody {
  readonly mediaType: string;
  readonly required: boolean;
  readonly schema: Schema.Json;
  readonly pointer: string;
}

export type BodyOf =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly body: JsonBody }
  | { readonly kind: 'other'; readonly mediaType: string };

type Resolved<A> = Result.Result<A, readonly DocumentProblem[]>;

const mostReferenceHops = 8;

const jsonMediaType = /^application\/(?:[\w.-]+\+)?json$/u;

const successStatus = /^2(?:\d\d|XX)$/u;

function isJson(mediaType: string): boolean {
  return jsonMediaType.test(mediaType.split(';', 1).join('').trim().toLowerCase());
}

function componentOf<A>(
  reference: string,
  kind: 'parameters' | 'requestBodies' | 'responses',
  entries: Readonly<Record<string, A>> | undefined,
): A | undefined {
  const prefix = `#/components/${kind}/`;
  const name = reference.startsWith(prefix) ? JsonPointer.unescapeToken(reference.slice(prefix.length)) : undefined;
  return name === undefined || entries === undefined || !Object.hasOwn(entries, name) ? undefined : entries[name];
}

interface Reference {
  readonly $ref: string;
}

function isReference(value: object): value is Reference {
  return Predicate.hasProperty(value, '$ref') && typeof value.$ref === 'string';
}

function followed<A extends object>(
  written: A | Reference,
  pointer: string,
  lookUp: (reference: string) => A | Reference | undefined,
): Resolved<Placed<A>> {
  let current: A | Reference = written;
  let at = pointer;
  for (let hops = 0; hops <= mostReferenceHops; hops += 1) {
    if (!isReference(current)) {
      return Result.succeed({ value: current, pointer: at });
    }
    const next = lookUp(current.$ref);
    if (next === undefined) {
      return Result.fail([{ pointer: `${at}/$ref`, detail: 'A reference to a component the document does not have' }]);
    }
    at = current.$ref.slice(1);
    current = next;
  }
  return Result.fail([{ pointer, detail: `A reference that leads through more than ${mostReferenceHops} others` }]);
}

function parameterAt(
  document: ApiDocument,
  written: ParameterOrReference,
  pointer: string,
): Resolved<Placed<Parameter>> {
  return followed(written, pointer, (reference) =>
    componentOf(reference, 'parameters', document.components?.parameters),
  );
}

export function collected<I, A>(items: readonly I[], resolve: (item: I) => Resolved<A>): Resolved<readonly A[]> {
  const problems: DocumentProblem[] = [];
  const values: A[] = [];
  for (const item of items) {
    const resolved = resolve(item);
    if (Result.isFailure(resolved)) {
      problems.push(...resolved.failure);
    } else {
      values.push(resolved.success);
    }
  }
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(values);
}

export function parametersOf(
  document: ApiDocument,
  item: Placed<PathItem>,
  operation: Placed<Operation>,
): Resolved<readonly Placed<Parameter>[]> {
  const shared: readonly Placed<ParameterOrReference>[] = (item.value.parameters ?? []).map((value, index) => ({
    value,
    pointer: `${item.pointer}/parameters/${index}`,
  }));
  const own: readonly Placed<ParameterOrReference>[] = (operation.value.parameters ?? []).map((value, index) => ({
    value,
    pointer: `${operation.pointer}/parameters/${index}`,
  }));
  const resolved = collected([...shared, ...own], ({ value, pointer }) => parameterAt(document, value, pointer));
  return Result.map(resolved, (parameters) => {
    const byPlace = new Map(parameters.map((each) => [`${each.value.in}\u0000${each.value.name}`, each]));
    return [...byPlace.values()];
  });
}

function bodyIn(body: Placed<RequestBody>): BodyOf {
  const entries = Object.entries(body.value.content);
  const json = entries.find(([mediaType]: readonly [string, unknown]) => isJson(mediaType));
  if (json !== undefined) {
    const [mediaType, { schema = {} }] = json;
    const pointer = `${body.pointer}/content/${JsonPointer.escapeToken(mediaType)}/schema`;
    return { kind: 'json', body: { mediaType, required: body.value.required === true, schema, pointer } };
  }
  const other = entries.map(([mediaType]: readonly [string, unknown]) => mediaType).at(0);
  return other === undefined ? { kind: 'none' } : { kind: 'other', mediaType: other };
}

export function bodyOf(document: ApiDocument, operation: Placed<Operation>): Resolved<BodyOf> {
  const written: RequestBodyOrReference | undefined = operation.value.requestBody;
  if (written === undefined) {
    return Result.succeed({ kind: 'none' });
  }
  return Result.map(
    followed(written, `${operation.pointer}/requestBody`, (reference) =>
      componentOf(reference, 'requestBodies', document.components?.requestBodies),
    ),
    bodyIn,
  );
}

function responseAt(document: ApiDocument, written: ResponseOrReference, pointer: string): readonly ApiResponse[] {
  const followedResponse = followed(written, pointer, (reference) =>
    componentOf(reference, 'responses', document.components?.responses),
  );
  return Result.isSuccess(followedResponse) ? [followedResponse.success.value] : [];
}

function answerSchemasOf(document: ApiDocument, operation: Placed<Operation>): readonly Schema.Json[] {
  return Object.entries(operation.value.responses ?? {})
    .filter(([status]: readonly [string, ResponseOrReference]) => successStatus.test(status))
    .flatMap(([status, written]: readonly [string, ResponseOrReference]) =>
      responseAt(document, written, `${operation.pointer}/responses/${status}`),
    )
    .flatMap(({ content = {} }) =>
      Object.entries(content).flatMap(
        ([mediaType, { schema }]: readonly [string, { readonly schema?: Schema.Json }]) =>
          isJson(mediaType) && schema !== undefined ? [schema] : [],
      ),
    );
}

export function answersOf(
  { version, document }: ReadDocument,
  operation: Placed<Operation>,
  definitions: AnswerSchemas['components'],
): AnswerSchemas {
  return {
    schemas: answerSchemasOf(document, operation).map(
      (schema) => standaloneOf(translatedSchema(schema, version), operation.pointer).schema,
    ),
    components: definitions,
  };
}
