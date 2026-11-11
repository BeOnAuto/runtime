import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { listedWith, withTheTextsInHand, type Answering } from '../operations/answered-definitions.ts';
import { textsToAnswer } from '../operations/unread-texts.ts';
import { textsByDigestOf, type TextsByDigest } from '../payloads/kept-texts.ts';
import type { Definition } from '../registry/definition.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';
import { storedFromTheReadModel, type RegisteredInTheReadModel } from './read-model-stored.ts';
import { usersFromTheReadModel } from './read-model-users.ts';
import { warningsAtAnOpen } from './remembered-warnings.ts';

export interface ReadFromTheReadModel extends RegisteredInTheReadModel {
  readonly definition: Definition;
  readonly inHand: TextsByDigest;
}

function withUsers(definition: Definition, users: readonly DefinitionUser[]): Definition {
  return users.length === 0 ? definition : { ...definition, used_by: users };
}

export const definitionFromTheReadModel = Effect.fnUntraced(function* (
  capability: Capability,
  types: readonly string[],
  name: string,
  { change, inHand = new Map() }: Answering = {},
) {
  const found = yield* storedFromTheReadModel(capability.type, name);
  const { stored, savedBy } = found;
  const texts = yield* textsToAnswer(capability.type, stored, change).pipe(withTheTextsInHand(inHand));
  const opened = { savedBy, document: texts.source, saved: stored.warnings ?? [] };
  const warnings = yield* warningsAtAnOpen(capability, opened);
  const users = yield* usersFromTheReadModel(types, { type: capability.type, name });
  const definition = withUsers({ ...listedWith(capability, stored, warnings), ...texts }, users);
  const read: ReadFromTheReadModel = { ...found, definition, inHand: textsByDigestOf(stored, texts) };
  return read;
});
