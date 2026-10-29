import { jsonSchemaLimits, utf8Bytes } from '@on.auto/json-schema';
import { JsonPointer, Result, type Schema } from 'effect';

import type { DocumentProblem, OpenApiVersion, Parameter, ReadDocument } from './api-document.ts';
import type { BodyOf, Placed } from './api-parameters.ts';
import {
  isSchemaObject,
  standaloneOf,
  translatedSchema,
  type ComponentReference,
  type Standalone,
} from './schema-translation.ts';

interface Component extends Standalone {
  readonly bytes: number;
}

export interface Components {
  readonly written: Readonly<Record<string, Schema.Json>>;
  readonly standalone: ReadonlyMap<string, Component>;
  readonly definitions: Readonly<Record<string, Schema.Json>>;
}

interface Definitions {
  readonly schemas: Readonly<Record<string, Schema.Json>>;
  readonly bytes: number;
}

export interface InputSchema {
  readonly schema: Schema.JsonObject;
  readonly definitionBytes: number;
}

interface Property {
  readonly name: string;
  readonly required: boolean;
  readonly standalone: Standalone;
}

type Deriving<A> = Result.Result<A, readonly DocumentProblem[]>;

const missingComponent = 'A reference to a schema the document does not have under components';

export function bytesOf(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function componentOf(standalone: Standalone): Component {
  return { ...standalone, bytes: bytesOf(standalone.schema) };
}

export function componentsOf({ version, document }: ReadDocument): Deriving<Components> {
  const written = document.components?.schemas ?? {};
  const standalone = new Map(
    Object.entries(written).map(([name, schema]: readonly [string, Schema.Json]) => [
      name,
      componentOf(
        standaloneOf(translatedSchema(schema, version), `/components/schemas/${JsonPointer.escapeToken(name)}`),
      ),
    ]),
  );
  const problems = [...standalone.values()].flatMap((each) => each.problems);
  const definitions = Object.fromEntries(
    [...standalone].map(([name, { schema }]: readonly [string, Component]) => [name, schema]),
  );
  return problems.length > 0 ? Result.fail(problems) : Result.succeed({ written, standalone, definitions });
}

export function oversizedBecause({ schema, definitionBytes }: InputSchema): string | undefined {
  return definitionBytes > jsonSchemaLimits.bytes || bytesOf(schema) > jsonSchemaLimits.bytes
    ? `its input schema, with the components it refers to, takes more than the ${jsonSchemaLimits.bytes} bytes as JSON a tool's input schema may take`
    : undefined;
}

function described(schema: Schema.Json, description: string | undefined): Schema.Json {
  if (description === undefined || !isSchemaObject(schema) || schema['description'] !== undefined) {
    return schema;
  }
  return Object.fromEntries([...Object.entries(schema), ['description', description]]);
}

function propertyOf(version: OpenApiVersion, { value, pointer }: Placed<Parameter>): Property {
  const standalone = standaloneOf(translatedSchema(value.schema ?? {}, version), `${pointer}/schema`);
  return {
    name: value.name,
    required: value.in === 'path' || value.required === true,
    standalone: { ...standalone, schema: described(standalone.schema, value.description) },
  };
}

function bodyPropertyOf(version: OpenApiVersion, body: BodyOf): readonly Property[] {
  if (body.kind !== 'json') {
    return [];
  }
  const { schema, pointer, required } = body.body;
  return [{ name: 'body', required, standalone: standaloneOf(translatedSchema(schema, version), pointer) }];
}

function definitionsOf(references: readonly ComponentReference[], components: Components): Deriving<Definitions> {
  const schemas: Record<string, Schema.Json> = {};
  const problems: DocumentProblem[] = [];
  const pending = [...references];
  let bytes = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const component = components.standalone.get(next.name);
    if (component === undefined) {
      problems.push({ pointer: next.pointer, detail: missingComponent });
    } else if (!Object.hasOwn(schemas, next.name)) {
      schemas[next.name] = component.schema;
      bytes += component.bytes;
      pending.push(...component.references);
    }
  }
  return problems.length > 0 ? Result.fail(problems) : Result.succeed({ schemas, bytes });
}

export function inputSchemaOf(
  version: OpenApiVersion,
  components: Components,
  parameters: readonly Placed<Parameter>[],
  body: BodyOf,
): Deriving<InputSchema> {
  const properties = [
    ...parameters
      .filter(({ value }) => value.in === 'path' || value.in === 'query')
      .map((each) => propertyOf(version, each)),
    ...bodyPropertyOf(version, body),
  ];
  const problems = properties.flatMap(({ standalone }) => standalone.problems);
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  return Result.map(
    definitionsOf(
      properties.flatMap(({ standalone }) => standalone.references),
      components,
    ),
    ({ schemas, bytes }) => {
      const required = properties.filter((property) => property.required).map(({ name }) => name);
      return {
        schema: {
          type: 'object',
          properties: Object.fromEntries(properties.map(({ name, standalone }) => [name, standalone.schema])),
          ...(required.length === 0 ? {} : { required }),
          additionalProperties: false,
          ...(Object.keys(schemas).length === 0 ? {} : { $defs: schemas }),
        },
        definitionBytes: bytes,
      };
    },
  );
}
