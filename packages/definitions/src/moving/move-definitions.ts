import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, type DefinitionWords } from '../plain-language/definition-words.ts';
import { definitionSchemaOf } from '../registry/definition.ts';
import { answeredWhereMoved, movedTogether } from './move-append.ts';
import { checkedMove, namedInTheCall, type MoveAsked, type MoveChecking } from './move-checks.ts';
import { mostDefinitionsMovedAtOnce, moveInputOf, moveWithGoalsInputOf } from './move-input.ts';
import {
  goalMoveOutcome,
  goalsMovedDescription,
  moveAttempt,
  moveDescription,
  moveOutcome,
  moveTask,
  moveWithGoalsDescription,
  moveWithGoalsTask,
  namedTogether,
  namedWithGoalsFirst,
  takenOnAMove,
  takenOnAMoveWithGoals,
  type Named,
} from './move-words.ts';

interface MoveComposition extends Omit<MoveChecking, 'known' | 'messages'> {
  readonly kept: { readonly goals: boolean; readonly messages: boolean };
}

const reasons = ['invalid_input', 'forbidden', 'not_found', 'conflict', 'unavailable'] as const;

function handled(checking: MoveChecking, goals: boolean) {
  return Effect.fnUntraced(function* (asked: MoveAsked) {
    const checked = yield* checkedMove(checking, asked);
    yield* movedTogether(checked);
    const definitions = yield* answeredWhereMoved(checking.known, checked, goals);
    return asked.goals === undefined ? { definitions } : { definitions, goals: [...new Set(asked.goals)] };
  });
}

function movedWithoutGoals(capabilities: readonly Capability[], checking: MoveChecking) {
  const words = definitionWordsFor(capabilities);
  const named = ({ definitions }: { readonly definitions: readonly Named[] }) => namedTogether(words, definitions);
  return defineCommand('playbook', {
    name: 'move_definitions',
    title: 'Move definitions',
    description: moveDescription,
    route: { method: 'POST', path: '/move' },
    inputSchema: moveInputOf(checking.known.types),
    outputSchema: Schema.Struct({ definitions: Schema.Array(definitionSchemaOf(false)) }),
    reasons: [...reasons],
    handle: handled(checking, false),
    plainLanguage: {
      task: moveTask,
      attempt: (asked) => moveAttempt(named(asked), asked.to),
      outcome: (moved, asked) => moveOutcome(named(asked), asked.to, moved.definitions.length),
      explanations: { taken: takenOnAMove },
    },
  });
}

function namedWithGoals(words: DefinitionWords, { definitions = [], goals = [] }: MoveAsked): string {
  return namedWithGoalsFirst(words, [...new Set(goals)], definitions);
}

function attemptWithGoals(words: DefinitionWords, asked: MoveAsked): string {
  const named = namedInTheCall(asked);
  return named === 0 || named > mostDefinitionsMovedAtOnce
    ? moveWithGoalsTask
    : moveAttempt(namedWithGoals(words, asked), asked.to);
}

function outcomeWithGoals(named: string, { to, goals = [] }: MoveAsked, definitions: number): string {
  const moved = new Set(goals).size;
  return moved === 0 ? moveOutcome(named, to, definitions) : goalMoveOutcome(named, to, { goals: moved, definitions });
}

function movedWithGoals(capabilities: readonly Capability[], checking: MoveChecking) {
  const words = definitionWordsFor(capabilities);
  return defineCommand('playbook', {
    name: 'move_definitions',
    title: 'Move definitions',
    description: moveWithGoalsDescription,
    route: { method: 'POST', path: '/move' },
    inputSchema: moveWithGoalsInputOf(checking.known.types),
    outputSchema: Schema.Struct({
      definitions: Schema.Array(definitionSchemaOf(true)),
      goals: Schema.optionalKey(Schema.Array(Schema.String).annotate({ description: goalsMovedDescription })),
    }),
    reasons: [...reasons],
    handle: handled(checking, true),
    plainLanguage: {
      task: moveWithGoalsTask,
      attempt: (asked) => attemptWithGoals(words, asked),
      outcome: (moved, asked) => outcomeWithGoals(namedWithGoals(words, asked), asked, moved.definitions.length),
      explanations: { taken: takenOnAMoveWithGoals },
    },
  });
}

export function defineMoveDefinitions(capabilities: readonly Capability[], { kept, ...composed }: MoveComposition) {
  const checking: MoveChecking = { known: knownCapabilities(capabilities), messages: kept.messages, ...composed };
  return kept.goals ? movedWithGoals(capabilities, checking) : movedWithoutGoals(capabilities, checking);
}
