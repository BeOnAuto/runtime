import { Schema } from 'effect';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const NamesSchema = Schema.Array(NamedSchema).check(Schema.isMinLength(1));

const ReasonSchema = NamedSchema.annotate({ description: 'Why the translation does so, in words' });

const OperationIdSchema = NamedSchema.annotate({ description: 'The id of an operation the document keeps' });

const PathValueSchema = Schema.Struct({
  parameter: NamedSchema.annotate({
    description: 'The path parameter written as its value in every path, and so no parameter of any operation',
  }),
  value: NamedSchema.annotate({ description: 'The value written in its place' }),
  because: ReasonSchema,
});

const LeftOutParametersSchema = Schema.Struct({
  operation: OperationIdSchema,
  parameters: NamesSchema.annotate({ description: 'The names of the parameters of the operation it leaves out' }),
  because: ReasonSchema,
});

const LeftOutDescriptionsSchema = Schema.Struct({
  operations: NamesSchema.annotate({
    description:
      'The ids of the operations kept whose summary, description and link to documentation the document leaves out',
  }),
  because: ReasonSchema,
});

const SingleStringSchema = Schema.Struct({
  operation: OperationIdSchema,
  at: Schema.String.check(Schema.isPattern(/^(?:\/[^/]+)+$/u)).annotate({
    description:
      'A JSON pointer, under the schema of the JSON body of the request, to the schema written as one string with its description',
  }),
  because: ReasonSchema,
});

const schemeFields = {
  name: NamedSchema.annotate({
    description: 'The name of the oauth2 scheme every operation requires, in place of the schemes of its document',
  }),
  leaving_out: Schema.Array(NamedSchema).annotate({
    description: 'The endings of the scopes an operation lists that its requirements leave out',
  }),
  because: ReasonSchema,
};

const ScopesAtSchema = NamesSchema.annotate({
  description: 'The keys, each inside the one before, under which an operation lists its scopes',
});

const ScopesFromSchemeSchema = NamedSchema.annotate({
  description: "The scheme of the vendor's document whose requirement in an operation lists the scopes it needs",
});

const ListsNoScopesSchema = NamedSchema.annotate({
  description:
    "Why no operation lists a scope, the vendor's documents naming none, so each requires the scheme at the document's root alone",
});

const OpenApiSchemeSchema = Schema.Union([
  Schema.Struct({
    ...schemeFields,
    scopes_at: ScopesAtSchema,
    scopes_from_scheme: Schema.optionalKey(Schema.Never),
    lists_no_scopes: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    ...schemeFields,
    scopes_from_scheme: ScopesFromSchemeSchema,
    scopes_at: Schema.optionalKey(Schema.Never),
    lists_no_scopes: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    name: schemeFields.name,
    lists_no_scopes: ListsNoScopesSchema,
    scopes_at: Schema.optionalKey(Schema.Never),
    scopes_from_scheme: Schema.optionalKey(Schema.Never),
    leaving_out: Schema.optionalKey(Schema.Never),
    because: Schema.optionalKey(Schema.Never),
  }),
]);

export type OpenApiScheme = typeof OpenApiSchemeSchema.Type;

export type ScopedScheme = Exclude<OpenApiScheme, { readonly lists_no_scopes: string }>;

export const OpenApiTranslationSchema = Schema.Struct({
  info: Schema.Struct({ title: NamedSchema, version: NamedSchema, description: NamedSchema }).annotate({
    description: 'The info of the document made',
  }),
  operations: NamesSchema.annotate({
    description: 'The ids of the operations the document keeps, each copied whole from the document that holds it',
  }),
  path_values: Schema.optionalKey(Schema.Array(PathValueSchema)),
  left_out_parameters: Schema.optionalKey(Schema.Array(LeftOutParametersSchema)),
  left_out_descriptions: Schema.optionalKey(Schema.Array(LeftOutDescriptionsSchema)),
  single_strings: Schema.optionalKey(Schema.Array(SingleStringSchema)),
  scheme: OpenApiSchemeSchema,
  keeps_responses: Schema.Boolean.annotate({
    description: 'Whether the operations keep the answers their documents describe, or say only that they answer',
  }),
});

export type OpenApiTranslation = typeof OpenApiTranslationSchema.Type;
