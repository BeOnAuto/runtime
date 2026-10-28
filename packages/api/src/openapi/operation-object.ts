import {
  catalogPathOf,
  isStreamedBody,
  mediaTypeOfBody,
  takesNoBody,
  type RegisteredAnswer,
  type RouteRegistration,
  type StreamedBody,
} from '@on.auto/operations';

import { selfContainedSchemaOf } from '../tools/tool-schema.ts';
import {
  fieldsOf,
  fieldsOfEveryMember,
  identifiedSchemaOf,
  isUnion,
  schemaOf,
  withoutFields,
  type Field,
} from './operation-schemas.ts';
import { tagOf } from './operation-tags.ts';
import {
  problemAnswersOfOperation,
  referencesTo,
  type OpenApiObject,
  type ProblemAnswer,
} from './problem-responses.ts';

export interface DescribedOperation {
  readonly path: string;
  readonly method: string;
  readonly tag: string;
  readonly operation: OpenApiObject;
  readonly problems: readonly ProblemAnswer[];
}

interface InputParts {
  readonly parameters: readonly OpenApiObject[];
  readonly requestBody?: OpenApiObject;
}

const successWords: Readonly<Record<RouteRegistration['successStatus'], string>> = { 200: 'Succeeded', 201: 'Created' };

function answerOf(registration: RouteRegistration): RegisteredAnswer {
  return registration.servedOverHttpAlone === undefined
    ? { kind: 'json', output: registration.output }
    : registration.answer;
}

function parameterNamesIn(path: string): readonly string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith('{'))
    .map((segment) => segment.slice(1, -1));
}

function parameterOf(place: 'path' | 'query', { name, schema, required }: Field): OpenApiObject {
  return { name, in: place, required, schema };
}

function pathParametersOf(registration: RouteRegistration, input: readonly Field[]): readonly OpenApiObject[] {
  return parameterNamesIn(catalogPathOf(registration)).map((name) => {
    const field = input.find((each) => each.name === name);
    return field === undefined ? { $ref: `#/components/parameters/${name}` } : parameterOf('path', field);
  });
}

function streamedBodyOf({ kind, mostBytes }: StreamedBody): OpenApiObject {
  return {
    required: true,
    description: `At most ${mostBytes.toLocaleString('en-US')} bytes, with their length as Content-Length`,
    content: { [mediaTypeOfBody[kind]]: {} },
  };
}

function jsonBodyOf(operationId: string, body: OpenApiObject, refusesEmptyBody: boolean): OpenApiObject {
  return {
    required: refusesEmptyBody,
    content: { 'application/json': { schema: identifiedSchemaOf(body, `${operationId}/input`) } },
  };
}

function queryParametersOf({ name }: RouteRegistration, given: Readonly<OpenApiObject>): readonly OpenApiObject[] {
  if (isUnion(given)) {
    throw new Error(`The query ${name} takes one of several inputs, which its query parameters cannot tell apart`);
  }
  return fieldsOf(given).map((field) => parameterOf('query', field));
}

function inputPartsOf(registration: RouteRegistration, operationId: string): InputParts {
  const input = selfContainedSchemaOf(registration.input);
  const given = withoutFields(input, registration.pathParameters);
  const path = pathParametersOf(registration, fieldsOfEveryMember(input));
  if (takesNoBody(registration.route)) {
    return { parameters: [...path, ...queryParametersOf(registration, given)] };
  }
  const body = registration.servedOverHttpAlone ?? { kind: 'json' };
  if (isStreamedBody(body)) {
    return { parameters: [...path, ...queryParametersOf(registration, given)], requestBody: streamedBodyOf(body) };
  }
  return body.kind === 'json'
    ? { parameters: path, requestBody: jsonBodyOf(operationId, given, registration.refusesEmptyBody) }
    : { parameters: path };
}

function successOf(registration: RouteRegistration, operationId: string): OpenApiObject {
  const answer = answerOf(registration);
  const content =
    answer.kind === 'json'
      ? { 'application/json': { schema: schemaOf(answer.output, operationId, 'output') } }
      : { [answer.mediaType]: {} };
  return { description: successWords[registration.successStatus], content };
}

export function describedOperationOf(registration: RouteRegistration, operationId: string): DescribedOperation {
  const problems = problemAnswersOfOperation(registration);
  const { parameters, requestBody } = inputPartsOf(registration, operationId);
  const tag = tagOf(registration);
  return {
    path: catalogPathOf(registration),
    method: registration.route.method.toLowerCase(),
    tag,
    problems,
    operation: {
      operationId,
      summary: registration.title,
      description: registration.description,
      tags: [tag],
      parameters,
      ...(requestBody === undefined ? {} : { requestBody }),
      responses: {
        [registration.successStatus]: successOf(registration, operationId),
        ...referencesTo(problems),
      },
      security: [{ bearer: [] }, ...registration.permissions.map((permission) => ({ openIdConnect: [permission] }))],
    },
  };
}
