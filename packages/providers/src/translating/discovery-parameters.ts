import { Schema } from 'effect';

import {
  isJsonList,
  isJsonObject,
  methodsOf,
  type DiscoveryDocument,
  type DiscoveryMethod,
  type DiscoveryResource,
  type Json,
  type JsonObject,
} from './discovery-document.ts';

type Methods = NonNullable<DiscoveryResource['methods']>;

type Resources = NonNullable<DiscoveryResource['resources']>;

type Change = (method: DiscoveryMethod) => DiscoveryMethod;

type Declared = NonNullable<DiscoveryMethod['parameters']>;

const NamesSchema = Schema.Array(Schema.String).check(Schema.isMinLength(1));

const RequiredBecauseSchema = Schema.String.annotate({
  description: 'Where the vendor says it refuses a call without them, which its Discovery document does not mark',
});

const RequiredParametersSchema = Schema.Struct({
  method: Schema.String.annotate({ description: 'The id of the method whose parameters a call must send' }),
  parameters: NamesSchema.annotate({ description: 'The parameters of the method a call must send' }),
  because: RequiredBecauseSchema,
});

type RequiredParameters = typeof RequiredParametersSchema.Type;

const RequiredPropertiesSchema = Schema.Struct({
  schema: Schema.String.annotate({ description: 'The schema whose properties a request must hold' }),
  properties: NamesSchema.annotate({ description: 'The properties of the schema a request must hold' }),
  because: RequiredBecauseSchema,
});

type RequiredProperties = typeof RequiredPropertiesSchema.Type;

export const RequirementSchema = Schema.Union([RequiredParametersSchema, RequiredPropertiesSchema]);

type Requirement = typeof RequirementSchema.Type;

export const LeftOutParametersSchema = Schema.Struct({
  method: Schema.String.annotate({ description: 'The id of the method whose parameters the document leaves out' }),
  parameters: NamesSchema.annotate({ description: 'The parameters of the method the document leaves out' }),
  because: Schema.String.annotate({ description: 'Why a call never sends them' }),
});

type LeftOutParameters = typeof LeftOutParametersSchema.Type;

export const GlobalParameterSchema = Schema.Struct({
  method: Schema.String.annotate({ description: 'The id of the method that keeps a global parameter' }),
  parameter: Schema.String.annotate({ description: 'The global parameter of the Discovery document the method keeps' }),
  values: NamesSchema.annotate({ description: 'The values of the parameter a call may send, each one it lists' }),
  says: Schema.String.annotate({
    description: 'What the method answers a call that sends them, ending its description',
  }),
});

type GlobalParameter = typeof GlobalParameterSchema.Type;

function missingOf(names: readonly string[], held: Readonly<Record<string, unknown>>): readonly string[] {
  return names.filter((name) => !Object.hasOwn(held, name));
}

function declaredOf(method: DiscoveryMethod, names: readonly string[], change: string): Declared {
  const declared = method.parameters ?? {};
  const missing = missingOf(names, declared);
  if (missing.length > 0) {
    throw new Error(
      `The method ${method.id} of the Discovery document has no parameter ${missing.join(', ')}, which ${change} names`,
    );
  }
  return declared;
}

function methodsChanged(methods: Methods | undefined, id: string, change: Change): Methods | undefined {
  return methods === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(methods).map(([name, method]: readonly [string, DiscoveryMethod]) => [
          name,
          method.id === id ? change(method) : method,
        ]),
      );
}

function resourcesChanged(resources: Resources | undefined, id: string, change: Change): Resources | undefined {
  return resources === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(resources).map(([name, resource]: readonly [string, DiscoveryResource]) => [
          name,
          resourceChanged(resource, id, change),
        ]),
      );
}

function resourceChanged<A extends DiscoveryResource>(resource: A, id: string, change: Change): A {
  const methods = methodsChanged(resource.methods, id, change);
  const resources = resourcesChanged(resource.resources, id, change);
  return {
    ...resource,
    ...(methods === undefined ? {} : { methods }),
    ...(resources === undefined ? {} : { resources }),
  };
}

function methodChanged(discovery: DiscoveryDocument, id: string, named: string, change: Change): DiscoveryDocument {
  if (!methodsOf(discovery).some((method) => method.id === id)) {
    throw new Error(`The Discovery document has no method ${id}, which ${named} names`);
  }
  return resourceChanged(discovery, id, change);
}

function parametersRequired(
  discovery: DiscoveryDocument,
  { method, parameters }: RequiredParameters,
): DiscoveryDocument {
  return methodChanged(discovery, method, 'a requirement', (kept) => {
    const declared = declaredOf(kept, parameters, 'a requirement');
    const required = parameters.map((name): readonly [string, JsonObject] => [
      name,
      { ...declared[name], required: true },
    ]);
    return { ...kept, parameters: { ...declared, ...Object.fromEntries(required) } };
  });
}

function propertiesRequired(
  discovery: DiscoveryDocument,
  { schema, properties }: RequiredProperties,
): DiscoveryDocument {
  const schemas = discovery.schemas ?? {};
  const written = Object.hasOwn(schemas, schema) ? schemas[schema] : undefined;
  if (written === undefined) {
    throw new Error(`The Discovery document has no schema ${schema}, which a requirement names`);
  }
  const held = written['properties'];
  const missing = missingOf(properties, isJsonObject(held) ? held : {});
  if (missing.length > 0) {
    throw new Error(
      `The schema ${schema} of the Discovery document has no property ${missing.join(', ')}, which a requirement names`,
    );
  }
  const before: readonly Json[] = isJsonList(written['required']) ? written['required'] : [];
  return { ...discovery, schemas: { ...schemas, [schema]: { ...written, required: [...before, ...properties] } } };
}

function requiredOnce(discovery: DiscoveryDocument, requirement: Requirement): DiscoveryDocument {
  return 'method' in requirement
    ? parametersRequired(discovery, requirement)
    : propertiesRequired(discovery, requirement);
}

function leftOutOnce(discovery: DiscoveryDocument, { method, parameters }: LeftOutParameters): DiscoveryDocument {
  return methodChanged(discovery, method, 'a parameter left out', (kept) => {
    const declared = declaredOf(kept, parameters, 'a parameter left out');
    const left = new Set(parameters);
    return {
      ...kept,
      parameters: Object.fromEntries(
        Object.entries(declared).filter(([name]: readonly [string, JsonObject]) => !left.has(name)),
      ),
    };
  });
}

function globalParameterOf(discovery: DiscoveryDocument, { parameter, values }: GlobalParameter): JsonObject {
  const globals = discovery.parameters ?? {};
  const written = Object.hasOwn(globals, parameter) ? globals[parameter] : undefined;
  if (written === undefined) {
    throw new Error(`The Discovery document has no global parameter ${parameter}, which a global parameter kept names`);
  }
  const listed: readonly Json[] = isJsonList(written['enum']) ? written['enum'] : [];
  const unlisted = values.filter((value) => !listed.includes(value));
  if (unlisted.length > 0) {
    throw new Error(
      `The global parameter ${parameter} of the Discovery document lists no value ${unlisted.join(', ')}, which a global parameter kept names`,
    );
  }
  const withoutItsDefault = Object.entries(written).filter(
    ([keyword]: readonly [string, Json]) => keyword !== 'default',
  );
  return { ...Object.fromEntries(withoutItsDefault), enum: values };
}

function globalKeptOnce(discovery: DiscoveryDocument, kept: GlobalParameter): DiscoveryDocument {
  const parameter = globalParameterOf(discovery, kept);
  return methodChanged(discovery, kept.method, 'a global parameter kept', (method) => ({
    ...method,
    description: method.description === undefined ? kept.says : `${method.description} ${kept.says}`,
    parameters: { ...method.parameters, [kept.parameter]: parameter },
  }));
}

export interface ParameterChanges {
  readonly required?: readonly Requirement[];
  readonly left_out_parameters?: readonly LeftOutParameters[];
  readonly global_parameters?: readonly GlobalParameter[];
}

export function discoveryParametersChanged(
  discovery: DiscoveryDocument,
  { required = [], left_out_parameters: leftOut = [], global_parameters: globals = [] }: ParameterChanges,
): DiscoveryDocument {
  const withRequired = required.reduce<DiscoveryDocument>((changed, each) => requiredOnce(changed, each), discovery);
  const withoutLeftOut = leftOut.reduce<DiscoveryDocument>((changed, each) => leftOutOnce(changed, each), withRequired);
  return globals.reduce<DiscoveryDocument>((changed, each) => globalKeptOnce(changed, each), withoutLeftOut);
}
