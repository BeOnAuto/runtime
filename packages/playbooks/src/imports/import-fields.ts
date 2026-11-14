import { Schema } from 'effect';

import { CreatedPlaybookWithGoalsSchema } from '../goals/goals-fields.ts';
import { PlaybookIdField, PlaybookNameField } from '../operations/playbook-fields.ts';

const ImportIdField = Schema.String.annotate({
  description:
    'The id of this import, chosen by the caller, such as a UUID: sending it again with the same package goes on where the import stopped',
}).check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u));

const PackageDefinitionSchema = Schema.Struct({
  type: Schema.String.annotate({ description: 'The type of the definition' }),
  name: Schema.String.annotate({ description: 'The name of the definition' }),
  source: Schema.String.annotate({ description: 'The definition document' }),
  overview: Schema.optionalKey(Schema.String.annotate({ description: 'Its overview' })),
  diagram: Schema.optionalKey(Schema.String.annotate({ description: 'Its diagram' })),
  paused: Schema.Boolean.annotate({
    description: 'Whether it was paused where it was exported; every definition is imported paused',
  }),
});

const PackageSchema = Schema.Struct({
  format: Schema.Int.annotate({ description: 'The format of the package, 1' }),
  page: Schema.optionalKey(Schema.String.annotate({ description: "The playbook's page" })),
  goals: Schema.optionalKey(Schema.String.annotate({ description: "The playbook's goals, which an import requires" })),
  definitions: Schema.Array(PackageDefinitionSchema).annotate({
    description: 'The definitions, in an order that can be created front to back, at most 100',
  }),
}).annotate({ description: 'A package as an export answers it, at most 1 MB' });

export const importPlaybookFields = {
  playbook: PlaybookIdField,
  import_id: ImportIdField,
  title: Schema.optionalKey(PlaybookNameField),
  package: PackageSchema,
};

export const ImportedPlaybookSchema = Schema.Struct({
  ...CreatedPlaybookWithGoalsSchema.fields,
  models_not_offered: Schema.Array(Schema.String).annotate({
    description: 'The models its definitions name that this runtime does not offer, which they cannot run on here',
  }),
}).annotate({
  identifier: 'ImportedPlaybook',
  description: 'A playbook made from a package, every definition paused, with its goals and its page in Studio',
});
