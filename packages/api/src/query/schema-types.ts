import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLUnionType,
  isObjectType,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLFieldConfigMap,
  type GraphQLNullableInputType,
  type GraphQLNullableOutputType,
  type GraphQLNamedType,
  type GraphQLOutputType,
} from 'graphql';

import {
  acceptsNull,
  definitionOf,
  descriptionOf,
  isClosedObject,
  isGraphQLName,
  isNullAlone,
  keyOf,
  matcherOf,
  membersOf,
  nodeOf,
  onlyOneOf,
  pascalCaseOf,
  propertiesOf,
  referenceOf,
  scalarKindsOf,
  stringsOf,
  tagOf,
  typesOf,
  withNoRepeats,
  type JsonDefinitions,
  type JsonNode,
  type ScalarKind,
} from './json-schema-reading.ts';
import { jsonScalar, scalarOfKinds, singleScalars } from './query-scalars.ts';

export type { JsonDefinitions, JsonNode } from './json-schema-reading.ts';

export interface FieldsAdded {
  readonly id: string;
  readonly at: readonly string[];
  readonly fields: () => GraphQLFieldConfigMap<unknown, unknown>;
}

export interface TypesOfJsonSchema {
  readonly json: GraphQLScalarType;
  readonly outputOf: (
    node: JsonNode,
    definitions: JsonDefinitions,
    name: string,
    added?: readonly FieldsAdded[],
  ) => GraphQLOutputType;
  readonly argumentsOf: (input: JsonNode, definitions: JsonDefinitions) => GraphQLFieldConfigArgumentMap;
}

interface Named {
  readonly key: string;
  readonly type: GraphQLNamedType;
}

interface Building {
  readonly found: (name: string) => Named | undefined;
  readonly keep: (name: string, named: Named) => void;
}

interface Place {
  readonly definitions: JsonDefinitions;
  readonly name: string;
  readonly added?: readonly FieldsAdded[] | undefined;
}

interface Naming {
  readonly base: string;
  readonly key: string;
}

function namedOnce<T extends GraphQLNamedType>(
  building: Building,
  { base, key }: Naming,
  make: (name: string) => T,
  isIt: (type: GraphQLNamedType) => type is T,
): T {
  for (let count = 1; ; count += 1) {
    const name = count === 1 ? base : `${base}${count}`;
    const found = building.found(name);
    if (found === undefined) {
      const type = make(name);
      building.keep(name, { key, type });
      return type;
    }
    if (found.key === key && isIt(found.type)) {
      return found.type;
    }
  }
}

const isScalar = (type: GraphQLNamedType): type is GraphQLScalarType => type instanceof GraphQLScalarType;

const isUnion = (type: GraphQLNamedType): type is GraphQLUnionType => type instanceof GraphQLUnionType;

function scalarOf(building: Building, kinds: ReadonlySet<ScalarKind>): GraphQLScalarType {
  const sorted = [...kinds].toSorted();
  const [only] = sorted;
  if (sorted.length === 1 && only !== undefined) return singleScalars[only];
  return namedOnce(building, { base: sorted.join('Or'), key: sorted.join() }, () => scalarOfKinds(sorted), isScalar);
}

function fieldTypeOf(field: JsonNode, required: boolean, type: GraphQLNullableOutputType): GraphQLOutputType {
  return required && !acceptsNull(field) ? new GraphQLNonNull(type) : type;
}

function addedBelow(added: readonly FieldsAdded[] | undefined, property: string): readonly FieldsAdded[] {
  return (added ?? []).flatMap(({ id, at: [next, ...rest], fields }) =>
    next === property ? [{ id, at: rest, fields }] : [],
  );
}

function objectFieldsOf(building: Building, node: JsonNode, place: Place): GraphQLFieldConfigMap<unknown, unknown> {
  const required = stringsOf(node['required']);
  return Object.fromEntries(
    propertiesOf(node).map(([property, field]) => [
      property,
      {
        type: fieldTypeOf(
          field,
          required.includes(property),
          outputOf(building, field, {
            definitions: place.definitions,
            name: `${place.name}${pascalCaseOf(property)}`,
            added: addedBelow(place.added, property),
          }),
        ),
        description: descriptionOf(field),
      },
    ]),
  );
}

function objectOf(building: Building, node: JsonNode, { definitions, name, added }: Place): GraphQLObjectType {
  const addedHere = (added ?? []).filter(({ at }) => at.length === 0);
  const ids = addedHere.map(({ id }) => id).join();
  return namedOnce(
    building,
    { base: name, key: ids === '' ? keyOf(node) : `${keyOf(node)}|${ids}` },
    (made) =>
      new GraphQLObjectType({
        name: made,
        description: descriptionOf(node),
        fields: () => ({
          ...objectFieldsOf(building, node, { definitions, name: made, added }),
          ...Object.fromEntries(addedHere.flatMap(({ fields: addedFields }) => Object.entries(addedFields()))),
        }),
      }),
    isObjectType,
  );
}

interface Matched {
  readonly type: GraphQLObjectType;
  readonly matches: (value: unknown) => boolean;
}

function memberOf(building: Building, member: JsonNode, at: number, { definitions, name }: Place): Matched | undefined {
  const shape = definitionOf(member, definitions) ?? member;
  const tag = tagOf(shape);
  const type = outputOf(building, member, {
    definitions,
    name: `${name}${tag === undefined ? at + 1 : pascalCaseOf(tag[1])}`,
  });
  return isObjectType(type) ? { type, matches: matcherOf(shape) } : undefined;
}

function unionOf(building: Building, members: readonly JsonNode[], place: Place): GraphQLNullableOutputType {
  const matched = members.map((member, at) => memberOf(building, member, at, place));
  if (!matched.every((each) => each !== undefined)) return jsonScalar;
  return namedOnce(
    building,
    { base: place.name, key: keyOf({ anyOf: members }) },
    (made) =>
      new GraphQLUnionType({
        name: made,
        types: matched.map(({ type }) => type),
        resolveType: (value) => matched.find(({ matches }) => matches(value))?.type.name,
      }),
    isUnion,
  );
}

function listOf(building: Building, node: JsonNode, place: Place): GraphQLNullableOutputType {
  if (!('items' in node)) return new GraphQLList(jsonScalar);
  const items = nodeOf(node['items']);
  return new GraphQLList(fieldTypeOf(items, true, outputOf(building, items, place)));
}

function typeOfMembers(building: Building, node: JsonNode, place: Place): GraphQLNullableOutputType {
  const members = withNoRepeats(membersOf(node).filter((member) => !isNullAlone(member)));
  const [only] = members;
  return members.length === 1 && only !== undefined
    ? outputOf(building, only, place)
    : unionOf(building, members, place);
}

function typeOfShape(building: Building, node: JsonNode, place: Place): GraphQLNullableOutputType {
  const kinds = scalarKindsOf(node, place.definitions);
  if (kinds !== undefined) return scalarOf(building, kinds);
  if (membersOf(node).length > 0) return typeOfMembers(building, node, place);
  const one = onlyOneOf(node);
  if (one !== undefined) return outputOf(building, one, place);
  if ('allOf' in node) return jsonScalar;
  if (typesOf(node).includes('array')) return listOf(building, node, place);
  return isClosedObject(node) ? objectOf(building, node, place) : jsonScalar;
}

function outputOf(building: Building, node: JsonNode, place: Place): GraphQLNullableOutputType {
  const reference = referenceOf(node);
  if (reference === undefined) return typeOfShape(building, node, place);
  const definition = definitionOf(node, place.definitions);
  return definition === undefined
    ? jsonScalar
    : typeOfShape(building, definition, { ...place, name: pascalCaseOf(reference.name) });
}

function inputOf(building: Building, node: JsonNode, definitions: JsonDefinitions): GraphQLNullableInputType {
  const kinds = scalarKindsOf(node, definitions);
  if (kinds !== undefined) return scalarOf(building, kinds);
  const items = typesOf(node).includes('array') ? scalarKindsOf(nodeOf(node['items']), definitions) : undefined;
  return items === undefined ? jsonScalar : new GraphQLList(new GraphQLNonNull(scalarOf(building, items)));
}

function argumentsOf(building: Building, input: JsonNode, definitions: JsonDefinitions): GraphQLFieldConfigArgumentMap {
  const required = stringsOf(input['required']);
  return Object.fromEntries(
    propertiesOf(input)
      .filter(([name]) => isGraphQLName(name))
      .map(([name, field]) => {
        const type = inputOf(building, field, definitions);
        return [
          name,
          {
            type: required.includes(name) && !acceptsNull(field) ? new GraphQLNonNull(type) : type,
            description: descriptionOf(field),
          },
        ];
      }),
  );
}

export function typesOfJsonSchema(): TypesOfJsonSchema {
  const named = new Map<string, Named>();
  const building: Building = {
    found: (name) => named.get(name),
    keep: (name, kept) => {
      named.set(name, kept);
    },
  };
  return {
    json: jsonScalar,
    outputOf: (node, definitions, name, added) => outputOf(building, node, { definitions, name, added }),
    argumentsOf: (input, definitions) => argumentsOf(building, input, definitions),
  };
}
