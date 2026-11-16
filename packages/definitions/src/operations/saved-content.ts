import { Effect, Struct } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { contributionsGated } from '../contributions/contribution-gate.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { textMemberNames, textMembersOf } from '../payloads/definition-texts.ts';
import { textsWritten } from '../payloads/kept-texts.ts';
import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { checkedContentOf, firstDefinitionNotice, noticesOfASave, type WrittenDefinition } from './definition-views.ts';
import { isThePlaybooksFirst, recordInRegistry } from './registry-access.ts';

export interface GoalsKeeping {
  readonly goals: boolean;
  readonly messages: boolean;
}

export const noGoalsKept: GoalsKeeping = { goals: false, messages: false };

interface Saving {
  readonly capability: Capability;
  readonly pages: SubjectPages;
  readonly written: WrittenDefinition;
  readonly goals?: boolean;
  readonly messages?: boolean;
}

function withTheTextsKept(content: DefinitionContent, written: WrittenDefinition) {
  return Effect.map(textsWritten(written), ({ texts, inHand }) => ({
    content: { ...Struct.omit(content, textMemberNames), ...textMembersOf(texts) },
    inHand,
  }));
}

export const savedFrom = Effect.fnUntraced(function* (
  { capability, pages, written, goals = false, messages = false }: Saving,
  commandOf: (content: DefinitionContent) => DefinitionCommandData,
) {
  const noticed = yield* noticesOfASave;
  const checking = checkedContentOf(capability, written, pages, noticed.keep);
  const checked = yield* goals ? contributionsGated(capability.type, checking, messages) : checking;
  const { content, inHand } = yield* withTheTextsKept(checked, written);
  const recorded = yield* recordInRegistry(capability, commandOf(content));
  return { ...recorded, inHand, notices: yield* noticed.kept };
});

export const createdFrom = Effect.fnUntraced(function* (
  saving: Saving,
  types: readonly string[],
  commandOf: (content: DefinitionContent) => DefinitionCommandData,
) {
  const saved = yield* savedFrom(saving, commandOf);
  const first = types.includes('workflow') && (yield* isThePlaybooksFirst(types, saving.capability.type, saved));
  return first ? { ...saved, notices: [...saved.notices, firstDefinitionNotice] } : saved;
});
