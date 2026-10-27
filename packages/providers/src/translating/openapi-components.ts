import { mappedSchema, type SchemaObject } from '@on.auto/tool-servers';
import { JsonPointer, type Schema } from 'effect';

import { byName, isJsonList, isJsonObject, referencesIn, type JsonObject } from './discovery-document.ts';

type Json = Schema.Json;

type JsonFields = Readonly<Record<string, Json>>;

export type Components = Readonly<Record<string, Readonly<Record<string, Json>>>>;

interface Component {
  readonly kind: string;
  readonly name: string;
  readonly value: Json;
}

export type HeldComponents = ReadonlyMap<string, Component>;

export interface Reaching {
  readonly id: string;
  readonly operation: JsonFields;
  readonly held: HeldComponents;
}

const holdersOfSchemas: ReadonlySet<string> = new Set(['parameters', 'requestBodies', 'responses', 'headers']);

const holdingNoSchema: ReadonlySet<string> = new Set(['example', 'examples', 'links']);

function referenceOf(kind: string, name: string): string {
  return `#/components/${JsonPointer.escapeToken(kind)}/${JsonPointer.escapeToken(name)}`;
}

export function heldComponentsOf(components: Components): HeldComponents {
  return new Map(
    Object.entries(components).flatMap(([kind, named]: readonly [string, Readonly<Record<string, Json>>]) =>
      Object.entries(named).map(([name, value]: readonly [string, Json]): readonly [string, Component] => [
        referenceOf(kind, name),
        { kind, name, value },
      ]),
    ),
  );
}

function reachedFrom({ id, operation, held }: Reaching, reached: Map<string, Component>): void {
  const pending = [...referencesIn(operation)];
  for (let reference = pending.pop(); reference !== undefined; reference = pending.pop()) {
    const component = held.get(reference);
    if (component === undefined) {
      throw new Error(`The operation ${id} refers to ${reference}, which is no component its document holds`);
    }
    const before = reached.get(reference);
    if (before === undefined) {
      reached.set(reference, component);
      pending.push(...referencesIn(component.value));
    } else if (JSON.stringify(before.value) !== JSON.stringify(component.value)) {
      throw new Error(`The documents the translation is made from hold ${reference} each its own way`);
    }
  }
}

function referenceNamedBy(mapped: string): string {
  return mapped.startsWith('#') ? mapped : referenceOf('schemas', mapped);
}

function isMissingFrom(held: HeldComponents, mapped: Json): boolean {
  return typeof mapped === 'string' && !held.has(referenceNamedBy(mapped));
}

function discriminatorHeld(discriminator: JsonFields, mapping: JsonFields, held: HeldComponents): JsonFields {
  return {
    ...discriminator,
    mapping: Object.fromEntries(
      Object.entries(mapping).filter(([, mapped]: readonly [string, Json]) => !isMissingFrom(held, mapped)),
    ),
  };
}

function withItsMappingHeld(schema: SchemaObject, held: HeldComponents): SchemaObject {
  const discriminator = schema['discriminator'];
  const mapping = isJsonObject(discriminator) ? discriminator['mapping'] : undefined;
  return isJsonObject(discriminator) && isJsonObject(mapping)
    ? { ...schema, discriminator: discriminatorHeld(discriminator, mapping, held) }
    : schema;
}

function schemaHeld(schema: Json, held: HeldComponents): Json {
  return mappedSchema(schema, (each) => withItsMappingHeld(each, held));
}

function fieldsHeld(fields: JsonObject, held: HeldComponents): JsonObject {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]: readonly [string, Json]): readonly [string, Json] => [
      key,
      key === 'schema' ? schemaHeld(value, held) : valueHeld(key, value, held),
    ]),
  );
}

function valueHeld(key: string, value: Json, held: HeldComponents): Json {
  if (holdingNoSchema.has(key)) {
    return value;
  }
  if (isJsonList(value)) {
    return value.map((each) => valueHeld(key, each, held));
  }
  return isJsonObject(value) ? fieldsHeld(value, held) : value;
}

export function withMappingsHeld(operation: JsonObject, held: HeldComponents): JsonObject {
  return fieldsHeld(operation, held);
}

function componentHeld({ kind, value }: Component, held: HeldComponents): Json {
  if (kind === 'schemas') {
    return schemaHeld(value, held);
  }
  return holdersOfSchemas.has(kind) && isJsonObject(value) ? fieldsHeld(value, held) : value;
}

export function componentsReachedBy(kept: readonly Reaching[]): Components {
  const reached = new Map<string, Component>();
  for (const each of kept) {
    reachedFrom(each, reached);
  }
  const components = [...reached.values()];
  const kinds = [...new Set(components.map(({ kind }) => kind))].toSorted();
  return Object.fromEntries(
    kinds.map((kind): readonly [string, Readonly<Record<string, Json>>] => [
      kind,
      Object.fromEntries(
        components
          .filter((component) => component.kind === kind)
          .map((component): readonly [string, Json] => [component.name, componentHeld(component, reached)])
          .toSorted(byName),
      ),
    ]),
  );
}
