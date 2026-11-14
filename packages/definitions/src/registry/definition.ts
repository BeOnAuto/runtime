import { RecordedCallerSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { functionTypeOrder } from '../capability/function-terminology.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import type { TextsAsRecorded } from '../payloads/definition-texts.ts';
import { DefinitionUserSchema } from '../used-by/user-relations.ts';
import { TriggerSchema } from './definition-triggers.ts';

const listedDefinitionFields = {
  type: Schema.String.annotate({
    description:
      'The type of the definition: reasoning, lookup, interaction, prediction, computation, generation or workflow',
  }),
  name: Schema.String.annotate({
    description:
      'The definition name, unique among definitions of its type in the playbook and never given to another, retired or not',
  }),
  definition_id: Schema.String.annotate({
    description: 'The id of the definition, given when it was created and never changed',
  }),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description:
      'The definition version: 1 when created, and one more for every update that changes its document, its overview or its diagram',
  }),
  status: Schema.Literals(['active', 'paused', 'retired']).annotate({
    description: 'active; paused, when it starts no runs until it is resumed; or retired, until it is restored',
  }),
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
        'What the parser finds in the document that may not work as written, such as an answer schema whose answers cannot be enforced while a model writes them, found again whenever the definition is read; the definition was accepted with them',
    }),
  ),
  details: Schema.optionalKey(
    Schema.Struct({
      shape: Schema.optionalKey(
        Schema.String.annotate({
          description:
            'The output shape its output_schema is: series, categories, table, text or asset, each a JSON Schema the runtime owns, which Auto Studio draws',
        }),
      ),
    }).annotate({ description: 'What the runtime declares of the definition beside its schemas' }),
  ),
  triggers: Schema.optionalKey(
    Schema.Array(TriggerSchema).annotate({
      description:
        'For a definition that starts runs on its own, its triggers in the order its document names them: a workflow may have an event trigger, a cron schedule and an every schedule, each kept and matched on its own',
    }),
  ),
  created_at: Schema.String.annotate({ description: 'When the definition was created, in ISO 8601 UTC' }),
  created_by: RecordedCallerSchema.annotate({ description: 'The caller who created the definition, by id and name' }),
  updated_at: Schema.String.annotate({
    description:
      'When the definition was last saved, retired or restored, in ISO 8601 UTC; a pause and a resumption leave it',
  }),
  paused_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the definition was paused, in ISO 8601 UTC; only while it is paused' }),
  ),
  paused_by: Schema.optionalKey(
    RecordedCallerSchema.annotate({
      description: 'The caller who paused the definition, by id and name; only while it is paused',
    }),
  ),
  reason: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Why the definition was paused, in the words of whoever paused it; only while it is paused',
    }),
  ),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({
      description: 'When the definition was retired, in ISO 8601 UTC; only while it is retired',
    }),
  ),
};

const StandingField = Schema.JsonObject.annotate({
  description:
    'How the definition stands where its runtime adapter keeps something for it, read when the definition is: the dataset of a prediction function',
});

const DefinitionPageSchema = Schema.Struct({
  result: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The latest run, or the sample output, rendered through the page's result: Markdown whose first line is the run's headline; in a preview",
    }),
  ),
  runs: Schema.optionalKey(
    Schema.String.annotate({
      description: "The definition's runs so far as its page shows them, Markdown with charts as fenced blocks",
    }),
  ),
  glance: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description:
        "A workflow's glance as its page renders it over its views and its latest ended run: its headline, visual and outstanding items",
    }),
  ),
  standing: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description: "How the page's views stand: live, rebuilding, waiting or stalled, and how far they have read",
    }),
  ),
}).annotate({ description: 'What the page of the definition, the page key of its document, shows when it is read' });

export const ListedDefinitionSchema = Schema.Struct(listedDefinitionFields).annotate({
  identifier: 'ListedDefinition',
  description: 'A saved definition, without its document',
});

export const DefinitionSchema = Schema.Struct({
  ...listedDefinitionFields,
  source: Schema.String.annotate({ description: 'The definition document' }),
  overview: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The overview its author wrote: Markdown for the person who runs the business, kept as written with this version',
    }),
  ),
  diagram: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The diagram its author gave a function with this version: Mermaid source of a flowchart or a state diagram of how it works, or the word none where a picture would add nothing; left out for a workflow and for a version saved without one',
    }),
  ),
  triggers_since: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For an active definition with triggers, the id of the record that saved its current version: from that record on, what its triggers start is a run of this version',
    }),
  ),
  standing: Schema.optionalKey(StandingField),
  page: Schema.optionalKey(DefinitionPageSchema),
  used_by: Schema.optionalKey(
    Schema.Array(DefinitionUserSchema).annotate({
      description:
        'The definitions of the playbook, active or paused, that use this one, read from the playbook when the definition is read: a workflow with the steps that call it, and a lookup function that reads its runs',
    }),
  ),
}).annotate({ identifier: 'Definition', description: 'A saved definition, with its document' });

export type Definition = typeof DefinitionSchema.Type;

export type ReasoningFunctionDefinition = Definition & { readonly type: 'reasoning' };

export type LookupFunctionDefinition = Definition & { readonly type: 'lookup' };

export type InteractionFunctionDefinition = Definition & { readonly type: 'interaction' };

export type PredictionFunctionDefinition = Definition & { readonly type: 'prediction' };

export type ComputationFunctionDefinition = Definition & { readonly type: 'computation' };

export type GenerationFunctionDefinition = Definition & { readonly type: 'generation' };

export type PlaybookFunctionDefinition =
  | ReasoningFunctionDefinition
  | LookupFunctionDefinition
  | InteractionFunctionDefinition
  | PredictionFunctionDefinition
  | ComputationFunctionDefinition
  | GenerationFunctionDefinition;

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

export function isRetired({ status }: Pick<ListedDefinition, 'status'>): boolean {
  return status === 'retired';
}

export type StoredDefinition = Omit<
  Definition,
  'type' | 'media_type' | 'triggers_since' | 'standing' | 'used_by' | 'details' | 'page' | keyof TextsAsRecorded
> &
  TextsAsRecorded & {
    readonly details?: Schema.JsonObject;
    readonly stripped?: StrippedForms;
  };
