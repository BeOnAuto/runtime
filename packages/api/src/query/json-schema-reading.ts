import { Predicate } from 'effect';

export type JsonNode = Readonly<Record<string, unknown>>;

export type JsonDefinitions = Readonly<Record<string, JsonNode>>;

export type ScalarKind = 'Boolean' | 'Number' | 'String';

const graphQLName = /^[_A-Za-z][_0-9A-Za-z]*$/u;

const definitionReference = /^#\/\$defs\/(.+)$/u;

export const nodeOf = (value: unknown): JsonNode => (Predicate.isObject(value) ? value : {});

const valuesOf = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value.map((each: unknown) => each) : undefined;

const nodesOf = (value: unknown): readonly JsonNode[] => (valuesOf(value) ?? []).map((each) => nodeOf(each));

export const stringsOf = (value: unknown): readonly string[] =>
  (valuesOf(value) ?? []).filter((each) => typeof each === 'string');

export const descriptionOf = (node: JsonNode): string | undefined =>
  typeof node['description'] === 'string' ? node['description'] : undefined;

export const keyOf = (node: JsonNode): string => JSON.stringify(node);

export const isGraphQLName = (name: string): boolean => graphQLName.test(name) && !name.startsWith('__');

export function pascalCaseOf(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/u)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

export function typesOf(node: JsonNode): readonly string[] {
  const { type } = node;
  return typeof type === 'string' ? [type] : stringsOf(type);
}

export function membersOf(node: JsonNode): readonly JsonNode[] {
  return [...nodesOf(node['anyOf']), ...nodesOf(node['oneOf'])];
}

export function isNullAlone(node: JsonNode): boolean {
  const types = typesOf(node);
  return types.length > 0 && types.every((type) => type === 'null');
}

export function acceptsNull(node: JsonNode): boolean {
  return typesOf(node).includes('null') || membersOf(node).some((member) => acceptsNull(member));
}

export function referenceOf(node: JsonNode): { readonly found: boolean; readonly name: string } | undefined {
  const reference = node['$ref'];
  if (typeof reference !== 'string') {
    return undefined;
  }
  const name = definitionReference.exec(reference)?.[1];
  return name === undefined ? { found: false, name: reference } : { found: true, name };
}

export function definitionOf(node: JsonNode, definitions: JsonDefinitions): JsonNode | undefined {
  const reference = referenceOf(node);
  return reference?.found === true ? definitions[reference.name] : undefined;
}

export function kindOfValue(value: unknown): ScalarKind | undefined {
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'Number';
  return typeof value === 'boolean' ? 'Boolean' : undefined;
}

const kindOfType: Readonly<Record<string, ScalarKind>> = {
  string: 'String',
  number: 'Number',
  integer: 'Number',
  boolean: 'Boolean',
};

function constantsOf(node: JsonNode): readonly unknown[] | undefined {
  return valuesOf(node['enum']) ?? ('const' in node ? [node['const']] : undefined);
}

function kindsOfConstants(constants: readonly unknown[]): ReadonlySet<ScalarKind> | undefined {
  const kinds = new Set(constants.map((constant) => kindOfValue(constant)));
  const [only] = kinds;
  return kinds.size === 1 && only !== undefined ? new Set([only]) : undefined;
}

function kindsOfTypes(node: JsonNode): ReadonlySet<ScalarKind> | undefined {
  const types = typesOf(node).filter((type) => type !== 'null');
  const kinds = types.map((type) => kindOfType[type]);
  return types.length > 0 && kinds.every((kind) => kind !== undefined) ? new Set(kinds) : undefined;
}

function kindsOfMembers(
  members: readonly JsonNode[],
  definitions: JsonDefinitions,
): ReadonlySet<ScalarKind> | undefined {
  const kinds = members.filter((member) => !isNullAlone(member)).map((member) => scalarKindsOf(member, definitions));
  return kinds.length > 0 && kinds.every((each) => each !== undefined)
    ? new Set(kinds.flatMap((each) => Array.from(each)))
    : undefined;
}

export function onlyOneOf(node: JsonNode): JsonNode | undefined {
  const everyOne = nodesOf(node['allOf']);
  return everyOne.length === 1 ? everyOne[0] : undefined;
}

export function scalarKindsOf(node: JsonNode, definitions: JsonDefinitions): ReadonlySet<ScalarKind> | undefined {
  if (referenceOf(node) !== undefined) {
    const definition = definitionOf(node, definitions);
    return definition === undefined ? undefined : scalarKindsOf(definition, definitions);
  }
  if (membersOf(node).length > 0) return kindsOfMembers(membersOf(node), definitions);
  const constants = constantsOf(node);
  if (constants !== undefined) return kindsOfConstants(constants);
  const one = onlyOneOf(node);
  return one === undefined ? kindsOfTypes(node) : scalarKindsOf(one, definitions);
}

export function propertiesOf(node: JsonNode): readonly (readonly [string, JsonNode])[] {
  return Object.entries(nodeOf(node['properties'])).map(
    ([name, field]: readonly [string, unknown]) => [name, nodeOf(field)] as const,
  );
}

export function isClosedObject(node: JsonNode): boolean {
  const properties = propertiesOf(node);
  const extra = node['additionalProperties'];
  return (
    properties.length > 0 &&
    (extra === undefined || extra === false) &&
    properties.every(([name]) => isGraphQLName(name))
  );
}

export function tagOf(node: JsonNode): readonly [string, string] | undefined {
  for (const [name, field] of propertiesOf(node)) {
    const constants = constantsOf(field) ?? [];
    const [constant] = constants;
    if (constants.length === 1 && typeof constant === 'string') return [name, constant];
  }
  return undefined;
}

export function matcherOf(node: JsonNode): (value: unknown) => boolean {
  const tag = tagOf(node);
  const required = stringsOf(node['required']);
  return (value) =>
    Predicate.isObject(value) &&
    (tag === undefined || value[tag[0]] === tag[1]) &&
    required.every((name) => name in value);
}

export function withNoRepeats(members: readonly JsonNode[]): readonly JsonNode[] {
  const keys = members.map((member) => keyOf(member));
  return members.filter((member, at) => keys.indexOf(keyOf(member)) === at);
}
