import { Predicate, Schema, SchemaRepresentation, type SchemaAST } from 'effect';

import { formatNames, isFormatName, stringFormats, type FormatName } from './string-formats.ts';

type Representation = SchemaRepresentation.Representation;

type Inline = Exclude<Representation, SchemaRepresentation.Reference>;

type Check = SchemaRepresentation.Check;

export const formatCheckId = '@on.auto/json-schema/isFormat';

const FormatPayload = Schema.Struct({ format: Schema.Literals(formatNames) });

const payloadOf = Schema.decodeUnknownSync(FormatPayload);

export function formatOfCheck(payload: unknown): FormatName {
  return payloadOf(payload).format;
}

function formatFilterOf(format: FormatName) {
  const { example, holds } = stringFormats[format];
  return Schema.makeFilter<unknown>((value) => typeof value !== 'string' || holds(value), {
    expected: `a string in the format ${format}, such as ${example}`,
    representation: { id: formatCheckId, payload: { format } },
  });
}

const revivers: readonly SchemaRepresentation.AnyReviver[] = [
  SchemaRepresentation.JsonReviver,
  SchemaRepresentation.isPatternReviver,
  SchemaRepresentation.isFiniteReviver,
  SchemaRepresentation.isGreaterThanReviver,
  SchemaRepresentation.isGreaterThanOrEqualToReviver,
  SchemaRepresentation.isLessThanReviver,
  SchemaRepresentation.isLessThanOrEqualToReviver,
  SchemaRepresentation.isMultipleOfReviver,
  SchemaRepresentation.isIntReviver,
  SchemaRepresentation.isMinLengthReviver,
  SchemaRepresentation.isMaxLengthReviver,
  SchemaRepresentation.isMinCodePointsReviver,
  SchemaRepresentation.isMaxCodePointsReviver,
  SchemaRepresentation.isMinPropertiesReviver,
  SchemaRepresentation.isMaxPropertiesReviver,
  SchemaRepresentation.isPropertyNamesReviver,
  SchemaRepresentation.isUniqueReviver,
  SchemaRepresentation.makeReviverFilter(formatCheckId, FormatPayload, ({ payload }) => formatFilterOf(payload.format)),
];

function formatsIn(annotations: Schema.Annotations.Annotations | undefined): readonly FormatName[] {
  const format = annotations?.['format'];
  return isFormatName(format) ? [format] : [];
}

function formatsOfCheck(check: Check): readonly FormatName[] {
  const own = formatsIn(check.annotations);
  return 'checks' in check ? [...own, ...check.checks.flatMap((inner) => formatsOfCheck(inner))] : own;
}

function formatCheckOf(format: FormatName): Check {
  return { _tag: 'Filter', aborted: false, representation: { id: formatCheckId, payload: { format } } };
}

function checkWithFormats(check: Check): Check {
  if ('checks' in check) {
    const [first, ...rest] = check.checks;
    return { ...check, checks: [checkWithFormats(first), ...rest.map((inner) => checkWithFormats(inner))] };
  }
  const { representation } = check;
  return representation?.schemas === undefined
    ? check
    : { ...check, representation: { ...representation, schemas: representation.schemas.map(withFormats) } };
}

function arraysWithFormats(node: SchemaRepresentation.Arrays, checks: readonly Check[]): Inline {
  const elements = node.elements.map((element) => ({ ...element, type: withFormats(element.type) }));
  return { ...node, elements, rest: node.rest.map(withFormats), checks };
}

function objectsWithFormats(node: SchemaRepresentation.Objects, checks: readonly Check[]): Inline {
  const propertySignatures = node.propertySignatures.map((property) => ({
    ...property,
    type: withFormats(property.type),
  }));
  const indexSignatures = node.indexSignatures.map(({ parameter, type }) => ({
    parameter: withFormats(parameter),
    type: withFormats(type),
  }));
  return { ...node, propertySignatures, indexSignatures, checks };
}

function childrenWithFormats(node: Inline): Inline {
  const checks = node.checks.map((check) => checkWithFormats(check));
  if ('thunk' in node) {
    return { ...node, thunk: withFormats(node.thunk) };
  }
  if ('typeParameters' in node) {
    return { ...node, typeParameters: node.typeParameters.map(withFormats), checks };
  }
  if ('types' in node) {
    return { ...node, types: node.types.map(withFormats), checks };
  }
  if ('elements' in node) {
    return arraysWithFormats(node, checks);
  }
  return 'propertySignatures' in node ? objectsWithFormats(node, checks) : { ...node, checks };
}

function withFormats(node: Representation): Representation {
  if ('$ref' in node) {
    return node;
  }
  const inline = childrenWithFormats(node);
  const formats = new Set([...formatsIn(inline.annotations), ...inline.checks.flatMap(formatsOfCheck)]);
  const checks = [...formats].map((format) => formatCheckOf(format));
  if (checks.length === 0) {
    return inline;
  }
  return 'thunk' in inline
    ? { _tag: 'Union', types: [inline], checks }
    : { ...inline, checks: [...inline.checks, ...checks] };
}

function namesAFormat(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((inner) => namesAFormat(inner));
  }
  if (!Predicate.isObject(value)) {
    return false;
  }
  const named = Predicate.hasProperty(value, 'format') && isFormatName(value.format);
  return named || Object.values(value).some((inner) => namesAFormat(inner));
}

function revivedWithFormatChecks(ast: SchemaAST.AST): SchemaAST.AST {
  const { representation, references } = SchemaRepresentation.toRepresentation(ast);
  const referencesWithFormats = Object.entries(references).map(
    ([name, referenced]: readonly [string, Representation]): readonly [string, Representation] => [
      name,
      withFormats(referenced),
    ],
  );
  return SchemaRepresentation.fromRepresentation(
    { representation: withFormats(representation), references: Object.fromEntries(referencesWithFormats) },
    { revivers },
  ).ast;
}

export function withFormatChecks(ast: SchemaAST.AST, document: Schema.JsonObject): SchemaAST.AST {
  return namesAFormat(document) ? revivedWithFormatChecks(ast) : ast;
}
