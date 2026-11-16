import {
  noticesFields,
  noticesIn,
  PlaybookContext,
  studioLinkField,
  withNotices,
  withStudioLink,
  type DefinitionSaved,
  type LinkedInStudio,
  type Notice,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { DefinitionSchema, DefinitionWithGoalsSchema, type Definition } from '../registry/definition.ts';
import { RunDetailSchema, type RunDetail } from '../runs/run.ts';

const savedAnnotations = {
  identifier: 'SavedDefinition',
  description: 'A definition just saved, with its document and its page in Studio',
};

const SavedDefinitionSchema = Schema.Struct({
  ...noticesFields(),
  ...DefinitionSchema.fields,
  studio: studioLinkField('saved'),
}).annotate(savedAnnotations);

const SavedDefinitionWithGoalsSchema = Schema.Struct({
  ...noticesFields(),
  ...DefinitionWithGoalsSchema.fields,
  studio: studioLinkField('saved'),
}).annotate(savedAnnotations);

export function savedDefinitionSchemaOf(
  goals: boolean,
): typeof SavedDefinitionSchema | typeof SavedDefinitionWithGoalsSchema {
  return goals ? SavedDefinitionWithGoalsSchema : SavedDefinitionSchema;
}

export const RequestedRunSchema = Schema.Struct({
  ...noticesFields(),
  ...RunDetailSchema.fields,
  studio: studioLinkField('run'),
}).annotate({
  identifier: 'RequestedRun',
  description:
    'A run run_definition answers: how it stands or ended, what its runtime adapter recorded and its page in Studio',
});

export function withDefinitionPageInStudio(
  definition: Definition,
  saved: DefinitionSaved | undefined,
): Effect.Effect<Definition & LinkedInStudio, never, PlaybookContext> {
  const { type, name, definition_id: id, version } = definition;
  return PlaybookContext.use(({ playbook }) =>
    withStudioLink(definition, {
      kind: 'definition',
      playbook,
      type,
      name,
      definition: id,
      version,
      ...(saved === undefined ? {} : { saved }),
    }),
  );
}

function withRunPageInStudio(run: RunDetail): Effect.Effect<RunDetail & LinkedInStudio, never, PlaybookContext> {
  return PlaybookContext.use(({ playbook }) => withStudioLink(run, { kind: 'run', playbook, run: run.run_id }));
}

export function requestedRunAnswered(
  run: RunDetail,
): Effect.Effect<
  RunDetail & LinkedInStudio & { readonly notices?: readonly Notice[]; readonly before_going_on?: string },
  never,
  PlaybookContext
> {
  return Effect.map(withRunPageInStudio(run), (linked) => withNotices(linked, noticesIn(run.record)));
}
