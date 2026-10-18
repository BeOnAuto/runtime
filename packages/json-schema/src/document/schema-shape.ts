import { Predicate, type Schema } from 'effect';

import { pointerOf, type SchemaIssue } from './json-bounds.ts';
import { formatNames, isFormatName } from './string-formats.ts';

type Path = readonly (string | number)[];

type KeywordCheck = (value: Schema.Json, path: Path, checks: KeywordChecks) => readonly SchemaIssue[];

type KeywordChecks = ReadonlyMap<string, KeywordCheck>;

export type OtherFormats = 'refused' | 'unchecked';

const mostEnumValues = 1000;

const typeNames: readonly string[] = ['null', 'boolean', 'object', 'array', 'number', 'string', 'integer'];

const unsafePattern = 'Regular expressions are not accepted, because a hostile pattern can stall validation';
const conditional = 'Conditional schemas (if, then and else) cannot be validated here';
const containment = 'contains, minContains and maxContains cannot be validated here';
const dependent = 'Dependent schemas and dependent required keys cannot be validated here';
const unevaluated = 'unevaluatedItems and unevaluatedProperties cannot be validated here';
const dynamic = 'Dynamic and recursive anchors cannot be validated here; use $ref to "#/$defs/<name>"';
const checkedFormats = new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(formatNames);
const uncheckedFormat = `Expected one of the formats checked here: ${checkedFormats}`;

const unsupportedKeywords: ReadonlyMap<string, string> = new Map([
  ['pattern', unsafePattern],
  ['patternProperties', unsafePattern],
  ['if', conditional],
  ['then', conditional],
  ['else', conditional],
  ['contains', containment],
  ['minContains', containment],
  ['maxContains', containment],
  ['dependentRequired', dependent],
  ['dependentSchemas', dependent],
  ['dependencies', dependent],
  ['unevaluatedItems', unevaluated],
  ['unevaluatedProperties', unevaluated],
  ['additionalItems', 'additionalItems cannot be validated here; use prefixItems and items'],
  ['$dynamicRef', dynamic],
  ['$dynamicAnchor', dynamic],
  ['$recursiveRef', dynamic],
  ['$recursiveAnchor', dynamic],
  ['$anchor', dynamic],
]);

function issue(path: Path, detail: string): readonly SchemaIssue[] {
  return [{ pointer: pointerOf(path), detail }];
}

function isScalar(value: Schema.Json): boolean {
  return value === null || typeof value !== 'object';
}

function isList(value: Schema.Json): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function isObject(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !isList(value);
}

function typeKeyword(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  const names = isList(value) ? value : [value];
  const valid = names.length > 0 && names.every((name) => typeNames.some((typeName) => typeName === name));
  return valid ? [] : issue(path, `Expected one of ${typeNames.join(', ')}, or a non-empty list of them`);
}

function text(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return typeof value === 'string' ? [] : issue(path, 'Expected a string');
}

function checkedFormat(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return isFormatName(value) ? [] : issue(path, uncheckedFormat);
}

function number(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return typeof value === 'number' ? [] : issue(path, 'Expected a number');
}

function positiveNumber(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return typeof value === 'number' && value > 0 ? [] : issue(path, 'Expected a number greater than 0');
}

function count(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? [] : issue(path, 'Expected an integer of 0 or more');
}

function flag(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return typeof value === 'boolean' ? [] : issue(path, 'Expected true or false');
}

function anything(): readonly SchemaIssue[] {
  return [];
}

function list(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return isList(value) ? [] : issue(path, 'Expected a list');
}

function stringList(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return isList(value) && value.every((entry) => typeof entry === 'string')
    ? []
    : issue(path, 'Expected a list of strings');
}

function type(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  return isScalar(value) ? [] : issue(path, 'Only strings, numbers, booleans and null can be constants');
}

function scalarList(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  if (!isList(value) || value.length === 0 || !value.every((entry) => isScalar(entry))) {
    return issue(path, 'Expected a non-empty list of strings, numbers, booleans or null');
  }
  return value.length > mostEnumValues ? issue(path, `An enum may list at most ${mostEnumValues} values`) : [];
}

function localReference(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  const local = typeof value === 'string' && /^#\/(?:\$defs|definitions)\/[^/]+$/u.test(value);
  return local ? [] : issue(path, 'Expected a reference to a definition of this schema, such as "#/$defs/address"');
}

function subschema(value: Schema.Json, path: Path, checks: KeywordChecks): readonly SchemaIssue[] {
  return typeof value === 'boolean' ? [] : shapeIssuesAt(value, path, checks);
}

function nothing(value: Schema.Json, path: Path): readonly SchemaIssue[] {
  const empty = isObject(value) && Object.keys(value).length === 0;
  return empty ? [] : issue(path, 'Only "not": {} (no value matches) can be validated here');
}

function schemaList(value: Schema.Json, path: Path, checks: KeywordChecks): readonly SchemaIssue[] {
  if (!isList(value) || value.length === 0) {
    return issue(path, 'Expected a non-empty list of schemas');
  }
  return value.flatMap((entry, index) => subschema(entry, [...path, index], checks));
}

function schemaMap(value: Schema.Json, path: Path, checks: KeywordChecks): readonly SchemaIssue[] {
  if (!isObject(value)) {
    return issue(path, 'Expected an object of schemas');
  }
  return Object.entries(value).flatMap(([name, entry]: readonly [string, Schema.Json]) =>
    subschema(entry, [...path, name], checks),
  );
}

function keywordChecksWith(format: KeywordCheck): KeywordChecks {
  return new Map<string, KeywordCheck>([
    ['type', typeKeyword],
    ['properties', schemaMap],
    ['$defs', schemaMap],
    ['definitions', schemaMap],
    ['required', stringList],
    ['items', subschema],
    ['additionalProperties', subschema],
    ['propertyNames', subschema],
    ['not', nothing],
    ['prefixItems', schemaList],
    ['anyOf', schemaList],
    ['oneOf', schemaList],
    ['allOf', schemaList],
    ['enum', scalarList],
    ['const', type],
    ['$ref', localReference],
    ['$schema', text],
    ['$id', text],
    ['$comment', text],
    ['title', text],
    ['description', text],
    ['format', format],
    ['minimum', number],
    ['maximum', number],
    ['exclusiveMinimum', number],
    ['exclusiveMaximum', number],
    ['multipleOf', positiveNumber],
    ['minLength', count],
    ['maxLength', count],
    ['minItems', count],
    ['maxItems', count],
    ['minProperties', count],
    ['maxProperties', count],
    ['uniqueItems', flag],
    ['readOnly', flag],
    ['writeOnly', flag],
    ['deprecated', flag],
    ['default', anything],
    ['examples', list],
  ]);
}

const keywordChecksFor: Readonly<Record<OtherFormats, KeywordChecks>> = {
  refused: keywordChecksWith(checkedFormat),
  unchecked: keywordChecksWith(text),
};

export function isKnownKeyword(keyword: string): boolean {
  return keywordChecksFor.refused.has(keyword) || unsupportedKeywords.has(keyword);
}

function keywordIssues(keyword: string, value: Schema.Json, path: Path, checks: KeywordChecks): readonly SchemaIssue[] {
  const unsupported = unsupportedKeywords.get(keyword);
  if (unsupported !== undefined) {
    return issue([...path, keyword], unsupported);
  }
  return checks.get(keyword)?.(value, [...path, keyword], checks) ?? [];
}

function combinationIssues(schema: Schema.JsonObject, path: Path): readonly SchemaIssue[] {
  const additional = schema['additionalProperties'];
  const typedAdditional = additional !== undefined && isObject(additional);
  return typedAdditional && schema['properties'] !== undefined
    ? issue(
        [...path, 'additionalProperties'],
        'A schema for additionalProperties cannot be combined with properties here',
      )
    : [];
}

function shapeIssuesAt(schema: Schema.Json, path: Path, checks: KeywordChecks): readonly SchemaIssue[] {
  if (!isObject(schema)) {
    return issue(path, 'Expected a schema: a JSON object, or true or false');
  }
  return [
    ...Object.entries(schema).flatMap(([keyword, value]: readonly [string, Schema.Json]) =>
      keywordIssues(keyword, value, path, checks),
    ),
    ...combinationIssues(schema, path),
  ];
}

export function shapeIssues(schema: Schema.JsonObject, otherFormats: OtherFormats = 'refused'): readonly SchemaIssue[] {
  return shapeIssuesAt(schema, [], keywordChecksFor[otherFormats]);
}
