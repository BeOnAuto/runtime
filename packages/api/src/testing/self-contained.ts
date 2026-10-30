import { Predicate } from 'effect';

function referencesIn(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => referencesIn(item));
  }
  if (!Predicate.isObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([keyword, member]: readonly [string, unknown]) =>
    keyword === '$ref' && typeof member === 'string' ? [member] : referencesIn(member),
  );
}

export function danglingReferencesIn(schema: Readonly<Record<string, unknown>>): readonly string[] {
  const definitions = Predicate.isObject(schema['$defs']) ? Object.keys(schema['$defs']) : [];
  return referencesIn(schema).filter((reference) => !definitions.includes(reference.replace('#/$defs/', '')));
}
