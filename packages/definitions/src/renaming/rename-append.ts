import { Caller, PlaybookContext, PlaybookWriter, recordedCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { definitionDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import type { NamedDefinition } from '../used-by/called-definitions.ts';
import { byTypeThenName } from '../used-by/definition-users.ts';
import type { RenameMember, Renaming } from './rename-members.ts';

export interface Resaved {
  readonly member: RenameMember;
  readonly content: DefinitionContent;
  readonly inHand: ReadonlyMap<string, string>;
}

export const renamedTogether = Effect.fnUntraced(function* (
  renamed: RenameMember,
  { from, to }: Renaming,
  resaved: readonly Resaved[],
) {
  const address = yield* PlaybookContext;
  const renamedBy = recordedCallerOf(yield* Caller);
  const metadata = yield* commandMetadata;
  const decisionOf = (
    { type, stored: { definition_id: definition } }: RenameMember,
    command: DefinitionCommandData,
  ) => ({
    definition,
    stream: definitionTypeStreamOf(type),
    decider: definitionDecider(type, address, definition),
    command: { ...command, ...metadata },
  });
  const own = resaved.find(({ member }) => member === renamed);
  const others = resaved.filter(({ member }) => member !== renamed);
  const [decided] = yield* (yield* PlaybookWriter).executeOnDefinitions([
    decisionOf(renamed, {
      type: 'rename',
      name: from,
      new_name: to,
      renamed_by: renamedBy,
      expectedVersion: renamed.stored.version,
      ...(own === undefined ? {} : { content: own.content }),
    }),
    ...others.map(({ member, content }) =>
      decisionOf(member, { type: 'update', name: member.name, content, expectedVersion: member.stored.version }),
    ),
  ]);
  const stored = yield* Effect.orDie(Effect.fromNullishOr(decided?.state));
  const savedAgain = others.map(({ member: { type, name } }): NamedDefinition => ({ type, name }));
  return { stored, savedAgain: savedAgain.toSorted(byTypeThenName) };
});
