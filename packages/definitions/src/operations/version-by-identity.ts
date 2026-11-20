import { NotFound, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionNotFound } from '../registry/registry-lookup.ts';
import { startVersionOnce, versionToStart } from './start-once.ts';

type Asked = Parameters<typeof versionToStart>[1];

const changedWhileStarted = new Unavailable({ detail: 'The state changed while the command was decided' });

function nameHeldBy(type: string, definition: string): Effect.Effect<string | undefined, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    Effect.map(reader.nameHeldBy(definition), (held) => (held?.definitionType === type ? held.name : undefined)),
  );
}

function renamedMeanwhile(type: string, definition: string, read: string) {
  return ({ detail }: { readonly detail: string }) =>
    Effect.flatMap(nameHeldBy(type, definition), (held) =>
      Effect.fail(held === read ? new NotFound({ detail }) : new Unavailable({ detail })),
    );
}

const versionOfTheDefinition = Effect.fnUntraced(function* (capability: Capability, definition: string, asked: Asked) {
  const { type } = capability;
  const held = yield* nameHeldBy(type, definition);
  if (held === undefined) {
    return yield* definitionNotFound(type, asked.name);
  }
  const request = { ...asked, name: held };
  const run = yield* versionToStart(capability, request).pipe(
    Effect.catchTag('not_found', renamedMeanwhile(type, definition, held)),
  );
  return run.definition.definition_id === definition ? { request, run } : yield* changedWhileStarted;
});

interface StartAsked {
  readonly id: string;
  readonly asked: Asked;
  readonly definition: string | undefined;
}

export const versionStartedOnce = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  { id, asked, definition }: StartAsked,
) {
  const { request, run } =
    definition === undefined
      ? { request: asked, run: yield* versionToStart(capability, asked) }
      : yield* versionOfTheDefinition(capability, definition, asked);
  return { run, started: startVersionOnce(capabilities, capability, id, { request, run }) };
});
