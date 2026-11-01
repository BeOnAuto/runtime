import { PlaybookContext } from '@on.auto/operations';
import { studioLinkField, withStudioLink, type LinkedInStudio } from '@on.auto/operations/studio-links';
import { Schema, type Effect } from 'effect';

import { DefinitionSchema, type Definition } from '../registry/definition.ts';
import { RunDetailSchema, type RunDetail } from '../runs/run.ts';

export const SavedDefinitionSchema = Schema.Struct({
  ...DefinitionSchema.fields,
  studio: studioLinkField('saved'),
}).annotate({
  identifier: 'SavedDefinition',
  description: 'A definition just saved, with its document and its page in Studio',
});

export const RequestedRunSchema = Schema.Struct({
  ...RunDetailSchema.fields,
  studio: studioLinkField('run'),
}).annotate({
  identifier: 'RequestedRun',
  description:
    'A run run_definition answers: how it stands or ended, what its runtime adapter recorded and its page in Studio',
});

export function withDefinitionPageInStudio(
  definition: Definition,
): Effect.Effect<Definition & LinkedInStudio, never, PlaybookContext> {
  return PlaybookContext.use(({ playbook }) =>
    withStudioLink(definition, { kind: 'definition', playbook, type: definition.type, name: definition.name }),
  );
}

export function withRunPageInStudio(run: RunDetail): Effect.Effect<RunDetail & LinkedInStudio, never, PlaybookContext> {
  return PlaybookContext.use(({ playbook }) => withStudioLink(run, { kind: 'run', playbook, run: run.run_id }));
}
