import { Caller, PlaybookContext, PlaybookReader, PlaybookWriter, recordedCallerOf } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import type { KnownCapabilities } from '../capability/known-capabilities.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { readDefinition } from '../operations/definition-reading.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import type { CheckedMove } from './move-checks.ts';
import { moveDecider } from './move-decider.ts';

export const movedTogether = Effect.fnUntraced(function* ({ admitted, members }: CheckedMove) {
  const { playbook: from } = yield* PlaybookContext;
  const movedBy = recordedCallerOf(yield* Caller);
  const metadata = yield* commandMetadata;
  const to = admitted.address.playbook;
  yield* (yield* PlaybookWriter).executeOnDefinitions(
    members.map(({ type, name, stored: { definition_id: definition } }) => ({
      definition,
      stream: definitionTypeStreamOf(type),
      decider: moveDecider(type, definition),
      command: { name, from, to, moved_by: movedBy, ...metadata },
    })),
  );
});

export function answeredWhereMoved(known: KnownCapabilities, { admitted, members }: CheckedMove, goals: boolean) {
  const there = Context.make(PlaybookReader, admitted.reader).pipe(Context.add(PlaybookContext, admitted.address));
  return Effect.forEach(members, ({ capability, name }) =>
    Effect.map(readDefinition(capability, known.types, name, goals), ({ definition }) => definition),
  ).pipe(Effect.provideContext(there));
}
