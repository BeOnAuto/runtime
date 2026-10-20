import { Option, Schema } from 'effect';

import type { DiscoveryDocument, Json } from './discovery-document.ts';

type SchemaObject = Readonly<Record<string, Json>>;

type Schemas = Readonly<Record<string, SchemaObject>>;

type Property = readonly [string, SchemaObject];

const NamesSchema = Schema.Array(Schema.String);

const WritableCutFieldsSchema = Schema.Struct({
  schema: Schema.String.annotate({ description: 'The schema whose writable copy the requests of the document send' }),
  writable_in: Schema.Record(Schema.String, NamesSchema).annotate({
    description: 'The properties, of each schema named, that refer to the writable copy in place of the schema',
  }),
  leaves_out: NamesSchema.annotate({ description: 'The properties the copy leaves out beside the output-only ones' }),
  because: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'What the properties the copy leaves out beside the output-only ones are, which its description says; given where it leaves out any',
    }),
  ),
});

type WritableCut = typeof WritableCutFieldsSchema.Type;

function becauseIssuesOf({ leaves_out: leavesOut, because }: WritableCut): readonly Schema.FilterIssue[] {
  if (leavesOut.length > 0 && because === undefined) {
    return [{ path: ['because'], issue: 'Expected because, which says what the properties the cut leaves out are' }];
  }
  return leavesOut.length === 0 && because !== undefined
    ? [{ path: ['because'], issue: 'Expected no because: the cut leaves out the output-only properties alone' }]
    : [];
}

const WritableCutSchema = WritableCutFieldsSchema.check(Schema.makeFilter(becauseIssuesOf));

const KeptCutSchema = Schema.Struct({
  schema: Schema.String.annotate({ description: 'The schema of which the document keeps some properties alone' }),
  keeps: NamesSchema.annotate({ description: 'The properties the document keeps' }),
  holds: Schema.String.annotate({ description: 'What those properties are, which the schema says it holds alone' }),
});

type KeptCut = typeof KeptCutSchema.Type;

export const CutSchema = Schema.Union([WritableCutSchema, KeptCutSchema]);

export type Cut = typeof CutSchema.Type;

const decodeProperties = Schema.decodeUnknownOption(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.JsonObject) }),
);

const writableSuffix = '_Writable';

function schemaNamed(schemas: Schemas, name: string): SchemaObject {
  const schema = Object.hasOwn(schemas, name) ? schemas[name] : undefined;
  if (schema === undefined) {
    throw new Error(`The Discovery document has no schema ${name}, which a cut names`);
  }
  return schema;
}

function propertiesOf(schema: SchemaObject): Schemas {
  return Option.match(decodeProperties(schema), {
    onNone: (): Schemas => ({}),
    onSome: ({ properties }) => properties,
  });
}

function pickedProperties(schemas: Schemas, name: string, names: readonly string[]): readonly Property[] {
  const properties = propertiesOf(schemaNamed(schemas, name));
  const picked: Property[] = [];
  const missing: string[] = [];
  for (const property of names) {
    const schema = Object.hasOwn(properties, property) ? properties[property] : undefined;
    if (schema === undefined) {
      missing.push(property);
    } else {
      picked.push([property, schema]);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `The schema ${name} of the Discovery document has no property ${missing.join(', ')}, which a cut names`,
    );
  }
  return picked;
}

function describedFurther(schema: SchemaObject, sentence: string): string {
  const description = schema['description'];
  return typeof description === 'string' ? `${description} ${sentence}` : sentence;
}

function isOutputOnly(property: SchemaObject): boolean {
  return property['readOnly'] === true;
}

function leftOutSentenceOf({ because }: WritableCut): string {
  return because === undefined
    ? 'The fields a request of this document sets: its output-only fields are left out.'
    : `The fields a request of this document sets: its output-only fields and ${because} are left out.`;
}

function writableCopyOf(schemas: Schemas, cut: WritableCut): SchemaObject {
  const schema = schemaNamed(schemas, cut.schema);
  const leftOut = new Set(pickedProperties(schemas, cut.schema, cut.leaves_out).map(([name]) => name));
  const kept = Object.entries(propertiesOf(schema)).filter(
    ([name, property]: Property) => !isOutputOnly(property) && !leftOut.has(name),
  );
  return {
    ...schema,
    description: describedFurther(schema, leftOutSentenceOf(cut)),
    properties: Object.fromEntries(kept),
  };
}

function referringToTheCopy(schemas: Schemas, name: string, referring: readonly string[], copy: string): SchemaObject {
  const schema = schemaNamed(schemas, name);
  const referred = pickedProperties(schemas, name, referring).map(([property, written]): Property => [
    property,
    { ...written, $ref: copy },
  ]);
  return { ...schema, properties: { ...propertiesOf(schema), ...Object.fromEntries(referred) } };
}

function cutToAWritableCopy(schemas: Schemas, cut: WritableCut): Schemas {
  const copy = `${cut.schema}${writableSuffix}`;
  const referring = Object.entries(cut.writable_in).map(
    ([name, properties]: readonly [string, readonly string[]]): Property => [
      name,
      referringToTheCopy(schemas, name, properties, copy),
    ],
  );
  return { ...schemas, [copy]: writableCopyOf(schemas, cut), ...Object.fromEntries(referring) };
}

function cutToTheKept(schemas: Schemas, cut: KeptCut): Schemas {
  const schema = schemaNamed(schemas, cut.schema);
  const kept = pickedProperties(schemas, cut.schema, cut.keeps);
  return {
    ...schemas,
    [cut.schema]: {
      ...schema,
      description: describedFurther(schema, `In this document it holds ${cut.holds} alone.`),
      properties: Object.fromEntries(kept),
    },
  };
}

function cutOnce(schemas: Schemas, cut: Cut): Schemas {
  return 'keeps' in cut ? cutToTheKept(schemas, cut) : cutToAWritableCopy(schemas, cut);
}

export function discoveryCut(discovery: DiscoveryDocument, cuts: readonly Cut[]): DiscoveryDocument {
  return {
    ...discovery,
    schemas: cuts.reduce<Schemas>((schemas, cut) => cutOnce(schemas, cut), discovery.schemas ?? {}),
  };
}
