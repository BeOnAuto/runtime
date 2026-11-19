import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { definitionSchemaOf } from '../registry/definition.ts';
import { answeredWhereMoved, movedTogether } from './move-append.ts';
import { checkedMove, type MoveAsked, type MoveChecking } from './move-checks.ts';
import { moveInputOf } from './move-input.ts';
import { moveAttempt, moveDescription, moveOutcome, moveTask, namedTogether, takenOnAMove } from './move-words.ts';

interface MoveComposition extends Omit<MoveChecking, 'known'> {
  readonly goals: boolean;
}

export function defineMoveDefinitions(capabilities: readonly Capability[], { goals, ...composed }: MoveComposition) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  const named = ({ definitions }: MoveAsked) => namedTogether(words, definitions);
  return defineCommand('playbook', {
    name: 'move_definitions',
    title: 'Move definitions',
    description: moveDescription,
    route: { method: 'POST', path: '/move' },
    inputSchema: moveInputOf(known.types),
    outputSchema: Schema.Struct({ definitions: Schema.Array(definitionSchemaOf(goals)) }),
    reasons: ['invalid_input', 'forbidden', 'not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* (asked) {
      const checked = yield* checkedMove({ known, ...composed }, asked);
      yield* movedTogether(checked);
      return { definitions: yield* answeredWhereMoved(known, checked, goals) };
    }),
    plainLanguage: {
      task: moveTask,
      attempt: (asked) => moveAttempt(named(asked), asked.to),
      outcome: (moved, asked) => moveOutcome(named(asked), asked.to, moved.definitions.length),
      explanations: { taken: takenOnAMove },
    },
  });
}
