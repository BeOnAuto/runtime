import {
  byName,
  translatedSchema,
  type DiscoveryDocument,
  type DiscoveryMethod,
  type Json,
  type JsonObject,
} from './discovery-document.ts';

interface Described {
  readonly description?: string;
}

export type DeclaredParameters = NonNullable<DiscoveryMethod['parameters']>;

const fieldsParameterName = 'fields';

const parameterKeywords: ReadonlySet<string> = new Set(['location', 'required', 'repeated', 'description']);

const pathParameterKeywords: ReadonlySet<string> = new Set([...parameterKeywords, 'pattern']);

const templatedSegment = /\{\+?([^{}]+)\}/gu;

const singleSegment = '^[^/]+$';

export interface Writing {
  readonly prefix: string;
  readonly fields: readonly JsonObject[];
  readonly described: ReadonlyMap<string, string>;
}

export function templated(path: string): string {
  return path.replaceAll(templatedSegment, '{$1}');
}

export function pathOf(method: DiscoveryMethod, prefix: string): string {
  return `/${prefix}${templated(method.flatPath ?? method.path)}`;
}

function pathNamesOf(path: string): readonly string[] {
  return (path.match(templatedSegment) ?? []).map((segment) => segment.replaceAll(/^\{\+?|\}$/gu, ''));
}

function describedBy(parameter: JsonObject | undefined): Described {
  const description = parameter?.['description'];
  return typeof description === 'string' ? { description } : {};
}

function parameterSchemaOf(parameter: JsonObject, leftOut: ReadonlySet<string>): Json {
  const schema = translatedSchema(
    Object.fromEntries(Object.entries(parameter).filter(([keyword]: readonly [string, Json]) => !leftOut.has(keyword))),
  );
  return parameter['repeated'] === true ? { type: 'array', items: schema } : schema;
}

function declaredPathParameter(declared: DeclaredParameters, name: string): JsonObject | undefined {
  const parameter = Object.hasOwn(declared, name) ? declared[name] : undefined;
  return parameter?.['location'] === 'path' ? parameter : undefined;
}

function renamedPathParameter(
  writtenPath: string,
  declared: DeclaredParameters,
  flatNames: readonly string[],
  position: number,
): JsonObject | undefined {
  const writtenNames = pathNamesOf(writtenPath);
  const written = writtenNames.length === flatNames.length ? writtenNames[position] : undefined;
  const renamed = written === undefined ? undefined : declaredPathParameter(declared, written);
  return renamed !== undefined && renamed['pattern'] === singleSegment ? renamed : undefined;
}

function pathParametersOf(method: DiscoveryMethod, declared: DeclaredParameters, path: string): readonly JsonObject[] {
  const flatNames = pathNamesOf(path);
  return flatNames.map((name, position) =>
    pathParameterOf(
      name,
      declaredPathParameter(declared, name) ?? renamedPathParameter(method.path, declared, flatNames, position),
    ),
  );
}

function pathParameterOf(name: string, declared: JsonObject | undefined): JsonObject {
  return {
    name,
    in: 'path',
    required: true,
    ...describedBy(declared),
    schema: declared === undefined ? { type: 'string' } : parameterSchemaOf(declared, pathParameterKeywords),
  };
}

function queryParameterOf([name, parameter]: readonly [string, JsonObject]): readonly JsonObject[] {
  if (parameter['location'] !== 'query') {
    return [];
  }
  const required = parameter['required'] === true;
  return [
    {
      name,
      in: 'query',
      ...(required ? { required } : {}),
      ...describedBy(parameter),
      schema: parameterSchemaOf(parameter, parameterKeywords),
    },
  ];
}

export function fieldsParameterOf(discovery: DiscoveryDocument): readonly JsonObject[] {
  const fields = discovery.parameters?.[fieldsParameterName];
  return fields === undefined
    ? []
    : [{ name: fieldsParameterName, in: 'query', ...describedBy(fields), schema: { type: 'string' } }];
}

export function parametersOf(
  method: DiscoveryMethod,
  path: string,
  { fields }: Writing,
  more: DeclaredParameters = {},
): readonly JsonObject[] {
  const declared = { ...method.parameters, ...more };
  return [
    ...pathParametersOf(method, declared, path),
    ...Object.entries(declared)
      .toSorted(byName)
      .flatMap((each: readonly [string, JsonObject]) => queryParameterOf(each)),
    ...(Object.hasOwn(declared, fieldsParameterName) ? [] : fields),
  ];
}
