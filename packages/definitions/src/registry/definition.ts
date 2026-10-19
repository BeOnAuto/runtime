import { Schema } from 'effect';

import { functionTypeOrder } from '../capability/function-terminology.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import { TriggerSchema } from './definition-triggers.ts';

const listedDefinitionFields = {
  type: Schema.String.annotate({
    description: 'The type of the definition: reasoning, interaction, prediction, recall, computation or workflow',
  }),
  name: Schema.String.annotate({
    description: 'The definition name, unique among definitions of its type in the playbook and never reused',
  }),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The definition version: 1 when created, and one more for every update that changes its document',
  }),
  status: Schema.Literals(['active', 'retired']).annotate({ description: 'active, or retired for good' }),
  media_type: Schema.String.annotate({
    description: 'The media type of the definition document, set by its runtime adapter',
  }),
  description: Schema.optionalKey(
    Schema.String.annotate({ description: 'What the definition does, as its document says' }),
  ),
  input_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the input a run takes' }),
  ),
  output_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the result a run produces' }),
  ),
  warnings: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'What the parser found that may not work everywhere, such as a schema some providers reject; the definition was accepted with these warnings',
    }),
  ),
  details: Schema.optionalKey(
    Schema.Struct({
      shape: Schema.String.annotate({
        description:
          'The output shape its output_schema is: series, categories, table or text, each a JSON Schema the runtime owns, which Auto Studio draws',
      }),
    }).annotate({ description: 'What the runtime declares of the definition beside its schemas' }),
  ),
  triggers: Schema.optionalKey(
    Schema.Array(TriggerSchema).annotate({
      description:
        'For a definition that starts runs on its own, its triggers in the order its document names them: a workflow may have an event trigger, a cron schedule and an every schedule, each kept and matched on its own',
    }),
  ),
  created_at: Schema.String.annotate({ description: 'When the definition was created, in ISO 8601 UTC' }),
  created_by: Schema.String.annotate({ description: 'The id of the caller who created the definition' }),
  updated_at: Schema.String.annotate({ description: 'When the definition last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the definition was retired, in ISO 8601 UTC' }),
  ),
};

const StandingField = Schema.JsonObject.annotate({
  description:
    'How the definition stands where its runtime adapter keeps something for it, read when the definition is: for a recall function, the view it keeps, with its state (live, rebuilding, waiting or stalled), its version, its checkpoint, the events folded and how far it lags the playbook',
});

export const ListedDefinitionSchema = Schema.Struct(listedDefinitionFields).annotate({
  identifier: 'ListedDefinition',
  description: 'A saved definition, without its document',
});

export const DefinitionSchema = Schema.Struct({
  ...listedDefinitionFields,
  source: Schema.String.annotate({ description: 'The definition document' }),
  overview: Schema.String.annotate({
    description:
      'The definition in plain words for a person who does not read its document: Markdown with headings, lists, tables of its fields and, where one helps, a diagram, saying what it needs and produces and what it does, as its type has it, composed by the runtime from the document when this version was saved and written each time it is read, with, after what the document says, the definitions a workflow calls, each with its description, and the active definitions of the playbook that use this one, a workflow with the steps that call it, and their exact names under Details at the end',
  }),
  triggers_since: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For an active definition with triggers, the id of the record that saved its current version: from that record on, what its triggers start is a run of this version',
    }),
  ),
  standing: Schema.optionalKey(StandingField),
}).annotate({ identifier: 'Definition', description: 'A saved definition, with its document' });

export type Definition = typeof DefinitionSchema.Type;

export type ReasoningFunctionDefinition = Definition & { readonly type: 'reasoning' };

export type InteractionFunctionDefinition = Definition & { readonly type: 'interaction' };

export type PredictionFunctionDefinition = Definition & { readonly type: 'prediction' };

export type ComputationFunctionDefinition = Definition & { readonly type: 'computation' };

export type RecallFunctionDefinition = Definition & { readonly type: 'recall' };

export type PlaybookFunctionDefinition =
  | ReasoningFunctionDefinition
  | InteractionFunctionDefinition
  | PredictionFunctionDefinition
  | ComputationFunctionDefinition
  | RecallFunctionDefinition;

const playbookFunctionTypes: ReadonlySet<string> = new Set<string>(functionTypeOrder);

export function isPlaybookFunctionType(type: string): boolean {
  return playbookFunctionTypes.has(type);
}

export type WorkflowDefinition = Definition & { readonly type: 'workflow' };

export function isPlaybookFunctionDefinition(definition: Definition): definition is PlaybookFunctionDefinition {
  return isPlaybookFunctionType(definition.type);
}

export function isWorkflowDefinition(definition: Definition): definition is WorkflowDefinition {
  return definition.type === 'workflow';
}

export type ListedDefinition = typeof ListedDefinitionSchema.Type;

export type StoredDefinition = Omit<
  Definition,
  'type' | 'media_type' | 'triggers_since' | 'standing' | 'details' | 'overview'
> & {
  readonly overview: unknown;
  readonly details?: Schema.JsonObject;
  readonly stripped?: StrippedForms;
};
