import { Schema } from 'effect';

import { PORTABLE_FORMAT } from '../portable/portable-package.ts';

const ExportedDefinitionSchema = Schema.Struct({
  type: Schema.String.annotate({ description: 'The type of the definition' }),
  name: Schema.String.annotate({ description: 'The name of the definition' }),
  source: Schema.String.annotate({ description: 'The definition document, as saved' }),
  overview: Schema.optionalKey(Schema.String.annotate({ description: 'Its overview, as saved' })),
  diagram: Schema.optionalKey(Schema.String.annotate({ description: 'Its diagram, as saved' })),
  paused: Schema.Boolean.annotate({ description: 'Whether the definition is paused in this playbook' }),
}).annotate({ description: 'A definition of the playbook, active or paused' });

const NeededConnectionSchema = Schema.Struct({
  server: Schema.String.annotate({ description: 'The name of a tool server the definitions call' }),
  used_by: Schema.Array(Schema.String).annotate({
    description: 'The definitions that name it, each as its type and name joined by a slash',
  }),
}).annotate({ description: 'A connection a copy of the playbook needs' });

const NeedsSchema = Schema.Struct({
  connections: Schema.Array(NeededConnectionSchema).annotate({
    description: 'The tool servers the definitions name, by name',
  }),
  types: Schema.Array(Schema.String).annotate({ description: 'The types of the definitions' }),
  models: Schema.Array(Schema.String).annotate({ description: 'The models the definitions name' }),
}).annotate({ description: 'What a runtime needs before a copy of the playbook can run' });

const OccurrenceSchema = Schema.Struct({
  part: Schema.Literals(['goals', 'page', 'definition']).annotate({ description: 'Where the value occurs' }),
  name: Schema.optionalKey(
    Schema.String.annotate({ description: 'For a definition, its type and name joined by a slash' }),
  ),
  field: Schema.optionalKey(
    Schema.Literals(['source', 'overview', 'diagram']).annotate({
      description: 'For a definition, which of its texts holds the value',
    }),
  ),
  line: Schema.Int.annotate({ description: 'The line it occurs on, counted from 1' }),
}).annotate({ description: 'One place a value occurs' });

const FindingSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the finding, the same wherever the value occurs' }),
  class: Schema.Literals(['secret', 'address', 'id', 'handle']).annotate({
    description:
      'secret, a token, a key or an address that carries a credential; address, an email address, an address on the web or its host; id, a channel or user id or another opaque id; handle, a channel name or an @name',
  }),
  value: Schema.String.annotate({ description: 'The value as it is written' }),
  occurrences: Schema.Array(OccurrenceSchema).annotate({ description: 'Every place the value occurs' }),
}).annotate({ description: 'A value that may be private to the org, found in the texts of the playbook' });

export const PlaybookExportSchema = Schema.Struct({
  format: Schema.Literal(PORTABLE_FORMAT).annotate({ description: 'The format of the package, 1' }),
  digest: Schema.String.annotate({
    description: 'The digest of the package: its format, page, goals and definitions, hashed whole',
  }),
  page: Schema.optionalKey(
    Schema.String.annotate({ description: "The playbook's page as saved; left out when it has none" }),
  ),
  goals: Schema.optionalKey(
    Schema.String.annotate({ description: "The playbook's goals as saved; left out when it has none" }),
  ),
  definitions: Schema.Array(ExportedDefinitionSchema).annotate({
    description:
      'Every active and paused definition, functions first and then workflows, each in the order it was created, so a copy can create them front to back',
  }),
  needs: NeedsSchema,
  findings: Schema.Array(FindingSchema).annotate({
    description:
      'The values a fixed scan of the goals, the page and every source, overview and diagram finds that may be private to the org',
  }),
}).annotate({ identifier: 'PlaybookExport', description: "The playbook's method, as a package a copy is made from" });

export type PlaybookExport = typeof PlaybookExportSchema.Type;
