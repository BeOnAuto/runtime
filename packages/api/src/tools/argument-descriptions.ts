import { Predicate } from 'effect';

export interface ArgumentDescription {
  readonly where: string;
  readonly description: string;
}

const valuesNotSchemas: ReadonlySet<string> = new Set(['const', 'default', 'enum', 'examples']);

function descriptionOf(schema: unknown): string {
  return Predicate.hasProperty(schema, 'description') && typeof schema.description === 'string'
    ? schema.description
    : '';
}

function placed(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`;
}

function described(properties: object, path: string): readonly ArgumentDescription[] {
  return Object.entries(properties).flatMap(([name, schema]: readonly [string, unknown]) => {
    const where = placed(path, name);
    return [{ where, description: descriptionOf(schema) }].concat(argumentsAt(schema, where));
  });
}

function definitionsAt(definitions: object): readonly ArgumentDescription[] {
  return Object.entries(definitions).flatMap(([name, schema]: readonly [string, unknown]) => argumentsAt(schema, name));
}

function keywordArguments(keyword: string, value: unknown, path: string): readonly ArgumentDescription[] {
  if (valuesNotSchemas.has(keyword)) {
    return [];
  }
  if (!Predicate.isObject(value)) {
    return argumentsAt(value, path);
  }
  if (keyword === 'properties') {
    return described(value, path);
  }
  return keyword === '$defs' ? definitionsAt(value) : argumentsAt(value, path);
}

function argumentsAt(node: unknown, path: string): readonly ArgumentDescription[] {
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown) => argumentsAt(item, path));
  }
  return Predicate.isObject(node)
    ? Object.entries(node).flatMap(([keyword, value]: readonly [string, unknown]) =>
        keywordArguments(keyword, value, path),
      )
    : [];
}

export function argumentDescriptionsIn(schema: unknown): readonly ArgumentDescription[] {
  return argumentsAt(schema, '');
}
