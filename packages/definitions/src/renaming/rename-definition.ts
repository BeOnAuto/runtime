import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { foundDefinition } from '../operations/registry-access.ts';
import { registriesOf } from '../used-by/users-of-a-definition.ts';
import { renamedTogether, type Resaved } from './rename-append.ts';
import { boundRefused, retiredRefused, runsInProgressOfMembers, startedTypesOf } from './rename-checks.ts';
import { renameMembersOf } from './rename-declarations.ts';
import type { RenameMember, Renaming } from './rename-members.ts';
import { renamedTexts } from './renamed-sources.ts';
import { resavedContent, type Resaving, type WrittenAgain } from './resaved-contents.ts';

interface Renamer extends Resaving {
  readonly capabilities: readonly Capability[];
  readonly started: readonly string[];
}

export function renamerOf(
  capabilities: readonly Capability[],
  resaving: Resaving,
  started = startedTypesOf(capabilities),
): Renamer {
  return { capabilities, started, ...resaving };
}

function writtenAgain(member: RenameMember, renaming: Renaming) {
  return Effect.map(renamedTexts(member, renaming), (texts): readonly WrittenAgain[] =>
    texts === undefined ? [] : [{ member, texts }],
  );
}

function resavedOf({ member, texts }: WrittenAgain, resaving: Resaving) {
  return Effect.map(resavedContent(member.capability, texts, resaving), ({ content, inHand }): Resaved => ({
    member,
    content,
    inHand,
  }));
}

export const definitionRenamed = Effect.fnUntraced(function* (renamer: Renamer, renaming: Renaming) {
  const { capabilities, started } = renamer;
  const { type, from } = renaming;
  yield* retiredRefused(type, yield* foundDefinition(type, from));
  const registries = yield* registriesOf(capabilities.map((each) => each.type));
  const members = yield* renameMembersOf(capabilities, registries, renaming);
  const renamed = yield* Effect.orDie(
    Effect.fromNullishOr(members.find((member) => member.type === type && member.name === from)),
  );
  yield* runsInProgressOfMembers(started, renamed, members);
  const written = (yield* Effect.forEach(members, (member) => writtenAgain(member, renaming))).flat();
  yield* boundRefused(
    renamed,
    written.map(({ member }) => member),
  );
  const resaved = yield* Effect.forEach(written, (each) => resavedOf(each, renamer));
  const { stored, savedAgain } = yield* renamedTogether(renamed, renaming, resaved);
  const own = resaved.find((each) => each.member === renamed);
  return {
    stored,
    inHand: own?.inHand ?? new Map<string, string>(),
    newVersion: own !== undefined,
    notices: [],
    savedAgain,
  };
});
