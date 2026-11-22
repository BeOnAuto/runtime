import { Caller, PlaybookContext, PlaybookReader, PlaybookWriter, recordedCallerOf } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import type { KnownCapabilities } from '../capability/known-capabilities.ts';
import { decisionsOnGoalsAndDefinitions } from '../goals/decisions-on-goals-and-definitions.ts';
import { goalDecider, goalStream, type GoalCommand } from '../goals/goal-decider.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { readDefinition } from '../operations/definition-reading.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import type { CheckedMove } from './move-checks.ts';
import { moveDecider } from './move-decider.ts';

export const movedTogether = Effect.fnUntraced(function* ({ admitted, members, goals }: CheckedMove) {
  const { playbook: from } = yield* PlaybookContext;
  const movedBy = recordedCallerOf(yield* Caller);
  const metadata = yield* commandMetadata;
  const to = admitted.address.playbook;
  yield* (yield* PlaybookWriter).executeOnDefinitions(
    decisionsOnGoalsAndDefinitions(
      goals.map(({ state: { definition, version }, position }) => {
        const command: GoalCommand = {
          type: 'move',
          playbook: from,
          to,
          moved_by: movedBy,
          position,
          expectedVersion: version,
          ...metadata,
        };
        return { definition, stream: goalStream, decider: goalDecider(definition), command };
      }),
      members.map(({ type, name, stored: { definition_id: definition, version } }) => ({
        definition,
        stream: definitionTypeStreamOf(type),
        decider: moveDecider(type, definition),
        command: { name, from, to, moved_by: movedBy, expectedVersion: version, ...metadata },
      })),
    ),
  );
});

export function answeredWhereMoved(known: KnownCapabilities, { admitted, members }: CheckedMove, goals: boolean) {
  const there = Context.make(PlaybookReader, admitted.reader).pipe(Context.add(PlaybookContext, admitted.address));
  return Effect.forEach(members, ({ capability, name }) =>
    Effect.map(readDefinition(capability, known.types, name, goals), ({ definition }) => definition),
  ).pipe(Effect.provideContext(there));
}
